import pytest

from arcloom.config import Settings
from arcloom.runtime import Runtime
from tests.ports import FixtureRunner, TestGraph

ADMIN = "test-owner-token-" + "a" * 48
RUNNER = "test-runner-token-" + "b" * 48


@pytest.fixture
def runtime(tmp_path):
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        admin_token=ADMIN,
        runner_secret=RUNNER,
        worker_enabled=False,
    )
    r = Runtime(settings, TestGraph(), FixtureRunner(RUNNER))
    r.initialize()
    yield r
    r.close()


@pytest.fixture
def owner(runtime):
    return runtime.auth.bearer(ADMIN)
