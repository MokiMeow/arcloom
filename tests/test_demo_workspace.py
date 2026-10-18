import json

import pytest

from arcloom.demo import demo_settings


def test_new_demo_is_separate_deterministic_and_resumable(runtime, tmp_path):
    original = runtime.settings.model_copy(deep=True)
    directory = tmp_path / "presentation"
    demo = demo_settings(original, directory, 8002)
    resumed = demo_settings(original, directory, 8002)
    assert demo.tenant == resumed.tenant != original.tenant
    assert demo.graph_prefix == resumed.graph_prefix != original.graph_prefix
    assert demo.data_dir == directory.resolve()
    assert demo.provider == "deterministic" and not demo.model
    assert demo.cloudflare_wrangler_until is None
    assert demo.lab_url == original.lab_url
    assert "http://127.0.0.1:8002" in demo.allowed_origins
    assert not (directory / "journal.sqlite3").exists()
    descriptor = (directory / "workspace.json").read_text()
    assert original.admin_token.get_secret_value() not in descriptor
    assert original.runner_secret.get_secret_value() not in descriptor
    assert original.model_dump() == runtime.settings.model_dump()


def test_demo_refuses_unrecognized_directory_and_changed_graph(runtime, tmp_path):
    unknown = tmp_path / "existing"
    unknown.mkdir()
    (unknown / "keep.txt").write_text("existing user data")
    with pytest.raises(ValueError, match="empty"):
        demo_settings(runtime.settings, unknown, 8002)
    assert (unknown / "keep.txt").read_text() == "existing user data"
    known = tmp_path / "presentation"
    demo_settings(runtime.settings, known, 8002)
    changed = runtime.settings.model_copy(update={"graph_host": "different.example"})
    with pytest.raises(ValueError, match="graph connection"):
        demo_settings(changed, known, 8002)


def test_demo_rejects_tampered_descriptor_without_echo(runtime, tmp_path):
    directory = tmp_path / "presentation"
    demo_settings(runtime.settings, directory, 8002)
    path = directory / "workspace.json"
    data = json.loads(path.read_text())
    data["tenant"] = "private-bad-identifier-/"
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError) as error:
        demo_settings(runtime.settings, directory, 8002)
    assert "private-bad" not in str(error.value)


@pytest.mark.parametrize("port", [0, -1, 65536])
def test_demo_rejects_invalid_port_before_creating_files(runtime, tmp_path, port):
    directory = tmp_path / "presentation"
    with pytest.raises(ValueError, match="port"):
        demo_settings(runtime.settings, directory, port)
    assert not directory.exists()


@pytest.mark.parametrize("command", ["agent-once", "doctor"])
def test_cli_workspace_uses_presentation_identity(runtime, tmp_path, monkeypatch, command):
    from arcloom.cli import main

    directory = tmp_path / "presentation"
    expected = demo_settings(runtime.settings, directory, 8002)
    received = []

    class Captured(Exception):
        pass

    def factory(settings):
        received.append(settings)
        raise Captured

    monkeypatch.setattr("sys.argv", ["arcloom", command, "--workspace", str(directory)])
    monkeypatch.setattr("arcloom.config.Settings", lambda: runtime.settings)
    monkeypatch.setattr("arcloom.runtime.Runtime", factory)
    with pytest.raises(Captured):
        main()
    assert received[0].data_dir == expected.data_dir
    assert received[0].tenant == expected.tenant
    assert received[0].graph_prefix == expected.graph_prefix


def test_cli_workspace_requires_existing_descriptor(runtime, tmp_path, monkeypatch, capsys):
    from arcloom.cli import main

    directory = tmp_path / "not-started"
    monkeypatch.setattr("sys.argv", ["arcloom", "agent-once", "--workspace", str(directory)])
    monkeypatch.setattr("arcloom.config.Settings", lambda: runtime.settings)
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 2
    assert "Start this presentation workspace" in capsys.readouterr().err
    assert not directory.exists()
