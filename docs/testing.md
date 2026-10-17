# Recorded validation — 17 October 2026

## Executed

| Check | Recorded result |
|---|---|
| Python backend, policy, evidence, HTTP and real graph tests | 124 passed |
| Real-engine integration | Included in the 124 tests; FalkorDBLite, not a graph mock |
| Separate-process memory handoff | Passed; distinct process IDs, persisted graph, no transcript |
| UI component tests | 5 passed |
| Chromium browser scenarios | 3 passed |
| TypeScript strict check and production Vite build | Passed |
| Ruff lint and format | Passed |
| Frontend Prettier formatting | Applied; build passed afterward |

Backend command: `ARCLOOM_TEST_GRAPH=lite python -m pytest -q --cov=arcloom`. Python was 3.14.4. Coverage recorded 1328/1474 statements (90.09%) and 271/362 branches (74.86%); combined coverage was 87.09%. CLI coverage is excluded in the project configuration. One upstream TestClient/httpx deprecation warning did not fail execution.

The browser tests cover real report approval, signed observations, human confirmation, two fresh-context follow-ups including a chain, graph rendering, patch invalidation, revalidation, mobile navigation, dialog cancellation, access-token rejection and cookie properties. The default browser planner is deliberately deterministic. The app communicates with a separate authenticated lab HTTP process, which exercises actual synthetic ASGI fixture endpoints.

Unit tests explicitly inject graph doubles to exercise failures and invariants. Integration tests request the actual FalkorDB engine and fail rather than silently substitute a fake. The application has no runtime fake-graph configuration.

## Not established by these results

Live OpenAI/Anthropic calls have not been paid for or executed; adapter contracts and error cases use mocked HTTP. The Docker Compose recipe is supplied and reviewed, but a Docker engine was not available for a complete container run in the build environment. Production load, high availability, a full backup/restore drill, external-target assessments and exhaustive coverage are not claimed.

The private GitHub repository preflight workflow ended in `startup_failure` with zero jobs, before any project tests ran. Its cause was not established. Do not label that run as a code-test failure or claim that GitHub-hosted CI is green. The recorded passing tests were executed in the isolated development sandbox.

## Run it yourself

```bash
uv sync --frozen --python 3.14 --extra dev --extra lite
uv run ruff check src tests scripts
uv run ruff format --check src tests scripts
ARCLOOM_TEST_GRAPH=lite uv run pytest -q --cov=arcloom
npm --prefix apps/web ci
npm --prefix apps/web run typecheck
npm --prefix apps/web test
npm --prefix apps/web run build
npm --prefix apps/web exec playwright install --with-deps chromium
ARCLOOM_TEST_PYTHON="$PWD/.venv/bin/python" npm --prefix apps/web run e2e
```

The E2E harness creates a temporary workspace and uses public test-only credentials. It must not be deployed. Run with ports 8000 and 9001 free. Traces are retained on failures and screenshots are produced by real browser execution, not an image model.
