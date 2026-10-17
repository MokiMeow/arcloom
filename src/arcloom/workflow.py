"""Transactional report, authorization, review and temporal-memory workflows."""

import json
import sqlite3
import time

from arcloom.auth import require
from arcloom.catalog import ASSETS, REVISIONS, TESTS
from arcloom.config import Settings
from arcloom.domain import Actor, ApprovalInput, DomainError, ReportInput, ReviewInput, Role, State
from arcloom.evidence import EvidenceStore
from arcloom.graph import Projector, edge, node
from arcloom.lab import RunPlan
from arcloom.runner import validate_receipt
from arcloom.storage import Store, canonical, digest, new_id, row_or_error


def decode_case(row: dict) -> dict:
    return {**row, "supports": json.loads(row["supports"]), "path": json.loads(row["path"])}


def case_node(case: dict) -> dict:
    return node(
        "Hypothesis",
        case["id"],
        title=case["title"],
        test_id=case["test_id"],
        asset_id=case["asset_id"],
        revision=case["revision"],
        state=case["state"],
        origin=case["origin"],
        reason=case["reason"],
        depth=case["depth"],
    )


def cached(
    conn: sqlite3.Connection, actor: Actor, operation: str, key: str, body: dict
) -> dict | None:
    if not 8 <= len(key) <= 100 or not all(c.isascii() and (c.isalnum() or c in "-_") for c in key):
        raise DomainError(
            "invalid_idempotency_key", "Provide an 8–100 character Idempotency-Key", 422
        )
    row = conn.execute(
        "SELECT * FROM idempotency WHERE tenant=? AND actor=? AND operation=? AND key=?",
        (actor.tenant, actor.id, operation, key),
    ).fetchone()
    if row:
        if row["request_hash"] != digest(canonical(body)):
            raise DomainError(
                "idempotency_conflict",
                "This idempotency key was already used for a different request",
                409,
            )
        return json.loads(row["response"])
    return None


def remember(
    conn: sqlite3.Connection, actor: Actor, operation: str, key: str, body: dict, response: dict
) -> dict:
    conn.execute(
        "INSERT INTO idempotency VALUES(?,?,?,?,?,?,?)",
        (
            actor.tenant,
            actor.id,
            operation,
            key,
            digest(canonical(body)),
            canonical(response),
            time.time(),
        ),
    )
    return response


def scope_check(
    conn: sqlite3.Connection,
    settings: Settings,
    tenant: str,
    test_id: str,
    asset_id: str,
    revision: str,
    budget: bool = True,
) -> dict:
    scope = row_or_error(conn, "SELECT * FROM tenants WHERE id=?", (tenant,))
    test = TESTS.get(test_id)
    if test is None or asset_id not in ASSETS or test.asset_id != asset_id:
        raise DomainError(
            "out_of_scope",
            "Only registered tests against their mapped synthetic lab assets are permitted",
            403,
        )
    if not scope["scope_enabled"]:
        raise DomainError("scope_paused", "New lab executions are paused", 403)
    if time.time() > scope["created_at"] + settings.assessment_seconds:
        raise DomainError("scope_expired", "The configured assessment window has expired", 403)
    if revision != scope["revision"]:
        raise DomainError("stale_revision", "This investigation targets an older lab revision", 409)
    if budget:
        b = row_or_error(
            conn, "SELECT * FROM budgets WHERE tenant=? AND revision=?", (tenant, revision)
        )
        if b["executions"] >= settings.execution_budget:
            raise DomainError(
                "execution_budget", "The execution budget for this revision is exhausted", 403
            )
    return scope


def verify_supports(conn: sqlite3.Connection, case: dict) -> None:
    if case["origin"] != "agent":
        return
    ids = json.loads(case["supports"])
    if not ids:
        raise DomainError(
            "missing_evidence", "An agent discovery requires graph-backed source findings", 409
        )
    capabilities = set()
    for finding_id in ids:
        finding = row_or_error(
            conn, "SELECT * FROM findings WHERE tenant=? AND id=?", (case["tenant"], finding_id)
        )
        if not finding["current"] or finding["revision"] != case["revision"]:
            raise DomainError(
                "stale_prerequisite", "A supporting finding is no longer current", 409
            )
        capabilities.update(TESTS[finding["test_id"]].enables)
    if not set(TESTS[case["test_id"]].requirements) <= capabilities:
        raise DomainError(
            "missing_prerequisite", "Not all prerequisites have verified support", 409
        )


class Cases:
    def __init__(
        self, store: Store, settings: Settings, projector: Projector, evidence: EvidenceStore
    ):
        self.store, self.settings, self.projector, self.evidence = (
            store,
            settings,
            projector,
            evidence,
        )

    def get(self, actor: Actor, case_id: str) -> dict:
        row = self.store.one("SELECT * FROM cases WHERE tenant=? AND id=?", (actor.tenant, case_id))
        if not row:
            raise DomainError("not_found", "Investigation not found", 404)
        case = decode_case(row)
        case["reports"] = self.store.all(
            "SELECT * FROM reports WHERE tenant=? AND case_id=? ORDER BY created_at",
            (actor.tenant, case_id),
        )
        case["approvals"] = self.store.all(
            "SELECT * FROM approvals WHERE tenant=? AND case_id=? ORDER BY created_at",
            (actor.tenant, case_id),
        )
        case["reviews"] = self.store.all(
            "SELECT * FROM reviews WHERE tenant=? AND case_id=? ORDER BY created_at",
            (actor.tenant, case_id),
        )
        case["runs"] = [
            {**r, "receipt": json.loads(r["receipt"])}
            for r in self.store.all(
                "SELECT * FROM runs WHERE tenant=? AND case_id=? ORDER BY created_at",
                (actor.tenant, case_id),
            )
        ]
        case["finding"] = self.store.one(
            "SELECT * FROM findings WHERE tenant=? AND case_id=?", (actor.tenant, case_id)
        )
        current = self.store.one("SELECT revision FROM tenants WHERE id=?", (actor.tenant,))
        case["stale"] = row["revision"] != current["revision"]
        return case

    def list(
        self,
        actor: Actor,
        limit: int = 50,
        offset: int = 0,
        state: str | None = None,
        search: str = "",
    ) -> dict:
        where, params = "tenant=?", [actor.tenant]
        if state:
            if state not in set(State):
                raise DomainError("invalid_state", "Unknown investigation state", 422)
            where += " AND state=?"
            params.append(state)
        if search:
            where += " AND (title LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')"
            escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            params += [f"%{escaped}%"] * 2
        total = self.store.one(f"SELECT count(*) AS n FROM cases WHERE {where}", tuple(params))["n"]
        rows = self.store.all(
            f"SELECT * FROM cases WHERE {where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
            tuple(params + [limit, offset]),
        )
        revision = self.store.one("SELECT revision FROM tenants WHERE id=?", (actor.tenant,))[
            "revision"
        ]
        return {
            "items": [{**decode_case(r), "stale": r["revision"] != revision} for r in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    def submit(self, actor: Actor, value: ReportInput, key: str) -> dict:
        require(actor, Role.RESEARCHER, Role.REVIEWER)
        body, now = value.model_dump(), time.time()
        with self.store.transaction() as conn:
            old = cached(conn, actor, "submit_report", key, body)
            if old:
                return old
            scope = row_or_error(conn, "SELECT * FROM tenants WHERE id=?", (actor.tenant,))
            scope_check(
                conn,
                self.settings,
                actor.tenant,
                value.test_id,
                value.asset_id,
                scope["revision"],
                budget=False,
            )
            existing = conn.execute(
                "SELECT * FROM cases WHERE tenant=? AND test_id=? AND revision=?",
                (actor.tenant, value.test_id, scope["revision"]),
            ).fetchone()
            if existing:
                case_id, duplicate = existing["id"], True
            else:
                count = conn.execute(
                    "SELECT count(*) FROM cases WHERE tenant=?", (actor.tenant,)
                ).fetchone()[0]
                if count >= 200:
                    raise DomainError(
                        "workspace_limit", "The demo workspace has reached its case limit", 409
                    )
                case_id, duplicate = new_id("case"), False
                conn.execute(
                    "INSERT INTO cases(id,tenant,title,test_id,asset_id,revision,origin,state,researcher,created_by,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        case_id,
                        actor.tenant,
                        value.title,
                        value.test_id,
                        value.asset_id,
                        scope["revision"],
                        "report",
                        State.AWAITING_APPROVAL,
                        value.researcher,
                        actor.id,
                        "Submitted report; not yet verified.",
                        now,
                        now,
                    ),
                )
                case = dict(conn.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone())
                self.store.event(
                    conn,
                    actor.tenant,
                    "investigation.proposed",
                    actor.id,
                    case_id,
                    {"origin": "report", "test_id": value.test_id},
                    {
                        "nodes": [case_node(case)],
                        "edges": [edge(case_id, "TARGETS", value.asset_id)],
                    },
                )
            report_id = new_id("report")
            conn.execute(
                "INSERT INTO reports VALUES(?,?,?,?,?,?,?,?)",
                (
                    report_id,
                    actor.tenant,
                    case_id,
                    value.title,
                    value.description,
                    value.researcher,
                    actor.id,
                    now,
                ),
            )
            self.store.event(
                conn,
                actor.tenant,
                "report.linked" if duplicate else "report.received",
                actor.id,
                case_id,
                {"report_id": report_id, "duplicate": duplicate, "researcher": value.researcher},
                {
                    "nodes": [
                        node("Report", report_id, title=value.title, researcher=value.researcher)
                    ],
                    "edges": [edge(case_id, "ATTRIBUTED_TO", report_id)],
                },
            )
            return remember(
                conn,
                actor,
                "submit_report",
                key,
                body,
                {"case_id": case_id, "report_id": report_id, "duplicate": duplicate},
            )

    def approve(self, actor: Actor, case_id: str, value: ApprovalInput, key: str) -> dict:
        require(actor, Role.REVIEWER)
        body, operation = value.model_dump(), "approve_" + case_id
        if value.decision == "approve":
            self.projector.require_current(actor.tenant)
        with self.store.transaction() as conn:
            old = cached(conn, actor, operation, key, body)
            if old:
                return old
            case = row_or_error(
                conn, "SELECT * FROM cases WHERE tenant=? AND id=?", (actor.tenant, case_id)
            )
            if case["state"] != State.AWAITING_APPROVAL:
                raise DomainError(
                    "invalid_transition",
                    "Only an investigation awaiting approval can be authorized or denied",
                )
            if value.decision == "approve":
                scope_check(
                    conn,
                    self.settings,
                    actor.tenant,
                    case["test_id"],
                    case["asset_id"],
                    case["revision"],
                )
                verify_supports(conn, case)
            now, approval_id = time.time(), new_id("approval")
            conn.execute(
                "INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    approval_id,
                    actor.tenant,
                    case_id,
                    value.decision,
                    actor.id,
                    value.reason,
                    case["revision"],
                    now + self.settings.approval_seconds,
                    now,
                ),
            )
            state = State.QUEUED if value.decision == "approve" else State.DENIED
            conn.execute("UPDATE cases SET state=?,updated_at=? WHERE id=?", (state, now, case_id))
            case["state"] = state
            job_id = None
            if value.decision == "approve":
                job_id = new_id("job")
                conn.execute(
                    "INSERT INTO jobs(id,tenant,case_id,approval_id,status,created_at) VALUES(?,?,?,?,?,?)",
                    (job_id, actor.tenant, case_id, approval_id, "queued", now),
                )
            self.store.event(
                conn,
                actor.tenant,
                "execution.authorized" if job_id else "execution.denied",
                actor.id,
                case_id,
                {
                    "approval_id": approval_id,
                    "job_id": job_id,
                    "reason": value.reason,
                    "revision": case["revision"],
                    "test_id": case["test_id"],
                    "asset_id": case["asset_id"],
                    "expires_at": now + self.settings.approval_seconds,
                },
                {"nodes": [case_node(case)]},
            )
            return remember(
                conn,
                actor,
                operation,
                key,
                body,
                {"case_id": case_id, "state": state, "job_id": job_id},
            )

    def review(self, actor: Actor, case_id: str, value: ReviewInput, key: str) -> dict:
        require(actor, Role.REVIEWER)
        body, operation = value.model_dump(), "review_" + case_id
        with self.store.transaction() as conn:
            old = cached(conn, actor, operation, key, body)
            if old:
                return old
            case = row_or_error(
                conn, "SELECT * FROM cases WHERE tenant=? AND id=?", (actor.tenant, case_id)
            )
            if case["state"] != State.AWAITING_REVIEW:
                raise DomainError(
                    "invalid_transition",
                    "Only an observed investigation awaiting review can be reviewed",
                )
            run = row_or_error(
                conn,
                "SELECT * FROM runs WHERE tenant=? AND case_id=? ORDER BY created_at DESC LIMIT 1",
                (actor.tenant, case_id),
            )
            receipt = self.evidence.get(actor.tenant, run["evidence_hash"])
            plan = RunPlan(
                run_id=run["id"],
                case_id=case_id,
                tenant=actor.tenant,
                test_id=case["test_id"],
                asset_id=case["asset_id"],
                revision=case["revision"],
            )
            if receipt.get("environment") == "synthetic-asgi-lab":
                validate_receipt(plan, receipt, self.settings.runner_secret.get_secret_value())
            elif run["outcome"] != "inconclusive":
                raise DomainError(
                    "invalid_proof", "An unobserved execution cannot establish a finding", 409
                )
            if receipt.get("outcome") != run["outcome"] or canonical(receipt) != run["receipt"]:
                raise DomainError(
                    "evidence_integrity", "The journal and evidence artifact disagree", 409
                )
            if value.decision == "reject":
                state = State.REJECTED
            elif value.decision == "needs_info":
                state = State.INCONCLUSIVE
            else:
                state = {
                    "reproduced": State.CONFIRMED,
                    "not_reproduced": State.NOT_REPRODUCED,
                    "inconclusive": State.INCONCLUSIVE,
                }[run["outcome"]]
            now, review_id, finding_id = time.time(), new_id("review"), None
            conn.execute(
                "INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?)",
                (
                    review_id,
                    actor.tenant,
                    case_id,
                    run["id"],
                    actor.id,
                    value.decision,
                    value.reason,
                    now,
                ),
            )
            conn.execute("UPDATE cases SET state=?,updated_at=? WHERE id=?", (state, now, case_id))
            case["state"] = state
            nodes = [
                case_node(case),
                node(
                    "Review",
                    review_id,
                    decision=value.decision,
                    reason=value.reason,
                    reviewer=actor.id,
                ),
            ]
            edges = [edge(review_id, "REVIEWS", run["id"])]
            if state == State.CONFIRMED:
                finding_id = new_id("finding")
                revision = row_or_error(
                    conn, "SELECT revision FROM tenants WHERE id=?", (actor.tenant,)
                )["revision"]
                current = revision == case["revision"]
                # A finding is historical truth; current applicability is separate.
                conn.execute(
                    "INSERT INTO findings VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        finding_id,
                        actor.tenant,
                        case_id,
                        run["id"],
                        case["test_id"],
                        case["revision"],
                        int(current),
                        case["depth"],
                        case["title"],
                        case["researcher"],
                        case["supports"],
                        now,
                    ),
                )
                nodes.append(
                    node(
                        "Finding",
                        finding_id,
                        title=case["title"],
                        status="confirmed",
                        current=current,
                        revision=case["revision"],
                        depth=case["depth"],
                        test_id=case["test_id"],
                        case_id=case_id,
                        researcher=case["researcher"],
                        evidence_hash=run["evidence_hash"],
                    )
                )
                edges += [
                    edge(finding_id, "BACKED_BY", run["id"]),
                    edge(finding_id, "AFFECTS", case["asset_id"]),
                ]
                edges += [
                    edge(finding_id, "ENABLES", cap) for cap in TESTS[case["test_id"]].enables
                ]
                edges += [
                    edge(finding_id, "DERIVED_FROM", source)
                    for source in json.loads(case["supports"])
                ]
            self.store.event(
                conn,
                actor.tenant,
                "finding.confirmed" if finding_id else "investigation.reviewed",
                actor.id,
                case_id,
                {
                    "review_id": review_id,
                    "finding_id": finding_id,
                    "state": state,
                    "run_id": run["id"],
                    "reason": value.reason,
                    "evidence_hash": run["evidence_hash"],
                },
                {"nodes": nodes, "edges": edges},
            )
            return remember(
                conn,
                actor,
                operation,
                key,
                body,
                {"case_id": case_id, "state": state, "finding_id": finding_id},
            )

    def retry(self, actor: Actor, case_id: str, key: str) -> dict:
        require(actor, Role.REVIEWER)
        operation = "retry_" + case_id
        with self.store.transaction() as conn:
            old = cached(conn, actor, operation, key, {})
            if old:
                return old
            case = row_or_error(
                conn, "SELECT * FROM cases WHERE tenant=? AND id=?", (actor.tenant, case_id)
            )
            if case["state"] != State.INCONCLUSIVE:
                raise DomainError(
                    "invalid_transition", "Only an inconclusive case can request another attempt"
                )
            scope_check(
                conn,
                self.settings,
                actor.tenant,
                case["test_id"],
                case["asset_id"],
                case["revision"],
            )
            attempts = conn.execute(
                "SELECT count(*) FROM jobs WHERE tenant=? AND case_id=?", (actor.tenant, case_id)
            ).fetchone()[0]
            if attempts >= 3:
                raise DomainError(
                    "retry_limit", "This case has reached its three-attempt limit", 403
                )
            case["state"] = State.AWAITING_APPROVAL
            conn.execute(
                "UPDATE cases SET state=?,updated_at=? WHERE id=?",
                (case["state"], time.time(), case_id),
            )
            self.store.event(
                conn,
                actor.tenant,
                "retry.requested",
                actor.id,
                case_id,
                {"prior_attempts": attempts},
                {"nodes": [case_node(case)]},
            )
            return remember(
                conn, actor, operation, key, {}, {"case_id": case_id, "state": case["state"]}
            )

    def revise(self, actor: Actor, revision: str, reason: str, key: str) -> dict:
        require(actor, Role.ADMIN)
        body, operation = {"revision": revision, "reason": reason}, "change_revision"
        if revision not in REVISIONS:
            raise DomainError("unknown_revision", "Unknown synthetic revision", 422)
        with self.store.transaction() as conn:
            old = cached(conn, actor, operation, key, body)
            if old:
                return old
            scope = row_or_error(conn, "SELECT * FROM tenants WHERE id=?", (actor.tenant,))
            if scope["revision"] == revision:
                raise DomainError("same_revision", "That revision is already active")
            if revision != "r2" or scope["revision"] != "r1":
                raise DomainError(
                    "revision_rollback",
                    "Demo revisions advance from r1 to r2; use a new workspace to replay",
                )
            busy = conn.execute(
                "SELECT 1 FROM jobs WHERE tenant=? AND status IN ('queued','running')",
                (actor.tenant,),
            ).fetchone()
            if busy:
                raise DomainError(
                    "executions_in_flight",
                    "Finish or deny outstanding executions before changing revision",
                )
            conn.execute("UPDATE tenants SET revision=? WHERE id=?", (revision, actor.tenant))
            conn.execute(
                "INSERT OR IGNORE INTO budgets(tenant,revision) VALUES(?,?)",
                (actor.tenant, revision),
            )
            rows = conn.execute(
                "SELECT f.*,r.evidence_hash FROM findings f JOIN runs r ON r.id=f.run_id WHERE f.tenant=? AND f.current=1",
                (actor.tenant,),
            ).fetchall()
            conn.execute("UPDATE findings SET current=0 WHERE tenant=?", (actor.tenant,))
            nodes = [node("Revision", revision, title=REVISIONS[revision])]
            nodes += [
                node("Asset", asset, **props, current_revision=revision)
                for asset, props in ASSETS.items()
            ]
            for f in rows:
                nodes.append(
                    node(
                        "Finding",
                        f["id"],
                        title=f["title"],
                        status="confirmed",
                        current=False,
                        revision=f["revision"],
                        depth=f["depth"],
                        test_id=f["test_id"],
                        case_id=f["case_id"],
                        researcher=f["researcher"],
                        evidence_hash=f["evidence_hash"],
                    )
                )
            self.store.event(
                conn,
                actor.tenant,
                "revision.changed",
                actor.id,
                revision,
                {
                    "from": scope["revision"],
                    "to": revision,
                    "reason": reason,
                    "stale_findings": [f["id"] for f in rows],
                    "interpretation": "Stale does not mean fixed.",
                },
                {
                    "nodes": nodes,
                    "edges": [edge(revision, "DEPLOYED_TO", asset) for asset in ASSETS],
                },
            )
            return remember(
                conn,
                actor,
                operation,
                key,
                body,
                {"revision": revision, "stale_findings": len(rows)},
            )

    def revalidate(self, actor: Actor, finding_id: str, key: str) -> dict:
        require(actor, Role.REVIEWER)
        operation = "revalidate_" + finding_id
        with self.store.transaction() as conn:
            old = cached(conn, actor, operation, key, {})
            if old:
                return old
            finding = row_or_error(
                conn, "SELECT * FROM findings WHERE tenant=? AND id=?", (actor.tenant, finding_id)
            )
            revision = row_or_error(
                conn, "SELECT revision FROM tenants WHERE id=?", (actor.tenant,)
            )["revision"]
            if finding["revision"] == revision:
                raise DomainError(
                    "already_current_revision",
                    "This finding already belongs to the current revision",
                )
            t = TESTS[finding["test_id"]]
            scope_check(conn, self.settings, actor.tenant, t.id, t.asset_id, revision)
            existing = conn.execute(
                "SELECT id FROM cases WHERE tenant=? AND test_id=? AND revision=?",
                (actor.tenant, t.id, revision),
            ).fetchone()
            if existing:
                return remember(
                    conn, actor, operation, key, {}, {"case_id": existing["id"], "duplicate": True}
                )
            case_id, now = new_id("case"), time.time()
            conn.execute(
                "INSERT INTO cases(id,tenant,title,test_id,asset_id,revision,origin,state,researcher,created_by,reason,parent_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    case_id,
                    actor.tenant,
                    "Revalidate: " + t.title,
                    t.id,
                    t.asset_id,
                    revision,
                    "revalidation",
                    State.AWAITING_APPROVAL,
                    finding["researcher"],
                    actor.id,
                    "Explicitly re-test a historical finding at the new synthetic revision.",
                    finding["case_id"],
                    now,
                    now,
                ),
            )
            case = dict(conn.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone())
            self.store.event(
                conn,
                actor.tenant,
                "revalidation.proposed",
                actor.id,
                case_id,
                {"finding_id": finding_id, "revision": revision},
                {
                    "nodes": [case_node(case)],
                    "edges": [
                        edge(case_id, "DERIVED_FROM", finding_id),
                        edge(case_id, "TARGETS", t.asset_id),
                    ],
                },
            )
            return remember(
                conn, actor, operation, key, {}, {"case_id": case_id, "duplicate": False}
            )

    def set_scope(self, actor: Actor, enabled: bool, reason: str, key: str) -> dict:
        require(actor, Role.ADMIN)
        body, operation = {"enabled": enabled, "reason": reason}, "scope"
        with self.store.transaction() as conn:
            old = cached(conn, actor, operation, key, body)
            if old:
                return old
            conn.execute(
                "UPDATE tenants SET scope_enabled=? WHERE id=?", (int(enabled), actor.tenant)
            )
            self.store.event(
                conn,
                actor.tenant,
                "scope.resumed" if enabled else "scope.paused",
                actor.id,
                actor.tenant,
                {
                    "reason": reason,
                    "enabled": enabled,
                    "note": "Already-started read-only tests may finish.",
                },
            )
            return remember(conn, actor, operation, key, body, {"enabled": enabled})
