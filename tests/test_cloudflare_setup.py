"""Cloudflare bootstrap keeps credentials local and preserves other configuration."""

import importlib.util
import json
import os
import stat
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from dotenv import dotenv_values

from arcloom.config import Settings

ACCOUNT = "6178e610e4d4e716f787ee1dd839a61c"
SECRET = "private-test-token_DO_NOT_LOG"


@pytest.fixture
def helper(monkeypatch):
    path = Path(__file__).resolve().parents[1] / "scripts" / "cloudflare_setup.py"
    assert path.exists(), "Cloudflare bootstrap helper has not been implemented"
    spec = importlib.util.spec_from_file_location("cloudflare_setup_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.delenv("CLOUDFLARE_API_TOKEN", raising=False)
    return module


def cli_result(helper, monkeypatch, *, stdout=None, returncode=0):
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(
            returncode=returncode,
            stdout=json.dumps({"type": "oauth", "token": SECRET}) if stdout is None else stdout,
            stderr="diagnostic that may contain " + SECRET,
        )

    monkeypatch.setattr(helper.subprocess, "run", run)
    return calls


def test_setup_preserves_auth_graph_comments_and_multiline_values(
    helper, monkeypatch, tmp_path, capsys
):
    path = tmp_path / ".env"
    untouched = (
        '# Keep this comment\r\nARCLOOM_ADMIN_TOKEN="private-owner"\r\n'
        "ARCLOOM_GRAPH_PASSWORD='private-graph'\r\n"
        'OTHER="line one\r\nARCLOOM_PROVIDER=embedded-text\r\nline three"\r\n'
    )
    path.write_bytes((untouched + "\r\nARCLOOM_PROVIDER=deterministic\r\n").encode())
    cli_result(helper, monkeypatch)

    assert helper.main(["--account-id", ACCOUNT, "--env-file", str(path)]) == 0

    assert path.read_bytes().startswith(untouched.encode())
    values = dotenv_values(path)
    assert values["ARCLOOM_ADMIN_TOKEN"] == "private-owner"
    assert values["ARCLOOM_GRAPH_PASSWORD"] == "private-graph"
    assert values["ARCLOOM_PROVIDER"] == "cloudflare"
    assert values["ARCLOOM_MODEL"] == "@cf/cloudflare/clef-flash"
    assert values["ARCLOOM_CLOUDFLARE_ACCOUNT_ID"] == ACCOUNT
    assert values["ARCLOOM_MODEL_API_KEY"] == SECRET
    output = capsys.readouterr()
    assert SECRET not in output.out + output.err
    assert "OAuth" in output.out and "expire" in output.out
    assert "--account-id " + ACCOUNT in output.out
    assert sorted(item.name for item in tmp_path.iterdir()) == [".env"]
    if os.name != "nt":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_duplicate_provider_keys_are_removed_without_dropping_other_fields(
    helper, monkeypatch, tmp_path
):
    path = tmp_path / ".env"
    path.write_text(
        "# heading\n\nexport ARCLOOM_PROVIDER=deterministic\n"
        "ARCLOOM_PROVIDER=gemini\nARCLOOM_MODEL_API_KEY=old\n"
        "export ARCLOOM_MODEL_API_KEY='second old'\nKEEP=unchanged",
        encoding="utf-8",
    )
    cli_result(helper, monkeypatch)
    assert helper.main(["--account-id", ACCOUNT, "--env-file", str(path)]) == 0
    content = path.read_text()
    assert content.startswith("# heading\n\n")
    assert content.count("ARCLOOM_PROVIDER=") == 1
    assert content.count("ARCLOOM_MODEL_API_KEY=") == 1
    assert "KEEP=unchanged\n" in content
    assert dotenv_values(path)["ARCLOOM_MODEL_API_KEY"] == SECRET


def test_case_aliases_cannot_shadow_cloudflare_settings(helper, monkeypatch, tmp_path):
    # Settings treats environment names case-insensitively: later aliases must
    # be removed as well as exact duplicates when changing providers.
    for key in tuple(os.environ):
        if key.upper().startswith("ARCLOOM_"):
            monkeypatch.delenv(key)
    path = tmp_path / ".env"
    unrelated = "# Keep original spelling\nMixedCase_Keep=unchanged\n"
    path.write_text(
        unrelated
        + "ARCLOOM_PROVIDER=deterministic\narcloom_provider=gemini\n"
        + "ARCLOOM_MODEL=old-model\nArcloom_Model=gemini-test-model\n"
        + "ARCLOOM_MODEL_API_KEY=old-token\narcloom_model_api_key=shadow-token\n"
        + f"arcloom_cloudflare_account_id={'1' * 32}\n"
        + f"ARCLOOM_CLOUDFLARE_ACCOUNT_ID={'2' * 32}\n",
        encoding="utf-8",
    )
    cli_result(helper, monkeypatch)

    assert helper.main(["--account-id", ACCOUNT, "--env-file", str(path)]) == 0

    settings = Settings(_env_file=path)
    assert settings.provider == "cloudflare"
    assert settings.model == "@cf/cloudflare/clef-flash"
    assert settings.model_api_key.get_secret_value() == SECRET
    assert settings.cloudflare_account_id == ACCOUNT
    assert path.read_text().startswith(unrelated)
    keys = list(dotenv_values(path))
    for key in (
        "ARCLOOM_PROVIDER",
        "ARCLOOM_MODEL",
        "ARCLOOM_MODEL_API_KEY",
        "ARCLOOM_CLOUDFLARE_ACCOUNT_ID",
    ):
        assert [item for item in keys if item.upper() == key] == [key]


def test_environment_api_token_takes_precedence_without_running_wrangler(
    helper, monkeypatch, tmp_path, capsys
):
    path = tmp_path / ".env"
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", SECRET)

    def forbidden(*args, **kwargs):
        pytest.fail("An existing API token must not start Wrangler")

    monkeypatch.setattr(helper.subprocess, "run", forbidden)
    assert helper.main(["--account-id", ACCOUNT, "--env-file", str(path)]) == 0
    assert dotenv_values(path)["ARCLOOM_MODEL_API_KEY"] == SECRET
    output = capsys.readouterr()
    assert "API token" in output.out
    assert SECRET not in output.out + output.err


@pytest.mark.parametrize("model", ["clef", "clef-omni", "@cf/cloudflare/clef-flash"])
def test_explicit_clef_variant_is_selected(helper, monkeypatch, tmp_path, model):
    path = tmp_path / ".env"
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", SECRET)
    assert helper.main(["--account-id", ACCOUNT, "--env-file", str(path), "--model", model]) == 0
    assert dotenv_values(path)["ARCLOOM_MODEL"] == (
        model if model.startswith("@cf/") else "@cf/cloudflare/" + model
    )


def test_unknown_model_is_rejected_without_writing(helper, tmp_path):
    path = tmp_path / ".env"
    with pytest.raises(SystemExit) as result:
        helper.main(["--account-id", ACCOUNT, "--env-file", str(path), "--model", "../../unknown"])
    assert result.value.code == 2
    assert not path.exists()


def test_cli_runs_pinned_wrangler_with_captured_output_and_timeout(helper, monkeypatch, tmp_path):
    calls = cli_result(helper, monkeypatch)
    assert helper.main(["--account-id", ACCOUNT, "--env-file", str(tmp_path / ".env")]) == 0
    args, options = calls[0]
    assert args == [
        "npx.cmd" if os.name == "nt" else "npx",
        "--yes",
        "wrangler@4.151.1",
        "auth",
        "token",
        "--json",
    ]
    assert options["shell"] is False
    assert options["capture_output"] is True
    assert 0 < options["timeout"] <= 120


@pytest.mark.parametrize(
    "stdout,returncode",
    [
        (SECRET, 1),
        (SECRET, 0),
        ('{"type":"oauth","token":', 0),
        ('{"type":"oauth"}', 0),
        ('["oauth", "' + SECRET + '"]', 0),
        (json.dumps({"type": "api_key", "key": SECRET, "email": "a@example.com"}), 0),
        (json.dumps({"type": "oauth", "token": "bad\nINJECT=secret"}), 0),
    ],
)
def test_cli_failure_or_malformed_credentials_never_leak_or_mutate(
    helper, monkeypatch, tmp_path, capsys, stdout, returncode
):
    path = tmp_path / ".env"
    original = b"ARCLOOM_ADMIN_TOKEN=keep-me\n"
    path.write_bytes(original)
    cli_result(helper, monkeypatch, stdout=stdout, returncode=returncode)
    assert helper.main(["--account-id", ACCOUNT, "--env-file", str(path)]) == 1
    assert path.read_bytes() == original
    output = capsys.readouterr()
    assert SECRET not in output.out + output.err
    assert "INJECT" not in output.out + output.err


@pytest.mark.parametrize(
    "exception", [FileNotFoundError(SECRET), subprocess.TimeoutExpired(SECRET, 1)]
)
def test_process_failure_is_sanitized(helper, monkeypatch, tmp_path, capsys, exception):
    def run(*args, **kwargs):
        raise exception

    monkeypatch.setattr(helper.subprocess, "run", run)
    path = tmp_path / ".env"
    assert helper.main(["--account-id", ACCOUNT, "--env-file", str(path)]) == 1
    assert not path.exists()
    output = capsys.readouterr()
    assert SECRET not in output.out + output.err


@pytest.mark.parametrize("account", ["", "../escape", "A" * 32, "a" * 31, "a" * 33])
def test_invalid_account_is_rejected_before_credentials_are_loaded(
    helper, monkeypatch, tmp_path, account
):
    def forbidden(*args, **kwargs):
        pytest.fail("Invalid accounts must not start Wrangler")

    monkeypatch.setattr(helper.subprocess, "run", forbidden)
    path = tmp_path / ".env"
    with pytest.raises(SystemExit) as result:
        helper.main(["--account-id", account, "--env-file", str(path)])
    assert result.value.code == 2
    assert not path.exists()


def test_symlink_detection_refuses_before_reading_credentials(helper, monkeypatch, tmp_path):
    path = tmp_path / ".env"
    monkeypatch.setattr(helper.Path, "is_symlink", lambda item: item == path)

    def forbidden(*args, **kwargs):
        pytest.fail("Symlink destinations must not start Wrangler")

    monkeypatch.setattr(helper.subprocess, "run", forbidden)
    assert helper.main(["--account-id", ACCOUNT, "--env-file", str(path)]) == 1
    assert not path.exists()


def test_malformed_existing_dotenv_is_preserved_without_secret_diagnostics(
    helper, monkeypatch, tmp_path, capsys
):
    path = tmp_path / ".env"
    original = b'ARCLOOM_ADMIN_TOKEN="unterminated\n'
    path.write_bytes(original)
    cli_result(helper, monkeypatch)
    assert helper.main(["--account-id", ACCOUNT, "--env-file", str(path)]) == 1
    assert path.read_bytes() == original
    output = capsys.readouterr()
    assert SECRET not in output.out + output.err
    assert "unterminated" not in output.out + output.err
    assert [item.name for item in tmp_path.iterdir()] == [".env"]


def test_symlink_env_is_rejected_without_changing_target(helper, monkeypatch, tmp_path):
    target = tmp_path / "private-config"
    target.write_text("KEEP=unchanged\n")
    path = tmp_path / ".env"
    try:
        path.symlink_to(target)
    except OSError:
        pytest.skip("Creating symlinks requires an elevated Windows developer environment")
    cli_result(helper, monkeypatch)
    assert helper.main(["--account-id", ACCOUNT, "--env-file", str(path)]) == 1
    assert target.read_text() == "KEEP=unchanged\n"
    assert path.is_symlink()


def test_failed_atomic_replace_keeps_original_and_removes_temporary_secret_file(
    helper, monkeypatch, tmp_path, capsys
):
    path = tmp_path / ".env"
    path.write_text("KEEP=unchanged\n")
    cli_result(helper, monkeypatch)

    def fail(*args, **kwargs):
        raise OSError("sensitive diagnostic " + SECRET)

    monkeypatch.setattr(helper.os, "replace", fail)
    assert helper.main(["--account-id", ACCOUNT, "--env-file", str(path)]) == 1
    assert path.read_text() == "KEEP=unchanged\n"
    assert [item.name for item in tmp_path.iterdir()] == [".env"]
    output = capsys.readouterr()
    assert SECRET not in output.out + output.err


def test_refresh_only_preserves_selection_and_all_other_configuration(
    helper, monkeypatch, tmp_path, capsys
):
    path = tmp_path / ".env"
    untouched = (
        f"ARCLOOM_PROVIDER=cloudflare\nARCLOOM_MODEL=clef-omni\n"
        f"ARCLOOM_CLOUDFLARE_ACCOUNT_ID={ACCOUNT}\n"
        f"ARCLOOM_CLOUDFLARE_WRANGLER_UNTIL={int(time.time()) + 3600}\n"
        "ARCLOOM_ADMIN_TOKEN=private-owner\nARCLOOM_RUNNER_SECRET=private-runner\n"
        "ARCLOOM_GRAPH_MODE=server\nOTHER=keep\n"
    )
    path.write_text(untouched + "ARCLOOM_MODEL_API_KEY=expired\n")
    overlay = tmp_path / "providers.json"
    overlay.write_text('{"active_provider":"chatgpt","model":"luna"}')
    calls = cli_result(helper, monkeypatch)
    assert helper.main(["--refresh-only", "--account-id", ACCOUNT, "--env-file", str(path)]) == 0
    assert path.read_text() == untouched + f"ARCLOOM_MODEL_API_KEY={SECRET}\n"
    assert overlay.read_text() == '{"active_provider":"chatgpt","model":"luna"}'
    assert len(calls) == 1
    output = capsys.readouterr()
    assert SECRET not in output.out + output.err
    assert "Configured Cloudflare" not in output.out


@pytest.mark.parametrize("case", ["missing", "owner", "account", "deadline", "expired", "long"])
def test_refresh_only_refuses_unowned_or_unbounded_destinations(
    helper, monkeypatch, tmp_path, case
):
    path = tmp_path / ".env"
    values = {
        "ARCLOOM_PROVIDER": "cloudflare",
        "ARCLOOM_CLOUDFLARE_ACCOUNT_ID": ACCOUNT,
        "ARCLOOM_CLOUDFLARE_WRANGLER_UNTIL": str(int(time.time()) + 3600),
        "ARCLOOM_MODEL_API_KEY": "old",
    }
    if case == "owner":
        values["ARCLOOM_PROVIDER"] = "gemini"
    elif case == "account":
        values["ARCLOOM_CLOUDFLARE_ACCOUNT_ID"] = "b" * 32
    elif case == "deadline":
        values["ARCLOOM_CLOUDFLARE_WRANGLER_UNTIL"] = "not-a-date"
    elif case == "expired":
        values["ARCLOOM_CLOUDFLARE_WRANGLER_UNTIL"] = str(int(time.time()) - 1)
    elif case == "long":
        values["ARCLOOM_CLOUDFLARE_WRANGLER_UNTIL"] = str(int(time.time()) + 5 * 86400)
    original = "".join(f"{key}={value}\n" for key, value in values.items())
    if case != "missing":
        path.write_text(original)

    def forbidden(*args, **kwargs):
        pytest.fail("Invalid maintenance destinations must not invoke Wrangler")

    monkeypatch.setattr(helper.subprocess, "run", forbidden)
    assert helper.main(["--refresh-only", "--account-id", ACCOUNT, "--env-file", str(path)]) == 1
    if case != "missing":
        assert path.read_text() == original
    else:
        assert not path.exists()


def test_setup_can_explicitly_enable_fixed_four_day_wrangler_window(helper, monkeypatch, tmp_path):
    path = tmp_path / ".env"
    deadline = int(time.time()) + 4 * 86400 - 60
    cli_result(helper, monkeypatch)
    assert (
        helper.main(
            ["--account-id", ACCOUNT, "--env-file", str(path), "--wrangler-until", str(deadline)]
        )
        == 0
    )
    assert dotenv_values(path)["ARCLOOM_CLOUDFLARE_WRANGLER_UNTIL"] == str(deadline)


def test_wrangler_exception_chain_contains_no_subprocess_secrets(helper, monkeypatch):
    def fail(*args, **kwargs):
        raise subprocess.TimeoutExpired(SECRET, 1, output=SECRET, stderr=SECRET)

    monkeypatch.setattr(helper.subprocess, "run", fail)
    with pytest.raises(helper.SetupError) as error:
        helper.credentials()
    assert error.value.__cause__ is None
    assert error.value.__context__ is None
    assert SECRET not in str(error.value)
