import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from arcloom.api import create_app
from arcloom.domain import DomainError, Role
from arcloom.evidence import sign_receipt
from arcloom.handoff import build_handoff
from arcloom.storage import canonical, digest, new_id
from tests.helpers import confirm


def test_packet_has_verified_findings_complete_paths_and_stable_digest(runtime, owner):
    confirm(runtime, owner)
    confirm(runtime, owner, "invoice-tenant-boundary")
    packet = build_handoff(runtime, owner)
    assert set(packet) == {
        "schemaVersion",
        "workspace",
        "graph",
        "audit",
        "summary",
        "findings",
        "candidates",
        "observations",
        "blocked",
        "packet_sha256",
    }
    assert packet["summary"]["confirmed_current"] == 2
    chain = next(c for c in packet["candidates"] if c["test_id"] == "invoice-chain")
    assert set(chain["requires"]) == {"internal-route-access", "cross-tenant-invoice-read"}
    assert len(chain["finding_ids"]) == 2
    assert {e["target"] for e in chain["paths"][0] if e["relation"] == "ENABLES"} == set(
        chain["requires"]
    )
    assert all(f["evidence"]["signature_verified"] for f in packet["findings"])
    assert packet["packet_sha256"] == digest(
        canonical({k: v for k, v in packet.items() if k != "packet_sha256"})
    )
    assert build_handoff(runtime, owner) == packet


def test_viewer_read_api_authentication_and_no_domain_writes(runtime, owner, monkeypatch):
    confirm(runtime, owner)
    member = runtime.auth.add_member(owner, "Observer", Role.VIEWER)
    viewer = runtime.auth.bearer(member["token"])
    before = {
        table: runtime.store.all(f"SELECT * FROM {table}")
        for table in (
            "events",
            "cases",
            "runs",
            "reviews",
            "findings",
            "agent_sessions",
            "sessions",
            "budgets",
            "outbox",
        )
    }
    monkeypatch.setattr(runtime.projector, "flush", lambda *a: pytest.fail("read flushed outbox"))
    monkeypatch.setattr(
        runtime.discovery, "planner_factory", lambda: pytest.fail("read called model")
    )
    assert build_handoff(runtime, viewer)["findings"]
    # Avoid app lifespan initialization: this test supplies the initialized runtime directly.
    app = create_app(runtime.settings, runtime)
    app.state.runtime = runtime
    with_client = TestClient(app, raise_server_exceptions=True)
    try:
        client = with_client
        assert client.get("/api/memory/handoff").status_code == 401
        response = client.get(
            "/api/memory/handoff", headers={"Authorization": "Bearer " + member["token"]}
        )
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
    finally:
        with_client.close()
    assert before == {table: runtime.store.all(f"SELECT * FROM {table}") for table in before}


def test_cross_tenant_actor_is_rejected(runtime, owner):
    with pytest.raises(DomainError) as exc:
        build_handoff(runtime, replace(owner, tenant="foreign"))
    assert exc.value.status in (401, 403)


def test_missing_frontend_explains_build_without_disabled_docs_link(runtime):
    settings = runtime.settings.model_copy(
        update={"web_dist": runtime.settings.data_dir / "missing_web"}
    )
    app = create_app(settings, runtime)
    app.state.runtime = runtime
    client = TestClient(app)
    try:
        response = client.get("/")
        assert response.status_code == 200
        assert (
            response.json()["frontend"]
            == "Build the frontend with npm --prefix apps/web ci and npm --prefix apps/web run build, then restart."
        )
        assert "docs" not in response.json()
        assert client.get("/docs").status_code == 404
        assert client.get("/api/memory/handoff").status_code == 401
    finally:
        client.close()


def test_patched_revision_excludes_historical_findings(runtime, owner):
    confirm(runtime, owner)
    runtime.cases.revise(owner, "r2", "Patch the synthetic fixture", new_id("request"))
    runtime.projector.require_current(owner.tenant)
    packet = build_handoff(runtime, owner)
    assert packet["workspace"]["revision"] == "r2"
    assert packet["findings"] == packet["candidates"] == []
    assert next(b for b in packet["blocked"] if b["test_id"] == "invoice-chain")[
        "missing_capabilities"
    ] == ["cross-tenant-invoice-read", "internal-route-access"]


@pytest.mark.parametrize("mode", ["missing", "tampered", "stale", "bad_signature"])
def test_invalid_evidence_fails_closed(runtime, owner, mode):
    confirm(runtime, owner)
    run = runtime.store.one("SELECT * FROM runs")
    artifact = runtime.evidence._path(owner.tenant, run["evidence_hash"])
    if mode == "missing":
        artifact.unlink()
    elif mode == "tampered":
        artifact.write_text("{}")
    else:
        receipt = json.loads(run["receipt"])
        if mode == "stale":
            receipt["revision"] = "r2"
            receipt["signature"] = sign_receipt(
                {k: v for k, v in receipt.items() if k != "signature"},
                runtime.settings.runner_secret.get_secret_value(),
            )
        else:
            receipt["signature"] = "0" * 64
        sha = runtime.evidence.put(owner.tenant, receipt)
        with runtime.store.transaction() as conn:
            conn.execute(
                "UPDATE runs SET evidence_hash=?,receipt=? WHERE id=?",
                (sha, canonical(receipt), run["id"]),
            )
    with pytest.raises(DomainError) as exc:
        build_handoff(runtime, owner)
    assert exc.value.status in (409, 422)
    assert 'signature"' not in exc.value.message


def test_pending_outbox_is_not_flushed(runtime, owner):
    with runtime.store.transaction() as conn:
        runtime.store.event(
            conn, owner.tenant, "test.pending", owner.id, "test", {}, {"nodes": [], "edges": []}
        )
    before = runtime.store.all("SELECT * FROM outbox")
    with pytest.raises(DomainError) as exc:
        build_handoff(runtime, owner)
    assert exc.value.code == "graph_sync_pending"
    assert runtime.store.all("SELECT * FROM outbox") == before


def test_audit_corruption_fails_closed(runtime, owner):
    with runtime.store.transaction() as conn:
        conn.execute("UPDATE events SET payload='{}' WHERE seq=1")
    with pytest.raises(DomainError) as exc:
        build_handoff(runtime, owner)
    assert exc.value.code == "audit_integrity"


def test_source_change_race_fails_consistency_check(runtime, owner, monkeypatch):
    confirm(runtime, owner)
    candidates = runtime.graph.candidates

    def changed(*args):
        result = candidates(*args)
        with runtime.store.transaction() as conn:
            runtime.store.event(conn, owner.tenant, "test.changed", owner.id, "test", {})
        return result

    monkeypatch.setattr(runtime.graph, "candidates", changed)
    with pytest.raises(DomainError) as exc:
        build_handoff(runtime, owner)
    assert exc.value.code == "analysis_changed"


def test_negative_and_inconclusive_are_reviewed_metadata(runtime, owner):
    confirm(runtime, owner)
    confirm(runtime, owner, "export-tenant-boundary")
    confirm(runtime, owner, "audit-boundary")
    packet = build_handoff(runtime, owner)
    assert packet["summary"]["negative_current"] == 1
    assert packet["summary"]["inconclusive_current"] == 1
    assert {o["outcome"] for o in packet["observations"]} == {"not_reproduced", "inconclusive"}


def test_graph_unavailable_is_explicit(runtime, owner):
    runtime.graph.available = False
    with pytest.raises(DomainError) as exc:
        build_handoff(runtime, owner)
    assert exc.value.status == 503


def test_depth_limit_and_report_required_have_exact_reasons(runtime, owner):
    first = build_handoff(runtime, owner)
    assert (
        next(b for b in first["blocked"] if b["test_id"] == "gateway-boundary")["reason"]
        == "report_required"
    )
    confirm(runtime, owner)
    runtime.settings.max_depth = 0
    packet = build_handoff(runtime, owner)
    assert not packet["candidates"]
    assert (
        next(b for b in packet["blocked"] if b["test_id"] == "invoice-tenant-boundary")["reason"]
        == "depth_limit"
    )


def test_graph_cannot_omit_supported_candidates(runtime, owner, monkeypatch):
    confirm(runtime, owner)
    monkeypatch.setattr(runtime.graph, "candidates", lambda *args: [])
    with pytest.raises(DomainError) as exc:
        build_handoff(runtime, owner)
    assert exc.value.code == "handoff_integrity"


def test_incomplete_multi_prerequisite_path_is_rejected(runtime, owner, monkeypatch):
    confirm(runtime, owner)
    confirm(runtime, owner, "invoice-tenant-boundary")
    raw = runtime.graph.candidates(owner.tenant, "r1")
    raw = [
        replace(c, path=tuple(e for e in c.path if e["target"] != "cross-tenant-invoice-read"))
        if c.test_id == "invoice-chain"
        else c
        for c in raw
    ]
    monkeypatch.setattr(runtime.graph, "candidates", lambda *args: raw)
    with pytest.raises(DomainError) as exc:
        build_handoff(runtime, owner)
    assert exc.value.code == "handoff_integrity"


def test_evidence_must_match_canonical_journal_receipt(runtime, owner):
    confirm(runtime, owner)
    with runtime.store.transaction() as conn:
        conn.execute("UPDATE runs SET receipt='{}'")
    with pytest.raises(DomainError) as exc:
        build_handoff(runtime, owner)
    assert exc.value.code == "handoff_evidence_invalid"


def test_cross_tenant_graph_support_is_rejected(runtime, owner, monkeypatch):
    confirm(runtime, owner)
    raw = runtime.graph.candidates(owner.tenant, "r1")
    monkeypatch.setattr(
        runtime.graph,
        "candidates",
        lambda *args: [replace(raw[0], finding_ids=("foreign_finding",))],
    )
    with pytest.raises(DomainError) as exc:
        build_handoff(runtime, owner)
    assert exc.value.status in (409, 503)


def test_oversized_graph_path_fails_instead_of_truncating(runtime, owner, monkeypatch):
    confirm(runtime, owner)
    raw = runtime.graph.candidates(owner.tenant, "r1")
    raw[0] = replace(raw[0], path=raw[0].path * 100)
    monkeypatch.setattr(runtime.graph, "candidates", lambda *args: raw)
    with pytest.raises(DomainError) as exc:
        build_handoff(runtime, owner)
    assert exc.value.code == "handoff_unsupported"


def test_domain_change_without_event_still_fails_consistency(runtime, owner, monkeypatch):
    confirm(runtime, owner)
    candidates = runtime.graph.candidates

    def changed(*args):
        result = candidates(*args)
        with runtime.store.transaction() as conn:
            conn.execute("UPDATE cases SET title='Concurrent title edit'")
        return result

    monkeypatch.setattr(runtime.graph, "candidates", changed)
    with pytest.raises(DomainError) as exc:
        build_handoff(runtime, owner)
    assert exc.value.code == "analysis_changed"
