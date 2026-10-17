"""One bounded, fresh-context investigation step, recoverable from persisted state."""

import sqlite3
import time
from collections.abc import Callable

from arcloom.agents import PlannerPort, check_selection
from arcloom.auth import require
from arcloom.catalog import TESTS
from arcloom.config import Settings
from arcloom.domain import Actor, Candidate, DiscoveryInput, DomainError, Role, State
from arcloom.evidence import EvidenceStore
from arcloom.graph import FOLLOWUPS_CYPHER, GraphPort, Projector, edge, node
from arcloom.storage import Store, canonical, new_id, row_or_error
from arcloom.workflow import cached, case_node, remember, scope_check, verify_supports


class Discovery:
    def __init__(
        self,
        store: Store,
        settings: Settings,
        graph: GraphPort,
        projector: Projector,
        evidence: EvidenceStore,
        planner_factory: Callable[[], PlannerPort],
    ):
        self.store, self.settings, self.graph = store, settings, graph
        self.projector, self.evidence, self.planner_factory = projector, evidence, planner_factory

    def run(self, actor: Actor, value: DiscoveryInput, key: str) -> dict:
        require(actor, Role.REVIEWER)
        body, operation = value.model_dump(), "discover"
        with self.store.transaction() as conn:
            old = cached(conn, actor, operation, key, body)
            if old:
                return old
        owner = new_id("discovery_lock")
        lock = "discovery_" + actor.tenant
        if not self.store.acquire_lock(lock, owner, 90):
            raise DomainError("discovery_busy", "Another discovery step is already running", 409)
        agent_id = None
        try:
            self.projector.require_current(actor.tenant)
            scope = self.store.one("SELECT * FROM tenants WHERE id=?", (actor.tenant,))
            revision = scope["revision"]
            if (
                not scope["scope_enabled"]
                or time.time() > scope["created_at"] + self.settings.assessment_seconds
            ):
                raise DomainError(
                    "scope_paused", "Discovery is paused or the assessment window expired", 403
                )
            if value.source_finding_id:
                source = self.store.one(
                    "SELECT * FROM findings WHERE tenant=? AND id=?",
                    (actor.tenant, value.source_finding_id),
                )
                if not source:
                    raise DomainError("not_found", "Source finding not found", 404)
                if not source["current"] or source["revision"] != revision:
                    raise DomainError(
                        "stale_source",
                        "Historical findings cannot supply current prerequisites",
                        409,
                    )
            raw = self.graph.candidates(actor.tenant, revision, value.source_finding_id)
            candidates = self._validate_candidates(actor.tenant, revision, raw)
            now, agent_id = time.time(), new_id("agent")
            tool = {
                "name": "eligible_followups",
                "cypher": FOLLOWUPS_CYPHER,
                "params": {"revision": revision, "source_id": value.source_finding_id or ""},
                "previous_messages": 0,
                "candidate_count": len(candidates),
            }
            with self.store.transaction() as conn:
                old = cached(conn, actor, operation, key, body)
                if old:
                    return old
                if candidates and self.settings.provider != "deterministic":
                    budget = row_or_error(
                        conn,
                        "SELECT * FROM budgets WHERE tenant=? AND revision=?",
                        (actor.tenant, revision),
                    )
                    if budget["model_calls"] >= self.settings.model_call_budget:
                        raise DomainError("model_budget", "The model-call budget is exhausted", 403)
                    # Failed calls also consume a reservation; failures cannot bypass the cap.
                    conn.execute(
                        "UPDATE budgets SET model_calls=model_calls+1 WHERE tenant=? AND revision=?",
                        (actor.tenant, revision),
                    )
                conn.execute(
                    "INSERT INTO agent_sessions(id,tenant,actor,provider,model,status,source_id,candidates,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                    (
                        agent_id,
                        actor.tenant,
                        actor.id,
                        self.settings.provider,
                        self.settings.model,
                        "planning",
                        value.source_finding_id,
                        canonical([c.public() for c in candidates]),
                        now,
                    ),
                )
                pending = {
                    "agent_id": agent_id,
                    "status": "planning",
                    "case_id": None,
                    "provider": self.settings.provider,
                    "tool": tool,
                }
                remember(conn, actor, operation, key, body, pending)
                self.store.event(
                    conn,
                    actor.tenant,
                    "agent.context_started",
                    actor.id,
                    agent_id,
                    {
                        "provider": self.settings.provider,
                        "model": self.settings.model,
                        "previous_messages": 0,
                        "tool": tool,
                    },
                )
            if not candidates:
                result = {
                    **pending,
                    "status": "no_candidates",
                    "reason": "No unattempted, currently supported graph path remains.",
                    "candidates": [],
                }
                self._finish(actor, key, agent_id, result, 0, 0)
                return result
            plan = self.planner_factory().select(candidates[:10])
            selected = check_selection(plan.selection, candidates[:10])
            with self.store.transaction() as conn:
                scope_check(
                    conn, self.settings, actor.tenant, selected.test_id, selected.asset_id, revision
                )
                virtual = {
                    "tenant": actor.tenant,
                    "origin": "agent",
                    "supports": canonical(list(selected.finding_ids)),
                    "revision": revision,
                    "test_id": selected.test_id,
                }
                verify_supports(conn, virtual)
                existing = conn.execute(
                    "SELECT id FROM cases WHERE tenant=? AND test_id=? AND revision=?",
                    (actor.tenant, selected.test_id, revision),
                ).fetchone()
                if existing:
                    case_id, duplicate = existing["id"], True
                else:
                    case_id, duplicate = new_id("case"), False
                    researchers = sorted(
                        {
                            row_or_error(
                                conn,
                                "SELECT researcher FROM findings WHERE tenant=? AND id=?",
                                (actor.tenant, f),
                            )["researcher"]
                            for f in selected.finding_ids
                        }
                    )
                    researcher = "; ".join(researchers)
                    conn.execute(
                        "INSERT INTO cases(id,tenant,title,test_id,asset_id,revision,origin,state,researcher,created_by,reason,supports,path,depth,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (
                            case_id,
                            actor.tenant,
                            selected.title,
                            selected.test_id,
                            selected.asset_id,
                            revision,
                            "agent",
                            State.AWAITING_APPROVAL,
                            researcher,
                            agent_id,
                            plan.selection.reason,
                            canonical(list(selected.finding_ids)),
                            canonical(list(selected.path)),
                            selected.depth,
                            now,
                            now,
                        ),
                    )
                    case = dict(
                        conn.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone()
                    )
                    self.store.event(
                        conn,
                        actor.tenant,
                        "agent.hypothesis_proposed",
                        agent_id,
                        case_id,
                        {
                            "test_id": selected.test_id,
                            "path": list(selected.path),
                            "score": selected.score,
                            "reason": plan.selection.reason,
                            "source_findings": list(selected.finding_ids),
                        },
                        {
                            "nodes": [
                                case_node(case),
                                node(
                                    "AgentSession",
                                    agent_id,
                                    title="Fresh investigation context",
                                    provider=self.settings.provider,
                                    previous_messages=0,
                                ),
                            ],
                            "edges": [
                                edge(agent_id, "PROPOSED", case_id),
                                edge(case_id, "TARGETS", selected.asset_id),
                            ]
                            + [edge(case_id, "DERIVED_FROM", f) for f in selected.finding_ids],
                        },
                    )
                result = {
                    **pending,
                    "status": "proposed",
                    "case_id": case_id,
                    "duplicate": duplicate,
                    "reason": plan.selection.reason,
                    "selection": selected.public(),
                    "candidates": [c.public() for c in candidates],
                }
                self._finish_tx(
                    conn, actor, key, agent_id, result, plan.input_tokens, plan.output_tokens
                )
            return result
        except Exception as exc:
            if agent_id and self.store.one("SELECT id FROM agent_sessions WHERE id=?", (agent_id,)):
                error_code = exc.code if isinstance(exc, DomainError) else "discovery_interrupted"
                result = {
                    "agent_id": agent_id,
                    "status": "failed",
                    "case_id": None,
                    "provider": self.settings.provider,
                    "error": error_code,
                    "reason": "Discovery did not finish. No finding or execution was created by this failure.",
                }
                self._finish(actor, key, agent_id, result, 0, 0)
            raise
        finally:
            self.store.release_lock(lock, owner)

    def _validate_candidates(
        self, tenant: str, revision: str, candidates: list[Candidate]
    ) -> list[Candidate]:
        result = []
        for candidate in candidates:
            if candidate.depth > self.settings.max_depth:
                continue
            if self.store.one(
                "SELECT id FROM cases WHERE tenant=? AND test_id=? AND revision=?",
                (tenant, candidate.test_id, revision),
            ):
                continue
            verified_caps, depths = set(), []
            for finding_id in candidate.finding_ids:
                finding = self.store.one(
                    "SELECT f.*,r.evidence_hash FROM findings f JOIN runs r ON f.run_id=r.id WHERE f.tenant=? AND f.id=?",
                    (tenant, finding_id),
                )
                if finding is None or not finding["current"] or finding["revision"] != revision:
                    raise DomainError(
                        "memory_integrity",
                        "The graph references a finding without current verified support",
                        503,
                    )
                self.evidence.get(tenant, finding["evidence_hash"])
                verified_caps.update(TESTS[finding["test_id"]].enables)
                depths.append(finding["depth"])
            if (
                not depths
                or candidate.depth != max(depths) + 1
                or not set(candidate.requirements) <= verified_caps
            ):
                raise DomainError(
                    "memory_integrity", "The graph's prerequisite path could not be verified", 503
                )
            result.append(candidate)
        return result

    def _finish(
        self,
        actor: Actor,
        key: str,
        agent_id: str,
        result: dict,
        input_tokens: int,
        output_tokens: int,
    ):
        with self.store.transaction() as conn:
            self._finish_tx(conn, actor, key, agent_id, result, input_tokens, output_tokens)

    def _finish_tx(
        self,
        conn: sqlite3.Connection,
        actor: Actor,
        key: str,
        agent_id: str,
        result: dict,
        input_tokens: int,
        output_tokens: int,
    ):
        selection = result.get("selection", {})
        conn.execute(
            "UPDATE agent_sessions SET status=?,selected_id=?,case_id=?,reason=?,input_tokens=?,output_tokens=?,finished_at=? WHERE id=?",
            (
                result["status"],
                selection.get("test_id"),
                result.get("case_id"),
                result.get("reason"),
                input_tokens,
                output_tokens,
                time.time(),
                agent_id,
            ),
        )
        conn.execute(
            "UPDATE idempotency SET response=? WHERE tenant=? AND actor=? AND operation='discover' AND key=?",
            (canonical(result), actor.tenant, actor.id, key),
        )
        self.store.event(
            conn,
            actor.tenant,
            "agent.context_finished",
            actor.id,
            agent_id,
            {
                "status": result["status"],
                "case_id": result.get("case_id"),
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "previous_messages": 0,
            },
        )
