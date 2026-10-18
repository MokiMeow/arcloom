"""Replay into a separate real graph on the explicitly requested test server."""

import os

import pytest

from arcloom.config import Settings
from arcloom.graph import FalkorGraph
from arcloom.runtime import Runtime
from arcloom.storage import new_id
from tests.conftest import ADMIN, RUNNER
from tests.helpers import confirm
from tests.ports import FixtureRunner
from tests.test_graph_migration import migration as migration

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("ARCLOOM_TEST_GRAPH") != "server",
        reason="Set ARCLOOM_TEST_GRAPH=server for a real isolated migration staging test",
    ),
]


def test_real_replay_preserves_accepted_and_historical_revision_facts(migration, tmp_path):
    source = Settings(
        _env_file=None,
        data_dir=tmp_path,
        graph_mode="server",
        graph_host=os.environ.get("ARCLOOM_TEST_GRAPH_HOST", "127.0.0.1"),
        graph_port=int(os.environ.get("ARCLOOM_TEST_GRAPH_PORT", "6379")),
        graph_username=os.environ.get("ARCLOOM_TEST_GRAPH_USERNAME", ""),
        graph_password=os.environ.get("ARCLOOM_TEST_GRAPH_PASSWORD", ""),
        graph_ssl=os.environ.get("ARCLOOM_TEST_GRAPH_SSL", "false"),
        graph_prefix=new_id("migration_source"),
        tenant=new_id("tenant"),
        admin_token=ADMIN,
        runner_secret=RUNNER,
        worker_enabled=False,
    )
    target = source.model_copy(update={"graph_prefix": new_id("migration_target")})
    runtime = Runtime(source, runner=FixtureRunner(RUNNER))
    staged = FalkorGraph(target)
    try:
        runtime.initialize()
        actor = runtime.auth.bearer(ADMIN)
        accepted = confirm(runtime, actor)
        # Verify nonempty candidate paths before the revision invalidates them.
        report = migration.stage(source, target, apply=True)
        assert report["status"] == "staged_only"
        assert staged.candidates(source.tenant, "r1")
        assert report["verification"]["candidate_contexts"] >= 2
        staged._database().select_graph(staged.graph_name(source.tenant)).delete()

        runtime.cases.revise(
            actor, "r2", "Controlled revision invalidates prior evidence.", new_id("request")
        )
        runtime.projector.require_current(source.tenant)
        rows = runtime.store.all("SELECT * FROM outbox ORDER BY seq")
        report = migration.stage(source, target, apply=True)
        assert report["replayed_events"] == len(rows)
        assert runtime.store.all("SELECT * FROM outbox ORDER BY seq") == rows
        view = staged.view(source.tenant)
        finding = next(n for n in view["nodes"] if n["id"] == accepted["finding_id"])
        assert finding["props"]["current"] is False
        assert finding["props"]["status"] == "confirmed"
        assert staged.candidates(source.tenant, "r2") == []
    finally:
        for graph in (runtime.graph, staged):
            try:
                if graph.graph_name(source.tenant) in graph._database().list_graphs():
                    graph._database().select_graph(graph.graph_name(source.tenant)).delete()
            finally:
                connection = getattr(graph._db, "connection", None)
                if connection is not None:
                    connection.close()
                    connection.connection_pool.disconnect()
        runtime.close()
