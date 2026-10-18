# Testing and validation

The final checks below were executed on **18 October 2026**, including the
handoff, agent-tool, presentation and renewal expansion. Each result applies to
the executed configuration and source tree; deployment-specific verification
remains part of operating the application.

[Documentation index](index.md) · [Run the demo](demo.md)

## Recorded automated checks

| Check | Recorded result |
| --- | --- |
| Full Python suite with actual local FalkorDB Server | **539 passed, 2 skipped** |
| Frontend component and behavior tests | **105 passed**, including read-only demo boundaries |
| Public UI demo, Chromium responsive scenarios | **5 passed** at 320, 390, 768, 1024 and 1440px; navigation, exports, graph tools, policy and historical cases |
| Chromium browser scenarios, actual graph and separate HTTP lab | **8 passed** |
| Ruff lint/format and frozen dependency lock check | Passed |
| TypeScript, production build and Prettier | Passed |
| Provider settings: automated WCAG A/AA/2.1 AA checks | Zero detected violations at 1440, 768 and 390px |
| Provider settings: horizontal overflow and browser errors | None at those widths |
| Cloud-backed readiness, lab health and audit verification | Passed |
| Expanded handoff: WCAG A/AA/2.1 AA, overflow and browser errors | Zero detected violations/errors/overflow at 1440, 1024, 768 and 390px |
| Actual MCP stdio client → running API → FalkorDB Cloud | All three tools succeeded; exported packet digest verified |
| Separate presentation CLI processes against Cloud + HTTP lab | Distinct PIDs proposed invoice and chain with zero previous messages; both executed/reviewed |
| Local bounded credential renewal | Credential-only helper and actual on-demand Wrangler/Clef call passed; Luna remained selected |
| Compose configuration validation | Passed; full Docker engine smoke test remains unexecuted in the recorded environment |

The Python skips require Windows symlink privileges; Linux's symlink checks remain
enabled. Automated accessibility rules cover only part of accessibility; these
results are not certification. Independent review found and verified corrections
for presentation workspace routing, renewal configuration and a request deadline
that previously allowed separate network phases to exceed the intended budget.

The browser sequence covers report approval, actual signed observations, evidence acceptance, fresh-context follow-ups, a chain, negative/inconclusive memory, revision revalidation, graph interaction, mobile navigation, session errors and one-time token retention. Browser runs use deterministic planning and disposable credentials. Live provider calls are separate checks.

New browser checks independently recompute the downloaded packet's canonical
SHA-256, inspect its verified prerequisite/evidence fields and exercise WebMCP
registration through an explicit test adapter calling the real authenticated API.
They verify removal on logout. The tested browser did not expose native WebMCP;
native availability is not claimed. Standard MCP and the ordinary browser UI
were tested without that capability.

The new local recording, `data/demo/arcloom-handoff-walkthrough.webm`, shows actual
gateway, invoice, chain, negative and inconclusive HTTP results. Its invoice and
chain proposals were made by two real CLI processes using the presentation
workspace. The recording is silent raw footage for participant narration.

## Live provider checks

| Provider | Recorded live behavior | Scope of evidence |
| --- | --- | --- |
| ChatGPT subscription, `gpt-5.6-luna` | Validated consent/catalog and inference; gateway → invoice → chain confirmed against actual Cloud and HTTP lab; valid 21-event audit | Local-app subscription integration and a bounded live workflow |
| Gemini, `gemini-3.5-flash-lite` | Diagnostic and gateway → invoice → chain confirmed against local actual FalkorDB; negative export retained; valid 28-event audit | Positive and negative memory with live selection |
| Cloudflare, `@cf/cloudflare/clef-flash` | Valid `needs_review` abstentions; one request reported confidence 0.2455 under the unchanged 0.70 threshold | Transport/decision contract, not positive selection quality |
| OpenAI project API key | Contract, transport and malformed-response tests | No live API-key account run recorded |
| Anthropic | Contract and error-response tests | No live account run recorded |
| Deterministic | Real-engine/HTTP workflow and separate-process handoff | Reproducible workflow without external inference |

The live evaluation harness submitted explicit approvals and reviews as the test owner. Those were automated test decisions, not independent human adjudication. Actual HTTP lab calls exercised deliberately vulnerable synthetic fixtures. Provider availability is account-specific; [setup](provider-setup.md) explains how to configure your own account.

Cloud staging separately replayed 32 historical events and verified 43 nodes/64 edges, properties, candidate paths and full-text indexes. Local journal and evidence were retained. An authenticated Cloud connection does not provide the application's journal, evidence, runner or backups.

Final live diagnostics after the transport/renewal changes also succeeded:
ChatGPT Luna selected (459 input / 113 output tokens), Gemini Flash-Lite selected
(418 / 57), and Clef-flash abstained with `needs_review` (371 / 0). The latter two
used isolated workspaces against the actual Cloud graph. No thresholds were
relaxed and no provider was substituted.

## Reproduce on Windows with a server

Use Python 3.13 and a supported Node version from the [README](../README.md). Start a dedicated real graph, then set its test connection in your shell; keep private values out of command history where practical.

```powershell
uv sync --frozen --python 3.13 --extra dev
$env:ARCLOOM_TEST_GRAPH = 'server'
$env:ARCLOOM_TEST_GRAPH_HOST = '127.0.0.1'
$env:ARCLOOM_TEST_GRAPH_PORT = '6379'
# Set ARCLOOM_TEST_GRAPH_PASSWORD from your private graph configuration.
uv run --frozen pytest -q --cov=arcloom
uv run --frozen ruff check src tests scripts
uv run --frozen ruff format --check src tests scripts
```

See [development helpers](../scripts/README.md) for an existing-WSL graph. Integration tests create isolated graphs; never point a disposable test harness at a production graph namespace.

## Reproduce on Linux with Lite

```bash
uv sync --frozen --python 3.14 --extra dev --extra lite
uv run --frozen ruff check src tests scripts
uv run --frozen ruff format --check src tests scripts
ARCLOOM_TEST_GRAPH=lite uv run --frozen pytest -q --cov=arcloom
```

Integration tests use actual FalkorDB and fail rather than replace it with a fake. Unit tests explicitly inject graph doubles to exercise failures and invariants; the application has no runtime fake-graph mode. The Windows WSL helper runs FalkorDB 4.18.3 from FalkorDBLite 0.10.0. Compose pins 4.22.1; the local server tests do not establish container-image parity.

## Frontend and browser checks

```bash
npm --prefix apps/web ci
npm --prefix apps/web run typecheck
npm --prefix apps/web test
npm --prefix apps/web run build
npm --prefix apps/web run format:check
npm --prefix apps/web exec playwright install --with-deps chromium
```

On Linux/Lite:

```bash
ARCLOOM_TEST_PYTHON="$PWD/.venv/bin/python" npm --prefix apps/web run e2e
```

On Windows, retain the `ARCLOOM_TEST_GRAPH_*` server values above:

```powershell
$env:ARCLOOM_TEST_PYTHON = (Resolve-Path '.venv/Scripts/python.exe').Path
npm --prefix apps/web run e2e
```

Keep ports 8000 and 9001 free: the E2E harness owns the API and separate lab processes. It creates a temporary workspace and uniquely named graph, removes the graph on graceful shutdown and retains failure traces. Build before starting the browser suite; rebuilding assets while a suite uses them invalidates that run. Test-only credentials are public placeholders and must never be deployed.

## Interpret the results

Passing checks establish the exercised paths. They do not establish production load, high availability, external-target safety, model calibration, discovery-rate uplift or exhaustive coverage. Confidence values are model decision signals, not vulnerability probabilities. A complete Docker run and deployment-specific backup/restore exercise need their own recorded verification. Local results do not imply a passing hosted CI run.
