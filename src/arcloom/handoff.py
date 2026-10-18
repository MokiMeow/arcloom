"""Bounded, verified investigation context assembled without advancing workflow state.

Eligibility means graph-supported follow-up context, never execution authorization.
The graph selects candidates; the journal, registry and signed artifacts verify them.
"""

from typing import TYPE_CHECKING

from arcloom.catalog import REVISIONS, TESTS
from arcloom.domain import Actor, DomainError, Role, State
from arcloom.lab import RunPlan
from arcloom.runner import validate_receipt
from arcloom.storage import canonical, digest

if TYPE_CHECKING:
    from arcloom.runtime import Runtime

MAX_RECORDS = 200
MAX_AUDIT_EVENTS = 10_000
# FOLLOWUPS_CYPHER has LIMIT 20. Fail explicitly if a larger registry could hide paths.
MAX_GRAPH_CATALOG = 20


def _unsupported(message: str) -> None:
    raise DomainError("handoff_unsupported", message, 422)


def _integrity(message: str) -> None:
    raise DomainError("handoff_integrity", message, 409)


def _snapshot(runtime: "Runtime", actor: Actor) -> dict:
    member = runtime.store.one(
        "SELECT id,tenant,role,active FROM members WHERE id=? AND tenant=?",
        (actor.id, actor.tenant),
    )
    if not member or not member["active"] or member["role"] != actor.role:
        raise DomainError("unauthorized", "An active workspace member is required", 401)
    workspace = runtime.store.one("SELECT * FROM tenants WHERE id=?", (actor.tenant,))
    if not workspace:
        raise DomainError("unauthorized", "An active workspace member is required", 401)
    if workspace["revision"] not in REVISIONS:
        _unsupported("The workspace revision is not in the reviewed registry")
    result = {"workspace": workspace, "member": member}
    # Fixed table names only. Never truncate prerequisites or reviewed observations.
    for table in ("cases", "findings", "runs", "reviews"):
        rows = runtime.store.all(
            f"SELECT * FROM {table} WHERE tenant=? ORDER BY id LIMIT ?",
            (actor.tenant, MAX_RECORDS + 1),
        )
        if len(rows) > MAX_RECORDS:
            _unsupported("The workspace exceeds the 200-record handoff bound")
        result[table] = rows
    result["head"] = runtime.store.one(
        "SELECT coalesce(max(seq),0) AS seq,count(*) AS n FROM events WHERE tenant=?",
        (actor.tenant,),
    )
    if result["head"]["n"] > MAX_AUDIT_EVENTS:
        _unsupported("The audit chain exceeds the 10000-event verification bound")
    result["pending"] = runtime.store.one(
        "SELECT count(*) AS n FROM outbox WHERE tenant=? AND applied_at IS NULL",
        (actor.tenant,),
    )["n"]
    return result


def _audit(runtime: "Runtime", tenant: str) -> dict:
    try:
        audit = runtime.store.verify_audit(tenant)
    except (ValueError, TypeError, KeyError) as exc:
        raise DomainError(
            "audit_integrity", "The workspace audit chain could not be verified", 409
        ) from exc
    if not audit["valid"]:
        raise DomainError("audit_integrity", "The workspace audit chain could not be verified", 409)
    return {k: audit[k] for k in ("valid", "checked", "head_hash")}


def _case_test(case: dict):
    test = TESTS.get(case["test_id"])
    if test is None or case["asset_id"] != test.asset_id:
        _unsupported("An investigation is outside the reviewed test registry")
    if not isinstance(case["depth"], int) or case["depth"] < 0:
        _integrity("An investigation has an invalid depth")
    return test


def _verify_finding(
    runtime: "Runtime", tenant: str, finding: dict, case: dict, run: dict, reviews: list[dict]
) -> dict:
    test = _case_test(case)
    if (
        finding["case_id"] != case["id"]
        or finding["run_id"] != run["id"]
        or run["case_id"] != case["id"]
        or any(row["tenant"] != tenant for row in (finding, case, run))
        or not (finding["revision"] == run["revision"] == case["revision"])
        or not (finding["test_id"] == run["test_id"] == case["test_id"])
        or finding["depth"] != case["depth"]
        or case["state"] != State.CONFIRMED
        or run["outcome"] != "reproduced"
        or not any(
            r["case_id"] == case["id"] and r["run_id"] == run["id"] and r["decision"] == "accept"
            for r in reviews
        )
    ):
        _integrity("A finding does not match its reviewed execution")
    try:
        receipt = runtime.evidence.get(tenant, run["evidence_hash"])
        if (
            not isinstance(receipt, dict)
            or canonical(receipt) != run["receipt"]
            or receipt.get("outcome") != run["outcome"]
        ):
            _integrity("The journal and evidence artifact disagree")
        validate_receipt(
            RunPlan(
                run_id=run["id"],
                case_id=case["id"],
                tenant=tenant,
                test_id=test.id,
                asset_id=test.asset_id,
                revision=case["revision"],
            ),
            receipt,
            runtime.settings.runner_secret.get_secret_value(),
        )
    except (DomainError, ValueError, TypeError, KeyError) as exc:
        raise DomainError(
            "handoff_evidence_invalid",
            "A current finding's evidence or runner receipt could not be verified",
            409,
        ) from exc
    return {
        "id": finding["id"],
        "case_id": case["id"],
        "title": finding["title"],
        "asset_id": test.asset_id,
        "revision": finding["revision"],
        "depth": finding["depth"],
        "original_researcher": finding["researcher"],
        "evidence": {
            "artifact_id": run["evidence_hash"],
            "sha256": run["evidence_hash"],
            "run_id": run["id"],
            "signature_verified": True,
        },
        "capabilities": sorted(test.enables),
    }


def build_handoff(runtime: "Runtime", actor: Actor) -> dict:
    """Return verified current context. This function never flushes, plans, or mutates."""
    if actor.role not in set(Role):
        raise DomainError("forbidden", "An authenticated workspace role is required", 403)
    if len(TESTS) > MAX_GRAPH_CATALOG:
        _unsupported("The test registry exceeds the bounded graph candidate query")
    before = _snapshot(runtime, actor)
    audit = _audit(runtime, actor.tenant)
    if before["pending"]:
        raise DomainError(
            "graph_sync_pending",
            "Graph memory is still synchronizing; retry after synchronization",
            503,
        )
    if not runtime.graph.ping(actor.tenant):
        raise DomainError("graph_unavailable", "FalkorDB is unavailable", 503)
    revision = before["workspace"]["revision"]
    cases = {c["id"]: c for c in before["cases"]}
    runs = {r["id"]: r for r in before["runs"]}
    findings = []
    for finding in before["findings"]:
        if not finding["current"]:
            continue
        if finding["revision"] != revision:
            _integrity("A current finding belongs to another revision")
        case, run = cases.get(finding["case_id"]), runs.get(finding["run_id"])
        if case is None or run is None:
            _integrity("A current finding is missing its reviewed execution")
        findings.append(
            _verify_finding(runtime, actor.tenant, finding, case, run, before["reviews"])
        )
    by_finding = {f["id"]: f for f in findings}
    raw = runtime.graph.candidates(actor.tenant, revision)
    if len(raw) > MAX_RECORDS or len({c.test_id for c in raw}) != len(raw):
        _unsupported("The graph returned duplicate or excessive handoff candidates")
    for candidate in raw:
        test = TESTS.get(candidate.test_id)
        if (
            test is None
            or candidate.asset_id != test.asset_id
            or set(candidate.requirements) != set(test.requirements)
            or not test.requirements
        ):
            _integrity("A graph candidate does not match the reviewed test registry")
        if len(candidate.path) > MAX_RECORDS or len(candidate.finding_ids) > MAX_RECORDS:
            _unsupported("A graph prerequisite path exceeds the 200-record bound")
    validated = runtime.discovery._validate_candidates(actor.tenant, revision, raw)
    candidates = []
    for candidate in validated:
        if any(fid not in by_finding for fid in candidate.finding_ids):
            _integrity("A graph prerequisite is not a current verified finding")
        required = set(candidate.requirements)
        expected = {(candidate.test_id, "TARGETS", candidate.asset_id)}
        expected.update((candidate.test_id, "REQUIRES", cap) for cap in required)
        for fid in candidate.finding_ids:
            expected.update(
                (fid, "ENABLES", cap) for cap in required & set(by_finding[fid]["capabilities"])
            )
        try:
            actual = {
                (e["source"], e["relation"], e["target"])
                for e in candidate.path
                if set(e) == {"source", "relation", "target"}
            }
        except (KeyError, TypeError) as exc:
            raise DomainError(
                "handoff_integrity", "A graph prerequisite path is malformed", 409
            ) from exc
        if actual != expected or any(
            set(e) != {"source", "relation", "target"} for e in candidate.path
        ):
            _integrity("A graph prerequisite path is incomplete or unsupported")
        candidates.append(
            {
                "test_id": candidate.test_id,
                "asset_id": candidate.asset_id,
                "title": TESTS[candidate.test_id].title,
                "depth": candidate.depth,
                "requires": sorted(required),
                "finding_ids": sorted(candidate.finding_ids),
                "paths": [[dict(source=s, relation=r, target=t) for s, r, t in sorted(expected)]],
            }
        )
    current_cases = [c for c in before["cases"] if c["revision"] == revision]
    attempted = {c["test_id"] for c in current_cases}
    eligible = {c["test_id"] for c in candidates}
    available = {cap for f in findings for cap in f["capabilities"]}
    blocked = []
    for test in TESTS.values():
        if test.id in eligible:
            continue
        missing = sorted(set(test.requirements) - available)
        if test.id in attempted:
            reason, missing = "already_attempted", []
        elif not test.requirements:
            reason, missing = "report_required", []
        elif missing:
            reason = "missing_prerequisites"
        else:
            supporting = [f for f in findings if set(f["capabilities"]) & set(test.requirements)]
            if max(f["depth"] for f in supporting) + 1 <= runtime.settings.max_depth:
                _integrity("The graph omitted a currently supported follow-up")
            reason = "depth_limit"
        blocked.append(
            {
                "test_id": test.id,
                "title": test.title,
                "reason": reason,
                "missing_capabilities": missing,
            }
        )
    observations = []
    for case in current_cases:
        if case["state"] not in {State.NOT_REPRODUCED, State.INCONCLUSIVE}:
            continue
        _case_test(case)
        reviewed = [r for r in before["reviews"] if r["case_id"] == case["id"]]
        if len(reviewed) != 1 or reviewed[0]["run_id"] not in runs:
            _integrity("A reviewed observation is missing its execution")
        run = runs[reviewed[0]["run_id"]]
        if (
            run["case_id"] != case["id"]
            or run["revision"] != revision
            or run["test_id"] != case["test_id"]
        ):
            _integrity("A reviewed observation does not match its execution")
        observations.append(
            {
                "case_id": case["id"],
                "test_id": case["test_id"],
                "title": case["title"],
                "state": case["state"],
                "outcome": run["outcome"],
                "revision": revision,
            }
        )
    after = _snapshot(runtime, actor)
    after_audit = _audit(runtime, actor.tenant)
    if before != after or audit != after_audit:
        raise DomainError(
            "analysis_changed", "Workspace changed during analysis; refresh and try again", 409
        )
    packet = {
        "schemaVersion": 1,
        "workspace": {"tenant": actor.tenant, "revision": revision},
        "graph": {"engine": "FalkorDB", "in_sync": True},
        "audit": audit,
        "summary": {
            "confirmed_current": len(findings),
            "negative_current": sum(o["state"] == State.NOT_REPRODUCED for o in observations),
            "inconclusive_current": sum(o["state"] == State.INCONCLUSIVE for o in observations),
            "eligible_followups": len(candidates),
        },
        "findings": sorted(findings, key=lambda f: f["id"]),
        "candidates": sorted(candidates, key=lambda c: c["test_id"]),
        "observations": sorted(observations, key=lambda o: o["case_id"]),
        "blocked": sorted(blocked, key=lambda b: b["test_id"]),
    }
    packet["packet_sha256"] = digest(canonical(packet))
    return packet
