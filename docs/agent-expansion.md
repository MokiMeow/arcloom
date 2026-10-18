# Extending reviewed investigation memory

Arcloom's working vertical slice is report → execution approval → synthetic test → evidence acceptance → graph memory → related hypothesis. It records attribution, positive/negative/inconclusive outcomes and the revision in which a conclusion applies. The same evidence contract is a foundation for broader authorized investigations.

[Documentation index](index.md) · [Architecture](architecture.md) · [Security boundaries](security.md)

## Product direction

A researcher could submit a report with reproduction evidence and an optional patch for an authorized program. Reviewed root cause, affected component, revision, trust boundary and attribution would become shared memory. Specialist investigators could query related components, code patterns, dependencies and recorded chains, then create separate hypotheses with explicit supporting paths.

Relatedness is a lead. It does not establish a vulnerability or expand permission. Each new finding needs its own reproduction and evidence acceptance. A patch needs regression checks and review before delivery. Negative and inconclusive work remains useful memory, and a changed deployment requires renewed applicability checks.

## A useful next vertical slice

A local test repository with two instances of the same authorization mistake would make a bounded extension: import a reviewed initial report, identify a related code location, independently reproduce it and prepare a patch for review. That tests the value of shared memory without making claims about arbitrary company repositories.

A repository integration would need versioned snapshots, file/line evidence, scoped asset inventory, approved execution definitions, enforced egress and protected credentials. Concurrent specialists would additionally need deduplicated tasks, per-program budgets, leases and cancellation. Preserve the current separation between proposing work, authorizing it and accepting its outcome.

The current application runs a five-test synthetic catalog. Researcher attribution is recorded; bounty and payout decisions belong to the relevant program and its human reviewers. Any expansion should be evaluated by independent reproduction and useful retained memory rather than a promised number of follow-up findings.
