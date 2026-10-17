"""Deliberately vulnerable, synthetic ASGI lab and bounded test runner.

The fixture routes are not mounted on the runner's HTTP server. They are exercised
through an in-process ASGI transport inside the isolated runner container. No
fixture accepts arbitrary network targets, commands, scripts or real credentials.
"""

import asyncio
import hmac
import os
import time
from typing import Literal

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from arcloom.catalog import TESTS
from arcloom.domain import Identifier, Outcome, StrictModel
from arcloom.evidence import sign_receipt
from arcloom.storage import canonical, digest


class RunPlan(StrictModel):
    run_id: Identifier
    case_id: Identifier
    tenant: Identifier
    test_id: Identifier
    revision: Literal["r1", "r2"]
    asset_id: Identifier


fixtures = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@fixtures.get("/snapshots/{revision}/gateway/routes")
def gateway(revision: Literal["r1", "r2"], x_demo_routing_context: str | None = Header(None)):
    # Deliberate lab flaw: r1 trusts an unauthenticated routing-context marker.
    if revision == "r1" and x_demo_routing_context == "edge":
        return {"route_capability": "synthetic-internal-route", "service": "invoice-api"}
    return JSONResponse({"error": "unauthorized"}, status_code=401)


@fixtures.get("/snapshots/{revision}/invoices/{invoice_id}")
def invoice(
    revision: Literal["r1", "r2"],
    invoice_id: str,
    authorization: str | None = Header(None),
    x_route_capability: str | None = Header(None),
):
    if (
        x_route_capability != "synthetic-internal-route"
        or authorization != "Bearer synthetic-tenant-alpha"
    ):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    records = {
        "invoice-alpha": {
            "id": "invoice-alpha",
            "tenant": "alpha",
            "amount": 120,
            "synthetic": True,
        },
        "invoice-beta": {"id": "invoice-beta", "tenant": "beta", "amount": 840, "synthetic": True},
    }
    record = records.get(invoice_id)
    if record is None:
        return JSONResponse({"error": "not_found"}, status_code=404)
    # Deliberate lab flaw: r1 omits the tenant ownership comparison.
    if revision == "r2" and record["tenant"] != "alpha":
        return JSONResponse({"error": "forbidden"}, status_code=403)
    return record


@fixtures.get("/snapshots/{revision}/exports/export-beta")
def export(revision: Literal["r1", "r2"]):
    return JSONResponse({"error": "forbidden", "synthetic": True}, status_code=403)


@fixtures.get("/snapshots/{revision}/audit")
def audit_fixture(revision: Literal["r1", "r2"]):
    return JSONResponse({"error": "dependency_unavailable", "synthetic": True}, status_code=503)


async def execute_fixture(plan: RunPlan, secret: str) -> dict:
    definition = TESTS.get(plan.test_id)
    if definition is None or definition.asset_id != plan.asset_id:
        raise ValueError("Test and asset are not registered together")
    observations: list[dict] = []
    started = time.time()
    prefix = f"/snapshots/{plan.revision}"

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fixtures),
        base_url="http://synthetic.local",
        follow_redirects=False,
    ) as client:

        async def request(path: str, assertion: str, **headers) -> tuple[int, dict]:
            if len(observations) >= definition.request_limit:
                raise RuntimeError("Request budget exhausted")
            response = await client.get(prefix + path, headers=headers)
            body = response.json()
            # Header credentials are deliberately excluded from stored observations.
            observations.append(
                {
                    "path": path,
                    "method": "GET",
                    "status": response.status_code,
                    "assertion": assertion,
                    "body_sha256": digest(canonical(body)),
                    "body": {k: v for k, v in body.items() if k != "route_capability"},
                }
            )
            return response.status_code, body

        if plan.test_id == "audit-boundary":
            await request("/audit", "An available dependency is required to evaluate authorization")
            outcome, conclusion = (
                Outcome.INCONCLUSIVE,
                "Dependency returned 503; no authorization conclusion is supported.",
            )
        elif plan.test_id == "gateway-boundary":
            control, _ = await request(
                "/gateway/routes", "Unauthenticated baseline must be rejected"
            )
            status, body = await request(
                "/gateway/routes",
                "Unverified context must not grant internal access",
                **{"X-Demo-Routing-Context": "edge"},
            )
            if control != 401:
                outcome, conclusion = (
                    Outcome.INCONCLUSIVE,
                    "The control request did not behave as expected.",
                )
            elif status == 200 and body.get("route_capability") == "synthetic-internal-route":
                outcome, conclusion = (
                    Outcome.REPRODUCED,
                    "A routing context crossed the gateway boundary without authentication.",
                )
            elif status in {401, 403}:
                outcome, conclusion = (
                    Outcome.NOT_REPRODUCED,
                    "Both unauthorized requests were denied in this revision.",
                )
            else:
                outcome, conclusion = (
                    Outcome.INCONCLUSIVE,
                    "Unexpected response; more evidence is required.",
                )
        else:
            status, body = await request(
                "/gateway/routes",
                "Acquire the prerequisite within this same lab revision",
                **{"X-Demo-Routing-Context": "edge"},
            )
            if status != 200 or body.get("route_capability") != "synthetic-internal-route":
                if plan.test_id == "invoice-chain":
                    outcome, conclusion = (
                        Outcome.NOT_REPRODUCED,
                        "The chain's first step is blocked at the gateway.",
                    )
                else:
                    outcome, conclusion = (
                        Outcome.INCONCLUSIVE,
                        "The prerequisite is blocked; this does not prove the downstream service is fixed.",
                    )
            elif plan.test_id == "export-tenant-boundary":
                status, _ = await request(
                    "/exports/export-beta", "A cross-tenant export must be denied"
                )
                outcome = Outcome.NOT_REPRODUCED if status == 403 else Outcome.INCONCLUSIVE
                conclusion = (
                    "Export isolation held for the tested identity."
                    if status == 403
                    else "Unexpected export response."
                )
            else:
                headers = {
                    "Authorization": "Bearer synthetic-tenant-alpha",
                    "X-Route-Capability": body["route_capability"],
                }
                own_status, own_body = await request(
                    "/invoices/invoice-alpha", "Same-tenant control should succeed", **headers
                )
                cross_status, cross_body = await request(
                    "/invoices/invoice-beta",
                    "A tenant-alpha principal must not read a tenant-beta invoice",
                    **headers,
                )
                if (
                    own_status == 200
                    and own_body.get("tenant") == "alpha"
                    and cross_status == 200
                    and cross_body.get("tenant") == "beta"
                ):
                    outcome = Outcome.REPRODUCED
                    conclusion = (
                        "Gateway access and a cross-tenant read succeeded in one revision and one identity context."
                        if plan.test_id == "invoice-chain"
                        else "A synthetic tenant-alpha principal read a tenant-beta invoice."
                    )
                elif own_status == 200 and cross_status in {401, 403}:
                    outcome, conclusion = (
                        Outcome.NOT_REPRODUCED,
                        "The cross-tenant read was denied.",
                    )
                else:
                    outcome, conclusion = (
                        Outcome.INCONCLUSIVE,
                        "The control or target response was unexpected.",
                    )

    receipt = {
        **plan.model_dump(),
        "outcome": outcome,
        "conclusion": conclusion,
        "observations": observations,
        "request_count": len(observations),
        "request_limit": definition.request_limit,
        "started_at": started,
        "finished_at": time.time(),
        "environment": "synthetic-asgi-lab",
        "identity": "synthetic-tenant-alpha",
        "runner_version": "1",
        "synthetic": True,
    }
    return {**receipt, "signature": sign_receipt(receipt, secret)}


def create_lab_app(secret: str | None = None) -> FastAPI:
    runner_secret = secret if secret is not None else os.environ.get("ARCLOOM_RUNNER_SECRET", "")
    if len(runner_secret) < 32:
        raise RuntimeError("ARCLOOM_RUNNER_SECRET must contain at least 32 random characters")
    app = FastAPI(
        title="Arcloom isolated lab runner", docs_url=None, redoc_url=None, openapi_url=None
    )

    @app.get("/health")
    def health():
        return {"status": "ok", "environment": "synthetic-asgi-lab"}

    @app.post("/execute")
    async def execute(plan: RunPlan, authorization: str | None = Header(None)):
        if not hmac.compare_digest(authorization or "", f"Bearer {runner_secret}"):
            raise HTTPException(401, "Runner authentication required")
        if plan.test_id not in TESTS or TESTS[plan.test_id].asset_id != plan.asset_id:
            raise HTTPException(403, "Unregistered test or asset")
        try:
            return await asyncio.wait_for(execute_fixture(plan, runner_secret), timeout=5)
        except TimeoutError as exc:
            raise HTTPException(504, "Bounded lab execution timed out") from exc

    return app
