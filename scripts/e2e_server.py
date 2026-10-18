"""Disposable E2E workspace: actual FalkorDB + separate authenticated HTTP lab.

Test credentials are fixed and intentionally public. Never deploy this harness.
Set ARCLOOM_TEST_GRAPH=server and ARCLOOM_TEST_GRAPH_HOST/PORT/PASSWORD
to use a separately running FalkorDB, including from native Windows.
"""

import multiprocessing
import os
import tempfile
from contextlib import suppress
from pathlib import Path
from uuid import uuid4

import uvicorn

from arcloom.api import create_app
from arcloom.config import Settings
from arcloom.graph import FalkorGraph
from arcloom.lab import create_lab_app

TOKEN = "arcloom-e2e-only-" + "t" * 48
SECRET = "arcloom-e2e-runner-" + "s" * 48


def serve_lab():
    uvicorn.run(create_lab_app(SECRET), host="127.0.0.1", port=9001, access_log=False)


def main():
    with tempfile.TemporaryDirectory(prefix="arcloom-e2e-") as directory:
        lab = multiprocessing.get_context("spawn").Process(target=serve_lab)
        lab.start()
        settings = None
        try:
            settings = Settings(
                _env_file=None,
                data_dir=Path(directory),
                graph_mode=os.environ.get("ARCLOOM_TEST_GRAPH", "lite"),
                graph_host=os.environ.get("ARCLOOM_TEST_GRAPH_HOST", "127.0.0.1"),
                graph_port=int(os.environ.get("ARCLOOM_TEST_GRAPH_PORT", "6379")),
                graph_password=os.environ.get("ARCLOOM_TEST_GRAPH_PASSWORD", ""),
                graph_prefix="e2e_" + uuid4().hex,
                admin_token=TOKEN,
                runner_secret=SECRET,
                provider="deterministic",
                tenant="e2e",
                worker_poll_seconds=0.15,
            )
            uvicorn.run(create_app(settings), host="127.0.0.1", port=8000, access_log=False)
        finally:
            lab.terminate()
            lab.join(timeout=10)
            if lab.is_alive():
                lab.kill()
                lab.join()
            # A server-backed test run must not retain its disposable workspace.
            if settings is not None and settings.graph_mode == "server":
                with suppress(Exception):
                    graph = FalkorGraph(settings)
                    graph._database().select_graph(graph.graph_name(settings.tenant)).delete()
                    graph.close()


if __name__ == "__main__":
    main()
