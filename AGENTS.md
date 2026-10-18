# Development guide

Start with [README.md](README.md) and the [documentation index](docs/index.md).
The [architecture](docs/architecture.md) describes state transitions and the
[graph model](docs/graph-intelligence.md) explains the prerequisite queries.

## Product invariants

- Report, proposal, runner observation and reviewed finding are distinct states.
- Execution needs approval; confirmation needs a separate evidence review.
- FalkorDB supplies complete current prerequisites. Do not replace failed graph
  reads with journal-derived or invented eligibility.
- Evidence hashes, signed receipts, revision and tenant must agree before use.
- Negative and inconclusive results remain useful memory. Historical findings
  must not silently become current after deployment changes.
- Preserve atomic journal/outbox writes, fenced jobs, budgets and idempotency.
- Provider selection is explicit. Errors never trigger another provider or model.
- MCP and WebMCP tools are read-only and inherit workspace authentication.

## Local work

Keep `.env`, `data/`, member tokens and provider credentials private. Generate
configuration with `python scripts/configure.py`; it refuses to overwrite an
existing file. Use `arcloom demo --workspace data/presentation` for a separate
persistent presentation. Never erase investigation history to rerun a demo.

Follow [DESIGN.md](DESIGN.md) for interface changes. Use actual API records and
preserve keyboard, mobile, reduced-motion and role-restricted flows.

Run focused tests while editing and the commands in [testing](docs/testing.md)
before delivery. Integration tests require actual FalkorDB; injected graph doubles
belong to unit tests. Build frontend assets before starting browser tests, because
rebuilding assets while they are served invalidates those tests.

Describe verification precisely: a contract test, real graph query, live model
call and human review establish different things. Update current documentation
when interfaces change, and preserve private operational records outside the
public documentation set.
