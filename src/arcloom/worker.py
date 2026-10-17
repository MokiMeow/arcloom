"""Durable, fenced execution. Uncertain interrupted tests are never auto-replayed."""

import logging
import threading
import time

from arcloom.config import Settings
from arcloom.domain import DomainError, State
from arcloom.evidence import EvidenceStore, sign_receipt
from arcloom.graph import Projector, edge, node
from arcloom.lab import RunPlan
from arcloom.runner import RunnerPort, validate_receipt
from arcloom.storage import Store, canonical, new_id
from arcloom.workflow import case_node, scope_check, verify_supports

log = logging.getLogger("arcloom.worker")


class Worker:
    def __init__(
        self,
        store: Store,
        settings: Settings,
        projector: Projector,
        runner: RunnerPort,
        evidence: EvidenceStore,
    ):
        self.store, self.settings, self.projector = store, settings, projector
        self.runner, self.evidence = runner, evidence
        self._stop, self._thread = threading.Event(), None
        self.last_tick: float | None = None
        self.last_error: str | None = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="arcloom-worker", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=self.settings.lab_timeout_seconds + 5)

    def _loop(self):
        while not self._stop.is_set():
            try:
                self.tick()
                self.last_error = None
            except Exception as exc:
                self.last_error = exc.code if isinstance(exc, DomainError) else "worker_error"
                log.warning("worker_tick_failed", extra={"error_code": self.last_error})
            finally:
                self.last_tick = time.time()
            self._stop.wait(self.settings.worker_poll_seconds)

    def tick(self) -> str | None:
        self.recover_expired()
        self.projector.flush()
        claim = self._claim()
        if claim is None:
            return None
        case, job = claim
        plan = RunPlan(
            run_id="run_" + job["id"][4:],
            case_id=case["id"],
            tenant=case["tenant"],
            test_id=case["test_id"],
            revision=case["revision"],
            asset_id=case["asset_id"],
        )
        try:
            receipt = self.runner.execute(plan)
            validate_receipt(plan, receipt, self.settings.runner_secret.get_secret_value())
        except Exception as exc:
            reason = exc.code if isinstance(exc, DomainError) else "runner_failed"
            receipt = self._uncertain(plan, reason)
        with self.store.transaction() as conn:
            current = conn.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone()
            if current["status"] != "running" or current["fence"] != job["fence"]:
                self.store.event(
                    conn,
                    case["tenant"],
                    "execution.late_result_discarded",
                    "worker",
                    case["id"],
                    {"job_id": job["id"]},
                )
                return job["id"]
            if current["lease_until"] < time.time():
                receipt = self._uncertain(plan, "execution_lease_expired")
            self._record(conn, case, job, receipt)
        self.projector.flush()
        return job["id"]

    def _claim(self) -> tuple[dict, dict] | None:
        with self.store.transaction() as conn:
            rows = conn.execute(
                "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 20"
            ).fetchall()
            for r in rows:
                job = dict(r)
                if conn.execute(
                    "SELECT 1 FROM jobs WHERE tenant=? AND status='running'", (job["tenant"],)
                ).fetchone():
                    continue
                case = dict(
                    conn.execute("SELECT * FROM cases WHERE id=?", (job["case_id"],)).fetchone()
                )
                approval = conn.execute(
                    "SELECT * FROM approvals WHERE id=?", (job["approval_id"],)
                ).fetchone()
                try:
                    scope_check(
                        conn,
                        self.settings,
                        case["tenant"],
                        case["test_id"],
                        case["asset_id"],
                        case["revision"],
                    )
                    verify_supports(conn, case)
                    if (
                        approval["expires_at"] <= time.time()
                        or approval["decision"] != "approve"
                        or approval["revision"] != case["revision"]
                    ):
                        raise DomainError(
                            "approval_expired", "A fresh matching approval is required", 403
                        )
                    reviewer = conn.execute(
                        "SELECT active,role FROM members WHERE id=? AND tenant=?",
                        (approval["actor"], case["tenant"]),
                    ).fetchone()
                    if (
                        not reviewer
                        or not reviewer["active"]
                        or reviewer["role"] not in {"admin", "reviewer"}
                    ):
                        raise DomainError(
                            "approval_revoked", "The approving reviewer no longer has access", 403
                        )
                except DomainError as exc:
                    conn.execute(
                        "UPDATE jobs SET status='denied',finished_at=? WHERE id=?",
                        (time.time(), job["id"]),
                    )
                    conn.execute(
                        "UPDATE cases SET state=?,updated_at=? WHERE id=?",
                        (State.DENIED, time.time(), case["id"]),
                    )
                    case["state"] = State.DENIED
                    self.store.event(
                        conn,
                        case["tenant"],
                        "execution.blocked",
                        "worker",
                        case["id"],
                        {"reason": exc.code, "job_id": job["id"], "network_execution": False},
                        {"nodes": [case_node(case)]},
                    )
                    continue
                now, fence = time.time(), new_id("fence")
                conn.execute(
                    "UPDATE jobs SET status='running',fence=?,lease_until=? WHERE id=?",
                    (fence, now + self.settings.run_lease_seconds, job["id"]),
                )
                conn.execute(
                    "UPDATE cases SET state=?,updated_at=? WHERE id=?",
                    (State.RUNNING, now, case["id"]),
                )
                conn.execute(
                    "UPDATE budgets SET executions=executions+1 WHERE tenant=? AND revision=?",
                    (case["tenant"], case["revision"]),
                )
                case["state"] = State.RUNNING
                job.update(
                    status="running", fence=fence, lease_until=now + self.settings.run_lease_seconds
                )
                self.store.event(
                    conn,
                    case["tenant"],
                    "execution.started",
                    "worker",
                    case["id"],
                    {
                        "job_id": job["id"],
                        "test_id": case["test_id"],
                        "revision": case["revision"],
                        "approval_id": approval["id"],
                        "budget_reserved": True,
                    },
                    {"nodes": [case_node(case)]},
                )
                return case, job
        return None

    def _uncertain(self, plan: RunPlan, reason: str) -> dict:
        receipt = {
            **plan.model_dump(),
            "outcome": "inconclusive",
            "environment": "control-plane",
            "conclusion": "The execution outcome is uncertain; a new approved attempt is required.",
            "reason_code": reason,
            "observations": [],
            "request_count": None,
            "synthetic": True,
            "recorded_at": time.time(),
        }
        return {
            **receipt,
            "signature": sign_receipt(receipt, self.settings.runner_secret.get_secret_value()),
        }

    def _record(self, conn, case: dict, job: dict, receipt: dict):
        sha, now, run_id = (
            self.evidence.put(case["tenant"], receipt),
            time.time(),
            receipt["run_id"],
        )
        conn.execute(
            "INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                run_id,
                case["tenant"],
                case["id"],
                job["id"],
                case["test_id"],
                case["revision"],
                receipt["outcome"],
                sha,
                canonical(receipt),
                now,
            ),
        )
        conn.execute("UPDATE jobs SET status='done',finished_at=? WHERE id=?", (now, job["id"]))
        conn.execute(
            "UPDATE cases SET state=?,updated_at=? WHERE id=?",
            (State.AWAITING_REVIEW, now, case["id"]),
        )
        case["state"] = State.AWAITING_REVIEW
        evidence_id = "evidence_" + sha
        self.store.event(
            conn,
            case["tenant"],
            "execution.observed",
            "worker",
            case["id"],
            {
                "run_id": run_id,
                "outcome": receipt["outcome"],
                "evidence_hash": sha,
                "environment": receipt["environment"],
                "request_count": receipt["request_count"],
            },
            {
                "nodes": [
                    case_node(case),
                    node(
                        "TestRun",
                        run_id,
                        title=case["test_id"],
                        outcome=receipt["outcome"],
                        test_id=case["test_id"],
                        revision=case["revision"],
                        case_id=case["id"],
                    ),
                    node(
                        "Evidence",
                        evidence_id,
                        title="Signed execution receipt",
                        sha256=sha,
                        uri="/api/evidence/" + sha,
                        environment=receipt["environment"],
                    ),
                ],
                "edges": [
                    edge(run_id, "EXECUTED", case["test_id"]),
                    edge(run_id, "BACKED_BY", evidence_id),
                    edge(case["id"], "PRODUCED", run_id),
                ],
            },
        )

    def recover_expired(self) -> int:
        recovered = 0
        with self.store.transaction() as conn:
            for row in conn.execute(
                "SELECT * FROM jobs WHERE status='running' AND lease_until<?", (time.time(),)
            ).fetchall():
                job = dict(row)
                case = dict(
                    conn.execute("SELECT * FROM cases WHERE id=?", (job["case_id"],)).fetchone()
                )
                plan = RunPlan(
                    run_id="run_" + job["id"][4:],
                    case_id=case["id"],
                    tenant=case["tenant"],
                    test_id=case["test_id"],
                    revision=case["revision"],
                    asset_id=case["asset_id"],
                )
                self._record(conn, case, job, self._uncertain(plan, "worker_interrupted"))
                recovered += 1
        return recovered
