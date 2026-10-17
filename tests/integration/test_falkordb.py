"""Actual FalkorDB integration. Set ARCLOOM_TEST_GRAPH=lite or server to enable."""

import os

import pytest

from arcloom.config import Settings
from arcloom.domain import DiscoveryInput, ReviewInput
from arcloom.graph import FalkorGraph, node
from arcloom.runtime import Runtime
from arcloom.storage import new_id
from tests.conftest import ADMIN, RUNNER
from tests.helpers import confirm, observe
from tests.ports import FixtureRunner

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not os.environ.get("ARCLOOM_TEST_GRAPH"),
        reason="Set ARCLOOM_TEST_GRAPH=lite or server for real-engine integration",
    ),
]


@pytest.fixture
def real_runtime(tmp_path):
    config = Settings(
        _env_file=None,
        data_dir=tmp_path,
        graph_mode=os.environ.get("ARCLOOM_TEST_GRAPH", "lite"),
        graph_host=os.environ.get("ARCLOOM_TEST_GRAPH_HOST", "127.0.0.1"),
        graph_password=os.environ.get("ARCLOOM_TEST_GRAPH_PASSWORD", ""),
        tenant=new_id("test"),
        admin_token=ADMIN,
        runner_secret=RUNNER,
        worker_enabled=False,
    )
    r = Runtime(config, runner=FixtureRunner(RUNNER))
    r.initialize()
    # Tests must fail, not skip, if an explicitly requested real engine is unavailable.
    r.projector.require_current(config.tenant)
    yield r
    if config.graph_mode == "server":
        r.graph._database().select_graph(r.graph.graph_name(config.tenant)).delete()
    r.close()


def test_real_end_to_end_and_same_revision_chain(real_runtime):
    r = real_runtime
    actor = r.auth.bearer(ADMIN)
    first = confirm(r, actor)
    candidates = r.graph.candidates(actor.tenant, "r1")
    assert "invoice-chain" not in {c.test_id for c in candidates}
    discovery = r.discovery.run(
        actor, DiscoveryInput(source_finding_id=first["finding_id"]), new_id("request")
    )
    assert discovery["selection"]["test_id"] == "invoice-tenant-boundary"
    cid = discovery["case_id"]
    assert observe(r, actor, cid)["runs"][0]["outcome"] == "reproduced"
    r.cases.review(
        actor,
        cid,
        ReviewInput(
            decision="accept", reason="Verified a distinct authorization issue in the lab."
        ),
        new_id("request"),
    )
    chain = r.discovery.run(actor, DiscoveryInput(), new_id("request"))
    assert chain["selection"]["test_id"] == "invoice-chain"
    assert len(chain["selection"]["finding_ids"]) == 2
    assert observe(r, actor, chain["case_id"])["runs"][0]["outcome"] == "reproduced"
    view = r.graph.view(actor.tenant)
    assert view["engine"] == "FalkorDB"
    assert any(n["id"] == first["finding_id"] for n in view["nodes"])
    assert any(
        e["relation"] == "ENABLES" and e["source"] == first["finding_id"] for e in view["edges"]
    )


def test_real_projection_replay_and_new_connection(real_runtime):
    r = real_runtime
    actor = r.auth.bearer(ADMIN)
    confirm(r, actor)
    before = r.graph.view(actor.tenant)
    # New adapter object has neither a previous graph handle nor an index cache.
    fresh = FalkorGraph(r.settings)
    with r.store.transaction() as c:
        c.execute("UPDATE outbox SET applied_at=NULL")
    from arcloom.graph import Projector

    Projector(r.store, fresh).require_current(actor.tenant)
    after = fresh.view(actor.tenant)
    assert len(before["nodes"]) == len(after["nodes"])
    assert len(before["edges"]) == len(after["edges"])
    assert fresh.candidates(actor.tenant, "r1")
    fresh.close()


def test_real_temporal_invalidation(real_runtime):
    r = real_runtime
    actor = r.auth.bearer(ADMIN)
    finding = confirm(r, actor)
    r.cases.revise(
        actor, "r2", "A controlled revision change requires revalidation.", new_id("request")
    )
    r.projector.require_current(actor.tenant)
    assert r.graph.candidates(actor.tenant, "r2") == []
    old = next(n for n in r.graph.view(actor.tenant)["nodes"] if n["id"] == finding["finding_id"])
    assert old["props"]["current"] is False
    assert old["props"]["status"] == "confirmed"


def test_real_graphs_are_tenant_isolated(real_runtime):
    r = real_runtime
    actor = r.auth.bearer(ADMIN)
    confirm(r, actor)
    other = new_id("other")
    r.graph.apply(
        other, {"nodes": [node("Asset", "other-asset", title="Only this tenant")], "edges": []}
    )
    assert len(r.graph.view(other)["nodes"]) == 1
    assert r.graph.candidates(other, "r1") == []
    assert all(n["id"] != "other-asset" for n in r.graph.view(actor.tenant)["nodes"])
    if r.settings.graph_mode == "server":
        r.graph._database().select_graph(r.graph.graph_name(other)).delete()


def test_real_parameterized_titles_not_query_syntax(real_runtime):
    r = real_runtime
    tenant = r.settings.tenant
    hostile = "Quote ' MATCH (n) DETACH DELETE n // <script>"
    before = len(r.graph.view(tenant)["nodes"])
    r.graph.apply(
        tenant, {"nodes": [node("Report", "untrusted-title", title=hostile)], "edges": []}
    )
    after = r.graph.view(tenant)
    assert len(after["nodes"]) == before + 1
    assert (
        next(n for n in after["nodes"] if n["id"] == "untrusted-title")["props"]["title"] == hostile
    )


def test_real_empty_memory_yields_no_candidate(real_runtime):
    r = real_runtime
    assert r.graph.candidates(r.settings.tenant, "r1") == []
