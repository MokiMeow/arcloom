import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import ValidationError

from arcloom.config import Settings
from arcloom.domain import (
    Actor,
    ApprovalInput,
    DiscoveryInput,
    DomainError,
    ReportInput,
    ReviewInput,
    Role,
)
from arcloom.storage import canonical, new_id
from tests.conftest import ADMIN
from tests.helpers import confirm, observe, report


def expect(code, fn):
    with pytest.raises(DomainError) as error:
        fn()
    assert error.value.code == code


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example",
        "http://169.254.169.254",
        "http://127.0.0.1.evil.example",
        "http://user@localhost:9001",
        "http://localhost:9001/execute",
        "http://localhost:9001?url=evil",
        "file:///etc/passwd",
        "http://[::1]:9001",
    ],
)
def test_runner_target_cannot_be_changed(url):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, lab_url=url)


@pytest.mark.parametrize(
    "field,value", [("test_id", "arbitrary-shell"), ("asset_id", "outside-lab")]
)
def test_unregistered_execution_is_blocked(runtime, owner, field, value):
    body = dict(
        title="An unregistered target",
        description="This must never reach the runner.",
        researcher="Researcher",
        asset_id="gateway",
        test_id="gateway-boundary",
    )
    body[field] = value
    expect(
        "out_of_scope", lambda: runtime.cases.submit(owner, ReportInput(**body), new_id("request"))
    )
    assert runtime.runner.calls == []
    assert runtime.store.all("SELECT * FROM cases") == []


@pytest.mark.parametrize("role", ["viewer", "researcher"])
def test_roles_cannot_approve(runtime, owner, role):
    cid = report(runtime, owner)["case_id"]
    member = runtime.auth.add_member(owner, "Limited member", Role(role))
    actor = runtime.auth.bearer(member["token"])
    expect(
        "forbidden",
        lambda: runtime.cases.approve(
            actor,
            cid,
            ApprovalInput(decision="approve", reason="Attempt an unauthorized approval."),
            new_id("request"),
        ),
    )
    assert runtime.runner.calls == []


def test_viewer_cannot_submit(runtime, owner):
    viewer = runtime.auth.add_member(owner, "Read only", Role.VIEWER)
    expect("forbidden", lambda: report(runtime, runtime.auth.bearer(viewer["token"])))


def test_tenant_cannot_read_another_case(runtime, owner):
    cid = report(runtime, owner)["case_id"]
    intruder = Actor("other", "other-tenant", Role.ADMIN)
    expect("not_found", lambda: runtime.cases.get(intruder, cid))
    assert runtime.store.all("SELECT * FROM cases WHERE tenant=?", ("other-tenant",)) == []


def test_token_rotation_revokes_sessions(runtime, owner):
    _, token, _ = runtime.auth.login(ADMIN)
    assert runtime.auth.session(token).id == owner.id
    runtime.settings.admin_token = "rotated-" + "z" * 48
    # Assignments are internal configuration; normalize the SecretStr as env loading would.
    from pydantic import SecretStr

    runtime.settings.admin_token = SecretStr("rotated-" + "z" * 48)
    runtime.auth.bootstrap()
    expect("unauthorized", lambda: runtime.auth.session(token))
    expect("unauthorized", lambda: runtime.auth.bearer(ADMIN))


def test_revoked_approver_stops_queued_execution(runtime, owner):
    cid = report(runtime, owner)["case_id"]
    m = runtime.auth.add_member(owner, "Reviewer", Role.REVIEWER)
    reviewer = runtime.auth.bearer(m["token"])
    runtime.cases.approve(
        reviewer,
        cid,
        ApprovalInput(decision="approve", reason="Approved lab execution."),
        new_id("request"),
    )
    runtime.auth.revoke_member(owner, reviewer.id)
    runtime.worker.tick()
    assert runtime.cases.get(owner, cid)["state"] == "denied"
    assert runtime.runner.calls == []


@pytest.mark.parametrize("condition", ["approval", "scope", "budget"])
def test_admission_rechecks_policy(runtime, owner, condition):
    cid = report(runtime, owner)["case_id"]
    runtime.cases.approve(
        owner,
        cid,
        ApprovalInput(decision="approve", reason="Only within current policy."),
        new_id("request"),
    )
    with runtime.store.transaction() as c:
        if condition == "approval":
            c.execute("UPDATE approvals SET expires_at=0")
        elif condition == "scope":
            c.execute("UPDATE tenants SET scope_enabled=0")
        else:
            c.execute("UPDATE budgets SET executions=100")
    runtime.worker.tick()
    assert runtime.cases.get(owner, cid)["state"] == "denied"
    assert runtime.runner.calls == []
    blocked = runtime.store.one("SELECT payload FROM events WHERE kind='execution.blocked'")
    assert json.loads(blocked["payload"])["network_execution"] is False


def test_assessment_window_expires(runtime, owner):
    with runtime.store.transaction() as c:
        c.execute("UPDATE tenants SET created_at=0")
    expect("scope_expired", lambda: report(runtime, owner))


def test_submission_idempotency_and_body_conflict(runtime, owner):
    first = report(runtime, owner, key="identical-report-001")
    assert report(runtime, owner, key="identical-report-001") == first
    assert len(runtime.store.all("SELECT * FROM reports")) == 1
    expect(
        "idempotency_conflict",
        lambda: report(runtime, owner, "audit-boundary", key="identical-report-001"),
    )


def test_report_dedup_preserves_attribution(runtime, owner):
    first = report(runtime, owner)
    second = runtime.cases.submit(
        owner,
        ReportInput(
            title="Same finding, independent report",
            description="Another researcher observed the same synthetic gateway condition.",
            researcher="Independent researcher",
            asset_id="gateway",
            test_id="gateway-boundary",
        ),
        new_id("request"),
    )
    assert second["duplicate"] and second["case_id"] == first["case_id"]
    assert len(runtime.cases.get(owner, first["case_id"])["reports"]) == 2


def test_duplicate_approval_only_runs_once(runtime, owner):
    cid = report(runtime, owner)["case_id"]
    value = ApprovalInput(decision="approve", reason="Run exactly once in the lab.")
    one = runtime.cases.approve(owner, cid, value, "same-approval-key")
    two = runtime.cases.approve(owner, cid, value, "same-approval-key")
    assert one == two
    runtime.worker.tick()
    runtime.worker.tick()
    assert len(runtime.runner.calls) == 1
    assert runtime.dashboard(owner)["budget"]["executions"] == 1


def test_concurrent_approval_has_single_winner(runtime, owner):
    cid = report(runtime, owner)["case_id"]

    def attempt(i):
        try:
            runtime.cases.approve(
                owner,
                cid,
                ApprovalInput(decision="approve", reason="Concurrent authorized approval."),
                "concurrent-key-" + str(i),
            )
            return "ok"
        except DomainError as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(attempt, range(4)))
    assert results.count("ok") == 1
    assert len(runtime.store.all("SELECT * FROM jobs WHERE status='queued'")) == 1


def test_no_confirmation_before_observation(runtime, owner):
    cid = report(runtime, owner)["case_id"]
    expect(
        "invalid_transition",
        lambda: runtime.cases.review(
            owner,
            cid,
            ReviewInput(decision="accept", reason="A model claimed success without a test."),
            new_id("request"),
        ),
    )
    assert not runtime.store.all("SELECT * FROM findings")


def test_observation_requires_human_review(runtime, owner):
    cid = report(runtime, owner)["case_id"]
    observe(runtime, owner, cid)
    assert runtime.cases.get(owner, cid)["state"] == "awaiting_review"
    assert not runtime.store.all("SELECT * FROM findings")
    assert (
        runtime.discovery.run(owner, DiscoveryInput(), new_id("request"))["status"]
        == "no_candidates"
    )


def test_evidence_tamper_prevents_promotion(runtime, owner):
    cid = report(runtime, owner)["case_id"]
    case = observe(runtime, owner, cid)
    sha = case["runs"][0]["evidence_hash"]
    artifact = runtime.evidence._path(owner.tenant, sha)
    artifact.write_text('{"tampered":true}')
    expect(
        "evidence_integrity",
        lambda: runtime.cases.review(
            owner,
            cid,
            ReviewInput(decision="accept", reason="Cannot accept changed evidence."),
            new_id("request"),
        ),
    )
    assert not runtime.store.all("SELECT * FROM findings")


def test_missing_evidence_blocks_discovery(runtime, owner):
    confirm(runtime, owner)
    run = runtime.store.one("SELECT * FROM runs")
    runtime.evidence._path(owner.tenant, run["evidence_hash"]).unlink()
    expect(
        "evidence_missing",
        lambda: runtime.discovery.run(owner, DiscoveryInput(), new_id("request")),
    )


def test_graph_outage_fails_closed(runtime, owner):
    confirm(runtime, owner)
    runtime.graph.available = False
    before = len(runtime.runner.calls)
    expect(
        "graph_unavailable",
        lambda: runtime.discovery.run(owner, DiscoveryInput(), new_id("request")),
    )
    assert len(runtime.runner.calls) == before
    assert runtime.dashboard(owner)["memory"]["available"] is False


def test_graph_write_outbox_replays_without_duplicate_nodes(runtime, owner):
    runtime.graph.available = False
    report(runtime, owner)
    expect("graph_unavailable", lambda: runtime.projector.flush())
    assert runtime.store.one("SELECT count(*) AS n FROM outbox WHERE applied_at IS NULL")["n"] > 0
    runtime.graph.available = True
    runtime.projector.flush()
    first = len(runtime.graph.view(owner.tenant)["nodes"])
    with runtime.store.transaction() as c:
        c.execute("UPDATE outbox SET applied_at=NULL")
    runtime.projector.flush()
    assert len(runtime.graph.view(owner.tenant)["nodes"]) == first


def test_crashed_worker_never_automatically_reexecutes(runtime, owner):
    cid = report(runtime, owner)["case_id"]
    runtime.cases.approve(
        owner,
        cid,
        ApprovalInput(decision="approve", reason="Authorized single execution."),
        new_id("request"),
    )
    assert runtime.worker._claim()
    with runtime.store.transaction() as c:
        c.execute("UPDATE jobs SET lease_until=0")
    assert runtime.worker.recover_expired() == 1
    runtime.worker.tick()
    assert runtime.runner.calls == []
    run = runtime.cases.get(owner, cid)["runs"][0]
    assert run["outcome"] == "inconclusive"
    assert run["receipt"]["request_count"] is None


def test_runner_failure_is_inconclusive_not_confirmed(runtime, owner):
    runtime.runner.fail = True
    result = confirm(runtime, owner)
    assert result["state"] == "inconclusive" and result["finding_id"] is None
    assert len(runtime.runner.calls) == 1
    assert runtime.dashboard(owner)["budget"]["executions"] == 1


def test_retry_needs_new_approval_and_stops_after_three(runtime, owner):
    result = confirm(runtime, owner, "audit-boundary")
    assert result["state"] == "inconclusive"
    cid = result["case_id"]
    for _ in range(2):
        runtime.cases.retry(owner, cid, new_id("request"))
        assert runtime.cases.get(owner, cid)["state"] == "awaiting_approval"
        observe(runtime, owner, cid)
        runtime.cases.review(
            owner,
            cid,
            ReviewInput(
                decision="accept", reason="Dependency remains unavailable; retain uncertainty."
            ),
            new_id("request"),
        )
    expect("retry_limit", lambda: runtime.cases.retry(owner, cid, new_id("request")))
    assert len(runtime.runner.calls) == 3


def test_patch_invalidates_without_rewriting_history(runtime, owner):
    first = confirm(runtime, owner)
    cid, fid = first["case_id"], first["finding_id"]
    old = runtime.cases.get(owner, cid)["runs"][0]["evidence_hash"]
    result = runtime.cases.revise(
        owner, "r2", "Patched both authorization boundaries in the lab.", new_id("request")
    )
    assert result["stale_findings"] == 1
    oldcase = runtime.cases.get(owner, cid)
    assert oldcase["state"] == "confirmed" and oldcase["stale"]
    assert oldcase["runs"][0]["evidence_hash"] == old
    assert runtime.dashboard(owner)["verified_current"] == 0
    expect(
        "stale_source",
        lambda: runtime.discovery.run(
            owner, DiscoveryInput(source_finding_id=fid), new_id("request")
        ),
    )
    follow = runtime.cases.revalidate(owner, fid, new_id("request"))
    newer = observe(runtime, owner, follow["case_id"])
    assert newer["runs"][0]["outcome"] == "not_reproduced"
    assert runtime.evidence.get(owner.tenant, old)["outcome"] == "reproduced"


def test_revision_cannot_advance_with_execution_queued(runtime, owner):
    cid = report(runtime, owner)["case_id"]
    runtime.cases.approve(
        owner,
        cid,
        ApprovalInput(decision="approve", reason="Execution is currently queued."),
        new_id("request"),
    )
    expect(
        "executions_in_flight",
        lambda: runtime.cases.revise(
            owner, "r2", "Cannot change during a queued execution.", new_id("request")
        ),
    )


def test_negative_and_inconclusive_memory(runtime, owner):
    confirm(runtime, owner)
    negative = confirm(runtime, owner, "export-tenant-boundary")
    unavailable = confirm(runtime, owner, "audit-boundary")
    assert negative["state"] == "not_reproduced"
    assert unavailable["state"] == "inconclusive"
    candidates = runtime.graph.candidates(owner.tenant, "r1")
    assert {c.test_id for c in candidates} == {"invoice-tenant-boundary"}


def test_chain_requires_all_capabilities(runtime, owner):
    confirm(runtime, owner)
    assert "invoice-chain" not in {c.test_id for c in runtime.graph.candidates(owner.tenant, "r1")}
    confirm(runtime, owner, "invoice-tenant-boundary")
    assert "invoice-chain" in {c.test_id for c in runtime.graph.candidates(owner.tenant, "r1")}


def test_audit_detects_modified_history(runtime, owner):
    report(runtime, owner)
    assert runtime.store.verify_audit(owner.tenant)["valid"]
    with runtime.store.transaction() as c:
        c.execute("UPDATE events SET payload='{}' WHERE kind='report.received'")
    assert runtime.store.verify_audit(owner.tenant)["valid"] is False


def test_audit_contains_no_raw_access_token(runtime, owner):
    runtime.auth.login(ADMIN)
    report(runtime, owner)
    assert ADMIN not in canonical(runtime.store.all("SELECT * FROM events"))


def test_bootstrap_owner_cannot_be_deleted(runtime, owner):
    expect("protected_member", lambda: runtime.auth.revoke_member(owner, owner.id))


def test_member_tokens_are_not_stored_plaintext(runtime, owner):
    member = runtime.auth.add_member(owner, "Additional reviewer", Role.REVIEWER)
    assert member["token"] not in canonical(runtime.store.all("SELECT * FROM members"))
    assert runtime.auth.bearer(member["token"]).role == Role.REVIEWER


def test_expired_session_is_rejected(runtime):
    _, token, _ = runtime.auth.login(ADMIN)
    with runtime.store.transaction() as c:
        c.execute("UPDATE sessions SET expires_at=0")
    expect("unauthorized", lambda: runtime.auth.session(token))


def test_rate_limit_window_resets(runtime):
    runtime.store.limit("sample", 2, 10, now=0)
    runtime.store.limit("sample", 2, 10, now=1)
    expect("rate_limited", lambda: runtime.store.limit("sample", 2, 10, now=2))
    runtime.store.limit("sample", 2, 10, now=11)
