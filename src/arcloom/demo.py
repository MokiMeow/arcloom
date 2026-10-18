"""Persistent, isolated presentation workspaces without resetting existing memory."""

import json
import os
from pathlib import Path
from uuid import uuid4

from arcloom.config import Settings


def demo_settings(source: Settings, directory: Path, port: int) -> Settings:
    if not 1 <= port <= 65535:
        raise ValueError("Choose a port between 1 and 65535")
    directory = directory.resolve()
    if directory == source.data_dir.resolve():
        raise ValueError("Choose a separate, empty presentation directory")
    descriptor = directory / "workspace.json"
    graph = {
        "mode": source.graph_mode,
        "host": source.graph_host,
        "port": source.graph_port,
        "username": source.graph_username,
        "tls": source.graph_ssl,
    }
    if descriptor.exists():
        try:
            if descriptor.is_symlink() or descriptor.stat().st_size > 4096:
                raise ValueError
            state = json.loads(descriptor.read_text(encoding="utf-8"))
            if set(state) != {"version", "tenant", "graph_prefix", "graph"}:
                raise ValueError
            if state["version"] != 1:
                raise ValueError
        except (OSError, ValueError, TypeError):
            raise ValueError("The presentation workspace descriptor is invalid") from None
        if state["graph"] != graph:
            raise ValueError("Restore this presentation's graph connection before resuming")
    else:
        if directory.exists() and any(directory.iterdir()):
            raise ValueError("Choose an empty presentation directory; existing data was preserved")
        identity = uuid4().hex[:20]
        state = {
            "version": 1,
            "tenant": "demo_" + identity,
            "graph_prefix": "arcloom_demo_" + identity,
            "graph": graph,
        }
    values = source.model_dump()
    values.update(
        data_dir=directory,
        tenant=state["tenant"],
        graph_prefix=state["graph_prefix"],
        provider="deterministic",
        model="",
        model_api_key="",
        chatgpt_profile_id="",
        cloudflare_wrangler_until=None,
        allowed_origins=[f"http://127.0.0.1:{port}", f"http://localhost:{port}"],
    )
    try:
        settings = Settings.model_validate(values)
        if settings.tenant == source.tenant or settings.graph_prefix == source.graph_prefix:
            raise ValueError
    except ValueError:
        raise ValueError("The presentation workspace identity is invalid") from None
    if not descriptor.exists():
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            fd = os.open(descriptor, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(state, stream, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
        except OSError:
            raise ValueError(
                "The presentation descriptor could not be saved; no data was reset"
            ) from None
    return settings
