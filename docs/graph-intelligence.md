# Evidence-aware graph intelligence

The graph drives candidate discovery; the added tools make its assumptions inspectable. Every operation uses a fixed query and server-resolved tenant identity. No user or model may supply arbitrary Cypher.

## Actual FalkorDB capabilities used

| Capability | Product behavior | Implementation |
|---|---|---|
| Parameterized Cypher and range index | Resolve graph identities and match current evidence-backed capabilities to every required prerequisite. | `src/arcloom/graph.py` |
| Multi-hop relationships | Connect findings, capabilities, assets, runs, decisions, and historical revisions; follow recorded provenance. | `graph.py`, `workflow.py`, `intelligence.py` |
| Persistence and isolated graphs | Fresh processes recover memory; tenant graphs are separate; no in-memory fallback impersonates FalkorDB. | `runtime.py`, graph integration and process-handoff tests |
| Native full-text index | Search persisted entity titles and descriptions and inspect returned nodes. Relevance is not duplicate identity or proof. | `GraphIntelligence.prepare/search` |
| Read-only queries | Inspect memory and perform an evidence-withdrawal experiment without changing historical observations. | `GraphIntelligence.withdraw` |
| Native PageRank over asset CALLS edges | Inspect dependency importance. It does not measure vulnerability severity or exploit probability. | `GraphIntelligence.diagnostics` |
| GRAPH.EXPLAIN | Show the actual execution plan of the candidate-discovery query without executing that query. | `GraphIntelligence.diagnostics` |

These additions do not claim every FalkorDB feature is necessary. GraphRAG SDK, Graphiti, vector search, MCP transport, graph-copy simulations, constraints, cluster operation, and replication are not implemented by this upgrade. A five-test synthetic catalog does not justify fabricated embeddings or an additional memory framework. Before expanding to real corpora, evaluate hybrid full-text/vector retrieval with real versioned embeddings and retain exact authorization/revision filters.

## Evidence withdrawal, not a claimed universal patch simulator

Select a current finding in Memory graph and choose **Run withdrawal analysis**. The backend retrieves that finding plus current descendants linked through recorded `DERIVED_FROM` edges, up to five hops. It retrieves every enabled test's prerequisites and all current confirmed providers of those capabilities from the same tenant and deployment revision.

For each required capability, the experiment removes providers in the withdrawn provenance set. A test remains supported only when **every** prerequisite still has at least one provider. An independently sourced finding can preserve a capability even when the original source is withdrawn. The UI displays before/after counts, actual provenance paths, and the IDs of alternative evidence providers.

```text
Finding A ──ENABLES──> Capability X <──REQUIRES── Test B
    ↑
    └──DERIVED_FROM── Finding C ──ENABLES──> Capability Y

Independent Finding D ──ENABLES──> Capability X

Withdraw A and its recorded descendants:
  X can remain supported by D.
  Y loses support when its only provider was C.
  Historical receipts are unchanged. Reproduction must still be tested.
```

The calculation concerns **evidence/prerequisite support**, not all execution eligibility. Scope, approvals, prior attempts, depth, and budgets are checked elsewhere. A downstream issue may remain independently exploitable after an upstream patch; this tool does not assert otherwise. A provenance dependency is not automatically a complete causal model of software behavior.

The analysis caps entity count at 400 and paths/prerequisite rows at 200 for this demo. It refuses oversized analyses instead of silently reporting incomplete results. All read endpoints are authenticated and rate limited. The response includes the journal event head; changes during analysis cause a retryable conflict. Native search returns at most twenty results with explicit truncation. Query-plan output is capped and reports truncation.

## Show judges the mechanism

First verify the gateway fixture, stop the first investigator, and start a fresh one. Display the exact Cypher and supporting IDs that made the invoice test eligible. Verify the separate issue and then the combined chain with actual tests and evidence review. Use withdrawal analysis to challenge the supporting graph, and show alternative support where it exists. Advance the lab revision and revalidate instead of erasing old receipts.

Do not present PageRank as part of the selection policy: it is currently an inspection tool. Do not claim a graph-selected registered test is unconstrained zero-day generation. The novelty demonstrated is verifiable, transferable security memory and explicit handling of outdated or withdrawn support.

## Primary documentation

[Full-text indexing](https://docs.falkordb.com/cypher/indexing/fulltext-index.html), [vector indexing](https://docs.falkordb.com/cypher/indexing/vector-index.html), [PageRank](https://docs.falkordb.com/algorithms/pagerank.html), [GRAPH.EXPLAIN](https://docs.falkordb.com/commands/graph.explain.html), [GRAPH.COPY](https://docs.falkordb.com/commands/graph.copy.html), [constraints](https://docs.falkordb.com/commands/graph.constraint-create.html), [FalkorDB documentation](https://docs.falkordb.com/).
