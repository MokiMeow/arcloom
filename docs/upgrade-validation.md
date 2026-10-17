# Clef and graph intelligence upgrade: validation record

17 October 2026. These checks ran in the isolated development environment using Python 3.14.4 and actual embedded FalkorDB. They are not GitHub CI results or a production security certification.

| Check | Result |
|---|---|
| Backend and integration suite | **170 passed**, one existing Starlette/httpx deprecation warning |
| UI component tests | **7 passed** |
| Chromium browser scenarios | **3 passed** |
| TypeScript check | Passed |
| Vite production build | Passed |
| Ruff checks and Python formatting | Passed |

The backend total includes the original policy/evidence/workflow tests, actual graph integration, separate-process memory handoff, all three Clef model adapter contracts, abstention persistence, invalid response handling, full-text search, native query plans, PageRank inspection, read-only withdrawal, alternative evidence, and tenant boundaries.

The primary browser scenario actually runs report approval, lab observations, evidence review, independent follow-up, chain verification, graph search, withdrawal inspection, native diagnostics, revision invalidation, and revalidation. Two more scenarios cover mobile navigation and invalid credentials. The additional UI tests verify that absent receipts do not imply live inference and that abstention is not represented as vulnerability proof.

**Cloudflare responses were mocked.** No actual hosted Clef request, model-quality benchmark, multimodal intake, live deployment, or Docker-engine startup was performed. Three browser scenarios are not exhaustive UI coverage. The local passing suite does not resolve the existing GitHub Actions startup failure.

Reproduce on a supported local development setup:

```sh
uv sync --frozen --extra dev --extra lite
ARCLOOM_TEST_GRAPH=lite uv run --frozen --extra dev --extra lite pytest -q --cov=arcloom
cd apps/web
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
ARCLOOM_TEST_PYTHON="$(pwd)/../../.venv/bin/python" npm run e2e
```

The checked-in Python lock has a reduced wheel list for the previously tested Linux/Python setup. Other operating systems may require source builds; use Docker or validate the platform before relying on it for the demonstration. No new package dependency was added by this upgrade.
