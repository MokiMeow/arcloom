"""Content-addressed, immutable-by-API evidence with verification on every read."""

import hmac
import json
import os
import re
from pathlib import Path
from typing import Any

from arcloom.domain import DomainError
from arcloom.storage import canonical, digest

SHA256 = re.compile(r"^[0-9a-f]{64}$")


def sign_receipt(receipt: dict, secret: str) -> str:
    return hmac.new(secret.encode(), canonical(receipt).encode(), "sha256").hexdigest()


def verify_receipt(receipt: dict, secret: str) -> bool:
    unsigned = {k: v for k, v in receipt.items() if k != "signature"}
    return hmac.compare_digest(str(receipt.get("signature", "")), sign_receipt(unsigned, secret))


class EvidenceStore:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def _path(self, tenant: str, sha: str) -> Path:
        if not SHA256.fullmatch(sha):
            raise DomainError("invalid_digest", "Invalid evidence digest", 422)
        directory = self.root / digest(tenant)[:24]
        directory.mkdir(exist_ok=True, mode=0o700)
        if directory.is_symlink() or directory.resolve().parent != self.root:
            raise DomainError("unsafe_artifact_path", "Evidence storage is unsafe", 500)
        return directory / f"{sha}.json"

    def put(self, tenant: str, value: dict[str, Any]) -> str:
        data = canonical(value).encode()
        if len(data) > 128 * 1024:
            raise DomainError("evidence_too_large", "Evidence exceeded the size limit", 413)
        sha = digest(data)
        path = self._path(tenant, sha)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        flags |= getattr(os, "O_NOFOLLOW", 0)
        try:
            fd = os.open(path, flags, 0o600)
        except FileExistsError:
            self.get(tenant, sha)
            return sha
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return sha

    def get(self, tenant: str, sha: str) -> dict:
        path = self._path(tenant, sha)
        if path.is_symlink():
            raise DomainError("evidence_integrity", "Evidence integrity check failed", 409)
        try:
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(fd, "rb") as handle:
                data = handle.read(128 * 1024 + 1)
        except FileNotFoundError as exc:
            raise DomainError("evidence_missing", "Evidence artifact is missing", 404) from exc
        if len(data) > 128 * 1024 or not hmac.compare_digest(digest(data), sha):
            raise DomainError("evidence_integrity", "Evidence integrity check failed", 409)
        try:
            return json.loads(data)
        except (ValueError, UnicodeDecodeError) as exc:
            raise DomainError("evidence_integrity", "Invalid evidence artifact", 409) from exc
