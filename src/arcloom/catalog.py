"""A reviewed catalog of read-only tests against our own deliberately vulnerable lab.

There is no arbitrary shell, generated Python, raw Cypher or caller-supplied URL.
Prerequisites are stored in FalkorDB and joined with verified capabilities.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TestDefinition:
    id: str
    title: str
    asset_id: str
    requirements: tuple[str, ...]
    enables: tuple[str, ...]
    impact: int
    request_limit: int
    description: str


ASSETS = {
    "gateway": {"title": "Edge gateway", "kind": "gateway", "criticality": "high"},
    "invoice-api": {"title": "Invoice service", "kind": "service", "criticality": "high"},
    "export-api": {"title": "Export service", "kind": "service", "criticality": "medium"},
    "audit-api": {"title": "Audit service", "kind": "service", "criticality": "medium"},
}

TESTS = {
    t.id: t
    for t in (
        TestDefinition(
            "gateway-boundary",
            "Gateway trusts an unverified routing context",
            "gateway",
            (),
            ("internal-route-access",),
            90,
            2,
            "Compare unauthenticated control with a fixed synthetic routing-context request.",
        ),
        TestDefinition(
            "invoice-tenant-boundary",
            "Invoice service misses a tenant ownership check",
            "invoice-api",
            ("internal-route-access",),
            ("cross-tenant-invoice-read",),
            85,
            3,
            "Use synthetic identities to compare same-tenant and cross-tenant invoice reads.",
        ),
        TestDefinition(
            "export-tenant-boundary",
            "Check whether export isolation shares the weakness",
            "export-api",
            ("internal-route-access",),
            (),
            55,
            2,
            "A useful negative control: this synthetic service enforces tenant ownership.",
        ),
        TestDefinition(
            "invoice-chain",
            "Verify the gateway-to-invoice chain in one revision",
            "invoice-api",
            ("internal-route-access", "cross-tenant-invoice-read"),
            ("verified-invoice-chain",),
            95,
            3,
            "Both steps must succeed sequentially under one synthetic identity and revision.",
        ),
        TestDefinition(
            "audit-boundary",
            "Investigate the adjacent audit authorization boundary",
            "audit-api",
            ("internal-route-access",),
            (),
            30,
            1,
            "This synthetic dependency is unavailable; the correct outcome is inconclusive.",
        ),
    )
}

REVISIONS = {
    "r1": "Seeded weaknesses present",
    "r2": "Patched gateway and invoice authorization",
}
