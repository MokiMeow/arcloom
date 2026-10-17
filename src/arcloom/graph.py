"""Fixed Cypher tools and ordered, idempotent projections. No generated Cypher."""

import json
import threading
import time
from typing import Protocol

from arcloom.catalog import ASSETS, TESTS
from arcloom.config import Settings
from arcloom.domain import Candidate, DomainError
from arcloom.storage import Store, canonical, digest, new_id

KINDS = frozenset(
    {
        "Asset",
        "TestCase",
        "Capability",
        "Finding",
        "Hypothesis",
        "TestRun",
        "Evidence",
        "Review",
        "Revision",
        "AgentSession",
        "Report",
        "TrustBoundary",
    }
)
RELATIONS = frozenset(
    {
        "TARGETS",
        "AFFECTS",
        "ENABLES",
        "REQUIRES",
        "DERIVED_FROM",
        "EXECUTED",
        "BACKED_BY",
        "REVIEWS",
        "PRODUCED",
        "DEPLOYED_TO",
        "CALLS",
        "PROTECTS",
        "PROPOSED",
        "ATTRIBUTED_TO",
    }
)

FOLLOWUPS_CYPHER = """
MATCH (t:TestCase {enabled: true})-[:REQUIRES]->(needed:Capability)
WITH t, collect(DISTINCT needed.id) AS required
MATCH (t)-[:REQUIRES]->(cap:Capability)<-[:ENABLES]-(f:Finding)
WHERE f.status = 'confirmed' AND f.current = true AND f.revision = $revision
WITH t, required, collect(DISTINCT cap.id) AS satisfied,
     collect(DISTINCT f.id) AS supporting, max(f.depth) AS prior_depth,
     collect(DISTINCT f.id + '|' + cap.id) AS links
WHERE size(required) = size(satisfied)
  AND ($source_id = '' OR $source_id IN supporting)
OPTIONAL MATCH (old:Hypothesis)
WHERE old.test_id = t.id AND old.revision = $revision
WITH t, required, supporting, prior_depth, links, count(old) AS attempts
WHERE attempts = 0
RETURN t.id, t.asset_id, t.title, required, supporting, t.impact, prior_depth, links
ORDER BY t.impact DESC, t.id
LIMIT 20
""".strip()


class GraphPort(Protocol):
    def apply(self, tenant: str, payload: dict) -> None: ...
    def candidates(
        self, tenant: str, revision: str, source_id: str | None = None
    ) -> list[Candidate]: ...
    def view(self, tenant: str) -> dict: ...
    def ping(self, tenant: str) -> bool: ...
    def close(self) -> None: ...


def node(label: str, entity_id: str, **props) -> dict:
    if label not in KINDS:
        raise ValueError("Unregistered graph label")
    return {"id": entity_id, "kind": label, "props": props}


def edge(source: str, relation: str, target: str, **props) -> dict:
    if relation not in RELATIONS:
        raise ValueError("Unregistered graph relationship")
    return {"source": source, "relation": relation, "target": target, "props": props}


def seed_graph(revision: str = "r1") -> dict:
    nodes = [
        node("Asset", key, **value, current_revision=revision) for key, value in ASSETS.items()
    ]
    edges = [edge("gateway", "CALLS", asset) for asset in ASSETS if asset != "gateway"]
    caps = {cap for t in TESTS.values() for cap in (*t.requirements, *t.enables)}
    nodes += [node("Capability", cap, title=cap.replace("-", " ")) for cap in sorted(caps)]
    for t in TESTS.values():
        nodes.append(
            node(
                "TestCase",
                t.id,
                title=t.title,
                asset_id=t.asset_id,
                impact=t.impact,
                enabled=True,
                description=t.description,
            )
        )
        edges.append(edge(t.id, "TARGETS", t.asset_id))
        edges += [edge(t.id, "REQUIRES", cap) for cap in t.requirements]
    nodes.append(node("Revision", revision, title=revision))
    edges += [edge(revision, "DEPLOYED_TO", asset) for asset in ASSETS]
    nodes.append(node("TrustBoundary", "tenant-isolation", title="Tenant ownership boundary"))
    edges += [
        edge("tenant-isolation", "PROTECTS", asset) for asset in ("invoice-api", "export-api")
    ]
    return {"nodes": nodes, "edges": edges}


class FalkorGraph:
    def __init__(self, settings: Settings):
        self.settings, self._db = settings, None
        self._connect_lock = threading.Lock()
        self._indexed: set[str] = set()

    def graph_name(self, tenant: str) -> str:
        return self.settings.graph_prefix + "_" + digest(tenant)[:24]

    def _database(self):
        if self._db is None:
            with self._connect_lock:
                if self._db is None:
                    if self.settings.graph_mode == "lite":
                        from redislite.falkordb_client import FalkorDB

                        self._db = FalkorDB(str(self.settings.data_dir / "falkordb.db"))
                    else:
                        from falkordb import FalkorDB

                        self._db = FalkorDB(
                            host=self.settings.graph_host,
                            port=self.settings.graph_port,
                            password=self.settings.graph_password.get_secret_value() or None,
                            ssl=self.settings.graph_ssl,
                            socket_timeout=3,
                            socket_connect_timeout=3,
                        )
        return self._db

    def _query(
        self, tenant: str, query: str, params: dict | None = None, readonly: bool = False
    ):
        try:
            graph = self._database().select_graph(self.graph_name(tenant))
            call = graph.ro_query if readonly else graph.query
            return call(query, params=params or {}, timeout=2000).result_set
        except Exception as exc:
            raise DomainError(
                "graph_unavailable", "FalkorDB is unavailable. No fallback memory was used.", 503
            ) from exc

    def apply(self, tenant: str, payload: dict) -> None:
        for item in payload.get("nodes", []):
            kind = item["kind"]
            if kind not in KINDS:
                raise ValueError("Unregistered graph label")
            # Only API-owned labels enter query syntax; all data is parameterized.
            props = {
                k: v
                for k, v in item["props"].items()
                if isinstance(v, (str, int, float, bool)) or v is None
            }
            props.update(kind=kind, data=canonical(item["props"]))
            self._query(
                tenant,
                f"MERGE (n:Entity:{kind} {{id: $id}}) SET n += $props RETURN n.id",
                {"id": item["id"], "props": props},
            )
        for item in payload.get("edges", []):
            rel = item["relation"]
            if rel not in RELATIONS:
                raise ValueError("Unregistered graph relationship")
            self._query(
                tenant,
                f"MATCH (a:Entity {{id:$source}}),(b:Entity {{id:$target}}) "
                f"MERGE (a)-[r:{rel}]->(b) SET r.data=$data RETURN a.id",
                {
                    "source": item["source"],
                    "target": item["target"],
                    "data": canonical(item["props"]),
                },
            )
        if tenant not in self._indexed:
            indexes = self._query(
                tenant, "CALL db.indexes() YIELD label, properties RETURN label, properties"
            )
            if not any(label == "Entity" and "id" in properties for label, properties in indexes):
                self._query(tenant, "CREATE INDEX ON :Entity(id)")
            self._indexed.add(tenant)

    def candidates(
        self, tenant: str, revision: str, source_id: str | None = None
    ) -> list[Candidate]:
        rows = self._query(
            tenant,
            FOLLOWUPS_CYPHER,
            {"revision": revision, "source_id": source_id or ""},
            readonly=True,
        )
        candidates = []
        for test_id, asset, title, req, supporting, impact, depth, links in rows:
            t = TESTS.get(test_id)
            if t is None or t.asset_id != asset or set(req) != set(t.requirements):
                raise DomainError(
                    "graph_catalog_mismatch",
                    "Graph catalog does not match the trusted test registry",
                    503,
                )
            path = []
            for link in sorted(links):
                finding, cap = link.split("|", 1)
                path += [
                    {"source": finding, "relation": "ENABLES", "target": cap},
                    {"source": test_id, "relation": "REQUIRES", "target": cap},
                ]
            path.append({"source": test_id, "relation": "TARGETS", "target": asset})
            candidates.append(
                Candidate(
                    test_id,
                    asset,
                    title,
                    tuple(sorted(req)),
                    tuple(sorted(supporting)),
                    int(impact) - 3 * t.request_limit - 4 * (int(depth) + 1),
                    int(depth) + 1,
                    tuple(path),
                )
            )
        return sorted(candidates, key=lambda c: (-c.score, c.test_id))

    def view(self, tenant: str) -> dict:
        nodes = self._query(
            tenant,
            "MATCH (n:Entity) RETURN n.id,n.kind,n.data ORDER BY n.id LIMIT 400",
            readonly=True,
        )
        edges = self._query(
            tenant,
            "MATCH (a:Entity)-[r]->(b:Entity) RETURN a.id,type(r),b.id,r.data LIMIT 800",
            readonly=True,
        )
        return {
            "nodes": [
                {"id": i, "kind": kind, "props": json.loads(data)} for i, kind, data in nodes
            ],
            "edges": [
                {"source": a, "relation": rel, "target": b, "props": json.loads(data or "{}")}
                for a, rel, b, data in edges
            ],
            "engine": "FalkorDB",
            "graph_name": self.graph_name(tenant),
            "limits": {"nodes": 400, "edges": 800},
        }

    def ping(self, tenant: str) -> bool:
        return self._query(tenant, "RETURN 1", readonly=True) == [[1]]

    def close(self) -> None:
        if self._db is not None and self.settings.graph_mode == "lite":
            # RDB persistence is managed by FalkorDBLite; explicitly request a save.
            connection = getattr(self._db, "connection", None)
            if connection is not None and hasattr(connection, "save"):
                connection.save()


class Projector:
    def __init__(self, store: Store, graph: GraphPort):
        self.store, self.graph = store, graph
        self.owner = new_id("projection")
        self._lock = threading.Lock()

    def flush(self, maximum: int = 100) -> int:
        with self._lock:
            if not self.store.acquire_lock("graph_projection", self.owner, 120):
                raise DomainError(
                    "graph_sync_busy", "Graph synchronization is in progress", 503
                )
            applied = 0
            try:
                for row in self.store.all(
                    "SELECT * FROM outbox WHERE applied_at IS NULL ORDER BY seq LIMIT ?", (maximum,)
                ):
                    if not self.store.acquire_lock("graph_projection", self.owner, 120):
                        raise DomainError(
                            "graph_sync_busy", "Graph synchronization lease was lost", 503
                        )
                    try:
                        self.graph.apply(row["tenant"], json.loads(row["payload"]))
                    except Exception:
                        with self.store.transaction() as conn:
                            conn.execute(
                                "UPDATE outbox SET attempts=attempts+1 WHERE seq=?", (row["seq"],)
                            )
                        raise
                    with self.store.transaction() as conn:
                        conn.execute(
                            "UPDATE outbox SET applied_at=?,attempts=attempts+1 WHERE seq=? AND applied_at IS NULL",
                            (time.time(), row["seq"]),
                        )
                    applied += 1
            finally:
                self.store.release_lock("graph_projection", self.owner)
            return applied

    def require_current(self, tenant: str) -> None:
        self.flush()
        pending = self.store.one(
            "SELECT count(*) AS n FROM outbox WHERE tenant=? AND applied_at IS NULL", (tenant,)
        )
        if pending and pending["n"]:
            raise DomainError("graph_sync_pending", "Graph memory is still synchronizing", 503)
        self.graph.ping(tenant)
