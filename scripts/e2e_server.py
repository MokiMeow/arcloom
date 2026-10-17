"""Disposable E2E workspace: actual FalkorDB + separate authenticated HTTP lab.

Test credentials are fixed and intentionally public. Never deploy this harness.
"""

import multiprocessing
import tempfile
from pathlib import Path

import uvicorn

from arcloom.api import create_app
from arcloom.config import Settings
from arcloom.lab import create_lab_app

TOKEN = "arcloom-e2e-only-" + "t" * 48
SECRET = "arcloom-e2e-runner-" + "s" * 48


def serve_lab():
    uvicorn.run(create_lab_app(SECRET), host="127.0.0.1", port=9001, access_log=False)


def main():
    with tempfile.TemporaryDirectory(prefix="arcloom-e2e-") as directory:
        lab = multiprocessing.get_context("spawn").Process(target=serve_lab)
        lab.start()
        try:
            settings = Settings(
                _env_file=None,
                data_dir=Path(directory),
                graph_mode="lite",
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


if __name__ == "__main__":
    main()
