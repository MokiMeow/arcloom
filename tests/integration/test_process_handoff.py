"""An actual operating-system process boundary, backed by persisted FalkorDB."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.environ.get("ARCLOOM_TEST_GRAPH"), reason="Requires actual FalkorDB"),
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
from arcloom.storage import digest
s=Settings(
 _env_file=None, data_dir=Path(sys.argv[1]),
 graph_mode=os.environ['ARCLOOM_TEST_GRAPH'],
 graph_host=os.environ.get('ARCLOOM_TEST_GRAPH_HOST', '127.0.0.1'),
 graph_port=int(os.environ.get('ARCLOOM_TEST_GRAPH_PORT', '6379')),
 graph_password=os.environ.get('ARCLOOM_TEST_GRAPH_PASSWORD', ''),
 tenant='handoff_'+digest(sys.argv[1])[:16],
 admin_token=ADMIN, runner_secret=RUNNER, worker_enabled=False)
r=Runtime(s,runner=FixtureRunner(RUNNER));r.initialize()
try:
 actor=r.auth.bearer(ADMIN)
 result=confirm(r,actor) if sys.argv[2]=='A' else r.discovery.run(actor,DiscoveryInput(),'process-b-request')
 print(json.dumps({'pid':os.getpid(),'result':result}))
finally:
 if sys.argv[2]=='B' and s.graph_mode=='server':
  r.graph._database().select_graph(r.graph.graph_name(s.tenant)).delete()
 r.close()
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
