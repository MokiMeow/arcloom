# Evidence-aware graph intelligence

FalkorDB drives candidate discovery and makes its supporting evidence inspectable. Each operation uses a fixed query and server-resolved workspace identity. User and model input never becomes arbitrary Cypher.

[Documentation index](index.md) · [Architecture and schema](architecture.md)

## Graph capabilities in the product

| FalkorDB capability | Arcloom behavior | Implementation |
| --- | --- | --- |
| Parameterized Cypher and range index | Resolve entity identities and require current evidence-backed support for every test prerequisite | [graph.py](../src/arcloom/graph.py) |
| Multi-hop relationships | Follow findings, capabilities, assets, runs, decisions and historical provenance | [workflow.py](../src/arcloom/workflow.py), [intelligence.py](../src/arcloom/intelligence.py) |
| Persistent isolated graphs | Recover memory in fresh processes and separate workspace projections | [runtime.py](../src/arcloom/runtime.py) |
| Native full-text index | Search persisted entity titles/descriptions and inspect returned nodes | `GraphIntelligence.prepare/search` |
| Read-only queries | Inspect memory and experiment with withdrawn evidence while preserving history | `GraphIntelligence.withdraw` |
| PageRank over asset `CALLS` edges | Inspect dependency importance | `GraphIntelligence.diagnostics` |
| `GRAPH.EXPLAIN` | Show the actual candidate query execution plan without executing it | `GraphIntelligence.diagnostics` |

Search relevance is a retrieval aid rather than proof or duplicate identity. PageRank is an inspection measure; it does not drive selection or measure exploit probability. The five-test synthetic catalog uses exact prerequisites and native full-text retrieval. Larger corpora should motivate measured retrieval experiments while preserving exact revision and authorization filters.

## Evidence withdrawal

Select a current finding in Memory graph and choose **Run withdrawal analysis**. The backend reads the finding and its current descendants along recorded `DERIVED_FROM` edges, up to five hops. It retrieves enabled tests, their requirements and all current confirmed providers of those capabilities in the same workspace and revision.

For each required capability, the experiment removes providers in the withdrawn provenance set. A test remains supported only when **every** prerequisite retains at least one provider. Independent evidence may preserve a capability even when the original source is withdrawn. The UI shows before/after counts, provenance paths and alternative provider IDs.

```text
Finding A ──ENABLES──> Capability X <──REQUIRES── Test B
    ↑
    └──DERIVED_FROM── Finding C ──ENABLES──> Capability Y

Independent Finding D ──ENABLES──> Capability X

Withdraw A and its recorded descendants:
  X can remain supported by D.
  Y loses support when its only provider was C.
  Historical receipts are unchanged.
```

This measures prerequisite support. Full eligibility also depends on scope, approvals, prior attempts, depth and budgets. Recorded provenance is not a complete causal model of software: losing support does not prove a downstream flaw is fixed. Reproduction and revision-specific evidence remain necessary.

## Bounds and consistency

The demo permits up to 400 entities and 200 paths/prerequisite rows. It refuses an oversized analysis instead of quietly omitting support. Read endpoints require authentication and enforce rate limits. Analysis includes the journal event head; concurrent changes produce a retryable conflict. Search returns at most twenty results with explicit truncation. Query-plan output is bounded and reports truncation.

To inspect the mechanism, verify the gateway fixture, start a fresh investigator and inspect the exact supporting IDs and query. Confirm the invoice issue and chain separately. Challenge support with withdrawal analysis, then advance revision and revalidate with historical receipts intact. [Demo guide](demo.md).

## Primary references

[Full-text indexing](https://docs.falkordb.com/cypher/indexing/fulltext-index.html) · [PageRank](https://docs.falkordb.com/algorithms/pagerank.html) · [GRAPH.EXPLAIN](https://docs.falkordb.com/commands/graph.explain.html) · [FalkorDB documentation](https://docs.falkordb.com/)
