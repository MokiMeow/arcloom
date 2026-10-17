"""Local operator commands. Agents can propose; they never approve themselves."""

import argparse
import json
import os
import secrets
from pathlib import Path


def configure(path: Path) -> None:
    """Generate a private configuration, refusing to overwrite existing secrets."""
    values = {
        "ARCLOOM_ADMIN_TOKEN": secrets.token_urlsafe(36),
        "ARCLOOM_RUNNER_SECRET": secrets.token_urlsafe(36),
        "ARCLOOM_GRAPH_PASSWORD": secrets.token_urlsafe(36),
        "ARCLOOM_PROVIDER": "deterministic",
        "ARCLOOM_GRAPH_MODE": "server",
        "ARCLOOM_COOKIE_SECURE": "false",
    }
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write("# Generated locally. Never commit or share this file.\n")
        stream.writelines(f"{key}={value}\n" for key, value in values.items())
    print(f"Created {path}. The login token is ARCLOOM_ADMIN_TOKEN in that file.")
    print("Use Docker Compose, or set GRAPH_MODE=lite for local Python development.")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="arcloom", description="Evidence-backed synthetic security memory"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    config = sub.add_parser("configure", help="Generate .env without overwriting existing files")
    config.add_argument("--path", type=Path, default=Path(".env"))
    for command, port in [("serve", 8000), ("lab", 9001)]:
        command_parser = sub.add_parser(command)
        command_parser.add_argument("--host", default="127.0.0.1")
        command_parser.add_argument("--port", type=int, default=port)
    sub.add_parser("doctor", help="Check graph synchronization, runner health, and audit integrity")
    agent = sub.add_parser(
        "agent-once", help="A fresh process proposes one graph-backed investigation"
    )
    agent.add_argument("--source", default=None)
    args = parser.parse_args()
    if args.command == "configure":
        try:
            configure(args.path)
        except FileExistsError:
            parser.exit(2, "Configuration already exists; refusing to replace credentials.\n")
        return

    from arcloom.config import Settings

    settings = Settings()
    if args.command in {"serve", "lab"}:
        import uvicorn

        from arcloom.api import create_app
        from arcloom.lab import create_lab_app

        app = (
            create_app(settings)
            if args.command == "serve"
            else create_lab_app(settings.runner_secret.get_secret_value())
        )
        uvicorn.run(app, host=args.host, port=args.port, access_log=False, server_header=False)
        return

    from arcloom.domain import DiscoveryInput, DomainError
    from arcloom.runtime import Runtime

    runtime = Runtime(settings.model_copy(update={"worker_enabled": False}))
    try:
        runtime.initialize()
        actor = runtime.auth.bearer(settings.admin_token.get_secret_value())
        if args.command == "agent-once":
            result = runtime.discovery.run(
                actor, DiscoveryInput(source_finding_id=args.source), "cli-" + secrets.token_hex(16)
            )
            print(
                json.dumps({"process_id": os.getpid(), "previous_messages": 0, **result}, indent=2)
            )
        else:
            import httpx

            runtime.projector.require_current(actor.tenant)
            with httpx.Client(trust_env=False, timeout=5) as client:
                response = client.get(settings.lab_url + "/health")
                response.raise_for_status()
            audit = runtime.store.verify_audit(actor.tenant)
            print(
                json.dumps(
                    {
                        "graph": "FalkorDB",
                        "graph_ready": True,
                        "lab": response.json(),
                        "audit": audit,
                        "provider": settings.provider,
                        "model": settings.model or "graph-rank-v1",
                    },
                    indent=2,
                )
            )
    except (DomainError, ValueError) as exc:
        parser.exit(1, f"{exc}\n")
    finally:
        runtime.close()


if __name__ == "__main__":
    main()
