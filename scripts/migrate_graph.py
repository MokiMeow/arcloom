"""Stage a verified FalkorDB projection; never activate it or modify the source journal.

Default: inspect a consistent read-only SQLite backup. --apply replays every tenant
projection into a fresh target graph, including already applied historical events.
Stop application writers first. A successful report is a point-in-time proof only;
the operator must keep writers stopped until any separately managed cutover.
Credentials belong in the ignored --target-env file, never command arguments.
"""

import argparse
import hashlib
import ipaddress
import json
import sqlite3
import subprocess
import sys
import uuid
from contextlib import closing, suppress
from pathlib import Path
from tempfile import TemporaryDirectory

from dotenv import dotenv_values

from arcloom.config import Settings
from arcloom.graph import KINDS, RELATIONS, FalkorGraph
from arcloom.intelligence import GraphIntelligence
from arcloom.storage import Store, canonical

ROOT = Path(__file__).resolve().parents[1]


class MigrationError(Exception):
    """Only fixed, non-secret diagnostics cross the CLI boundary."""


def is_ignored(path: Path) -> bool:
    result = subprocess.run(
        ["git", "check-ignore", "--quiet", "--", str(path.resolve())],
        cwd=ROOT,
        capture_output=True,
        timeout=10,
        check=False,
    )
    return result.returncode == 0


def load_target(
    path: Path, source: Settings, *, allow_plaintext_synthetic: bool = False
) -> Settings:
    if not path.is_file() or not is_ignored(path):
        raise MigrationError("Target configuration must be an existing git-ignored private file.")
    try:
        # Deliberately do not inherit graph credentials from environment or source.
        values = dotenv_values(path, interpolate=False)
        required = ("HOST", "PORT", "USERNAME", "PASSWORD", "SSL")
        if any(not values.get("ARCLOOM_GRAPH_" + key) for key in required):
            raise MigrationError(
                "Target file requires explicit graph host, port, username, password and SSL."
            )
        raw = values["ARCLOOM_GRAPH_SSL"].lower()
        if raw not in {"true", "false", "1", "0", "yes", "no", "on", "off"}:
            raise MigrationError("Target SSL must be an explicit boolean.")
        ssl = raw in {"true", "1", "yes", "on"}
        host = values["ARCLOOM_GRAPH_HOST"].strip()
        if not host or any(c in host for c in "/@?#\\ \t\r\n"):
            raise MigrationError("Target graph host is invalid.")
        try:
            local = ipaddress.ip_address(host).is_loopback
        except ValueError:
            local = host.lower() == "localhost"
        if not ssl and not local and not allow_plaintext_synthetic:
            raise MigrationError(
                "Remote targets require TLS; plaintext requires --allow-plaintext-synthetic."
            )
        data = source.model_dump()
        data.update(
            graph_mode="server",
            graph_host=host,
            graph_port=int(values["ARCLOOM_GRAPH_PORT"]),
            graph_username=values["ARCLOOM_GRAPH_USERNAME"],
            graph_password=values["ARCLOOM_GRAPH_PASSWORD"],
            graph_ssl=ssl,
            graph_prefix=values.get("ARCLOOM_GRAPH_PREFIX")
            or "arcloom_stage_" + uuid.uuid4().hex[:20],
        )
        return Settings(_env_file=None, **data)
    except MigrationError:
        raise
    except Exception:
        raise MigrationError(
            "Target configuration is invalid; no credentials were logged."
        ) from None


class Projection:
    """Real-engine boundary, replaceable only through explicit Python dependency injection."""

    def __init__(self, settings: Settings):
        self.graph = FalkorGraph(settings)

    def graph_name(self, tenant):
        return self.graph.graph_name(tenant)

    def exists(self, tenant):
        # GRAPH.LIST does not instantiate a missing graph, unlike a graph query.
        names = self.graph._database().list_graphs()
        return self.graph_name(tenant) in {
            name.decode() if isinstance(name, bytes) else name for name in names
        }

    def apply(self, tenant, payload):
        self.graph.apply(tenant, payload)

    def snapshot(self, tenant):
        nodes = self.graph._query(
            tenant,
            "MATCH (n:Entity) RETURN n.id,n.kind,n.data,properties(n),labels(n)",
            readonly=True,
        )
        edges = self.graph._query(
            tenant,
            "MATCH (a:Entity)-[r]->(b:Entity) RETURN a.id,type(r),b.id,r.data,properties(r)",
            readonly=True,
        )
        return {
            "nodes": [
                dict(id=i, kind=k, props=json.loads(d), stored_props=p, labels=sorted(labels))
                for i, k, d, p, labels in nodes
            ],
            "edges": [
                dict(source=a, relation=r, target=b, props=json.loads(d or "{}"), stored_props=p)
                for a, r, b, d, p in edges
            ],
        }

    def view(self, tenant):
        return self.graph.view(tenant)

    def candidates(self, tenant, revision, source_id=None):
        return self.graph.candidates(tenant, revision, source_id)

    def prepare(self, tenant):
        GraphIntelligence(self.graph).prepare(tenant)
        indexes = self.graph._query(
            tenant, "CALL db.indexes() YIELD label, types RETURN label, types", readonly=True
        )
        fields = next((types for label, types in indexes if label == "Entity"), {})
        if any("FULLTEXT" not in fields.get(field, []) for field in ("title", "description")):
            raise MigrationError("Target full-text index verification failed.")

    def close(self):
        # Close the actual Redis connection rather than FalkorGraph.close(), whose
        # lite implementation issues SAVE against the source database.
        database = self.graph._db
        if database is not None:
            connection = getattr(database, "connection", None)
            if connection is not None:
                connection.close()
                connection.connection_pool.disconnect()


def readonly_journal(path):
    if not path.is_file():
        raise MigrationError("Source journal does not exist; no files were created.")
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=10)


def fingerprint(connection):
    """Logical entire-journal digest is insensitive to WAL checkpoints."""
    with connection:
        connection.execute("BEGIN")
        try:
            hasher = hashlib.sha256()
            for line in connection.iterdump():
                hasher.update(line.encode("utf-8"))
                hasher.update(b"\n")
            return hasher.hexdigest()
        finally:
            connection.rollback()


def normalize(view):
    return {key: sorted(canonical(item) for item in view[key]) for key in ("nodes", "edges")}


def basic_view(view):
    return {
        "nodes": [{k: item[k] for k in ("id", "kind", "props")} for item in view["nodes"]],
        "edges": [
            {k: item[k] for k in ("source", "relation", "target", "props")}
            for item in view["edges"]
        ],
    }


def candidates(projection, tenant, revisions, finding_ids):
    result = {}
    for revision in sorted(revisions):
        for finding in [None, *sorted(finding_ids)]:
            items = []
            for candidate in projection.candidates(tenant, revision, finding):
                value = candidate.public()
                value["path"] = sorted(value["path"], key=canonical)
                value["finding_ids"] = sorted(value["finding_ids"])
                value["requirements"] = sorted(value["requirements"])
                items.append(canonical(value))
            result[(revision, finding)] = sorted(items)
    return result


def validate_payload(payload):
    if not isinstance(payload, dict) or set(payload) - {"nodes", "edges"}:
        raise MigrationError("Invalid projection payload; no replay was attempted.")
    for category in ("nodes", "edges"):
        if not isinstance(payload.get(category, []), list):
            raise MigrationError("Invalid projection payload; no replay was attempted.")
        for item in payload.get(category, []):
            if not isinstance(item, dict) or not isinstance(item.get("props"), dict):
                raise MigrationError("Invalid projection payload; no replay was attempted.")
            keys = ("id",) if category == "nodes" else ("source", "target")
            if any(not isinstance(item.get(key), str) or not item[key] for key in keys):
                raise MigrationError("Invalid projection identity; no replay was attempted.")
            if (category == "nodes" and item.get("kind") not in KINDS) or (
                category == "edges" and item.get("relation") not in RELATIONS
            ):
                raise MigrationError(
                    "Unregistered projection label or relationship; no replay was attempted."
                )
    canonical(payload)  # Reject non-finite JSON values before any target mutation.


def _stage(source, target, *, apply, graph_factory, resources):
    tenant = source.tenant
    with TemporaryDirectory(prefix="arcloom-migration-") as temporary:
        root = Path(temporary)
        backup_path = root / "journal.sqlite3"
        with closing(readonly_journal(source.data_dir / "journal.sqlite3")) as live:
            source_version = live.execute("PRAGMA data_version").fetchone()[0]
            with closing(sqlite3.connect(backup_path)) as backup:
                live.backup(backup)
                source_digest = fingerprint(backup)
            store = Store(root)  # Schema initialization is confined to the disposable backup.
            audit = store.verify_audit(tenant)
            if not audit["valid"]:
                raise MigrationError("Source audit verification failed; target was not modified.")
            tenant_row = store.one("SELECT revision FROM tenants WHERE id=?", (tenant,))
            if tenant_row is None:
                raise MigrationError("Source journal has no configured tenant.")
            rows = store.all(
                "SELECT o.*, e.seq AS event_seq, e.tenant AS event_tenant FROM outbox o "
                "LEFT JOIN events e ON e.event_id=o.event_id WHERE o.tenant=? ORDER BY e.seq,o.seq",
                (tenant,),
            )
            if any(row["event_seq"] is None or row["event_tenant"] != tenant for row in rows):
                raise MigrationError("Source projection references an invalid audit event.")
            payloads = [json.loads(row["payload"]) for row in rows]
            for payload in payloads:
                validate_payload(payload)
            pending = sum(row["applied_at"] is None for row in rows)
            sequence = store.one(
                "SELECT coalesce(max(seq),0) AS n FROM events WHERE tenant=?", (tenant,)
            )["n"]
            report = {
                "status": "dry_run",
                "ready_for_manual_cutover": False,
                "source": {
                    "tenant": tenant,
                    "revision": tenant_row["revision"],
                    "audit": audit,
                    "event_seq": sequence,
                    "outbox_seq": max((r["seq"] for r in rows), default=0),
                    "projection_events": len(rows),
                    "pending_events": pending,
                    "journal_sha256": source_digest,
                },
                "target": {
                    "graph_prefix": target.graph_prefix,
                    "tls": target.graph_ssl,
                    "mode": target.graph_mode,
                },
                "replayed_events": 0,
                "note": "Staging only. No environment configuration or activation was changed.",
            }
            if not apply:
                if (
                    fingerprint(live) != source_digest
                    or live.execute("PRAGMA data_version").fetchone()[0] != source_version
                ):
                    raise MigrationError(
                        "Source journal changed during inspection; rerun with writers stopped."
                    )
                return report
            if pending:
                raise MigrationError(
                    "Source has pending graph projections; synchronize it and stop writers before migration."
                )
            if not rows:
                raise MigrationError("Source has no projection events to migrate.")
            source_graph = graph_factory(source)
            resources.append(source_graph)
            target_graph = graph_factory(target)
            resources.append(target_graph)
            report["target"]["graph_name"] = target_graph.graph_name(tenant)
            if target_graph.exists(tenant):
                raise MigrationError("Target graph already exists; choose a fresh graph prefix.")
            if not source_graph.exists(tenant):
                raise MigrationError("Source graph does not exist; no fallback was used.")
            before = source_graph.snapshot(tenant)
            before_view = source_graph.view(tenant)
            revisions = {tenant_row["revision"]}
            finding_ids = set()
            for item in before["nodes"]:
                if item["kind"] == "Revision":
                    revisions.add(item["id"])
                if item["props"].get("revision"):
                    revisions.add(item["props"]["revision"])
                if item["kind"] == "Finding":
                    finding_ids.add(item["id"])
            paths_before = candidates(source_graph, tenant, revisions, finding_ids)
            # Check again just before the first mutation to narrow creation races.
            if target_graph.exists(tenant):
                raise MigrationError("Target graph already exists; choose a fresh graph prefix.")
            for payload in payloads:
                target_graph.apply(tenant, payload)
                report["replayed_events"] += 1
            target_graph.prepare(tenant)
            staged = target_graph.snapshot(tenant)
            if normalize(before) != normalize(staged):
                raise MigrationError(
                    "Target graph identity/property verification failed; staged graph retained for inspection."
                )
            # graph.view is bounded. Its actual returned identities/properties must
            # occur in the complete target snapshot, without relying on row order.
            target_basic = normalize(basic_view(staged))
            if any(
                not set(normalize(before_view)[key]) <= set(target_basic[key])
                for key in ("nodes", "edges")
            ):
                raise MigrationError("Target graph.view verification failed.")
            if paths_before != candidates(target_graph, tenant, revisions, finding_ids):
                raise MigrationError(
                    "Target candidate path verification failed; staged graph retained for inspection."
                )
            if (
                normalize(before) != normalize(source_graph.snapshot(tenant))
                or normalize(before_view) != normalize(source_graph.view(tenant))
                or paths_before != candidates(source_graph, tenant, revisions, finding_ids)
                or fingerprint(live) != source_digest
                or live.execute("PRAGMA data_version").fetchone()[0] != source_version
            ):
                raise MigrationError(
                    "Source changed during migration; keep writers stopped and migrate again with a fresh prefix."
                )
            report.update(
                status="staged_only",
                ready_for_manual_cutover=True,
                verification={
                    "audit": True,
                    "all_projection_events": True,
                    "entity_properties_and_labels": True,
                    "edge_properties": True,
                    "graph_view": True,
                    "candidate_paths": True,
                    "fulltext_indexes": True,
                    "source_unchanged": True,
                    "candidate_contexts": len(paths_before),
                    "nodes": len(staged["nodes"]),
                    "edges": len(staged["edges"]),
                },
            )
            return report


def stage(source, target, *, apply=False, graph_factory=Projection):
    resources = []
    try:
        return _stage(source, target, apply=apply, graph_factory=graph_factory, resources=resources)
    except MigrationError:
        raise
    except Exception:
        raise MigrationError(
            "Migration failed; no credentials were logged. No cutover occurred; a partial staged graph may remain."
        ) from None
    finally:
        for resource in reversed(resources):
            with suppress(Exception):
                resource.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-env", type=Path, default=ROOT / ".env")
    parser.add_argument("--target-env", type=Path, required=True)
    parser.add_argument(
        "--apply", action="store_true", help="Replay into a fresh graph; never activate it"
    )
    parser.add_argument(
        "--allow-plaintext-synthetic",
        action="store_true",
        help="Explicitly attest staging contains synthetic lab data only; allow a non-TLS target",
    )
    args = parser.parse_args(argv)
    try:
        try:
            source = Settings(_env_file=args.source_env)
        except Exception:
            raise MigrationError(
                "Source configuration is invalid; no credentials were logged."
            ) from None
        target = load_target(
            args.target_env, source, allow_plaintext_synthetic=args.allow_plaintext_synthetic
        )
        report = stage(source, target, apply=args.apply)
        if args.allow_plaintext_synthetic and not target.graph_ssl:
            report["target"]["synthetic_plaintext_acknowledged"] = True
        print(json.dumps(report, indent=2))
        return 0
    except MigrationError as error:
        print(
            json.dumps(
                {"status": "failed", "ready_for_manual_cutover": False, "error": str(error)}
            ),
            file=sys.stderr,
        )
        return 1
    except Exception:
        print(
            '{"status":"failed","ready_for_manual_cutover":false,"error":"Configuration could not be read safely."}',
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
