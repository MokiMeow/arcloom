"""Authenticated encryption for reusable local credentials, bound to a workspace.

Passwords are handled separately by the account password KDF. These credentials
must be recoverable to authenticate to their explicitly selected remote service.
"""

import base64
import json
import os
import tempfile
from contextlib import suppress
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from arcloom.domain import DomainError
from arcloom.storage import canonical

MAGIC = b"ARCLOOM-PRIVATE-1\n"


def safe_path(path: Path) -> None:
    if any(item.is_symlink() or item.is_junction() for item in (path, *path.parents)):
        raise DomainError("private_storage", "Private credential storage is unsafe", 503)


class PrivateStorage:
    def __init__(self, settings):
        self.root = Path(settings.data_dir)
        self.tenant = settings.tenant
        self.key_path = self.root / ".private-key"
        self.configured_key = settings.private_encryption_key.get_secret_value()

    def _cipher(self, *, create: bool) -> Fernet:
        try:
            if self.configured_key:
                return Fernet(self.configured_key.encode("ascii"))
            safe_path(self.key_path)
            if create and not self.key_path.exists():
                self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
                descriptor, temporary = tempfile.mkstemp(prefix=".key-", dir=self.root)
                try:
                    with os.fdopen(descriptor, "wb") as stream:
                        stream.write(Fernet.generate_key())
                        stream.flush()
                        os.fsync(stream.fileno())
                    # Publish a complete key atomically. Concurrent first
                    # writers must never observe a partially written key.
                    with suppress(FileExistsError):
                        os.link(temporary, self.key_path)
                finally:
                    Path(temporary).unlink(missing_ok=True)
            if os.name != "nt" and self.key_path.stat().st_mode & 0o077:
                raise ValueError("Unsafe key permissions")
            with self.key_path.open("rb") as stream:
                key = stream.read(129)
            return Fernet(key)
        except (OSError, ValueError, UnicodeError):
            raise DomainError(
                "private_storage", "The private encryption key is unavailable or invalid", 503
            ) from None

    def read(self, path: Path, purpose: str) -> tuple[bytes, bool]:
        """Return plaintext internally and whether validated legacy data needs migration."""
        safe_path(path)
        try:
            if path.stat().st_size > 2 * 1024 * 1024:
                raise ValueError("Credential file is too large")
            if os.name != "nt":
                os.chmod(path, 0o600)
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(fd, "rb") as stream:
                data = stream.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024:
                raise ValueError("Credential file is too large")
            if not data.startswith(MAGIC):
                return data, True
            payload = json.loads(self._cipher(create=False).decrypt(data[len(MAGIC) :]))
            if payload["tenant"] != self.tenant or payload["purpose"] != purpose:
                raise ValueError("Credential context mismatch")
            return base64.b64decode(payload["data"], validate=True), False
        except (OSError, ValueError, KeyError, TypeError, InvalidToken):
            raise DomainError(
                "private_storage", "Protected private credentials could not be read", 503
            ) from None

    def write(self, path: Path, purpose: str, plaintext: bytes) -> None:
        safe_path(path)
        temporary = None
        try:
            if len(plaintext) > 1024 * 1024:
                raise ValueError("Credential payload is too large")
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if os.name != "nt":
                os.chmod(path.parent, 0o700)
            payload = canonical(
                {
                    "tenant": self.tenant,
                    "purpose": purpose,
                    "data": base64.b64encode(plaintext).decode("ascii"),
                }
            ).encode()
            encrypted = MAGIC + self._cipher(create=True).encrypt(payload)
            descriptor, temporary = tempfile.mkstemp(prefix=".sealed-", dir=path.parent)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(encrypted)
                stream.flush()
                os.fsync(stream.fileno())
            safe_path(path)
            os.replace(temporary, path)
            if os.name != "nt":
                os.chmod(path, 0o600)
        except (OSError, ValueError):
            raise DomainError(
                "private_storage", "Private credentials could not be protected and saved", 503
            ) from None
        finally:
            if temporary:
                Path(temporary).unlink(missing_ok=True)
