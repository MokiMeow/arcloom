"""The control plane can only invoke the fixed, authenticated lab origin."""

from typing import Protocol

import httpx

from arcloom.catalog import TESTS
from arcloom.config import Settings
from arcloom.domain import DomainError, Outcome
from arcloom.evidence import verify_receipt
from arcloom.http_boundary import DeadlineTransport, bounded_json
from arcloom.lab import RunPlan


class RunnerPort(Protocol):
    def execute(self, plan: RunPlan) -> dict: ...


def validate_receipt(plan: RunPlan, receipt: dict, secret: str) -> None:
    if not verify_receipt(receipt, secret):
        raise DomainError("runner_integrity", "The runner receipt signature is invalid", 502)
    for key, value in plan.model_dump().items():
        if receipt.get(key) != value:
            raise DomainError(
                "runner_mismatch", "The runner receipt does not match the approved execution", 502
            )
    observations = receipt.get("observations")
    if (
        not isinstance(observations, list)
        or len(observations) > TESTS[plan.test_id].request_limit
        or receipt.get("request_count") != len(observations)
        or receipt.get("outcome") not in set(Outcome)
        or receipt.get("environment") != "synthetic-asgi-lab"
        or receipt.get("synthetic") is not True
    ):
        raise DomainError(
            "runner_contract", "The runner receipt violates the execution contract", 502
        )
    if receipt["outcome"] == Outcome.REPRODUCED and not observations:
        raise DomainError("runner_empty_proof", "A reproduced finding requires observations", 502)


class HttpRunner:
    def __init__(self, settings: Settings):
        self.settings = settings

    def execute(self, plan: RunPlan) -> dict:
        secret = self.settings.runner_secret.get_secret_value()
        if len(secret) < 32:
            raise DomainError(
                "runner_not_configured", "The lab runner secret is not configured", 503
            )
        try:
            with httpx.Client(
                timeout=self.settings.lab_timeout_seconds,
                follow_redirects=False,
                trust_env=False,
                transport=DeadlineTransport(
                    self.settings.lab_timeout_seconds, error_prefix="runner"
                ),
            ) as client:
                receipt = bounded_json(
                    client,
                    self.settings.lab_url + "/execute",
                    body=plan.model_dump(),
                    headers={"Authorization": f"Bearer {secret}"},
                    seconds=self.settings.lab_timeout_seconds,
                    error_prefix="runner",
                )
        except (httpx.HTTPError, ValueError) as exc:
            raise DomainError(
                "runner_unavailable", "The bounded lab test did not complete reliably", 503
            ) from exc
        validate_receipt(plan, receipt, secret)
        return receipt
