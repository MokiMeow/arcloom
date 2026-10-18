# Operations

Follow the [quickstart](../README.md#run-locally) for the API, graph and authenticated lab. Typed settings read `.env`; the configuration helper refuses to replace existing credentials. The workspace planner label records whether investigations use deterministic or live selection.

[Documentation index](index.md) · [Graph hosting](cloud-hosting.md) · [Provider setup](provider-setup.md)

## Persistent state

| Store | Contents |
| --- | --- |
| `data/journal.sqlite3` | Transactions, approvals, jobs, audit events and graph projection outbox |
| `data/evidence/` | Workspace-bound, content-addressed JSON receipts |
| FalkorDB | Projected entities, evidence provenance and prerequisite paths |
| Private configuration | Access, runner-signing, graph and provider credentials |

Lite stores its database beside the journal. Compose uses separate named graph and journal volumes. Preserve these stores and signing configuration together. A restart must resume memory rather than reset or seed accepted findings. A new workspace identity denotes a separate assessment; restarting does not extend the assessment expiry.

Use `arcloom demo --workspace data/presentation --port 8002` for a separate persistent presentation workspace with its own journal and graph identity. It resumes the same presentation on subsequent runs, defaults to deterministic planning and preserves the main workspace. Keep the ordinary lab running; [demo setup](demo.md#start-a-separate-presentation-workspace) explains the process and session boundary.

## Readiness and diagnosis

- `/health/live` means the process responds. `/health/ready` additionally requires synchronized graph memory.
- `arcloom doctor` checks graph readiness, lab health and the audit chain. It does not make an inference request or validate provider billing/model access.
- During a graph outage, projection work remains queued in the journal while graph-guided discovery and new authorization fail closed. Restore connectivity and allow the worker to synchronize the outbox.
- Timed-out or interrupted execution becomes inconclusive. Review it and explicitly request/approve another attempt where appropriate.
- Model failures are recorded and consume their reservation. Check model ID, authentication, tool support and provider limits. There is no silent provider fallback.
- A new revision makes previous conclusions historical. Revalidate the relevant test; a blocked prerequisite alone does not prove every downstream issue repaired.
- Missing or short admin/runner secrets prevent startup. Generate private configuration rather than substituting public test tokens.

## Backup and recovery

For a controlled backup, stop mutation and workers. Save/checkpoint the graph, use SQLite's backup API rather than copying an active WAL database, and copy the evidence directory with separately secured configuration. After restoring, verify the audit head and representative artifact hashes. Perform a full restore exercise before relying on that procedure for durable service operation.

Use the [migration helper](cloud-hosting.md#migrate-an-existing-journal) to rebuild graph state from the complete journal into a fresh verified target. Keep source settings and evidence until cutover is verified. A stale retained graph is not automatic failover.

The runner signing key is required to verify old receipts. Key rotation needs a historical-key design so a new signing key does not strand old evidence. Anchor the audit head independently if replacement of the entire local history is a threat you need to detect.

## Application hosting

Keep the lab and graph private. Public UI hosting needs HTTPS, exact allowed hosts/origins, secure cookies, access control, protected secrets and reviewed network policy. Set `ARCLOOM_COOKIE_SECURE=true` behind HTTPS; the default local HTTP cookie cannot use that flag.

The API needs durable journal/evidence storage and coordinated writers. File-based SQLite requires a deliberate design before adding application replicas. Cloud graph hosting moves only the graph; it does not supply application state or a runner boundary. A remote model API also does not host the application. [Security](security.md) describes the trusted components and requirements for any broader target integration.
