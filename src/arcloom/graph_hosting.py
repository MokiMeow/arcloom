"""Private operator staging for a managed graph; saving never changes the live graph."""

import os
import re
import tempfile
import threading
from io import StringIO
from pathlib import Path
from typing import Annotated

from dotenv import dotenv_values
from pydantic import Field, StringConstraints, field_validator

from arcloom.domain import DomainError, StrictModel

_LOCK = threading.RLock()


class GraphTargetInput(StrictModel):
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)
    username: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.-]+$")
    password: Annotated[str, StringConstraints(strip_whitespace=False)] = Field(
        default="", max_length=4096
    )
    ssl: bool = True

    @field_validator("host")
    @classmethod
    def valid_host(cls, value):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*", value):
            raise ValueError("Use a database hostname without a scheme or path")
        return value

    @field_validator("password", mode="before")
    @classmethod
    def valid_password(cls, value):
        if isinstance(value, str) and any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("Control characters are not accepted")
        return value


def target_path(settings):
    return settings.data_dir / "private" / "cloud.env"


def _safe(path):
    if any(item.is_symlink() or item.is_junction() for item in (path, *path.parents)):
        raise DomainError("graph_configuration", "Unsafe private connection storage", 503)


def _read(settings):
    path = target_path(settings)
    _safe(path)
    if not path.exists():
        return None
    try:
        values = dotenv_values(path, interpolate=False)
        return GraphTargetInput(
            host=values["ARCLOOM_GRAPH_HOST"],
            port=values["ARCLOOM_GRAPH_PORT"],
            username=values["ARCLOOM_GRAPH_USERNAME"],
            password=values["ARCLOOM_GRAPH_PASSWORD"],
            ssl=values["ARCLOOM_GRAPH_SSL"],
        )
    except (OSError, ValueError, KeyError, TypeError):
        raise DomainError(
            "graph_configuration", "The staged graph connection could not be read", 503
        ) from None


def hosting_status(settings):
    with _LOCK:
        target = _read(settings)
        return {
            "current": {
                "host": settings.graph_host,
                "port": settings.graph_port,
                "username": settings.graph_username,
                "ssl": settings.graph_ssl,
                "prefix": settings.graph_prefix,
            },
            "target": {
                "host": target.host,
                "port": target.port,
                "username": target.username,
                "ssl": target.ssl,
                "password_configured": bool(target.password),
            }
            if target
            else None,
            "staged": target is not None,
        }


def save_target(settings, value):
    with _LOCK:
        old = _read(settings)
        if not value.password:
            if old is None or (value.host, value.port, value.username) != (
                old.host,
                old.port,
                old.username,
            ):
                raise DomainError(
                    "graph_credentials_required",
                    "Enter the password for this database connection",
                    422,
                )
            value = value.model_copy(update={"password": old.password})
        path = target_path(settings)
        _safe(path)
        temporary = None
        try:
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if os.name != "nt":
                os.chmod(path.parent, 0o700)
            values = {
                "HOST": value.host,
                "PORT": str(value.port),
                "USERNAME": value.username,
                "PASSWORD": value.password,
                "SSL": str(value.ssl).lower(),
            }
            # Single-quoted dotenv values preserve literal dollar signs and backslashes.
            content = "".join(
                "ARCLOOM_GRAPH_"
                + key
                + "='"
                + val.replace("\\", "\\\\").replace("'", "\\'")
                + "'\n"
                for key, val in values.items()
            )
            # Verify the serialized credential before it reaches disk.
            if (
                dotenv_values(stream=StringIO(content), interpolate=False)["ARCLOOM_GRAPH_PASSWORD"]
                != value.password
            ):
                raise DomainError(
                    "graph_configuration", "The private connection could not be serialized", 503
                )
            descriptor, temporary = tempfile.mkstemp(prefix=".cloud-", dir=path.parent)
            os.chmod(temporary, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            _safe(path)
            os.replace(temporary, path)
            os.chmod(path, 0o600)
        except OSError:
            raise DomainError(
                "graph_configuration", "The private graph connection could not be saved", 503
            ) from None
        finally:
            if temporary:
                Path(temporary).unlink(missing_ok=True)
        return hosting_status(settings)
