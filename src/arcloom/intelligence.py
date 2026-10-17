"""Read-only graph diagnostics and evidence-withdrawal experiments.

All queries are fixed application tools. Search text cannot become Cypher or
RediSearch operators. Counterfactual results describe prerequisite support,
not a claim that a patch fixes independently exploitable vulnerabilities.
"""

import json
import re

from arcloom.domain import DomainError
from arcloom.graph import FOLLOWUPS_CYPHER, FalkorGraph

SEARCH = """
CALL db.idx.fulltext.queryNodes('Entity', $query) YIELD node, score
RETURN node.id, node.kind, node.data, score
ORDER BY score DESC, node.id LIMIT 21
""".strip()
LINEAGE = """
MATCH p=(f:Finding)-[:DERIVED_FROM*0..5]->(root:Entity:Finding {id:$finding_id})
WHERE f.current = true AND f.revision = $revision AND f.status = 'confirmed'
  AND root.current = true AND root.revision = $revision AND root.status = 'confirmed'
RETURN DISTINCT f.id, f.title, [n IN nodes(p) | n.id]
ORDER BY f.id LIMIT 201
""".strip()
PREREQUISITES = """
MATCH (t:TestCase {enabled:true})-[:REQUIRES]->(cap:Capability)
OPTIONAL MATCH (f:Finding)-[:ENABLES]->(cap)
WHERE f.current = true AND f.status = 'confirmed' AND f.revision = $revision
RETURN t.id, t.title, t.asset_id, cap.id, collect(DISTINCT f.id)
ORDER BY t.id, cap.id LIMIT 201
""".strip()
CENTRALITY = """
CALL algo.pageRank('Asset', 'CALLS') YIELD node, score
RETURN node.id, node.title, score ORDER BY score DESC, node.id LIMIT 21
""".strip()


def search_terms(text: str) -> str:
    if len(text) > 100:
        raise DomainError("search_input", "Search is limited to 100 characters", 422)
    words = re.findall(r"[A-Za-z0-9]+", text)
    if not words or len(words) > 8:
        raise DomainError("search_input", "Use one to eight search words", 422)
    return " ".join(words).lower()


class GraphIntelligence:
    def __init__(self, graph: FalkorGraph):
        self.graph = graph

    def prepare(self, tenant: str) -> None:
        indexes = self.graph._query(
            tenant, "CALL db.indexes() YIELD label, types RETURN label, types"
        )
        fields = next((types for label, types in indexes if label == "Entity"), {})
        for field in ("title", "description"):
            if "FULLTEXT" not in fields.get(field, []):
                # field names originate in the fixed tuple above, not user input.
                self.graph._query(
                    tenant, f"CALL db.idx.fulltext.createNodeIndex('Entity','{field}')"
                )

    def _bounded(self, tenant: str) -> None:
        counts = self.graph._query(tenant, "MATCH (n:Entity) RETURN count(n)", readonly=True)
        if counts[0][0] > 400:
            raise DomainError(
                "analysis_budget", "This demo's analysis budget is 400 graph entities", 409
            )

    def search(self, tenant: str, text: str) -> dict:
        query = search_terms(text)
        rows = self.graph._query(tenant, SEARCH, {"query": query}, readonly=True)
        return {
            "engine": "FalkorDB full-text index",
            "query": query,
            "cypher": SEARCH,
            "items": [
                {"id": i, "kind": kind, "props": json.loads(data), "score": score}
                for i, kind, data, score in rows[:20]
            ],
            "truncated": len(rows) > 20,
            "warning": "Text relevance is not duplicate identity, current validity, or proof.",
        }

    def withdraw(self, tenant: str, revision: str, finding_id: str) -> dict:
        self._bounded(tenant)
        params = {"revision": revision, "finding_id": finding_id}
        paths = self.graph._query(tenant, LINEAGE, params, readonly=True)
        if not paths:
            raise DomainError("not_found", "No current finding exists in this workspace", 404)
        if len(paths) > 200:
            raise DomainError(
                "analysis_budget", "Too many provenance paths for a complete analysis", 409
            )
        excluded = {row[0] for row in paths}
        rows = self.graph._query(tenant, PREREQUISITES, {"revision": revision}, readonly=True)
        if len(rows) > 200:
            raise DomainError(
                "analysis_budget", "Too many prerequisites for a complete analysis", 409
            )
        tests: dict[str, dict] = {}
        for test_id, title, asset, capability, providers in rows:
            item = tests.setdefault(
                test_id,
                {
                    "test_id": test_id,
                    "title": title,
                    "asset_id": asset,
                    "requirements": [],
                },
            )
            before = set(providers)
            item["requirements"].append(
                {
                    "capability": capability,
                    "before": sorted(before),
                    "after": sorted(before - excluded),
                    "withdrawn_providers": sorted(before & excluded),
                }
            )
        for item in tests.values():
            item["supported_before"] = all(r["before"] for r in item["requirements"])
            item["supported_after"] = all(r["after"] for r in item["requirements"])
            item["lost_support"] = item["supported_before"] and not item["supported_after"]
        items = list(tests.values())
        return {
            "format": "arcloom-withdrawal-v1",
            "engine": "FalkorDB",
            "finding_id": finding_id,
            "revision": revision,
            "read_only": True,
            "withdrawn_findings": sorted(excluded),
            "paths": [{"finding_id": i, "title": title, "path": path} for i, title, path in paths],
            "tests": items,
            "supported_before": sum(i["supported_before"] for i in items),
            "supported_after": sum(i["supported_after"] for i in items),
            "lost_support": sum(i["lost_support"] for i in items),
            "queries": {"lineage": LINEAGE, "prerequisites": PREREQUISITES},
            "assumptions": [
                "Withdraw the selected finding and current findings whose recorded provenance depends on it, through at most five edges.",
                "An independently sourced current finding can still supply the same capability. Every required capability needs at least one remaining provider.",
                "This is prerequisite support, not execution eligibility. Prior attempts, budgets, scope and approvals are enforced separately.",
                "Historical observations are unchanged. Lost evidence support does not prove a patch fixed downstream issues. Retests are still required.",
            ],
        }

    def diagnostics(self, tenant: str, revision: str) -> dict:
        self._bounded(tenant)
        rows = self.graph._query(tenant, CENTRALITY, readonly=True)
        try:
            graph = self.graph._database().select_graph(self.graph.graph_name(tenant))
            plan = str(
                graph.explain(FOLLOWUPS_CYPHER, params={"revision": revision, "source_id": ""})
            )
        except Exception as exc:
            raise DomainError(
                "graph_unavailable", "The fixed query plan could not be inspected", 503
            ) from exc
        return {
            "engine": "FalkorDB",
            "plan": plan[:16000],
            "plan_truncated": len(plan) > 16000,
            "plan_executes_query": False,
            "centrality": [
                {"asset_id": i, "title": title, "score": score} for i, title, score in rows[:20]
            ],
            "centrality_truncated": len(rows) > 20,
            "centrality_query": CENTRALITY,
            "warning": "PageRank measures relative dependency importance in CALLS edges, not severity or exploit probability.",
        }
