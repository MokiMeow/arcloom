import json
import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from cryptography.fernet import Fernet

from arcloom.config import Settings
from arcloom.domain import DomainError
from arcloom.graph_hosting import GraphTargetInput, _read, save_target
from arcloom.private_storage import MAGIC, PrivateStorage
from arcloom.providers import ProviderManager
from arcloom.storage import Store


def test_reusable_secrets_are_encrypted_and_context_bound(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path)
    storage = PrivateStorage(settings)
    path = tmp_path / "private" / "credentials.bin"
    secret = b"private-outbound-secret"
    storage.write(path, "provider", secret)
    assert path.read_bytes().startswith(MAGIC)
    assert secret not in path.read_bytes()
    assert storage.read(path, "provider") == (secret, False)
    with pytest.raises(DomainError, match="could not be read"):
        storage.read(path, "graph")
    if os.name != "nt":
        assert path.stat().st_mode & 0o077 == 0
        assert storage.key_path.stat().st_mode & 0o077 == 0


def test_concurrent_first_writes_share_one_complete_encryption_key(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path)

    def write(index):
        path = tmp_path / "private" / f"credentials-{index}.bin"
        PrivateStorage(settings).write(path, "provider", f"private-{index}".encode())
        return path

    with ThreadPoolExecutor(max_workers=8) as pool:
        paths = list(pool.map(write, range(16)))
    for index, path in enumerate(paths):
        assert PrivateStorage(settings).read(path, "provider")[0] == f"private-{index}".encode()


def test_environment_key_never_written_and_cross_tenant_copy_rejected(tmp_path):
    key = Fernet.generate_key().decode()
    settings = Settings(_env_file=None, data_dir=tmp_path, private_encryption_key=key)
    storage = PrivateStorage(settings)
    path = tmp_path / "private" / "credentials.bin"
    storage.write(path, "provider", b"private-secret")
    assert not storage.key_path.exists()
    other = PrivateStorage(settings.model_copy(update={"tenant": "other-workspace"}))
    with pytest.raises(DomainError, match="could not be read"):
        other.read(path, "provider")
    assert key.encode() not in path.read_bytes()


def test_tampering_or_missing_key_fails_closed_without_replacing_credentials(tmp_path):
    storage = PrivateStorage(Settings(_env_file=None, data_dir=tmp_path))
    path = tmp_path / "private" / "credentials.bin"
    storage.write(path, "provider", b"private-secret")
    original = path.read_bytes()
    storage.key_path.unlink()
    with pytest.raises(DomainError):
        storage.read(path, "provider")
    assert not storage.key_path.exists()
    assert path.read_bytes() == original
    storage.write(path, "provider", b"new-private-secret")
    content = path.read_bytes()
    path.write_bytes(content[:-8] + b"corrupt!")
    with pytest.raises(DomainError):
        storage.read(path, "provider")


def test_legacy_provider_overlay_migrates_without_losing_saved_credentials(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path)
    manager = ProviderManager(settings, Store(tmp_path))
    manager.path.parent.mkdir(mode=0o700)
    state = {
        "version": 1,
        "active_provider": "openai",
        "profiles": {
            "openai": {
                "model": "test-model",
                "api_key": "legacy-private-key",
                "credential_source": "saved",
            }
        },
    }
    manager.path.write_text(json.dumps(state))
    assert manager.snapshot().model_api_key.get_secret_value() == "legacy-private-key"
    assert manager.path.read_bytes().startswith(MAGIC)
    assert b"legacy-private-key" not in manager.path.read_bytes()
    assert manager._load() == state


def test_legacy_graph_target_migrates_and_preserves_password(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path)
    path = tmp_path / "private" / "cloud.env"
    path.parent.mkdir(mode=0o700)
    path.write_text(
        "ARCLOOM_GRAPH_HOST=graph.example\nARCLOOM_GRAPH_PORT=6379\nARCLOOM_GRAPH_USERNAME=owner\nARCLOOM_GRAPH_PASSWORD='legacy-password'\nARCLOOM_GRAPH_SSL=true\n"
    )
    assert _read(settings).password == "legacy-password"
    assert path.read_bytes().startswith(MAGIC)
    assert b"legacy-password" not in path.read_bytes()
    assert _read(settings).host == "graph.example"


def test_legacy_chatgpt_credentials_migrate_without_exposing_token(tmp_path):
    from arcloom.chatgpt_auth import ChatGPTAuth

    if os.name == "nt":
        pytest.skip("Legacy Windows credentials use separately tested DPAPI protection")
    auth = ChatGPTAuth(Settings(_env_file=None, data_dir=tmp_path))
    auth.credential_path.parent.mkdir(mode=0o700)
    state = {
        "version": 1,
        "host_id": "old-host",
        "active": "profile",
        "profiles": {
            "profile": {
                "access_token": "legacy-access-secret",
                "refresh_token": "legacy-refresh-secret",
            }
        },
    }
    auth.credential_path.write_text(json.dumps(state))
    with auth._locked():
        assert auth._read() == state
    assert auth.credential_path.read_bytes().startswith(MAGIC)
    assert b"legacy-access-secret" not in auth.credential_path.read_bytes()
    assert b"legacy-refresh-secret" not in auth.credential_path.read_bytes()


def test_symlinked_private_storage_is_rejected(tmp_path):
    actual = tmp_path / "actual"
    actual.mkdir()
    link = tmp_path / "private"
    try:
        link.symlink_to(actual, target_is_directory=True)
    except OSError:
        pytest.skip("Symlink permission is unavailable")
    storage = PrivateStorage(Settings(_env_file=None, data_dir=tmp_path))
    with pytest.raises(DomainError, match="unsafe"):
        storage.write(link / "credentials.bin", "provider", b"secret")
    assert not list(actual.iterdir())


def test_migration_loader_reads_protected_graph_target(tmp_path, monkeypatch):
    from scripts.migrate_graph import load_target

    monkeypatch.setattr("scripts.migrate_graph.is_ignored", lambda path: True)
    settings = Settings(_env_file=None, data_dir=tmp_path)
    save_target(
        settings,
        GraphTargetInput(
            host="graph.example",
            port=6379,
            username="owner",
            password="private-target-secret",
            ssl=True,
        ),
    )
    target = load_target(tmp_path / "private" / "cloud.env", settings)
    assert target.graph_host == "graph.example"
    assert target.graph_password.get_secret_value() == "private-target-secret"
