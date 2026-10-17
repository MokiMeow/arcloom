"""An actual operating-system process boundary, backed by persisted FalkorDB."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("ARCLOOM_TEST_GRAPH") != "lite", reason="Requires actual embedded FalkorDB"
    ),
]
CODE = """
import json, os, sys
from pathlib import Path
from arcloom.config import Settings
from arcloom.runtime import Runtime
from arcloom.domain import DiscoveryInput
from tests.ports import FixtureRunner
from tests.helpers import confirm
from tests.conftest import ADMIN, RUNNER
s=Settings(_env_file=None, data_dir=Path(sys.argv[1]), graph_mode='lite', admin_token=ADMIN, runner_secret=RUNNER, worker_enabled=False)
r=Runtime(s,runner=FixtureRunner(RUNNER));r.initialize()
try:
 actor=r.auth.bearer(ADMIN)
 result=confirm(r,actor) if sys.argv[2]=='A' else r.discovery.run(actor,DiscoveryInput(),'process-b-request')
 print(json.dumps({'pid':os.getpid(),'result':result}))
finally:r.close()
"""


def test_fresh_process_inherits_graph_not_conversation(tmp_path):
    root = Path(__file__).resolve().parents[2]
    env = {**os.environ, "PYTHONPATH": str(root / "src") + os.pathsep + str(root)}

    def invoke(stage):
        run = subprocess.run(
            [sys.executable, "-c", CODE, str(tmp_path), stage],
            cwd=root,
            env=env,
            capture_output=True,
            text=True,
            timeout=45,
            check=True,
        )
        return json.loads(run.stdout.strip().splitlines()[-1])

    a, b = invoke("A"), invoke("B")
    assert a["pid"] != b["pid"]
    assert b["result"]["selection"]["test_id"] == "invoice-tenant-boundary"
    assert a["result"]["finding_id"] in b["result"]["selection"]["finding_ids"]
