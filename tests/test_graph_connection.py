"""Managed graph credentials must reach the real FalkorDB client."""

from unittest.mock import patch

from arcloom.config import Settings
from arcloom.graph import FalkorGraph


def test_cloud_acl_username_reaches_graph_client():
    settings = Settings(
        _env_file=None,
        graph_host="example.falkordb.cloud",
        graph_port=12345,
        graph_username="falkordb",
        graph_password="private-test-password",
        graph_ssl=True,
    )
    with patch("falkordb.FalkorDB") as client:
        graph = FalkorGraph(settings)
        graph._database()
    assert client.call_args.kwargs["username"] == "falkordb"
    assert client.call_args.kwargs["ssl"] is True
    assert client.call_args.kwargs["port"] == 12345


def test_local_graph_keeps_default_user_authentication():
    with patch("falkordb.FalkorDB") as client:
        FalkorGraph(Settings(_env_file=None))._database()
    assert client.call_args.kwargs["username"] is None
