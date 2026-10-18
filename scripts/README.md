# Development helpers

Run commands from the repository root. [Quickstart](../README.md#run-locally) · [Documentation index](../docs/index.md) · [Testing](../docs/testing.md)

## Private configuration

`python scripts/configure.py` creates random admin, runner and graph credentials in ignored `.env`. It refuses to overwrite an existing file. Browser sign-in uses `ARCLOOM_ADMIN_TOKEN`; no separate email/password account is required.

`uv run --frozen python scripts/cloudflare_setup.py --account-id <your account ID>` privately copies an existing Wrangler credential and selects Clef-flash. Other settings are preserved and no key is printed. Copied OAuth tokens expire; rerun the helper and restart the API to refresh the snapshot. See [provider setup](../docs/provider-setup.md) for a scoped API-token option for unattended use.

## Native Windows with an existing WSL graph

Python dependencies run natively on Windows; only the actual FalkorDB process runs inside an existing x86-64 WSL distribution. The helper does not install a distribution or change Windows/Docker settings.

```powershell
uv sync --frozen --python 3.13 --extra dev
python scripts/configure.py  # once, only when .env does not exist
python scripts/dev_graph.py start
npm --prefix apps/web ci
npm --prefix apps/web run build
```

The default distribution is `docker-desktop`; use `--distribution NAME` to select another existing distribution. The frontend requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`.

Run the lab and API in separate terminals:

```powershell
uv run --frozen arcloom lab
```

```powershell
uv run --frozen arcloom serve
```

Open [the workspace](http://127.0.0.1:8000) and run `uv run --frozen arcloom doctor`. Graph, lab and API must remain available. The helper binds the graph to localhost, uses the private `.env` graph password and stores the database/log under `data/wsl-graph/`.

```powershell
python scripts/dev_graph.py status
python scripts/dev_graph.py stop
python scripts/dev_graph.py start  # resumes the persistent database
```

The helper downloads SHA256-pinned FalkorDBLite 0.10.0 binaries and Debian runtime libraries into ignored workspace data. The wheel contains FalkorDB **4.18.3**. This is a local development engine, distinct from Compose's pinned 4.22.1 image.

The helper records the launched instance's random Redis run ID, PID, configuration, data directory and PID file. `stop` requires those details and the current PID file to match. Existing external servers remain externally managed; a plain Redis server without graph support is rejected. Removing the ownership record does not adopt or stop an existing server.

## Separate presentation workspace

With the graph and ordinary lab already running:

```powershell
uv run --frozen arcloom demo --workspace data/presentation --port 8002
```

This creates or resumes a separate persistent journal/graph identity and leaves main workspace history intact. It uses the admin token and lab configuration from `.env`, defaults to deterministic planning and does not copy live provider keys. Use a separate browser profile or private browsing session for the presentation: session cookies share the hostname across ports. [Demo guide](../docs/demo.md).

## Browser tests with a real server

The default E2E harness uses Linux FalkorDBLite. Native Windows can use a dedicated local server:

```powershell
$env:ARCLOOM_TEST_GRAPH = 'server'
$env:ARCLOOM_TEST_GRAPH_HOST = '127.0.0.1'
$env:ARCLOOM_TEST_GRAPH_PORT = '6379'
# Set ARCLOOM_TEST_GRAPH_PASSWORD from your private graph configuration.
$env:ARCLOOM_TEST_PYTHON = (Resolve-Path '.venv/Scripts/python.exe').Path
npm --prefix apps/web run e2e
```

Keep ports 8000 and 9001 free. Build assets before the suite starts. The harness creates a temporary workspace, public test credentials, a separate authenticated lab and a uniquely named graph. Graceful shutdown deletes that graph. A failed real connection remains a failure, never an in-memory substitute. [Testing](../docs/testing.md) gives the complete validation commands and ledger.

## Graph migration

`scripts/migrate_graph.py` stages a complete historical projection into a fresh target graph without activating it. Stop writers, preserve source stores and follow the [migration procedure](../docs/cloud-hosting.md#migrate-an-existing-journal). Private connection settings belong in an ignored file, never command-line arguments.
