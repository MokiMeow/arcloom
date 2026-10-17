from arcloom.catalog import TESTS
from arcloom.domain import ApprovalInput, ReportInput, ReviewInput
from arcloom.storage import new_id


def report(runtime, owner, test_id="gateway-boundary", key=None):
    t = TESTS[test_id]
    return runtime.cases.submit(
        owner,
        ReportInput(
            title=t.title,
            description="Synthetic report with a reproducible observation in the lab.",
            researcher="Mohith and teammate",
            asset_id=t.asset_id,
            test_id=test_id,
        ),
        key or new_id("request"),
    )


def observe(runtime, owner, case_id):
    runtime.cases.approve(
        owner,
        case_id,
        ApprovalInput(
            decision="approve",
            reason="Authorized synthetic fixture within the registered assessment.",
        ),
        new_id("request"),
    )
    runtime.worker.tick()
    return runtime.cases.get(owner, case_id)


def confirm(runtime, owner, test_id="gateway-boundary"):
    submitted = report(runtime, owner, test_id)
    cid = submitted["case_id"]
    case = observe(runtime, owner, cid)
    assert case["state"] == "awaiting_review", case
    result = runtime.cases.review(
        owner,
        cid,
        ReviewInput(
            decision="accept", reason="Checked the recorded assertions and evidence integrity."
        ),
        new_id("request"),
    )
    runtime.projector.require_current(owner.tenant)
    return result
