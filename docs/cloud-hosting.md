# FalkorDB Server and Cloud

Arcloom can use a local FalkorDB Server, embedded FalkorDBLite on Linux, or a managed FalkorDB Cloud instance. The graph is persistent investigation memory. The application, SQLite journal, evidence files and authenticated synthetic lab remain separate services.

[Documentation index](index.md) · [Operations](operations.md) · [Validation](testing.md)

## Connect a fresh workspace

Generate `.env` with `python scripts/configure.py` before configuring a graph. For a server or Cloud connection, set these privately:

```dotenv
ARCLOOM_GRAPH_MODE=server
ARCLOOM_GRAPH_HOST=<database host without a URL scheme>
ARCLOOM_GRAPH_PORT=<instance port>
ARCLOOM_GRAPH_USERNAME=<database ACL username>
ARCLOOM_GRAPH_PASSWORD=<database password>
ARCLOOM_GRAPH_SSL=true
```

Use the database credentials and actual port shown by your instance, rather than a Cloud management API token. A local server may use a blank ACL username. Preserve the generated admin and runner secrets. Start the lab and API, then run `uv run --frozen arcloom doctor` to check graph connectivity, synchronized memory, lab health and the audit chain.

**Workspace policy → Cloud graph connection** saves a target privately to `data/private/cloud.env`. Saving this form stages credentials; it does not migrate data or change the running graph. For an existing journal, follow the migration procedure below before switching.

## Choose appropriate storage

A non-TLS Cloud Free instance is for **disposable synthetic evaluation only**. The reviewed Free offering has no durable persistence or backups, and inactivity can stop or delete it. Keep sensitive reports and real customer data off a plaintext instance. Confirm the current [tier limits](https://docs.falkordb.com/cloud/tiers/free) and [connection requirements](https://docs.falkordb.com/cloud/console/connect) for the instance you create.

Keep the local journal, evidence and signing configuration even when the graph is hosted remotely. They are needed to reconstruct graph projections and verify historical receipts. A persistent deployment needs encrypted transport, durable storage, backups and a verified restore procedure. The [operations guide](operations.md) describes the application and runner requirements.

## Migrate an existing journal

Changing a graph host does not replay projection events already acknowledged by the old graph. The migration helper replays the complete historical projection log into a fresh target and verifies the result before an operator chooses cutover.

1. Stop all application writers and workers. Keep them stopped through staging, verification and cutover.
2. Preserve the journal, evidence and signing configuration together. Retain the source graph connection privately.
3. Save explicit target host, port, username, password and SSL in ignored `data/private/cloud.env`. The helper requires a Git-ignored private file.
4. Inspect the read-only plan, then apply it:

```powershell
uv run --frozen python scripts/migrate_graph.py --target-env data/private/cloud.env
uv run --frozen python scripts/migrate_graph.py --target-env data/private/cloud.env --apply
```

For a remote plaintext **synthetic-only** target, the apply command additionally requires `--allow-plaintext-synthetic`. Omit that attestation for a TLS-enabled target.

The helper uses a consistent source snapshot, replays every historical event, creates a fresh target graph, and refuses to overwrite an existing graph. Verification compares node/edge identity and properties, candidate paths, full-text indexes and source integrity. It produces a report; it never activates the target or rewrites `.env`.

After reviewing a successful applied report, copy the target connection settings and **exact graph prefix returned by that run** into `.env`, including `ARCLOOM_GRAPH_PREFIX`. Keep other configuration intact. Restart the backend and run `uv run --frozen arcloom doctor` before resuming work.

Do not clear outbox acknowledgements or seed an empty graph in place of migration. If returning to a stale local graph after remote activity, replay the current full journal into a fresh local graph and verify it before switching. A retained old graph is a recovery source, not automatic failover.

## Recorded verification

An executed staging run replayed 32 historical events into an actual Cloud graph, verified 43 nodes and 64 edges including properties and paths, and left the source unchanged. A separate live-provider investigation then confirmed the gateway → invoice → chain workflow against Cloud and the HTTP lab. These are bounded integration observations; [testing](testing.md) records the provider and validation context.
