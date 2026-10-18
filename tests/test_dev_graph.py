"""The Windows graph helper must never stop a server it did not launch."""

import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture
def helper(monkeypatch, tmp_path):
    path = Path(__file__).resolve().parents[1] / "scripts" / "dev_graph.py"
    spec = importlib.util.spec_from_file_location("dev_graph_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "RUNTIME", tmp_path)
    monkeypatch.setattr(module, "settings", lambda: (6379, "private-test-password"))
    return module


def redis_graph(helper, monkeypatch):
    calls = []

    def command(port, password, *parts):
        calls.append(parts)
        return b"PONG" if parts == ("PING",) else []

    monkeypatch.setattr(helper, "command", command)
    return calls


def save_ownership(helper, monkeypatch):
    identity = {
        "port": 6379,
        "run_id": "random-per-process-instance-marker",
        "process_id": "123",
        "config_file": "/mnt/host/c/work/data/wsl-graph/redis.conf",
        "directory": "/mnt/host/c/work/data/wsl-graph/database",
        "pidfile": "/mnt/host/c/work/data/wsl-graph/graph.pid",
    }
    helper.ownership_file(6379).write_text(
        json.dumps({"runtime": str(helper.RUNTIME.resolve()), "identity": identity}),
        encoding="utf-8",
    )
    (helper.RUNTIME / "graph.pid").write_text("123\n", encoding="utf-8")
    monkeypatch.setattr(helper, "instance_identity", lambda *_: identity.copy())
    return identity


def test_stop_refuses_unrelated_graph_with_same_password(helper, monkeypatch):
    calls = redis_graph(helper, monkeypatch)
    monkeypatch.setattr("sys.argv", ["dev_graph.py", "stop"])
    with pytest.raises(SystemExit, match="Refusing to stop an externally managed graph"):
        helper.main()
    assert calls == [("PING",), ("GRAPH.LIST",)]


def test_start_labels_existing_graph_as_external_without_changing_it(helper, monkeypatch, capsys):
    calls = redis_graph(helper, monkeypatch)
    monkeypatch.setattr("sys.argv", ["dev_graph.py", "start"])
    helper.main()
    assert "Externally managed graph" in capsys.readouterr().out
    assert calls == [("PING",), ("GRAPH.LIST",)]
    assert not list(helper.RUNTIME.iterdir())


def test_start_refuses_plain_redis_without_graph_support(helper, monkeypatch):
    calls = []

    def command(port, password, *parts):
        calls.append(parts)
        if parts == ("GRAPH.LIST",):
            raise RuntimeError("ERR unknown command 'GRAPH.LIST'")
        return b"PONG"

    monkeypatch.setattr(helper, "command", command)
    monkeypatch.setattr("sys.argv", ["dev_graph.py", "start"])
    with pytest.raises(SystemExit, match="without FalkorDB support"):
        helper.main()
    assert calls == [("PING",), ("GRAPH.LIST",)]


@pytest.mark.parametrize(
    "field", ["port", "run_id", "process_id", "config_file", "directory", "pidfile"]
)
def test_stop_refuses_replaced_or_reconfigured_instance(helper, monkeypatch, field):
    calls = redis_graph(helper, monkeypatch)
    original = save_ownership(helper, monkeypatch)
    actual = original | {field: "different-instance-value"}
    monkeypatch.setattr(helper, "instance_identity", lambda *_: actual)
    monkeypatch.setattr("sys.argv", ["dev_graph.py", "stop"])
    with pytest.raises(SystemExit, match="instance ownership is unverified"):
        helper.main()
    assert ("SHUTDOWN", "SAVE") not in calls


def test_stop_refuses_changed_pidfile(helper, monkeypatch):
    calls = redis_graph(helper, monkeypatch)
    save_ownership(helper, monkeypatch)
    (helper.RUNTIME / "graph.pid").write_text("456\n", encoding="utf-8")
    monkeypatch.setattr("sys.argv", ["dev_graph.py", "stop"])
    with pytest.raises(SystemExit, match="instance ownership is unverified"):
        helper.main()
    assert ("SHUTDOWN", "SAVE") not in calls


def test_stop_refuses_ownership_record_from_another_runtime(helper, monkeypatch):
    calls = redis_graph(helper, monkeypatch)
    identity = save_ownership(helper, monkeypatch)
    helper.ownership_file(6379).write_text(
        json.dumps({"runtime": "another-workspace", "identity": identity}), encoding="utf-8"
    )
    monkeypatch.setattr("sys.argv", ["dev_graph.py", "stop"])
    with pytest.raises(SystemExit, match="instance ownership is unverified"):
        helper.main()
    assert ("SHUTDOWN", "SAVE") not in calls


def test_stop_only_shuts_down_exact_managed_instance(helper, monkeypatch):
    calls = redis_graph(helper, monkeypatch)
    save_ownership(helper, monkeypatch)
    monkeypatch.setattr("sys.argv", ["dev_graph.py", "stop"])
    helper.main()
    assert calls[-1] == ("SHUTDOWN", "SAVE")
    assert not helper.ownership_file(6379).exists()
