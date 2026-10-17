# Graph Hacks submission audit

Checked against the [official rules](https://www.wemakedevs.org/hackathons/falkordb/rules), [challenge and FAQ](https://www.wemakedevs.org/hackathons/falkordb), and [schedule](https://www.wemakedevs.org/hackathons/falkordb/schedule) on 17 October 2026. This is a preparation audit, not a submitted entry or a guarantee of eligibility.

**Deadline: 18 October 2026, 11:59 PM IST.** Teams may have one to four members; a person may belong to one team. The current rules and FAQ allow entering multiple tracks. Recommended declarations: **Track 01: Agents That Act on Connected Data**, and **Track 02: Agent Memory and Coordination**. Do not claim Track 03 merely because the graph contains business assets.

## Required submission items

| Requirement | Current status | Evidence or remaining action |
|---|---|---|
| FalkorDB is central, not a decorative graph | Implemented and locally tested | Candidate eligibility comes from FalkorDB relationships; graph outages fail closed. |
| Public source-code repository | **Not met yet** | The repository remains private as requested. Owner must approve publication and review secrets, attribution and license first. |
| README, setup and graph model | Present | README, architecture, operations and graph-intelligence docs. A clean Docker startup still needs execution on a Docker-capable host. |
| Essential Cypher/algorithms | Present | Fixed queries in `graph.py` and `intelligence.py`; the UI shows returned paths and native query plans. |
| Working demo video | **Not created or submitted** | Record the actual workflow below, not only diagrams or a simulated interface. |
| Deployment or complete local setup | Local instructions present; deployment not verified | Public hosting is not mandatory when complete local setup and a working video are provided. Test setup on a second machine. |
| Track declaration | Drafted here | Select the tracks in the actual submission panel. |
| AI-assistance disclosure and participant understanding | Disclosure file present; participant verification outstanding | Read `AI_USAGE.md`. Both teammates must understand and meaningfully review/test/contribute; AI-authored code alone is insufficient. |
| Permitted data | Synthetic lab only in implementation/tests | Do not ingest private, login-protected, paywalled or personal material for this submission. |
| Main work during event | Development history is within the event window | Preserve commits and honestly identify reused dependencies and human contributions. |
| Registration, team membership and submission form | **Not verified** | Sign in to the organizer panel, check the registered team, enter required links and submit before the deadline. |

No numeric judging weights were found in the reviewed official pages. Treat traceable decisions, working graph-backed behavior, persistent memory, technical understanding, and a clear demo as alignment goals, not invented scoring percentages. The organizer's [graph-agent guide](https://www.wemakedevs.org/blogs/how-to-build-an-agent-that-reasons-over-a-graph) supports showing real paths, controlled queries and honest handling of missing evidence; where a guide differs from current formal rules, verify the rules and actual submission panel.

## Suggested demonstration (about four minutes, an editorial choice)

1. Explain the synthetic lab and original researcher attribution. Submit the gateway report.
2. Show scope approval, the actual bounded test, evidence-integrity check, and reviewer confirmation.
3. Terminate Agent A. Start Agent B without previous messages. Show the persisted supporting path and registered invoice follow-up.
4. With Cloudflare credentials configured, show a real Clef decision receipt. Clearly label the default deterministic mode when no live model is configured; never present a mock as live inference.
5. Approve and verify the distinct invoice issue, then the combined chain. A path alone is not chain proof.
6. Open graph search and native diagnostics. Withdraw a finding and inspect which prerequisite support disappears or survives independently.
7. Advance to the patched lab revision, show historical/stale conclusions, and revalidate. Show an out-of-scope proposal being denied before execution.

The process-handoff test is also reproducible from `tests/integration/test_process_handoff.py`. The UI's fresh agent context and that separate-process test are related but different demonstrations; do not claim the UI itself terminates operating-system processes.

## Release gates still open

- Live Cloudflare account inference and workload evaluation; current provider tests use mocks.
- Docker-engine startup and container network isolation on a Docker-capable host.
- A passing GitHub Actions run. The last inspected run failed at startup before any jobs; the cause is unconfirmed.
- Owner-approved repository publication, working video URL, and completed organizer submission.
- Participant code review and meaningful contributions, accurate README/demo links and ownership agreement.

## Submission description draft

Arcloom gives security investigators evidence-backed memory in FalkorDB. A verified synthetic report links assets, capabilities, test conditions and artifacts. A fresh agent retrieves those relationships to choose a separate authorized follow-up; Cloudflare Clef can score the offered choices or abstain. Tests and reviewer decisions, not model confidence, establish findings. A read-only withdrawal analysis exposes how conclusions depend on evidence, preserves independent support, and leaves historical receipts intact. Revision-aware revalidation prevents old observations from silently becoming current truth.
