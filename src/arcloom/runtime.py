"""Dependency composition. Tests inject explicit ports, never a runtime fallback."""

import json
import time
from contextlib import suppress
from dataclasses import asdict

from arcloom.agents import DeterministicPlanner, ModelPlanner
from arcloom.auth import Auth
from arcloom.catalog import ASSETS, REVISIONS, TESTS
from arcloom.config import Settings
from arcloom.discovery import Discovery
from arcloom.domain import Actor, DomainError
from arcloom.evidence import EvidenceStore
from arcloom.graph import FalkorGraph, GraphPort, Projector, seed_graph
from arcloom.runner import HttpRunner, RunnerPort
from arcloom.storage import Store
from arcloom.worker import Worker
from arcloom.workflow import Cases


class Runtime:
    def __init__(
        self,
        settings: Settings,
        graph: GraphPort | None = None,
        runner: RunnerPort | None = None,
        planner_factory=None,
    ):
        self.settings = settings
        self.store = Store(settings.data_dir)
        self.auth = Auth(self.store, settings)
        self.evidence = EvidenceStore(settings.data_dir / "evidence")
        self.graph = graph if graph is not None else FalkorGraph(settings)
        self.projector = Projector(self.store, self.graph)
        self.runner = runner if runner is not None else HttpRunner(settings)
        self.cases = Cases(self.store, settings, self.projector, self.evidence)
        factory = planner_factory or (
            lambda: (
                DeterministicPlanner()
                if settings.provider == "deterministic"
                else ModelPlanner(settings)
            )
        )
        self.discovery = Discovery(
            self.store, settings, self.graph, self.projector, self.evidence, factory
        )
        self.worker = Worker(self.store, settings, self.projector, self.runner, self.evidence)

    def initialize(self):
        if len(self.settings.runner_secret.get_secret_value()) < 32:
            raise ValueError("ARCLOOM_RUNNER_SECRET must have at least 32 characters")
        fresh = self.auth.bootstrap()
        if fresh:
            with self.store.transaction() as conn:
                self.store.event(
                    conn,
                    self.settings.tenant,
                    "workspace.initialized",
                    "system",
                    self.settings.tenant,
                    {"catalog_version": "1", "synthetic": True},
                    seed_graph(),
                )
        # An unavailable graph stays unavailable; no SQLite reasoning fallback.
        with suppress(DomainError):
            self.projector.flush()

    def dashboard(self, actor: Actor) -> dict:
        tenant = self.store.one("SELECT * FROM tenants WHERE id=?", (actor.tenant,))
        budget = self.store.one(
            "SELECT * FROM budgets WHERE tenant=? AND revision=?",
            (actor.tenant, tenant["revision"]),
        )
        counts = {
            r["state"]: r["n"]
            for r in self.store.all(
                "SELECT state,count(*) AS n FROM cases WHERE tenant=? GROUP BY state",
                (actor.tenant,),
            )
        }
        findings = self.store.all(
            "SELECT * FROM findings WHERE tenant=? ORDER BY created_at DESC", (actor.tenant,)
        )
        agent_usage = self.store.one(
            "SELECT coalesce(sum(input_tokens),0) AS input_tokens,coalesce(sum(output_tokens),0) AS output_tokens,count(*) AS sessions FROM agent_sessions WHERE tenant=?",
            (actor.tenant,),
        )
        pending = self.store.one(
            "SELECT count(*) AS n FROM outbox WHERE tenant=? AND applied_at IS NULL",
            (actor.tenant,),
        )["n"]
        graph_ok = False
        with suppress(DomainError):
            graph_ok = self.graph.ping(actor.tenant)
        return {
            "workspace": actor.tenant,
            "revision": tenant["revision"],
            "revision_title": REVISIONS[tenant["revision"]],
            "scope_enabled": bool(tenant["scope_enabled"]),
            "scope_expires_at": tenant["created_at"] + self.settings.assessment_seconds,
            "counts": counts,
            "findings": [
                {**f, "current": bool(f["current"]), "supports": json.loads(f["supports"])}
                for f in findings
            ],
            "verified_current": sum(bool(f["current"]) for f in findings),
            "verified_historical": len(findings),
            "budget": {
                **budget,
                "execution_limit": self.settings.execution_budget,
                "model_call_limit": self.settings.model_call_budget,
            },
            "memory": {
                "engine": "FalkorDB",
                "available": graph_ok,
                "pending_events": pending,
                "in_sync": graph_ok and pending == 0,
            },
            "model": {
                "provider": self.settings.provider,
                "model": self.settings.model or "graph-rank-v1",
                "live_llm": self.settings.provider != "deterministic",
                **agent_usage,
            },
            "worker": {
                "enabled": self.settings.worker_enabled,
                "last_tick": self.worker.last_tick,
                "last_error": self.worker.last_error,
            },
            "synthetic": True,
            "at": time.time(),
        }

    def catalog(self) -> dict:
        return {
            "assets": [{"id": i, **v} for i, v in ASSETS.items()],
            "tests": [asdict(t) for t in TESTS.values()],
            "revisions": REVISIONS,
            "boundary": "Only registered synthetic ASGI fixtures; no external targets or generated execution.",
        }

    def close(self):
        self.worker.stop()
        self.graph.close()
