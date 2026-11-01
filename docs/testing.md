# Testing and validation

The final checks below were executed on **18 October 2026**, including the
handoff, agent-tool, presentation and renewal expansion. Each result applies to
the executed configuration and source tree; deployment-specific verification
remains part of operating the application.

[Documentation index](index.md) · [Run the demo](demo.md)

GitHub-hosted validation is available on demand through **Actions → Arcloom validation → Run workflow**. Pushes and pull requests do not start hosted runs. The commands below reproduce the recorded checks locally.

## Recorded automated checks

| Check | Recorded result |
| --- | --- |
| Full Python suite with actual local FalkorDB Server | **539 passed, 2 skipped** |
| Frontend component and behavior tests | **105 passed**, including read-only demo boundaries |
| Public UI demo, Chromium responsive scenarios | **5 passed** at 320, 390, 768, 1024 and 1440px; navigation, exports, graph tools, policy and historical cases; focused/whole graph fitting and desktop-to-phone resize |
| Deployed Vercel UI demo, Chromium and WebKit | **90 view checks passed** across those five widths; zero page errors, API requests or horizontal overflow; fresh browser contexts without login |
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

The [public UI demo](ui-demo.md) was checked separately against its deployed Vercel URL. Each browser engine exercised nine views or recorded states at every width, including exports, recorded integrity/audit checks, graph search, withdrawal analysis, diagnostics, policy and historical cases. These are automated browser viewport checks, not physical-device certification. The normal application build excludes the recorded demo fixture chunk.

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
ARCLOOM_TEST_PYTHON="$PWD/.venv/bin/python" npm --prefix apps/web run e2e:accounts
```

On Windows, retain the `ARCLOOM_TEST_GRAPH_*` server values above:

```powershell
$env:ARCLOOM_TEST_PYTHON = (Resolve-Path '.venv/Scripts/python.exe').Path
npm --prefix apps/web run e2e
```

Keep ports 8000 and 9001 free: the E2E harness owns the API and separate lab processes. It creates a temporary workspace and uniquely named graph, removes the graph on graceful shutdown and retains failure traces. Build before starting the browser suite; rebuilding assets while a suite uses them invalidates that run. Test-only credentials are public placeholders and must never be deployed.

## Interpret the results

Passing checks establish the exercised paths. They do not establish production load, high availability, external-target safety, model calibration, discovery-rate uplift or exhaustive coverage. Confidence values are model decision signals, not vulnerability probabilities. A complete Docker run and deployment-specific backup/restore exercise need their own recorded verification. Local results do not imply a passing hosted CI run.

## Enterprise interface rebuild

The enterprise interface uses references inspected through the actual Tessory
catalog, source pages and license notices. See [design references](design-references.md)
and [component interactions](component-map.md).

The live visual review runs in a separate temporary workspace with actual
FalkorDBLite, a separate authenticated HTTP lab and the deterministic planner.
Gateway evidence was produced and accepted through the actual API, an invoice
investigation was left awaiting evidence review, and an export investigation was
left awaiting approval. Those are automated test-owner decisions in an isolated
lab; they do not imply independent human adjudication. The normal user workspace
and its investigation history were not populated or reset.

The new browser regressions in `apps/web/e2e/enterprise.spec.ts` exercise native
sign-in focus, product foundations/workflow/FAQ controls without mutation, audit
window/day inspection and real JSON snapshot downloads, command search,
sidebar collapse/mobile navigation, actual graph record inspection and filtering
of loaded audit records. The original investigation/evidence/revision and
private-token checks remain in `workspace.spec.ts`.

Validation uses system Chromium through a local launch adapter. Responsive
screenshots and automated WCAG A/AA/2.1 AA checks cover landing, overview, inbox,
graph, activity, policy and evidence detail at 320, 390, 768, 1024, 1440 and 2560px.
Screen emulation does not establish physical Android/iOS or Safari/WebKit
coverage, and automated rules do not establish complete accessibility.

Validated on 29 October 2026 with Python 3.14.8, Node 24.19.0 and system Chromium:

- 192 frontend tests passed across 23 files.
- All 13 live API/HTTP-lab browser scenarios passed, including the complete
  evidence/follow-up/revision chain and five enterprise interface checks.
- Three additional live account/layout scenarios passed in a fresh harness,
  covering password/session/recovery behavior, actual tenant isolation and
  pointer/keyboard layout persistence.
- All five public recorded-view browser scenarios passed. This separate mode was
  not used for the real-workspace visual previews.
- Full backend suite: 602 passed, 2 server-only checks skipped under Lite. Total
  measured coverage was 88%; real FalkorDBLite integration ran. The focused account,
  tenant-isolation, encryption, legacy migration and account-API regressions passed.
- Production and recorded-view builds, TypeScript, Ruff, Prettier and diff checks
  passed.
- 85 measured page/state/viewport combinations had no detected WCAG A/AA/2.1 AA
  violations, horizontal document overflow, clipped controls or JavaScript page
  errors: seven ordinary pages at all six widths, plus account sign-in/signup/
  reset/recovery, expanded password settings, dashboard customization, signed
  receipts, audit details, selected graph records and mobile agent contexts.
- Real Chromium clipboard copying preserved the complete 64-character artifact
  digest. Receipt/query JSON regions are keyboard-scrollable. Favicon SVG was
  inspected at 16, 32, 64 and 128px.

The separate `e2e:accounts` command gives account lifecycle/isolation/layout tests
a fresh disposable API/lab and its own output paths, respecting the unchanged
production login/recovery limits. It is included in CI after the main browser suite.

Read-only enterprise browser checks reuse a session cookie in worker memory to
respect the unchanged login rate limit. Authentication, token privacy, role and
logout scenarios still sign in independently; no session state is saved to disk.

A retry-state regression test verifies that retained receipts/reviews never mark
an unexecuted new attempt complete. Review completion is tied to the current run's
`run_id`; previous-attempt evidence remains visible and labelled separately.
