"""Durable workflow journal with atomic transitions, an audit chain and graph outbox.

SQLite is not a graph substitute. Only FalkorDB selects graph-based follow-ups.
The journal prevents lost approvals, duplicate executions and partial dual writes.
"""

import hashlib
import json
import os
import sqlite3
import time
import uuid
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Any

from arcloom.domain import DomainError


def canonical(value: Any) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )


def digest(value: str | bytes) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
CREATE TABLE IF NOT EXISTS tenants(
 id TEXT PRIMARY KEY, revision TEXT NOT NULL, scope_enabled INTEGER NOT NULL DEFAULT 1,
 created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS members(
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
 role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1,
 created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
 csrf_hash TEXT NOT NULL, expires_at REAL NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits(
 key TEXT PRIMARY KEY, window_start REAL NOT NULL, count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cases(
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL REFERENCES tenants(id), title TEXT NOT NULL,
 test_id TEXT NOT NULL, asset_id TEXT NOT NULL, revision TEXT NOT NULL, origin TEXT NOT NULL,
 state TEXT NOT NULL, researcher TEXT NOT NULL, created_by TEXT NOT NULL,
 reason TEXT NOT NULL, supports TEXT NOT NULL DEFAULT '[]', path TEXT NOT NULL DEFAULT '[]',
 depth INTEGER NOT NULL DEFAULT 0, parent_id TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL,
 UNIQUE(tenant,id), UNIQUE(tenant,test_id,revision)
);
CREATE TABLE IF NOT EXISTS reports(
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL, case_id TEXT NOT NULL, title TEXT NOT NULL,
 description TEXT NOT NULL, researcher TEXT NOT NULL, submitted_by TEXT NOT NULL,
 created_at REAL NOT NULL,
 FOREIGN KEY(tenant,case_id) REFERENCES cases(tenant,id)
);
CREATE TABLE IF NOT EXISTS approvals(
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL, case_id TEXT NOT NULL, decision TEXT NOT NULL,
 actor TEXT NOT NULL, reason TEXT NOT NULL, revision TEXT NOT NULL, expires_at REAL NOT NULL,
 created_at REAL NOT NULL,
 FOREIGN KEY(tenant,case_id) REFERENCES cases(tenant,id)
);
CREATE TABLE IF NOT EXISTS jobs(
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL, case_id TEXT NOT NULL, approval_id TEXT NOT NULL,
 status TEXT NOT NULL, lease_until REAL, fence TEXT, created_at REAL NOT NULL, finished_at REAL,
 FOREIGN KEY(tenant,case_id) REFERENCES cases(tenant,id),
 FOREIGN KEY(approval_id) REFERENCES approvals(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(tenant,case_id)
 WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS runs(
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL, case_id TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE,
 test_id TEXT NOT NULL, revision TEXT NOT NULL, outcome TEXT NOT NULL, evidence_hash TEXT NOT NULL,
 receipt TEXT NOT NULL, created_at REAL NOT NULL,
 FOREIGN KEY(tenant,case_id) REFERENCES cases(tenant,id)
);
CREATE TABLE IF NOT EXISTS reviews(
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL, case_id TEXT NOT NULL, run_id TEXT NOT NULL UNIQUE,
 actor TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT NOT NULL, created_at REAL NOT NULL,
 FOREIGN KEY(tenant,case_id) REFERENCES cases(tenant,id), FOREIGN KEY(run_id) REFERENCES runs(id)
);
CREATE TABLE IF NOT EXISTS findings(
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL, case_id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL,
 test_id TEXT NOT NULL, revision TEXT NOT NULL, current INTEGER NOT NULL, depth INTEGER NOT NULL,
 title TEXT NOT NULL, researcher TEXT NOT NULL, supports TEXT NOT NULL, created_at REAL NOT NULL,
 FOREIGN KEY(tenant,case_id) REFERENCES cases(tenant,id), FOREIGN KEY(run_id) REFERENCES runs(id)
);
CREATE TABLE IF NOT EXISTS events(
 seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
 tenant TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL, object_id TEXT NOT NULL,
 at REAL NOT NULL, payload TEXT NOT NULL, previous_hash TEXT NOT NULL, event_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_tenant_seq ON events(tenant,seq);
CREATE TABLE IF NOT EXISTS outbox(
 seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE,
 payload TEXT NOT NULL, applied_at REAL, attempts INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(event_id) REFERENCES events(event_id)
);
CREATE TABLE IF NOT EXISTS budgets(
 tenant TEXT NOT NULL, revision TEXT NOT NULL, executions INTEGER NOT NULL DEFAULT 0,
 model_calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(tenant,revision)
);
CREATE TABLE IF NOT EXISTS idempotency(
 tenant TEXT NOT NULL, actor TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL,
 request_hash TEXT NOT NULL, response TEXT NOT NULL, created_at REAL NOT NULL,
 PRIMARY KEY(tenant,actor,operation,key)
);
CREATE TABLE IF NOT EXISTS agent_sessions(
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL, actor TEXT NOT NULL, provider TEXT NOT NULL,
 model TEXT NOT NULL, status TEXT NOT NULL, source_id TEXT, candidates TEXT NOT NULL,
 selected_id TEXT, case_id TEXT, reason TEXT, input_tokens INTEGER NOT NULL DEFAULT 0,
 output_tokens INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL, finished_at REAL
);
CREATE TABLE IF NOT EXISTS locks(
 name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at REAL NOT NULL
);
"""


class Store:
    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root, self.path = root, root / "journal.sqlite3"
        with closing(self.connect()) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA)
            if conn.execute("SELECT version FROM schema_version").fetchone()[0] != 1:
                raise RuntimeError("Unsupported database schema; restore a compatible version")
        os.chmod(self.path, 0o600)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=10000")
        return conn

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        conn = self.connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def one(self, sql: str, params: tuple = ()) -> dict | None:
        conn = self.connect()
        try:
            row = conn.execute(sql, params).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def all(self, sql: str, params: tuple = ()) -> list[dict]:
        conn = self.connect()
        try:
            return [dict(row) for row in conn.execute(sql, params).fetchall()]
        finally:
            conn.close()

    @staticmethod
    def event(
        conn: sqlite3.Connection,
        tenant: str,
        kind: str,
        actor: str,
        object_id: str,
        payload: dict,
        projection: dict | None = None,
    ) -> str:
        previous = conn.execute(
            "SELECT event_hash FROM events WHERE tenant=? ORDER BY seq DESC LIMIT 1", (tenant,)
        ).fetchone()
        prev_hash = previous[0] if previous else "0" * 64
        eid, at = new_id("evt"), time.time()
        record = {
            "event_id": eid,
            "tenant": tenant,
            "kind": kind,
            "actor": actor,
            "object_id": object_id,
            "at": at,
            "payload": payload,
            "previous_hash": prev_hash,
        }
        conn.execute(
            "INSERT INTO events(event_id,tenant,kind,actor,object_id,at,payload,previous_hash,event_hash) VALUES(?,?,?,?,?,?,?,?,?)",
            (
                eid,
                tenant,
                kind,
                actor,
                object_id,
                at,
                canonical(payload),
                prev_hash,
                digest(canonical(record)),
            ),
        )
        if projection is not None:
            conn.execute(
                "INSERT INTO outbox(tenant,event_id,payload) VALUES(?,?,?)",
                (tenant, eid, canonical(projection)),
            )
        return eid

    def verify_audit(self, tenant: str) -> dict:
        previous, count = "0" * 64, 0
        for row in self.all("SELECT * FROM events WHERE tenant=? ORDER BY seq", (tenant,)):
            count += 1
            record = {
                k: row[k]
                for k in ("event_id", "tenant", "kind", "actor", "object_id", "at", "previous_hash")
            }
            record["payload"] = json.loads(row["payload"])
            if row["previous_hash"] != previous or digest(canonical(record)) != row["event_hash"]:
                return {"valid": False, "checked": count, "first_invalid_seq": row["seq"]}
            previous = row["event_hash"]
        return {
            "valid": True,
            "checked": count,
            "head_hash": previous,
            "note": "Hash chain detects changes; export the head to an independent trusted store for anchoring.",
        }

    def limit(self, key: str, maximum: int, window: float, now: float | None = None) -> None:
        now = time.time() if now is None else now
        with self.transaction() as conn:
            row = conn.execute("SELECT * FROM rate_limits WHERE key=?", (key,)).fetchone()
            if row is None or now >= row["window_start"] + window:
                conn.execute("INSERT OR REPLACE INTO rate_limits VALUES(?,?,1)", (key, now))
            elif row["count"] >= maximum:
                raise DomainError("rate_limited", "Too many requests. Try again shortly.", 429)
            else:
                conn.execute("UPDATE rate_limits SET count=count+1 WHERE key=?", (key,))

    def acquire_lock(self, name: str, owner: str, seconds: float) -> bool:
        now = time.time()
        with self.transaction() as conn:
            conn.execute("DELETE FROM locks WHERE name=? AND expires_at<?", (name, now))
            row = conn.execute("SELECT owner FROM locks WHERE name=?", (name,)).fetchone()
            if row and row["owner"] != owner:
                return False
            conn.execute("INSERT OR REPLACE INTO locks VALUES(?,?,?)", (name, owner, now + seconds))
        return True

    def release_lock(self, name: str, owner: str) -> None:
        with self.transaction() as conn:
            conn.execute("DELETE FROM locks WHERE name=? AND owner=?", (name, owner))


def row_or_error(
    conn: sqlite3.Connection, sql: str, params: tuple, message: str = "Not found"
) -> dict:
    row = conn.execute(sql, params).fetchone()
    if row is None:
        raise DomainError("not_found", message, 404)
    return dict(row)
