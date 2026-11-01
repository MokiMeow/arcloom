# Arcloom architecture and redesign constraints

This review maps the checked-out application and the existing API contracts. The source of truth is the workflow journal plus actual FalkorDB prerequisite queries, not UI state or demonstration illustrations.

## End-to-end interaction

1. `main.tsx` mounts `App`; `App` checks `/api/auth/session`, stores the server session identity and in-memory CSRF token, then shows the authenticated workspace or public landing page with a native token dialog.
2. `Workspace` owns hash-route navigation, selected investigation, report-dialog state, dashboard polling, discovery and logout. A navigation version prevents a slow discovery response from redirecting a user who moved elsewhere.
3. `api.request` sends same-origin cookies, mutation CSRF and a fresh idempotency key; it maps server errors and session expiration. `useRemote` cancels superseded reads, ignores stale completions, retains useful snapshots while refreshing, and polls only visible documents.
4. `api.py` enforces trusted hosts, same-origin mutations, bounded input, role/session authentication and operation routing. `Runtime` composes the journal, authentication, evidence store, graph, projector, providers, discovery, cases and worker.
5. A submitted report creates/links an `awaiting_approval` case. An authorized reviewer approves a registered bounded test; the worker claims the queued job, rechecks scope/support/approval/budgets, calls the private synthetic lab and persists the signed observation.
6. A runner observation yields `awaiting_review`. A separate evidence acceptance can establish `confirmed`; negative/inconclusive results remain first-class memory. Reviewer acceptance—not an animated success indicator—creates the finding.
7. Atomic journal transactions write audit events and graph projection outbox records together. `Projector` flushes ordered parameterized graph updates. `Discovery.run` requires current graph projection, retrieves complete prerequisite-supported candidates and creates a fresh planner context with zero previous messages.
8. Advancing deployment revision invalidates current support without erasing the original finding/evidence. Historical confirmation does not mean current eligibility or prove that a flaw was fixed.

## Backend responsibilities and method dependencies

| Module | Main responsibility and interactions |
| --- | --- |
| `passwords.py` | Exact Unicode password policy, bounded Argon2id hash/verify and upgrades; normalized unverified email login identifiers. |
| `private_storage.py` | Atomic tenant/purpose-bound authenticated encryption for reusable provider/OAuth/graph credentials; key validation and legacy migration. |
| `config.py` | `Settings` validates private local/server graph, synthetic lab origin, budgets, provider, allowed hosts/origins; runtime/API/CLI share it. |
| `domain.py` | Strict typed mutation contracts, roles, states, observations, actor and candidate public shapes. |
| `catalog.py` | Trusted registry of four synthetic assets, five bounded tests, their prerequisites/capabilities and two deployment revisions. |
| `storage.py` | `Store.connect/transaction/one/all`, `event`, `verify_audit`, rate limits and locks. SQLite owns durable workflow and atomic outbox writes, not graph reasoning. |
| `auth.py` | Private-workspace registration, Argon2id account login, password change and single-use recovery; `bootstrap`, `bearer`, `session`, `login/logout`, CSRF derivation, one-time member creation and revocation; `require` centralizes role checks. |
| `api.py` | `RequestBoundary` bounds input and emits security headers/request IDs; `create_app` owns lifespan and explicit typed endpoint-to-service routing. |
| `runtime.py` | Builds ports/services, initializes tenant and graph seed, exposes actual dashboard/catalog state, closes worker/provider/graph resources. |
| `workflow.py` | `Cases.get/list/submit/approve/review/retry/revise/revalidate/set_scope`; shared scope/support checks and idempotent response caching protect all transitions. |
| `worker.py` | `start/stop/_loop/tick`, `_claim`, `_record`, `recover_expired` implement bounded execution, durable leases, fencing, receipt validation and inconclusive recovery. |
| `runner.py` | `HttpRunner.execute` calls only the fixed local lab endpoint and `validate_receipt` checks signed run/case/tenant/test/revision identity. |
| `lab.py` | Fixed gateway/invoice/export/audit fixtures and registered `RunPlan`; signs bounded synthetic observations. Never a general shell or arbitrary-target runner. |
| `evidence.py` | `sign_receipt/verify_receipt`, `EvidenceStore.put/get`, tenant/hash checks and private receipt storage. |
| `graph.py` | `FalkorGraph` opens Lite/server, selects only parameterized queries, serializes projection nodes/edges and returns candidates/views. `Projector.flush/require_current` enforce consistency and fail closed. |
| `discovery.py` | `Discovery.run` acquires the workspace lease, snapshots provider configuration, validates graph candidates and persisted support/evidence, reserves budget and persists one proposal. Recovery never invents eligibility. |
| `agents.py` | Planner port/adapters and selection validation. Model choices must refer to complete graph-supported candidates. |
| `providers.py` | `ProviderManager.status/configure/snapshot/planner/planning_snapshot/test/audit` keeps selected provider explicit and private profiles server-side. Errors never switch provider/model. |
| `chatgpt_auth.py` | Bounded browser-based subscription connection, local profiles, consent/catalog, credential renewal, disconnect and cleanup. |
| `chatgpt_planner.py` | Streaming subscription result assembly, strict final selection and deadline/transport handling. |
| `clef.py`, `cloudflare_auth.py` | Validated Cloudflare decision results, confidence/margin rules and explicit bounded credential renewal. |
| `http_boundary.py` | Deadline-aware transport and bounded JSON consumption used by provider calls. |
| `intelligence.py` | Read-only fixed full-text search, evidence withdrawal, prerequisite diagnostics and graph dependency queries; bounded native graph operations. |
| `handoff.py` | Builds current verified portable memory packet from graph plus journal/evidence, with canonical packet digest and explicit blocked follow-ups. |
| `graph_hosting.py` | Privately stages a remote graph target; saving never silently changes the active graph or migrates data. |
| `mcp_server.py` | Read-only authenticated stdio tools delegate to the same API; no mutation or execution tools. |
| `demo.py` | Separate persistent presentation workspace settings; normal investigation history must not be reset. |
| `cli.py` | Non-overwriting private configuration, API/lab/demo server commands, doctor, one-step investigator and explicit provider connection/diagnostics. |

## Frontend contracts

| Component | Reads/actions and interactions to preserve |
| --- | --- |
| `App` / `Workspace` | Account/token session/login/logout; dashboard/catalog; route history; discovery; report dialog; role checks; public-demo banner; navigation focus trap; skip link. |
| `Landing` | Original sky/chrome product story; keyboard evidence-to-memory workbench, workflow tabs, system explorer and FAQ; native account access and focus restoration. Illustrations never create workspace records. |
| `AccountAccess` / `AccountSettings` | Email/password registration, sign-in, recovery code saving/reset and password change; renewed sessions update in-memory CSRF, with no credential storage. |
| `dashboardLayout` | Validated per-account widget IDs/order/width metadata; pointer/keyboard movement, reset and blocked-storage fallback. |
| `FullIdentifier` | Complete wrapping values, exact copy, accessible manual fallback and stale-copy protection. |
| `CommandPalette` | Searchable, keyboard-operated route/report commands with role-aware actions and focus restoration; opens from the workspace or Cmd/Ctrl+K. |
| `Overview` | Actual dashboard counts/budgets, loaded-page queue and independent agent sessions; source-labelled first-page audit histogram with UTC/window/day controls and exact table; authorized loaded-data JSON snapshot; report, discovery, case, graph and queue navigation. |
| `HandoffBrief` | `/api/memory/handoff`, strict verified packet shape, refresh failure protection, case/graph links and JSON export; no invented counts or eligibility. |
| `Investigations` | `/api/investigations?q&state&limit&offset`, search/status/pagination, report and case navigation. |
| `CaseDetail` | Polls case; displays original reports, approval/review history and signed observations; approval/review/retry/revalidation/discovery; evidence integrity request and export. |
| `ReportForm` | Native accessible dialog; trusted catalog test selection locks asset/request limit; creates report with attribution and observed description. |
| `Memory` / `memoryGraph` | Actual `/api/memory` graph and case paths, deterministic graph layout, keyboard node inspection, focus/fit/zoom and readable details; searchable/paginated graph record list selects the same inspector. |
| `GraphInsights` | Read-only native graph search, withdrawal analysis and diagnostics; paths/results remain hypotheses, not execution proof. |
| `Activity` / `DecisionReceipt` | Cursor-based audit events and agent sessions, expandable provenance and model decisions, audit verification/head export. API events are ascending by cursor; UI reverses loaded results for display. Current pagination is deliberate, not a confirmed bug. |
| `Settings` | Revision/scope mutations with reasons; budgets/expiry; admin-only members, one-time tokens, revocation; provider/graph forms. |
| `ProviderSettings` | Admin-only provider profile selection/save/test; optional ChatGPT connect/catalog/disconnect; credentials stay server-side; diagnostics remain distinct from investigations. |
| `GraphHostingSettings` | Admin-only current/staged graph target, private password input; labels must state that save stages rather than activates a connection. |
| `ui` | Textual semantic statuses, errors with role=alert, loading status, empty states, section headings, short identifiers and local date formatting. |
| `Brand` | Identity mark; not a source of application state. |
| `navigation.ts` | Stable hash routes for overview/investigations/memory/activity/settings; percent-encoded investigation IDs; malformed routes safely fall back. |
| `webmcp.ts` | Optional read-only browser tool registration tied to authenticated session; abort/unregister at logout; API-enforced access. |
| `demoMode.ts`, `demo/api.ts`, snapshots | Explicit read-only recorded r1/r2 API adapter; normal application build must exclude demo data chunks. |

## Confirmed flaw and fix

The investigation search UI advertised titles, assets and test IDs, but the backend searched only title/case ID. `Cases.list` now applies the same escaped, parameterized LIKE search to `title`, `id`, `asset_id` and `test_id`, within the existing tenant and state predicate. Added focused regression coverage verifies each field, literal `%`/`_`/backslash, SQL-like input, tenant isolation, totals and pagination.

Other cautions are contract semantics, not confirmed backend defects: `verified_historical` currently means total retained findings; label it accordingly or derive stale-only from findings. `scope_enabled` alone does not establish an unexpired assessment; display or disable actions using `scope_expires_at` too. The backend already rejects expired admission.

## Redesign guardrails and validation

Preserve accessibility (semantic labels/statuses, keyboard focus, dialog containment, reduced motion, 44px touch targets), responsive graph/details, one-time credentials until dismissal, server-side role enforcement, no browser token storage, public-demo restrictions and explicit provider labels. Marketing illustrations must be clearly illustrative and must never appear to be live dashboard measurements.

Use the existing API and real records. Keep approval and evidence acceptance as separate explicit human actions. Do not copy external creator code without inspecting it and verifying the license. Validate 320/390/768/1024/1440/2560px; keyboard paths, long content, failed requests, mobile navigation, report/review/export, real graph readiness and deterministic full browser flow.
