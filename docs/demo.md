# Demo: memory changes the next investigation

Use an empty persistent workspace with graph, API and lab running. Run `uv run --frozen arcloom doctor` and check the visible planner mode. The default is deterministic; live planning requires your own [configured provider](provider-setup.md). Every weakness below is a deliberately seeded synthetic fixture.

[Documentation index](index.md) · [Watch the demo](https://youtu.be/Z8RMloVLsig) · [Engineering story](blog/README.md)

## Start a separate presentation workspace

Keep the configured FalkorDB connection and ordinary `arcloom lab` process running. Then launch:

```bash
uv run --frozen arcloom demo --workspace data/presentation --port 8002
```

Open [the presentation workspace](http://127.0.0.1:8002) in a separate browser profile or private browsing session. Session cookies share a hostname across ports, so a separate normal browser window alone does not isolate sessions. Sign in with the admin token from your private `.env`.

The command creates a separate journal and graph identity, defaults to deterministic planning and preserves the main workspace's history. Repeating it resumes the same presentation. Its descriptor records connection metadata and refuses to resume against a changed graph connection. It does not copy provider credentials into that descriptor. Keep the graph and lab available throughout.

## Walkthrough

1. Submit **Gateway trusts an unverified routing context** with the original researcher's attribution. The case begins at `awaiting_approval`.
2. Approve its registered lab test. Inspect the actual observations, signed receipt and SHA-256. Accept the recorded outcome to create the first finding.
3. Start a fresh investigator. Inspect the new agent session and the FalkorDB path showing how the gateway finding's capability makes the invoice test eligible.
4. Approve and review the invoice test. Its observation verifies a separate tenant-ownership weakness.
5. Start another fresh investigator. Both verified capabilities now support the chain test. Approve it and inspect its sequential execution under one synthetic identity and revision.
6. Run the export negative control and unavailable audit test. Accept their recorded outcomes. They remain negative or inconclusive memory and do not become confirmed findings or unexplored candidates.
7. In Workspace policy, give a rationale and advance to patched `r2`. Earlier findings remain visible with unchanged receipts but become historical. Request revalidation and inspect the new blocked or not-reproduced observation before reviewing it.

The [browser suite](testing.md) exercises the central workflow with actual FalkorDB and a separate authenticated HTTP lab. Evidence review is a distinct checkpoint from execution approval.

## Demonstrate a real process boundary

After accepting the preceding result in the presentation UI, launch a new
command-line process against that same persistent workspace:

```bash
uv run --frozen arcloom agent-once --workspace data/presentation
```

The `--workspace` argument loads the presentation's journal, tenant and graph
identity. Omit it to use the standard workspace configured by `.env`. Check a
presentation's readiness with `uv run --frozen arcloom doctor --workspace
data/presentation`. A UI fresh context and a new operating-system process are
different demonstrations; show which one you actually used.

The command proposes one investigation from persisted memory. It does not approve or execute that test. Close the process, review the next completed result in the UI, then launch another process. The separate-process integration test checks distinct operating-system process IDs; creating a fresh UI session alone demonstrates a fresh context rather than an OS restart.

## Inspect the boundaries

Submit an API report with an unregistered test/asset pair and observe rejection before execution. The test catalog is the permitted target inventory. There is no need to contact an external host to demonstrate scope enforcement.

Search the graph, select a current finding and run withdrawal analysis. Follow the recorded provenance and inspect whether independent evidence still supports a capability. PageRank describes dependency structure; withdrawal describes prerequisite support. Neither is a vulnerability probability or proof that every downstream issue is patched.

The workflow demonstrates evidence-backed memory, controlled execution, fresh-context continuation and revision-aware conclusions. The [engineering story](blog/README.md) explains the implementation, and the [demo assets](media/README.md) include the narrated walkthrough and captions.
