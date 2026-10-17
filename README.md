# Arcloom

**Evidence-backed security memory for independent investigation agents.**

Arcloom turns a reviewed finding into a useful starting point for the next investigation. FalkorDB holds the prerequisite paths; an isolated synthetic lab produces observations; a human reviewer accepts or rejects the outcome. A new agent process can continue without the previous conversation.

This is a working, private development release for the FalkorDB hackathon, not a production penetration-testing service. The application contains deliberately vulnerable **synthetic fixtures only**. It does not scan arbitrary URLs, execute generated shell commands, or accept production credentials.

## What works

- Report intake, deterministic duplicate linking, and original researcher attribution.
- Explicit human approval before execution and a separate evidence review afterward.
- Actual FalkorDB queries that require **all** verified prerequisites, respect the deployment revision, and exclude previously attempted tests.
- Independent fresh-context investigation sessions and a separately tested operating-system process handoff.
- Signed, content-addressed evidence with integrity verification and JSON export.
- Durable jobs, execution leases, idempotency, budget reservations, a graph projection outbox, and a hash-chained audit journal.
- Negative and inconclusive memory, a verified two-step synthetic chain, and patch-aware revalidation.
- React/TypeScript workspace: inbox, evidence review, real graph inspector, agent ledger, policy controls, and team roles.
- Optional OpenAI Responses and Anthropic Messages tool-calling adapters. Provider errors never silently fall back to another mode.

**The default planner is deterministic, visibly labelled, and needs no API key.** It proves the graph, execution, review, and persistence plumbing without pretending an LLM was called. Live provider calls require your own server-side API key and a compatible model ID.

## Start locally (validated Linux path)

Use Python 3.14, Node 22.12 or newer, and uv. Windows users should use WSL2 or Docker Desktop rather than native FalkorDBLite.

```bash
git clone https://github.com/MokiMeow/arcloom.git
cd arcloom
python scripts/configure.py
uv sync --frozen --python 3.14 --extra dev --extra lite
npm --prefix apps/web ci
npm --prefix apps/web run build
```

Change `ARCLOOM_GRAPH_MODE=server` to `ARCLOOM_GRAPH_MODE=lite` in `.env`. Then run these in two terminals, from the repository root:

```bash
uv run arcloom lab
```

```bash
uv run arcloom serve
```

Open `http://127.0.0.1:8000`. Sign in with `ARCLOOM_ADMIN_TOKEN` from your local `.env`. Configuration refuses to overwrite existing credentials. No secret belongs in GitHub, screenshots, or chat.

Check readiness:

```bash
uv run arcloom doctor
```

The lab runs on loopback port 9001; the UI and backend share port 8000. `data/` contains persistent state and is ignored by Git. Stopping the processes does not delete memory.

## Docker Compose (provided, not yet engine-tested here)

```bash
python scripts/configure.py  # only when .env does not already exist
docker compose up --build -d
docker compose exec app arcloom doctor
```

Compose uses FalkorDB `v6.0.2`, named persistence volumes, a non-root app and runner, an internal-only runner/graph network, and loopback-only UI publication. Only the app has an outbound network for the optional model provider. The graph and runner have no published host ports.

The native real-engine integration and browser paths were executed successfully. The supplied container recipe still needs its first Docker engine smoke test on your machine or a working CI runner; do not confuse configuration review with a completed container run.

## The demonstration

1. Submit **Gateway trusts an unverified routing context**, naming the original researcher.
2. Approve the registered lab test. Inspect the actual receipt, verify its SHA-256, and accept the recorded outcome.
3. Start a fresh investigator. Show the FalkorDB path from the gateway finding to the invoice test.
4. Approve and review the invoice test. It verifies a distinct seeded tenant-ownership weakness.
5. Start another fresh investigator. Both verified prerequisites make the chain test eligible; the runner executes its steps under one identity and revision.
6. Retain a negative export test and an inconclusive audit test. Neither becomes a confirmed finding.
7. Advance to patched `r2`. Historical findings remain visible but are no longer current. Revalidate and inspect the new outcome.

For an actual process boundary, terminate one `agent-once` command and launch another after reviewing the preceding result:

```bash
uv run arcloom agent-once
```

The command proposes one investigation; it does **not** approve or execute it. The continuing loop deliberately pauses at human checkpoints. See [the demo guide](docs/demo.md).

## Use a live model

Set these only in your private server environment or `.env`, then restart the app:

```dotenv
ARCLOOM_PROVIDER=openai
ARCLOOM_MODEL=<tool-capable model ID available to your account>
ARCLOOM_MODEL_API_KEY=<private API key>
```

`ARCLOOM_PROVIDER=anthropic` selects the Anthropic Messages adapter. We intentionally do not hard-code a model recommendation or ship API credentials. The adapters have contract and failure-path tests with mock HTTP responses; **a paid live-provider run was not performed**. Compare model selections against deterministic mode before recording your final demo.

## Validate

```bash
uv run --extra dev --extra lite ruff check src tests scripts
uv run --extra dev --extra lite ruff format --check src tests scripts
ARCLOOM_TEST_GRAPH=lite uv run --extra dev --extra lite pytest -q --cov=arcloom
npm --prefix apps/web run typecheck
npm --prefix apps/web test
npm --prefix apps/web run build
npm --prefix apps/web exec playwright install --with-deps chromium
ARCLOOM_TEST_PYTHON="$PWD/.venv/bin/python" npm --prefix apps/web run e2e
```

The recorded validation run passed **124 backend tests**, **5 UI component tests**, and **3 browser scenarios**. It includes real FalkorDB integration and a two-process handoff, not only mocks. Statement coverage was 90.09%; branch coverage 74.86%; combined coverage 87.09%. This is not a claim of exhaustive testing or production readiness. See [test results and limits](docs/testing.md).

## How the code is organized

```text
src/arcloom/          Trusted API, policy, graph tools, agents, journal, runner
apps/web/            React + TypeScript workspace and Playwright scenarios
tests/               Unit, policy, failure, HTTP, real graph and process tests
scripts/             Local configuration and disposable browser-test harness
docs/                Architecture, threat model, operation and demonstration
compose.yml          Separate app, runner and FalkorDB containers
```

FalkorDB is the reasoning/memory graph. SQLite is the transactional approval/execution journal, **not a substitute graph or reasoning fallback**. Evidence lives in content-addressed files. The outbox reconciles journal commits into idempotent graph projections.

Read [architecture](docs/architecture.md), [security boundaries](docs/security.md), [operations](docs/operations.md), [validation](docs/testing.md), and [AI assistance disclosure](AI_USAGE.md).

## Before sharing or submitting

Keep the repository private until you explicitly choose otherwise. Check the event's submission rules, select a source-code license with your teammate, enable and test a real model if presenting LLM behavior, perform the Docker smoke test, and record actual executions rather than simulated success. No bounty reduction, discovery-rate uplift, or win is claimed without measurement.
