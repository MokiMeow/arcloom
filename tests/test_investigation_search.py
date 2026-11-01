import pytest

from arcloom.catalog import TESTS
from arcloom.domain import Actor, ReportInput, Role
from arcloom.storage import new_id


def submit(runtime, actor, test_id="gateway-boundary", title="A controlled observation"):
    return runtime.cases.submit(
        actor,
        ReportInput(
            title=title,
            description="A reproducible observation in the registered synthetic lab.",
            researcher="Search test researcher",
            asset_id=TESTS[test_id].asset_id,
            test_id=test_id,
        ),
        new_id("request"),
    )["case_id"]


@pytest.mark.parametrize("field", ["title", "id", "asset_id", "test_id"])
def test_search_finds_each_advertised_investigation_field(runtime, owner, field):
    case_id = submit(runtime, owner)
    case = runtime.cases.get(owner, case_id)

    result = runtime.cases.list(owner, search=case[field])

    assert result["total"] == 1
    assert [item["id"] for item in result["items"]] == [case_id]


@pytest.mark.parametrize("query", ["100%", "percent_", "folder\\"])
def test_search_treats_like_wildcards_and_escape_as_literal_text(runtime, owner, query):
    case_id = submit(runtime, owner, title="100% percent_ folder\\ observation")
    submit(runtime, owner, "invoice-tenant-boundary", "100x percentx folderx observation")

    result = runtime.cases.list(owner, search=query)

    assert result["total"] == 1
    assert [item["id"] for item in result["items"]] == [case_id]
    assert runtime.cases.list(owner, search="' OR 1=1 --")["total"] == 0


def test_asset_and_test_search_keep_tenant_isolation_and_pagination(runtime, owner):
    case_id = submit(runtime, owner)
    other = Actor("other_owner", "other_workspace", Role.ADMIN)
    with runtime.store.transaction() as conn:
        conn.execute(
            "INSERT INTO tenants(id,revision,scope_enabled,created_at) VALUES(?,?,1,?)",
            (
                other.tenant,
                "r1",
                runtime.store.one("SELECT created_at FROM tenants WHERE id=?", (owner.tenant,))[
                    "created_at"
                ],
            ),
        )
    other_case_id = submit(runtime, other)

    for query in ("gateway", "gateway-boundary"):
        result = runtime.cases.list(owner, search=query, limit=1)
        assert result["total"] == 1
        assert [item["id"] for item in result["items"]] == [case_id]
        assert other_case_id not in {item["id"] for item in result["items"]}
        assert runtime.cases.list(owner, search=query, offset=1)["items"] == []
