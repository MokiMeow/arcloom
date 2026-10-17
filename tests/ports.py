"""Explicit test doubles. Never imported by the application or selected via settings."""

import asyncio
from copy import deepcopy

from arcloom.catalog import TESTS
from arcloom.domain import Candidate, DomainError
from arcloom.lab import execute_fixture


class TestGraph:
    __test__ = False

    def __init__(self):
        self.nodes, self.edges = {}, {}
        self.available = True
        self.queries = []

    def ping(self, tenant):
        if not self.available:
            raise DomainError("graph_unavailable", "Graph test double unavailable", 503)
        return True

    def apply(self, tenant, payload):
        self.ping(tenant)
        nodes, edges = self.nodes.setdefault(tenant, {}), self.edges.setdefault(tenant, {})
        for n in payload.get("nodes", []):
            nodes[n["id"]] = deepcopy(n)
        for e in payload.get("edges", []):
            edges[(e["source"], e["relation"], e["target"])] = deepcopy(e)

    def view(self, tenant):
        self.ping(tenant)
        return {
            "nodes": list(self.nodes.get(tenant, {}).values()),
            "edges": list(self.edges.get(tenant, {}).values()),
            "engine": "EXPLICIT_TEST_DOUBLE",
        }

    def candidates(self, tenant, revision, source_id=None):
        self.ping(tenant)
        self.queries.append((tenant, revision, source_id))
        nodes, edges = self.nodes.get(tenant, {}), list(self.edges.get(tenant, {}).values())
        result = []
        for n in nodes.values():
            if n["kind"] != "TestCase" or not n["props"]["enabled"]:
                continue
            tid = n["id"]
            reqs = {
                e["target"] for e in edges if e["source"] == tid and e["relation"] == "REQUIRES"
            }
            if not reqs:
                continue
            supporting = {
                e["source"]
                for e in edges
                if e["relation"] == "ENABLES"
                and e["target"] in reqs
                and nodes[e["source"]]["props"].get("current")
                and nodes[e["source"]]["props"].get("revision") == revision
            }
            covered = {
                e["target"]
                for e in edges
                if e["source"] in supporting and e["relation"] == "ENABLES"
            }
            if not reqs <= covered or (source_id and source_id not in supporting):
                continue
            if any(
                h["kind"] == "Hypothesis"
                and h["props"].get("test_id") == tid
                and h["props"].get("revision") == revision
                for h in nodes.values()
            ):
                continue
            depth = max(nodes[i]["props"]["depth"] for i in supporting) + 1
            path = [
                dict(source=e["source"], relation="ENABLES", target=e["target"])
                for e in edges
                if e["source"] in supporting and e["relation"] == "ENABLES" and e["target"] in reqs
            ]
            path += [dict(source=tid, relation="REQUIRES", target=c) for c in reqs]
            path += [dict(source=tid, relation="TARGETS", target=n["props"]["asset_id"])]
            t = TESTS[tid]
            result.append(
                Candidate(
                    tid,
                    t.asset_id,
                    t.title,
                    tuple(sorted(reqs)),
                    tuple(sorted(supporting)),
                    t.impact - 3 * t.request_limit - 4 * depth,
                    depth,
                    tuple(path),
                )
            )
        return sorted(result, key=lambda c: (-c.score, c.test_id))

    def close(self):
        pass


class FixtureRunner:
    def __init__(self, secret):
        self.secret, self.calls = secret, []
        self.fail = False

    def execute(self, plan):
        self.calls.append(plan)
        if self.fail:
            raise DomainError("lab_unavailable", "Injected runner outage", 503)
        return asyncio.run(execute_fixture(plan, self.secret))
