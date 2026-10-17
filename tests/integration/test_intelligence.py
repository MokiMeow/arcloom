"""Native FalkorDB feature tests on synthetic graph records, never external targets."""

import os

import pytest
from fastapi.testclient import TestClient

from arcloom.api import create_app
from arcloom.domain import DomainError
from arcloom.graph import edge, node
from tests.conftest import ADMIN

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.environ.get("ARCLOOM_TEST_GRAPH"), reason="Requires real FalkorDB"),
]


def fixtures(r):
    # Deliberately synthetic, proof-free feature fixtures. These are not findings
    # produced or asserted by an investigation run.
    tenant = r.settings.tenant
    records = [
        node(
            "Finding",
            "root",
            title="Gateway fixture",
            current=True,
            status="confirmed",
            revision="r1",
        ),
        node(
            "Finding",
            "child",
            title="Invoice fixture",
            current=True,
            status="confirmed",
            revision="r1",
        ),
        node(
            "Finding",
            "independent",
            title="Independent fixture",
            current=True,
            status="confirmed",
            revision="r1",
        ),
    ]
    r.graph.apply(
        tenant,
        {
            "nodes": records,
            "edges": [
                edge("root", "ENABLES", "internal-route-access"),
                edge("child", "ENABLES", "cross-tenant-invoice-read"),
                edge("child", "DERIVED_FROM", "root"),
            ],
        },
    )
    return tenant


def test_search_and_explain_use_native_engine(real_runtime):
    r = real_runtime
    tenant = r.settings.tenant
    r.intelligence.prepare(tenant)
    r.intelligence.prepare(tenant)
    found = r.intelligence.search(tenant, "invoice")
    assert found["items"] and found["engine"] == "FalkorDB full-text index"
    diagnostics = r.intelligence.diagnostics(tenant, "r1")
    assert diagnostics["centrality"] and "Results" in diagnostics["plan"]
    assert diagnostics["plan_executes_query"] is False
    assert all(a["score"] > 0 for a in diagnostics["centrality"])
    assert diagnostics["centrality"] == sorted(
        diagnostics["centrality"], key=lambda a: (-a["score"], a["asset_id"])
    )


def test_withdrawal_cascades_but_preserves_independent_support(real_runtime):
    r = real_runtime
    tenant = fixtures(r)
    # Use an actual registered prerequisite id, not an invented capability.
    r.graph.apply(
        tenant, {"nodes": [], "edges": [edge("independent", "ENABLES", "internal-route-access")]}
    )
    before = r.graph.view(tenant)
    result = r.intelligence.withdraw(tenant, "r1", "root")
    assert result["withdrawn_findings"] == ["child", "root"]
    invoice = next(t for t in result["tests"] if t["test_id"] == "invoice-tenant-boundary")
    assert invoice["supported_before"] and invoice["supported_after"]
    assert invoice["requirements"][0]["after"] == ["independent"]
    assert r.graph.view(tenant) == before


def test_without_alternative_support_admission_is_lost(real_runtime):
    r = real_runtime
    tenant = fixtures(r)
    result = r.intelligence.withdraw(tenant, "r1", "root")
    invoice = next(t for t in result["tests"] if t["test_id"] == "invoice-tenant-boundary")
    assert invoice["lost_support"] and not invoice["supported_after"]
    assert result["read_only"]


def test_unknown_and_stale_findings_do_not_get_invented(real_runtime):
    r = real_runtime
    tenant = fixtures(r)
    for rev, target in [("r1", "not-present"), ("r2", "root")]:
        with pytest.raises(DomainError) as err:
            r.intelligence.withdraw(tenant, rev, target)
        assert err.value.code == "not_found"


def test_other_tenant_cannot_observe_findings(real_runtime):
    r = real_runtime
    fixtures(r)
    r.graph.apply(
        "isolated", {"nodes": [node("Asset", "isolated-asset", title="Isolated")], "edges": []}
    )
    with pytest.raises(DomainError):
        r.intelligence.withdraw("isolated", "r1", "root")
    if r.settings.graph_mode == "server":
        r.graph._database().select_graph(r.graph.graph_name("isolated")).delete()


def test_native_api_requires_auth_and_returns_real_records(real_runtime):
    r = real_runtime
    with TestClient(create_app(r.settings, r)) as c:
        assert c.get("/api/memory/search?q=invoice").status_code == 401
        c.headers["Authorization"] = "Bearer " + ADMIN
        assert c.get("/api/memory/search?q=invoice").json()["items"]
        assert c.get("/api/memory/diagnostics").json()["plan_executes_query"] is False
        assert c.get("/api/memory/withdrawal?finding_id=missing").status_code == 404
