import asyncio

import pytest
from fastapi.testclient import TestClient

from arcloom.catalog import TESTS
from arcloom.domain import DomainError
from arcloom.evidence import EvidenceStore, sign_receipt, verify_receipt
from arcloom.lab import RunPlan, create_lab_app, execute_fixture
from arcloom.runner import validate_receipt
from tests.conftest import RUNNER


def plan(test_id="gateway-boundary", revision="r1"):
    return RunPlan(
        run_id="run_fixture",
        case_id="case_fixture",
        tenant="lab-fixture",
        test_id=test_id,
        asset_id=TESTS[test_id].asset_id,
        revision=revision,
    )


@pytest.mark.parametrize(
    "test_id,outcome",
    [
        ("gateway-boundary", "reproduced"),
        ("invoice-tenant-boundary", "reproduced"),
        ("invoice-chain", "reproduced"),
        ("export-tenant-boundary", "not_reproduced"),
        ("audit-boundary", "inconclusive"),
    ],
)
def test_actual_fixture_outcomes(test_id, outcome):
    p = plan(test_id)
    receipt = asyncio.run(execute_fixture(p, RUNNER))
    assert receipt["outcome"] == outcome
    assert receipt["request_count"] <= TESTS[test_id].request_limit
    validate_receipt(p, receipt, RUNNER)
    assert receipt["synthetic"] is True
    assert len(receipt["observations"]) > 0


@pytest.mark.parametrize(
    "test_id,outcome",
    [
        ("gateway-boundary", "not_reproduced"),
        ("invoice-tenant-boundary", "inconclusive"),
        ("invoice-chain", "not_reproduced"),
        ("export-tenant-boundary", "inconclusive"),
    ],
)
def test_patch_does_not_invent_downstream_fix(test_id, outcome):
    receipt = asyncio.run(execute_fixture(plan(test_id, "r2"), RUNNER))
    assert receipt["outcome"] == outcome


def test_lab_auth_and_no_fixture_routes():
    with TestClient(create_lab_app(RUNNER)) as c:
        assert c.get("/health").status_code == 200
        assert c.get("/internal/invoices/invoice-beta").status_code == 404
        assert c.post("/execute", json=plan().model_dump()).status_code == 401
        r = c.post(
            "/execute", json=plan().model_dump(), headers={"Authorization": "Bearer " + RUNNER}
        )
        assert r.status_code == 200
        assert verify_receipt(r.json(), RUNNER)


def test_mapped_asset_enforced_inside_runner():
    p = plan().model_copy(update={"asset_id": "invoice-api"})
    with pytest.raises(ValueError):
        asyncio.run(execute_fixture(p, RUNNER))


@pytest.mark.parametrize(
    "field,bad",
    [
        ("run_id", "run_wrong"),
        ("revision", "r2"),
        ("tenant", "other-tenant"),
        ("case_id", "wrongcase"),
        ("test_id", "audit-boundary"),
    ],
)
def test_signed_but_mismatched_receipt_rejected(field, bad):
    p = plan()
    receipt = asyncio.run(execute_fixture(p, RUNNER))
    receipt[field] = bad
    unsigned = {k: v for k, v in receipt.items() if k != "signature"}
    receipt["signature"] = sign_receipt(unsigned, RUNNER)
    with pytest.raises(DomainError) as error:
        validate_receipt(p, receipt, RUNNER)
    assert error.value.code == "runner_mismatch"


def test_invalid_signature_rejected():
    p = plan()
    receipt = asyncio.run(execute_fixture(p, RUNNER))
    receipt["signature"] = "0" * 64
    with pytest.raises(DomainError) as error:
        validate_receipt(p, receipt, RUNNER)
    assert error.value.code == "runner_integrity"


def test_empty_signed_proof_rejected():
    p = plan()
    receipt = asyncio.run(execute_fixture(p, RUNNER))
    receipt["observations"], receipt["request_count"] = [], 0
    receipt["signature"] = sign_receipt(
        {k: v for k, v in receipt.items() if k != "signature"}, RUNNER
    )
    with pytest.raises(DomainError) as err:
        validate_receipt(p, receipt, RUNNER)
    assert err.value.code == "runner_empty_proof"


def test_content_addressed_storage(tmp_path):
    e = EvidenceStore(tmp_path)
    value = {"observation": "actual", "run_id": "one"}
    first = e.put("alpha", value)
    assert e.put("alpha", dict(reversed(list(value.items())))) == first
    assert e.get("alpha", first) == value
    with pytest.raises(DomainError):
        e.get("beta", first)


@pytest.mark.parametrize("sha", ["../secret", "/etc/passwd", "a" * 63, "G" * 64, "<script>"])
def test_evidence_path_cannot_traverse(tmp_path, sha):
    with pytest.raises(DomainError):
        EvidenceStore(tmp_path).get("alpha", sha)


def test_artifact_symlink_rejected(tmp_path):
    e = EvidenceStore(tmp_path / "evidence")
    sha = e.put("alpha", {"x": 1})
    target = tmp_path / "elsewhere"
    target.write_text("secret")
    p = e._path("alpha", sha)
    p.unlink()
    p.symlink_to(target)
    with pytest.raises(DomainError) as err:
        e.get("alpha", sha)
    assert err.value.code == "evidence_integrity"


def test_oversize_evidence_rejected(tmp_path):
    with pytest.raises(DomainError) as err:
        EvidenceStore(tmp_path).put("alpha", {"data": "x" * (128 * 1024)})
    assert err.value.code == "evidence_too_large"
