"""Migration never edits the journal and proves the staged projection before reporting ready."""

import importlib.util
import json
from copy import deepcopy
from pathlib import Path

import pytest

from arcloom.config import Settings
from arcloom.graph import seed_graph
from arcloom.storage import Store
from tests.ports import TestGraph


@pytest.fixture
def migration():
    path = Path(__file__).resolve().parents[1] / "scripts" / "migrate_graph.py"
    assert path.exists(), "Safe graph migration tool has not been implemented"
    spec = importlib.util.spec_from_file_location("migration_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MemoryProjection:
    """Explicit in-memory external-port double; journal and migration code remain real."""

    def __init__(self, settings, graph=None):
        self.settings = settings
        self.graph = graph or TestGraph()
        self.closed = False
        self.prepared = False
        self.occupied = False
        self.after_apply = lambda: None
        self.corrupt = False

    def graph_name(self, tenant):
        return self.settings.graph_prefix + "_test"

    def exists(self, tenant):
        return self.occupied

    def apply(self, tenant, payload):
        self.graph.apply(tenant, payload)
        self.after_apply()

    def snapshot(self, tenant):
        result = self.graph.view(tenant)
        if self.corrupt:
            result["nodes"] = []
        return deepcopy(result)

    def view(self, tenant):
        return self.snapshot(tenant)

    def candidates(self, tenant, revision, source_id=None):
        return self.graph.candidates(tenant, revision, source_id)

    def prepare(self, tenant):
        self.prepared = True

    def close(self):
        self.closed = True


@pytest.fixture
def scene(tmp_path):
    source = Settings(_env_file=None, data_dir=tmp_path / "source", tenant="lab-01")
    target = source.model_copy(update={"graph_prefix": "staged_unique"})
    store = Store(source.data_dir)
    graph = TestGraph()
    with store.transaction() as conn:
        conn.execute("INSERT INTO tenants VALUES(?,?,1,0)", (source.tenant, "r2"))
        Store.event(conn, source.tenant, "seed", "owner", "r1", {}, seed_graph())
        payload = {
            "nodes": [
                {
                    "id": "retained-finding",
                    "kind": "Finding",
                    "props": {
                        "revision": "r1",
                        "current": True,
                        "status": "confirmed",
                        "title": "Accepted",
                    },
                }
            ],
            "edges": [],
        }
        Store.event(conn, source.tenant, "accepted", "owner", "retained-finding", {}, payload)
        withdrawn = deepcopy(payload)
        withdrawn["nodes"][0]["props"].update(current=False, status="withdrawn")
        Store.event(conn, source.tenant, "withdrawn", "owner", "retained-finding", {}, withdrawn)
        conn.execute("UPDATE outbox SET applied_at=123,attempts=1")
    for row in store.all("SELECT payload FROM outbox ORDER BY seq"):
        graph.apply(source.tenant, json.loads(row["payload"]))
    source_port, target_port = MemoryProjection(source, graph), MemoryProjection(target)
    source_port.occupied = True
    return source, target, store, source_port, target_port


def run(migration, scene, **kwargs):
    source, target, _, source_port, target_port = scene
    return migration.stage(
        source,
        target,
        graph_factory=lambda s: source_port if s is source else target_port,
        **kwargs,
    )


def test_dry_run_reads_audit_and_all_events_without_contacting_target(migration, scene):
    report = run(migration, scene)
    assert report["status"] == "dry_run"
    assert report["source"]["projection_events"] == 3
    assert report["source"]["audit"]["valid"] is True
    assert not scene[4].prepared


def test_replay_includes_applied_events_preserves_withdrawal_and_source_bytes(migration, scene):
    source, _, store, _, target = scene
    before = store.path.read_bytes()
    rows = store.all("SELECT * FROM outbox ORDER BY seq")
    report = run(migration, scene, apply=True)
    finding = target.graph.nodes[source.tenant]["retained-finding"]
    assert finding["props"]["status"] == "withdrawn"
    assert finding["props"]["current"] is False
    assert report["replayed_events"] == 3
    assert report["status"] == "staged_only"
    assert report["ready_for_manual_cutover"] is True
    assert report["source"]["event_seq"] == 3
    assert store.path.read_bytes() == before
    assert store.all("SELECT * FROM outbox ORDER BY seq") == rows
    assert scene[3].closed and target.closed and target.prepared


def test_prefix_collision_refuses_before_replay(migration, scene):
    scene[4].occupied = True
    with pytest.raises(migration.MigrationError, match="already exists"):
        run(migration, scene, apply=True)
    assert not scene[4].graph.nodes


def test_pending_outbox_refuses_without_marking_it_applied(migration, scene):
    with scene[2].transaction() as conn:
        conn.execute("UPDATE outbox SET applied_at=NULL WHERE seq=3")
    with pytest.raises(migration.MigrationError, match="pending"):
        run(migration, scene, apply=True)
    assert scene[2].one("SELECT applied_at FROM outbox WHERE seq=3")["applied_at"] is None
    assert not scene[4].graph.nodes


def test_target_mismatch_never_reports_ready(migration, scene):
    scene[4].corrupt = True
    with pytest.raises(migration.MigrationError, match="verification"):
        run(migration, scene, apply=True)


def test_candidate_mismatch_never_reports_ready(migration, scene):
    from arcloom.domain import Candidate

    scene[4].candidates = lambda *args: [Candidate("invented", "asset", "Wrong", (), (), 0, 1, ())]
    with pytest.raises(migration.MigrationError, match="candidate"):
        run(migration, scene, apply=True)


def test_mutated_source_graph_never_reports_ready(migration, scene):
    def mutate():
        scene[3].graph.nodes[scene[0].tenant]["retained-finding"]["props"]["title"] = "Changed"

    scene[4].after_apply = mutate
    with pytest.raises(migration.MigrationError, match="changed"):
        run(migration, scene, apply=True)


def test_mutated_source_journal_never_reports_ready(migration, scene):
    def mutate():
        with scene[2].transaction() as conn:
            conn.execute("UPDATE tenants SET scope_enabled=0")

    scene[4].after_apply = mutate
    with pytest.raises(migration.MigrationError, match="changed"):
        run(migration, scene, apply=True)


def test_source_write_followed_by_restore_still_refuses_ready(migration, scene):
    def mutate_then_restore():
        with scene[2].transaction() as conn:
            conn.execute("UPDATE tenants SET scope_enabled=0")
        with scene[2].transaction() as conn:
            conn.execute("UPDATE tenants SET scope_enabled=1")

    scene[4].after_apply = mutate_then_restore
    with pytest.raises(migration.MigrationError, match="changed"):
        run(migration, scene, apply=True)


def test_invalid_audit_refuses_before_target_mutation(migration, scene):
    with scene[2].transaction() as conn:
        conn.execute("UPDATE events SET payload='{}' WHERE seq=1")
        conn.execute("UPDATE events SET event_hash='broken' WHERE seq=2")
    with pytest.raises(migration.MigrationError, match="audit"):
        run(migration, scene, apply=True)
    assert not scene[4].graph.nodes


def test_unsafe_payload_refuses_before_any_partial_replay(migration, scene):
    with scene[2].transaction() as conn:
        conn.execute(
            "UPDATE outbox SET payload=? WHERE seq=3",
            (json.dumps({"nodes": [{"id": "bad", "kind": "Finding) DELETE n", "props": {}}]}),),
        )
    with pytest.raises(migration.MigrationError, match="projection"):
        run(migration, scene, apply=True)
    assert not scene[4].graph.nodes


def test_dependency_errors_never_expose_secrets_even_in_exception_chain(migration, scene):
    def fail(*args):
        raise RuntimeError("PASSWORD-private-token")

    scene[3].snapshot = fail
    with pytest.raises(migration.MigrationError) as error:
        run(migration, scene, apply=True)
    import traceback

    assert "PASSWORD-private-token" not in "".join(traceback.format_exception(error.value))
    assert scene[3].closed and scene[4].closed


def test_missing_source_is_not_created(migration, scene):
    scene[0].data_dir = scene[0].data_dir / "absent"
    with pytest.raises(migration.MigrationError, match="journal"):
        run(migration, scene, apply=True)
    assert not scene[0].data_dir.exists()


def test_missing_source_graph_refuses_without_creating_target(migration, scene):
    scene[3].occupied = False
    with pytest.raises(migration.MigrationError, match="Source graph"):
        run(migration, scene, apply=True)
    assert not scene[4].graph.nodes


@pytest.mark.parametrize(
    "changes",
    [
        {"ARCLOOM_GRAPH_SSL": "false"},
        {"ARCLOOM_GRAPH_HOST": ""},
        {"ARCLOOM_GRAPH_PORT": "0"},
        {"ARCLOOM_GRAPH_USERNAME": ""},
        {"ARCLOOM_GRAPH_PASSWORD": ""},
        {"ARCLOOM_GRAPH_SSL": "maybe"},
    ],
)
def test_invalid_target_settings_refuse_secret_safe(migration, tmp_path, monkeypatch, changes):
    values = {
        "ARCLOOM_GRAPH_HOST": "cloud.example",
        "ARCLOOM_GRAPH_PORT": "6379",
        "ARCLOOM_GRAPH_USERNAME": "default",
        "ARCLOOM_GRAPH_PASSWORD": "private-token",
        "ARCLOOM_GRAPH_SSL": "true",
    }
    values.update(changes)
    path = tmp_path / ".env.cloud"
    path.write_text("\n".join(f"{k}={v}" for k, v in values.items()))
    monkeypatch.setattr(migration, "is_ignored", lambda path: True)
    with pytest.raises(migration.MigrationError) as error:
        migration.load_target(path, Settings(_env_file=None))
    assert "private-token" not in str(error.value)


def test_target_file_cannot_inherit_process_credentials(migration, tmp_path, monkeypatch):
    path = tmp_path / ".env.cloud"
    path.write_text("ARCLOOM_GRAPH_HOST=cloud.example\n")
    monkeypatch.setattr(migration, "is_ignored", lambda path: True)
    monkeypatch.setenv("ARCLOOM_GRAPH_PASSWORD", "private-token")
    with pytest.raises(migration.MigrationError, match="explicit"):
        migration.load_target(path, Settings(_env_file=None))


def test_unique_prefix_and_explicit_synthetic_plaintext_escape_hatch(
    migration, tmp_path, monkeypatch
):
    path = tmp_path / ".env.cloud"
    path.write_text(
        "ARCLOOM_GRAPH_HOST=cloud.example\nARCLOOM_GRAPH_PORT=6379\n"
        "ARCLOOM_GRAPH_USERNAME=default\nARCLOOM_GRAPH_PASSWORD=secret\n"
        "ARCLOOM_GRAPH_SSL=false\n"
    )
    monkeypatch.setattr(migration, "is_ignored", lambda path: True)
    source = Settings(_env_file=None)
    target = migration.load_target(path, source, allow_plaintext_synthetic=True)
    assert target.graph_prefix != source.graph_prefix
    assert target.graph_ssl is False


def test_unignored_target_configuration_refused(migration, tmp_path, monkeypatch):
    path = tmp_path / "public.env"
    path.write_text("ARCLOOM_GRAPH_PASSWORD=private-token")
    monkeypatch.setattr(migration, "is_ignored", lambda path: False)
    with pytest.raises(migration.MigrationError, match="ignored"):
        migration.load_target(path, Settings(_env_file=None))
