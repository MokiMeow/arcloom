"""Verified handoff against an explicitly requested, isolated real FalkorDB graph."""

import os

import pytest

from arcloom.config import Settings
from arcloom.handoff import build_handoff
from arcloom.runtime import Runtime
from arcloom.storage import canonical, digest, new_id
from tests.conftest import ADMIN, RUNNER
from tests.helpers import confirm
from tests.ports import FixtureRunner

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("ARCLOOM_TEST_GRAPH") != "server",
        reason="Set ARCLOOM_TEST_GRAPH=server for isolated real handoff verification",
    ),
]


def test_verified_packet_preserves_real_graph_and_journal(tmp_path, monkeypatch):
    config = Settings(
        _env_file=None,
        data_dir=tmp_path,
        graph_mode="server",
        graph_host=os.environ.get("ARCLOOM_TEST_GRAPH_HOST", "127.0.0.1"),
        graph_port=int(os.environ.get("ARCLOOM_TEST_GRAPH_PORT", "6379")),
        graph_username=os.environ.get("ARCLOOM_TEST_GRAPH_USERNAME", ""),
        graph_password=os.environ.get("ARCLOOM_TEST_GRAPH_PASSWORD", ""),
        graph_ssl=os.environ.get("ARCLOOM_TEST_GRAPH_SSL", "false"),
        graph_prefix=new_id("handoff_test"),
        tenant=new_id("handoff_tenant"),
        admin_token=ADMIN,
        runner_secret=RUNNER,
        worker_enabled=False,
    )
    runtime = Runtime(config, runner=FixtureRunner(RUNNER))
    try:
        runtime.initialize()
        actor = runtime.auth.bearer(ADMIN)
        confirm(runtime, actor)
        confirm(runtime, actor, "invoice-tenant-boundary")
        confirm(runtime, actor, "export-tenant-boundary")
        confirm(runtime, actor, "audit-boundary")
        graph_before = runtime.graph.view(actor.tenant)
        journal_before = {
            table: runtime.store.all(f"SELECT * FROM {table}")
            for table in (
                "events",
                "outbox",
                "cases",
                "findings",
                "runs",
                "reviews",
                "budgets",
                "agent_sessions",
                "sessions",
            )
        }
        # Reads must succeed without invoking graph writes or projection preparation.
        query = runtime.graph._query

        def readonly_query(tenant, cypher, params=None, readonly=False):
            assert readonly, "Handoff attempted a graph mutation"
            return query(tenant, cypher, params, readonly=readonly)

        monkeypatch.setattr(runtime.graph, "_query", readonly_query)
        monkeypatch.setattr(
            runtime.projector, "flush", lambda *args: pytest.fail("Handoff flushed outbox")
        )
        packet = build_handoff(runtime, actor)
        assert packet["summary"] == {
            "confirmed_current": 2,
            "negative_current": 1,
            "inconclusive_current": 1,
            "eligible_followups": 1,
        }
        chain = packet["candidates"][0]
        assert chain["test_id"] == "invoice-chain"
        assert len(chain["finding_ids"]) == 2
        assert {e["target"] for e in chain["paths"][0] if e["relation"] == "ENABLES"} == set(
            chain["requires"]
        )
        assert packet["packet_sha256"] == digest(
            canonical({k: v for k, v in packet.items() if k != "packet_sha256"})
        )
        assert runtime.graph.view(actor.tenant) == graph_before
        assert {
            table: runtime.store.all(f"SELECT * FROM {table}") for table in journal_before
        } == journal_before
    finally:
        database = runtime.graph._database()
        graph_name = runtime.graph.graph_name(config.tenant)
        try:
            if graph_name in database.list_graphs():
                database.select_graph(graph_name).delete()
        finally:
            connection = getattr(database, "connection", None)
            if connection is not None:
                connection.close()
                connection.connection_pool.disconnect()
            runtime.close()
