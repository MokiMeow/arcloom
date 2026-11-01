"""Dependency composition. Tests inject explicit ports, never a runtime fallback."""

import json
import threading
import time
from contextlib import suppress
from dataclasses import asdict

from pydantic import SecretStr

from arcloom.auth import Auth
from arcloom.catalog import ASSETS, REVISIONS, TESTS
from arcloom.config import Settings
from arcloom.discovery import Discovery
from arcloom.domain import Actor, DomainError
from arcloom.evidence import EvidenceStore
from arcloom.graph import FalkorGraph, GraphPort, Projector, seed_graph
from arcloom.intelligence import GraphIntelligence
from arcloom.providers import ProviderManager
from arcloom.runner import HttpRunner, RunnerPort
from arcloom.storage import Store, digest
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
        self.intelligence = (
            GraphIntelligence(self.graph) if isinstance(self.graph, FalkorGraph) else None
        )
        self.runner = runner if runner is not None else HttpRunner(settings)
        self.cases = Cases(self.store, settings, self.projector, self.evidence)
        from arcloom.chatgpt_auth import ChatGPTAuth

        self.chatgpt = ChatGPTAuth(settings)
        self.providers = ProviderManager(settings, self.store, self.chatgpt)
        factory = planner_factory or (lambda: self.providers.planner(self.providers.snapshot()))
        self.discovery = Discovery(
            self.store,
            settings,
            self.graph,
            self.projector,
            self.evidence,
            factory,
            settings_factory=self.providers.snapshot,
            snapshot_planner_factory=None if planner_factory else self.providers.planner,
        )
        self.worker = Worker(self.store, settings, self.projector, self.runner, self.evidence)
        self._tenant_lock = threading.RLock()
        self._tenant_services = {}

    def _services_for(self, actor: Actor):
        if actor.tenant == self.settings.tenant:
            return self.settings, self.providers, self.chatgpt, self.discovery
        if not self.store.one("SELECT id FROM tenants WHERE id=?", (actor.tenant,)):
            raise DomainError("forbidden", "Workspace access is unavailable", 403)
        with self._tenant_lock:
            if actor.tenant not in self._tenant_services:
                # Graph/runner transport is shared infrastructure. Provider
                # selection, reusable credentials and OAuth identity never are.
                settings = self.settings.model_copy(
                    update={
                        "tenant": actor.tenant,
                        "data_dir": self.settings.data_dir / "tenants" / digest(actor.tenant),
                        "provider": "deterministic",
                        "model": "",
                        "model_api_key": SecretStr(""),
                        "cloudflare_account_id": "",
                        "cloudflare_wrangler_until": None,
                        "chatgpt_profile_id": "",
                        "admin_token": SecretStr(""),
                    },
                    deep=True,
                )
                settings._shared_graph_infrastructure = True
                settings._cloudflare_environment_credential = False
                settings._model_deadline = None
                from arcloom.chatgpt_auth import ChatGPTAuth

                chatgpt = ChatGPTAuth(settings)
                providers = ProviderManager(settings, self.store, chatgpt)
                discovery = Discovery(
                    self.store,
                    settings,
                    self.graph,
                    self.projector,
                    self.evidence,
                    lambda: providers.planner(providers.snapshot()),
                    settings_factory=providers.snapshot,
                    snapshot_planner_factory=providers.planner,
                )
                self._tenant_services[actor.tenant] = (settings, providers, chatgpt, discovery)
            return self._tenant_services[actor.tenant]

    def settings_for(self, actor: Actor):
        return self._services_for(actor)[0]

    def providers_for(self, actor: Actor):
        return self._services_for(actor)[1]

    def chatgpt_for(self, actor: Actor):
        return self._services_for(actor)[2]

    def discovery_for(self, actor: Actor):
        return self._services_for(actor)[3]

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
            if self.intelligence is not None:
                self.intelligence.prepare(self.settings.tenant)

    def dashboard(self, actor: Actor) -> dict:
        provider = self.providers_for(actor).snapshot()
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
                "provider": provider.provider,
                "model": provider.model
                or ("graph-rank-v1" if provider.provider == "deterministic" else ""),
                "live_llm": provider.provider in {"openai", "anthropic", "gemini", "chatgpt"},
                "remote_model": provider.provider != "deterministic",
                "decision_model": provider.provider == "cloudflare",
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
        self.chatgpt.close()
        with self._tenant_lock:
            for _, _, chatgpt, _ in self._tenant_services.values():
                chatgpt.close()
        self.graph.close()
