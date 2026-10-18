import pytest

from arcloom.config import Settings
from arcloom.domain import DomainError
from arcloom.graph import FalkorGraph
from arcloom.intelligence import SEARCH, GraphIntelligence


def test_search_recovers_when_index_preparation_failed_at_startup(monkeypatch):
    graph = FalkorGraph(Settings(_env_file=None))
    tool = GraphIntelligence(graph)
    available, indexed = False, set()

    def query(tenant, cypher, params=None, readonly=False):
        if not available:
            raise DomainError("graph_unavailable", "Temporary graph outage", 503)
        if cypher.startswith("CALL db.indexes"):
            return [["Entity", {field: ["FULLTEXT"] for field in indexed}]]
        if cypher.startswith("CALL db.idx.fulltext.createNodeIndex"):
            indexed.add("title" if "'title'" in cypher else "description")
            return []
        if cypher == SEARCH:
            if indexed != {"title", "description"}:
                raise DomainError("graph_unavailable", "Full-text index does not exist", 503)
            return [["invoice-api", "Asset", '{"title":"Invoice service"}', 1.0]]
        raise AssertionError(cypher)

    monkeypatch.setattr(graph, "_query", query)
    with pytest.raises(DomainError):
        tool.prepare("tenant")
    available = True

    result = tool.search("tenant", "invoice")

    assert result["items"][0]["id"] == "invoice-api"
    assert result["engine"] == "FalkorDB full-text index"
