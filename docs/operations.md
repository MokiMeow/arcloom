# Operations

Start with the README's local path. Python reads `.env` through typed settings. The standard-library configuration script refuses to replace existing credentials. The visible planner banner and readiness endpoint distinguish an actual graph/model connection from a planned integration.

## Persistent data

`data/journal.sqlite3` records transactions, approvals, jobs, audit events and the graph outbox. `data/evidence/` contains per-workspace content-addressed JSON receipts. Lite mode stores the real embedded FalkorDB database beside the journal. Compose uses separate named journal and graph volumes.

Keep all three stores together. A deployment restart must not reset the journal or silently seed previously confirmed findings. A new workspace identity is a new assessment, not an excuse to broaden authorization. Assessment expiry is measured from creation and is not extended by restarting the app.

## Diagnosis

- `/health/live` means the process responds; `/health/ready` additionally requires synchronized graph memory.
- `arcloom doctor` checks graph readiness, lab health and the audit chain.
- A graph outage queues projection work in the journal; graph-guided discovery and test authorization fail closed. Restore the graph and allow the worker to synchronize the outbox.
- A timed-out or interrupted test is inconclusive. Review it, request another attempt if appropriate, and approve anew. Do not edit the database to manufacture success.
- A model failure is recorded and consumes its reservation. It does not activate a hidden fallback. Check model ID, key, tool support and provider limits without posting the key in logs or issues.
- A new revision makes previous conclusions historical. A blocked prerequisite does not establish that every downstream flaw is repaired.
- Startup with missing/short owner or runner secrets fails. Generate configuration before launching; do not substitute known demo tokens.

## Backup and public deployment

A production backup service is not implemented. For a controlled backup, stop mutation and workers, save/checkpoint the graph, use SQLite's backup API rather than copying an active WAL database, and copy the immutable evidence directory plus separately secured configuration. Verify the resulting audit head and representative artifact hashes after restoration. Run a restoration drill before relying on this procedure for anything important.

Do not run multiple application replicas against the same file-based journal without a deliberate deployment design. Do not publicly expose the lab or graph. Public UI hosting requires TLS, exact allowed-host/origin configuration, secure cookies, access control, monitored secrets and reviewed network policy. No live deployment was created as part of the delivered application.
