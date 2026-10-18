# Why we built Arcloom

Arcloom began with the project owner's idea: a narrowly scoped security report should help another investigator ask a better next question. A researcher may identify one issue while related consequences sit beyond that first report's scope. The useful handoff preserves the original researcher's attribution, explains the relationship, and keeps a person responsible for authorizing the next investigation.

The owner defined that flow, directed the product and design priorities, chose account and hosting integrations, and reviewed the interface, diagrams, narration and demonstration. Revisions to graph spacing, arrow direction, readable evidence, mobile navigation and presentation followed that review. Coding assistants supported implementation and verification under this direction; the [assistance disclosure](../AI_USAGE.md) records their role.

## The question we chose to answer

**What should a fresh investigator inherit when the previous conversation is gone?**

A useful answer needs more than a summary. It needs the evidence, its review status, the system revision it describes, the attribution behind it and the prerequisites it can actually support. Arcloom makes those relationships inspectable in FalkorDB.

## Decisions that shaped the product

- **A capability connects findings to tests.** A reviewed gateway result can support a separate invoice investigation without pretending the invoice issue is already proven.
- **Approval and evidence acceptance stay separate.** The next investigator proposes one bounded test. A person authorizes execution and separately reviews the resulting observation.
- **Memory includes uncertainty.** Negative and inconclusive observations prevent repeated work and preserve what remains unresolved.
- **Revision is part of truth.** An old finding remains available as history while a new deployment requires fresh support.
- **The handoff is inspectable.** Supporting findings, relationship paths and evidence digests travel together, including through read-only MCP tools.

The synthetic lab makes these choices reproducible: gateway, invoice and chain tests produce concrete observations, and patched `r2` changes which prerequisites are supported. The [engineering story](blog/README.md) walks through the actual run; the [architecture](architecture.md) explains the implementation.

## What visitors can try

The public UI demo offers two recorded synthetic states for exploring cases, memory, evidence and revision changes. It is labelled as a demo throughout. The full application supports approved execution, evidence review and optional live-model planning through the [local setup](../README.md#run-locally). A fully hosted investigation service additionally needs persistent API, journal, evidence and runner hosting alongside FalkorDB.
