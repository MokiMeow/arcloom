"""Password policy and Argon2id hashing; no reversible password storage."""

import re
import secrets
import threading
from contextlib import contextmanager

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# OWASP recommends Argon2id. These explicit settings also make upgrades testable.
PASSWORD_HASHER = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)


class PasswordHashBusyError(RuntimeError):
    """The bounded memory-hard hashing pool is full; retry without weakening hashing."""


_KDF_SLOTS = threading.BoundedSemaphore(4)


@contextmanager
def _kdf_slot():
    if not _KDF_SLOTS.acquire(timeout=1):
        raise PasswordHashBusyError("Password processing is busy")
    try:
        yield
    finally:
        _KDF_SLOTS.release()


with _kdf_slot():
    _DUMMY_HASH = PASSWORD_HASHER.hash(secrets.token_urlsafe(48))
_LOCAL_PART = re.compile(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+", re.ASCII)
_DOMAIN_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", re.ASCII)


def normalize_email(value: str) -> str:
    """Canonical account ID; email ownership is not asserted without verification."""
    value = value.strip().lower()
    if len(value) > 254 or value.count("@") != 1:
        raise ValueError("Enter a valid email address")
    local, domain = value.split("@")
    try:
        domain = domain.encode("idna").decode("ascii")
    except UnicodeError as error:
        raise ValueError("Enter a valid email address") from error
    labels = domain.split(".")
    if (
        not local
        or len(local) > 64
        or not _LOCAL_PART.fullmatch(local)
        or local.startswith(".")
        or local.endswith(".")
        or ".." in local
        or len(labels) < 2
        or any(not _DOMAIN_LABEL.fullmatch(label) for label in labels)
        or len(local) + len(domain) + 1 > 254
    ):
        raise ValueError("Enter a valid email address")
    return f"{local}@{domain}"


def validate_password(value: str) -> str:
    # Preserve spaces and Unicode exactly; unlike other input, passwords are not stripped.
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError("Use valid Unicode characters in your password") from None
    if not 12 <= len(value) <= 128 or len(encoded) > 512:
        raise ValueError("Use a password containing 12–128 characters")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("Passwords cannot contain control characters")
    return value


def hash_password(value: str) -> str:
    value = validate_password(value)
    with _kdf_slot():
        return PASSWORD_HASHER.hash(value)


def verify_password(encoded: str | None, value: str) -> bool:
    try:
        password_bytes = value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    if not 1 <= len(value) <= 128 or len(password_bytes) > 512:
        return False
    try:
        with _kdf_slot():
            matches = PASSWORD_HASHER.verify(encoded or _DUMMY_HASH, value)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return bool(matches and encoded)


def needs_rehash(encoded: str) -> bool:
    return PASSWORD_HASHER.check_needs_rehash(encoded)
