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


def doctor(runtime, settings, actor) -> dict:
    """Check dependencies independently; never echo upstream bodies or exceptions."""
    import httpx

    from arcloom.domain import DomainError

    provider = runtime.providers.snapshot()
    result = {
        "status": "not_ready",
        "graph": "FalkorDB",
        "graph_ready": False,
        "lab": {"status": "unavailable"},
        "audit": runtime.store.verify_audit(actor.tenant),
        "provider": provider.provider,
        "model": provider.model
        or ("graph-rank-v1" if provider.provider == "deterministic" else ""),
        "errors": [],
    }
    try:
        runtime.projector.require_current(actor.tenant)
        result["graph_ready"] = True
    except DomainError as error:
        result["errors"].append(
            {
                "component": "graph",
                "code": error.code,
                "message": "Check FalkorDB connectivity and pending projections.",
            }
        )
    try:
        with httpx.Client(trust_env=False, timeout=5, follow_redirects=False) as client:
            response = client.get(settings.lab_url + "/health")
            response.raise_for_status()
        health = response.json()
        if (
            not isinstance(health, dict)
            or health.get("status") != "ok"
            or health.get("environment") != "synthetic-asgi-lab"
        ):
            raise ValueError("Unexpected lab health contract")
        result["lab"] = {"status": "ok", "environment": "synthetic-asgi-lab"}
    except httpx.HTTPStatusError as error:
        code = (
            "lab_authentication" if error.response.status_code in {401, 403} else "lab_http_error"
        )
        result["errors"].append(
            {
                "component": "lab",
                "code": code,
                "message": "The lab health request was rejected; check runner configuration.",
            }
        )
    except httpx.HTTPError:
        result["errors"].append(
            {
                "component": "lab",
                "code": "lab_unavailable",
                "message": "Start the lab runner and check its configured address.",
            }
        )
    except (ValueError, TypeError):
        result["errors"].append(
            {
                "component": "lab",
                "code": "lab_contract",
                "message": "The configured address did not return valid synthetic lab health.",
            }
        )
    if not result["audit"]["valid"]:
        result["errors"].append(
            {
                "component": "audit",
                "code": "audit_integrity",
                "message": "The audit chain failed verification.",
            }
        )
    if not result["errors"]:
        result["status"] = "ready"
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="arcloom", description="Evidence-backed synthetic security memory"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    config = sub.add_parser("configure", help="Generate .env without overwriting existing files")
    config.add_argument("--path", type=Path, default=Path(".env"))
    demo = sub.add_parser(
        "demo", help="Start or resume a separate persistent presentation workspace"
    )
    demo.add_argument("--workspace", type=Path, default=Path("data/presentation"))
    demo.add_argument("--port", type=int, default=8002)
    for command, port in [("serve", 8000), ("lab", 9001)]:
        command_parser = sub.add_parser(command)
        command_parser.add_argument("--host", default="127.0.0.1")
        command_parser.add_argument("--port", type=int, default=port)
    doctor_parser = sub.add_parser(
        "doctor", help="Check graph synchronization, runner health, and audit integrity"
    )
    doctor_parser.add_argument("--workspace", type=Path, default=None)
    sub.add_parser("providers", help="Show provider configuration without secrets")
    sub.add_parser(
        "provider-test", help="Explicitly call the selected provider with a synthetic diagnostic"
    )
    subscription = sub.add_parser(
        "chatgpt-login", help="Connect a ChatGPT subscription in the browser"
    )
    subscription.add_argument("--profile", default=None)
    agent = sub.add_parser(
        "agent-once", help="A fresh process proposes one graph-backed investigation"
    )
    agent.add_argument("--source", default=None)
    agent.add_argument(
        "--workspace", type=Path, default=None, help="Use an existing presentation workspace"
    )
    args = parser.parse_args()
    if args.command == "configure":
        try:
            configure(args.path)
        except FileExistsError:
            parser.exit(2, "Configuration already exists; refusing to replace credentials.\n")
        return

    from arcloom.config import Settings

    try:
        settings = Settings()
    except ValueError:
        if args.command == "doctor":
            print(
                json.dumps(
                    {
                        "status": "not_ready",
                        "error": {
                            "code": "invalid_configuration",
                            "message": "Check the server configuration; sensitive values are omitted.",
                        },
                    }
                )
            )
            parser.exit(1)
        parser.exit(1, "Invalid server configuration; check the private environment settings.\n")
    if args.command in {"doctor", "agent-once"} and args.workspace is not None:
        from arcloom.demo import demo_settings

        if not (args.workspace / "workspace.json").is_file():
            parser.exit(2, "Start this presentation workspace with arcloom demo first.\n")
        try:
            settings = demo_settings(settings, args.workspace, 8002)
        except ValueError as error:
            parser.exit(2, str(error) + "\n")
    if args.command == "demo":
        import uvicorn

        from arcloom.api import create_app
        from arcloom.demo import demo_settings

        try:
            settings = demo_settings(settings, args.workspace, args.port)
        except ValueError as error:
            parser.exit(2, str(error) + "\n")
        print(f"Presentation: http://127.0.0.1:{args.port}")
        print(f"Persistent workspace: {settings.data_dir}")
        print("Use ARCLOOM_ADMIN_TOKEN from .env to sign in. Keep the configured lab running.")
        uvicorn.run(
            create_app(settings),
            host="127.0.0.1",
            port=args.port,
            access_log=False,
            server_header=False,
        )
        return
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

    runtime = None
    try:
        runtime = Runtime(settings.model_copy(update={"worker_enabled": False}))
        runtime.initialize()
        actor = runtime.auth.bearer(settings.admin_token.get_secret_value())
        if args.command == "agent-once":
            result = runtime.discovery.run(
                actor, DiscoveryInput(source_finding_id=args.source), "cli-" + secrets.token_hex(16)
            )
            print(
                json.dumps({"process_id": os.getpid(), "previous_messages": 0, **result}, indent=2)
            )
        elif args.command == "providers":
            print(json.dumps(runtime.providers.status(), indent=2))
        elif args.command == "provider-test":
            result = runtime.providers.test(actor)
            print(json.dumps(result, indent=2))
            if result["status"] == "error":
                parser.exit(1)
        elif args.command == "chatgpt-login":
            import time
            import webbrowser

            result = runtime.chatgpt.start(args.profile)
            print("Open this authorization link locally to connect your ChatGPT subscription:")
            print(result["authorization_url"])
            webbrowser.open(result["authorization_url"])
            while time.time() < result["expires_at"]:
                status = runtime.chatgpt.status()
                if not status["pending"]:
                    print(json.dumps(status, indent=2))
                    if not status["connected"]:
                        parser.exit(1)
                    break
                time.sleep(0.5)
            else:
                parser.exit(1, "ChatGPT authorization expired; start a new login.\n")
        else:
            result = doctor(runtime, settings, actor)
            print(json.dumps(result, indent=2))
            if result["status"] != "ready":
                parser.exit(1)
    except (DomainError, ValueError, RuntimeError) as exc:
        if args.command == "doctor":
            print(
                json.dumps(
                    {
                        "status": "not_ready",
                        "error": {
                            "code": exc.code
                            if isinstance(exc, DomainError)
                            else "invalid_configuration",
                            "message": "Check workspace authentication, configuration and audit integrity; sensitive details are omitted.",
                        },
                    }
                )
            )
            parser.exit(1)
        parser.exit(1, f"{exc}\n")
    finally:
        if runtime is not None:
            runtime.close()


if __name__ == "__main__":
    main()
