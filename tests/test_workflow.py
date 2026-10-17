from arcloom.domain import DiscoveryInput, ReviewInput
from arcloom.storage import new_id
from tests.helpers import confirm, observe


def test_full_loop(runtime, owner):
    first = confirm(runtime, owner)
    assert first["finding_id"]
    next_step = runtime.discovery.run(owner, DiscoveryInput(), new_id("request"))
    assert next_step["status"] == "proposed"
    assert next_step["selection"]["test_id"] == "invoice-tenant-boundary"
    assert next_step["tool"]["previous_messages"] == 0
    cid = next_step["case_id"]
    assert observe(runtime, owner, cid)["runs"][0]["outcome"] == "reproduced"
    second = runtime.cases.review(
        owner,
        cid,
        ReviewInput(
            decision="accept",
            reason="Independent cross-tenant check verified in the synthetic lab.",
        ),
        new_id("request"),
    )
    assert second["finding_id"] != first["finding_id"]
    assert runtime.dashboard(owner)["verified_current"] == 2
    chain = runtime.discovery.run(owner, DiscoveryInput(), new_id("request"))
    assert chain["selection"]["test_id"] == "invoice-chain"
    assert runtime.store.verify_audit(owner.tenant)["valid"]
