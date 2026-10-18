"""Same-origin HTTP API. The browser never receives graph, runner or model secrets."""

import json
import logging
import secrets
import time
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from arcloom import __version__
from arcloom.auth import require
from arcloom.config import Settings
from arcloom.domain import (
    Actor,
    ApprovalInput,
    DiscoveryInput,
    DomainError,
    LoginInput,
    MemberInput,
    ReportInput,
    ReviewInput,
    RevisionInput,
    Role,
    ScopeInput,
    State,
)
from arcloom.graph import FOLLOWUPS_CYPHER
from arcloom.graph_hosting import GraphTargetInput, hosting_status, save_target
from arcloom.handoff import build_handoff
from arcloom.providers import ChatGPTProfileInput, ProviderInput
from arcloom.runtime import Runtime
from arcloom.storage import canonical, digest

logger = logging.getLogger("arcloom.http")
COOKIE = "arcloom_session"


class RequestBoundary:
    """Bound request bytes before validation, add trace IDs and conservative browser headers."""

    def __init__(self, app, allowed_origins: list[str]):
        self.app, self.allowed_origins = app, set(allowed_origins)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        trace_id = secrets.token_hex(12)
        scope.setdefault("state", {})["trace_id"] = trace_id
        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        method, path = scope["method"], scope["path"]
        mutation = method not in {"GET", "HEAD", "OPTIONS"}
        status = 500

        async def secure_send(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                values = list(message.get("headers", []))
                values += [
                    (b"x-request-id", trace_id.encode()),
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"x-frame-options", b"DENY"),
                    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
                    (
                        b"content-security-policy",
                        b"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
                    ),
                ]
                if path.startswith("/api"):
                    values += [(b"cache-control", b"no-store")]
                message["headers"] = values
            await send(message)

        async def reject(code, detail, status_code):
            await JSONResponse(
                {"error": {"code": code, "message": detail}, "request_id": trace_id}, status_code
            )(scope, receive, secure_send)

        if mutation:
            origin = headers.get(b"origin")
            if origin and origin.decode("latin1") not in self.allowed_origins:
                return await reject("origin_denied", "Cross-origin mutations are not allowed", 403)
            content = bytearray()
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                content.extend(message.get("body", b""))
                if len(content) > 65536:
                    return await reject("body_too_large", "Request body exceeds 64 KiB", 413)
                if not message.get("more_body", False):
                    break
            delivered = False

            async def buffered_receive():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": bytes(content), "more_body": False}
                return await receive()

            downstream_receive = buffered_receive
        else:
            downstream_receive = receive
        started = time.monotonic()
        try:
            await self.app(scope, downstream_receive, secure_send)
        finally:
            # Never log bodies, headers, query strings, model prompts or credentials.
            logger.info(
                canonical(
                    {
                        "event": "http.request",
                        "request_id": trace_id,
                        "method": method,
                        "status": status,
                        "duration_ms": round((time.monotonic() - started) * 1000, 2),
                    }
                )
            )


def create_app(settings: Settings | None = None, runtime: Runtime | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        rt = runtime or Runtime(settings)
        app.state.runtime = rt
        rt.initialize()
        if settings.worker_enabled:
            rt.worker.start()
        try:
            yield
        finally:
            rt.close()

    app = FastAPI(
        title="Arcloom",
        docs_url=None,
        redoc_url=None,
        version=__version__,
        lifespan=lifespan,
        description="Evidence-backed security memory for a controlled synthetic lab.",
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    app.add_middleware(RequestBoundary, allowed_origins=settings.allowed_origins)

    def rt(request: Request) -> Runtime:
        return request.app.state.runtime

    def actor(request: Request) -> Actor:
        current = rt(request)
        header = request.headers.get("authorization", "")
        if header:
            if not header.startswith("Bearer "):
                raise DomainError("unauthorized", "Use a Bearer access token", 401)
            who = current.auth.bearer(header[7:])
        else:
            who = current.auth.session(
                request.cookies.get(COOKIE, ""),
                request.headers.get("x-csrf-token"),
                mutate=request.method not in {"GET", "HEAD", "OPTIONS"},
            )
        request.state.actor = who
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            current.store.limit("mutate_" + who.id, 120, 60)
        return who

    Person = Annotated[Actor, Depends(actor)]
    Service = Annotated[Runtime, Depends(rt)]
    Key = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=100)]

    @app.exception_handler(DomainError)
    async def domain_error(request: Request, error: DomainError):
        who = getattr(request.state, "actor", None)
        if who and request.method not in {"GET", "HEAD"}:
            with rt(request).store.transaction() as conn:
                rt(request).store.event(
                    conn,
                    who.tenant,
                    "request.denied",
                    who.id,
                    "api",
                    {"code": error.code, "request_id": request.state.trace_id},
                )
        return JSONResponse(
            {
                "error": {"code": error.code, "message": error.message},
                "request_id": request.state.trace_id,
            },
            status_code=error.status,
            headers={"Retry-After": "60"} if error.status == 429 else None,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError):
        # Pydantic's default input echo could disclose access tokens or submitted reports.
        fields = [{"location": list(e["loc"]), "type": e["type"]} for e in error.errors()]
        return JSONResponse(
            {
                "error": {
                    "code": "validation",
                    "message": "Request validation failed",
                    "fields": fields,
                },
                "request_id": request.state.trace_id,
            },
            status_code=422,
        )

    @app.get("/health/live")
    def live():
        return {"status": "alive", "version": __version__}

    @app.get("/health/ready")
    def ready(service: Service):
        try:
            service.projector.require_current(settings.tenant)
        except DomainError:
            return JSONResponse({"status": "not_ready", "graph": "unavailable_or_pending"}, 503)
        return {
            "status": "ready",
            "graph": "FalkorDB",
            "provider": service.providers.snapshot().provider,
        }

    @app.post("/api/auth/login")
    def login(value: LoginInput, request: Request, response: Response, service: Service):
        ip = request.client.host if request.client else "unknown"
        service.store.limit("login_" + digest(ip), 12, 60)
        who, session, csrf = service.auth.login(value.token)
        response.set_cookie(
            COOKIE,
            session,
            max_age=settings.session_seconds,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="strict",
            path="/api",
        )
        return {"actor": {"id": who.id, "tenant": who.tenant, "role": who.role}, "csrf": csrf}

    @app.get("/api/auth/session")
    def session(who: Person, service: Service):
        return {
            "actor": {"id": who.id, "tenant": who.tenant, "role": who.role},
            "csrf": service.auth.csrf_for_hash(who.session_hash) if who.session_hash else None,
        }

    @app.post("/api/auth/logout", status_code=204)
    def logout(response: Response, who: Person, service: Service):
        service.auth.logout(who)
        response.delete_cookie(COOKIE, path="/api")

    @app.get("/api/dashboard")
    def dashboard(who: Person, service: Service):
        return service.dashboard(who)

    @app.get("/api/catalog")
    def catalog(who: Person, service: Service):
        return service.catalog()

    @app.get("/api/providers")
    def providers(who: Person, service: Service):
        require(who, Role.ADMIN)
        return service.providers.status()

    @app.get("/api/graph-hosting")
    def graph_hosting(who: Person, service: Service):
        require(who, Role.ADMIN)
        return hosting_status(service.settings)

    @app.post("/api/graph-hosting/target")
    def stage_graph_target(value: GraphTargetInput, who: Person, service: Service):
        require(who, Role.ADMIN)
        result = save_target(service.settings, value)
        service.providers.audit(who, "graph.connection_staged", {"ssl": value.ssl})
        return result

    @app.post("/api/providers")
    def configure_provider(value: ProviderInput, who: Person, service: Service):
        return service.providers.configure(who, **value.model_dump())

    @app.post("/api/providers/test")
    def test_provider(who: Person, service: Service):
        return service.providers.test(who)

    @app.post("/api/providers/chatgpt/start")
    def start_chatgpt(value: ChatGPTProfileInput, who: Person, service: Service):
        require(who, Role.ADMIN)
        service.store.limit("chatgpt_start_" + who.tenant, 5, 60)
        result = service.chatgpt.start(value.profile_id)
        service.providers.audit(who, "provider.chatgpt_login_started", {"provider": "chatgpt"})
        return result

    @app.get("/api/providers/chatgpt/models")
    def chatgpt_models(
        who: Person,
        service: Service,
        profile_id: str | None = Query(None, max_length=80, pattern=r"^[A-Za-z0-9_-]+$"),
    ):
        require(who, Role.ADMIN)
        service.store.limit("chatgpt_models_" + who.tenant, 10, 60)
        return {
            "items": service.chatgpt.models(
                profile_id or service.providers.snapshot().chatgpt_profile_id or None
            )
        }

    @app.post("/api/providers/chatgpt/disconnect")
    def disconnect_chatgpt(value: ChatGPTProfileInput, who: Person, service: Service):
        require(who, Role.ADMIN)
        result = service.chatgpt.disconnect(value.profile_id)
        service.providers.audit(who, "provider.chatgpt_disconnected", {"provider": "chatgpt"})
        return result

    @app.get("/api/investigations")
    def cases(
        who: Person,
        service: Service,
        q: str = Query("", max_length=100),
        state: State | None = None,
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0, le=10000),
    ):
        return service.cases.list(who, limit=limit, offset=offset, state=state, search=q)

    @app.get("/api/investigations/{case_id}")
    def detail(case_id: str, who: Person, service: Service):
        return service.cases.get(who, case_id)

    @app.post("/api/reports", status_code=201)
    def report(value: ReportInput, key: Key, who: Person, service: Service):
        return service.cases.submit(who, value, key)

    @app.post("/api/investigations/{case_id}/approve")
    def approve(case_id: str, value: ApprovalInput, key: Key, who: Person, service: Service):
        return service.cases.approve(who, case_id, value, key)

    @app.post("/api/investigations/{case_id}/review")
    def review(case_id: str, value: ReviewInput, key: Key, who: Person, service: Service):
        return service.cases.review(who, case_id, value, key)

    @app.post("/api/investigations/{case_id}/retry")
    def retry(case_id: str, key: Key, who: Person, service: Service):
        return service.cases.retry(who, case_id, key)

    @app.post("/api/findings/{finding_id}/revalidate", status_code=201)
    def revalidate(finding_id: str, key: Key, who: Person, service: Service):
        return service.cases.revalidate(who, finding_id, key)

    @app.post("/api/agents/discover")
    def discover(value: DiscoveryInput, key: Key, who: Person, service: Service):
        return service.discovery.run(who, value, key)

    @app.get("/api/agents")
    def agents(who: Person, service: Service, limit: int = Query(50, ge=1, le=100)):
        items = service.store.all(
            "SELECT a.*, (SELECT e.payload FROM events e WHERE e.tenant=a.tenant "
            "AND e.object_id=a.id AND e.kind='agent.context_finished' ORDER BY e.seq DESC LIMIT 1) "
            "AS finish_payload FROM agent_sessions a WHERE tenant=? ORDER BY created_at DESC LIMIT ?",
            (who.tenant, limit),
        )
        return {
            "items": [
                {
                    **{k: v for k, v in a.items() if k != "finish_payload"},
                    "candidates": json.loads(a["candidates"]),
                    "previous_messages": 0,
                    "decision": json.loads(a["finish_payload"] or "{}").get("decision"),
                }
                for a in items
            ]
        }

    @app.get("/api/memory/handoff")
    def handoff(who: Person, service: Service):
        service.store.limit("handoff_" + who.id, 30, 60)
        return build_handoff(service, who)

    @app.get("/api/memory")
    def memory(who: Person, service: Service):
        service.projector.require_current(who.tenant)
        return {
            **service.graph.view(who.tenant),
            "selection_query": FOLLOWUPS_CYPHER,
            "warning": "A connected path is a hypothesis, not proof of a working chain.",
        }

    def analyze(who: Actor, service: Runtime, operation):
        service.store.limit("analysis_" + who.id, 30, 60)
        if service.intelligence is None:
            raise DomainError("graph_unavailable", "Native FalkorDB analysis is unavailable", 503)
        service.projector.require_current(who.tenant)

        def head():
            return service.store.one(
                "SELECT coalesce(max(seq),0) AS seq FROM events WHERE tenant=?", (who.tenant,)
            )["seq"]

        before = head()
        revision = service.store.one("SELECT revision FROM tenants WHERE id=?", (who.tenant,))[
            "revision"
        ]
        result = operation(service.intelligence, revision)
        if head() != before:
            raise DomainError(
                "analysis_changed", "Workspace changed during analysis; refresh and try again", 409
            )
        return {**result, "event_head": before}

    @app.get("/api/memory/search")
    def search_memory(who: Person, service: Service, q: str = Query(min_length=1, max_length=100)):
        return analyze(who, service, lambda tool, rev: tool.search(who.tenant, q))

    @app.get("/api/memory/withdrawal")
    def withdrawal(
        who: Person, service: Service, finding_id: str = Query(min_length=1, max_length=100)
    ):
        return analyze(who, service, lambda tool, rev: tool.withdraw(who.tenant, rev, finding_id))

    @app.get("/api/memory/diagnostics")
    def diagnostics(who: Person, service: Service):
        return analyze(who, service, lambda tool, rev: tool.diagnostics(who.tenant, rev))

    @app.get("/api/evidence/{artifact_hash}")
    def evidence(artifact_hash: str, who: Person, service: Service):
        owned = service.store.one(
            "SELECT id FROM runs WHERE tenant=? AND evidence_hash=?", (who.tenant, artifact_hash)
        )
        if not owned:
            raise DomainError("not_found", "Evidence not found", 404)
        return {
            "sha256": artifact_hash,
            "integrity": "verified",
            "receipt": service.evidence.get(who.tenant, artifact_hash),
        }

    @app.get("/api/investigations/{case_id}/export")
    def export_case(case_id: str, who: Person, service: Service):
        case = service.cases.get(who, case_id)
        for run in case["runs"]:
            service.evidence.get(who.tenant, run["evidence_hash"])
        return JSONResponse(
            {"format": "arcloom-investigation-v1", "synthetic": True, "investigation": case},
            headers={"Content-Disposition": 'attachment; filename="arcloom-investigation.json"'},
        )

    @app.post("/api/revisions")
    def revision(value: RevisionInput, key: Key, who: Person, service: Service):
        return service.cases.revise(who, value.revision, value.reason, key)

    @app.post("/api/scope")
    def scope(value: ScopeInput, key: Key, who: Person, service: Service):
        return service.cases.set_scope(who, value.enabled, value.reason, key)

    @app.get("/api/events")
    def events(
        who: Person,
        service: Service,
        after: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=200),
    ):
        rows = service.store.all(
            "SELECT * FROM events WHERE tenant=? AND seq>? ORDER BY seq LIMIT ?",
            (who.tenant, after, limit),
        )
        return {
            "items": [{**r, "payload": json.loads(r["payload"])} for r in rows],
            "cursor": rows[-1]["seq"] if rows else after,
            "has_more": len(rows) == limit,
        }

    @app.get("/api/audit/verify")
    def audit(who: Person, service: Service):
        return service.store.verify_audit(who.tenant)

    @app.get("/api/members")
    def members(who: Person, service: Service):
        require(who, Role.ADMIN)
        return {
            "items": service.store.all(
                "SELECT id,name,role,active,created_at FROM members WHERE tenant=? ORDER BY created_at",
                (who.tenant,),
            )
        }

    @app.post("/api/members", status_code=201)
    def add_member(value: MemberInput, who: Person, service: Service):
        return service.auth.add_member(who, value.name, value.role)

    @app.delete("/api/members/{member_id}", status_code=204)
    def revoke_member(member_id: str, who: Person, service: Service):
        service.auth.revoke_member(who, member_id)

    if settings.web_dist.is_dir():
        app.mount("/", StaticFiles(directory=settings.web_dist, html=True), name="web")
    else:

        @app.get("/")
        def index():
            return {
                "application": "Arcloom",
                "frontend": "Build the frontend with npm --prefix apps/web ci and npm --prefix apps/web run build, then restart.",
            }

    return app
