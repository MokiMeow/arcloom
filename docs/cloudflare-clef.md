# Cloudflare Clef decision adapter

The Cloudflare adapter selects among evidence-backed graph candidates through Workers AI. Clef, Clef-flash and Clef-omni use the same bounded structured-text contract in Arcloom. FastAPI calls the official REST API directly; using the provider does not deploy the backend to Workers.

[Documentation index](index.md) · [Provider setup](provider-setup.md) · [Validation](testing.md)

## Decision contract

1. FalkorDB identifies eligible revision-compatible registered tests and their verified prerequisites.
2. Arcloom verifies supporting evidence before providing up to ten candidates.
3. A `choice` question selects a candidate or `abstain`; a separate `noul` question scores uncertainty or contradiction.
4. The response must match the requested model, question IDs, types, candidate IDs, finite normalized probabilities and reported usage.
5. A choice becomes a proposal only when confidence is at least 0.70, the top-two margin is at least 0.15 and caution is below 0.50. These initial configurable thresholds are not calibrated guarantees.
6. Abstention becomes `needs_review`: it consumes the recorded model call and creates no test job or finding.
7. A proposal still needs deterministic scope/budget checks, human execution approval, a registered synthetic test and separate evidence acceptance.

The explanation is assembled from the actual graph path; it is not presented as model-written prose. Application code attaches trusted source findings. The decision receipt persists option probabilities, confidence, margin, caution, latency, token usage, input hash, model ID and an estimated inference cost. Inspect receipts in Agent activity.

Input is capped at 20,000 UTF-8 bytes, including instructions and questions. The adapter exposes candidate decisions rather than arbitrary URLs, shell commands, Cypher or generated code. Provider errors are explicit. The current Omni adapter sends structured text; media processing requires a separately designed intake and evidence contract.

## Configure

Create private credentials with `python scripts/configure.py`, then use Workspace policy or set:

```dotenv
ARCLOOM_PROVIDER=cloudflare
ARCLOOM_MODEL=@cf/cloudflare/clef-flash
ARCLOOM_CLOUDFLARE_ACCOUNT_ID=<your account ID>
ARCLOOM_MODEL_API_KEY=<your scoped Workers AI token>
ARCLOOM_CLEF_MIN_CONFIDENCE=0.70
ARCLOOM_CLEF_MIN_MARGIN=0.15
```

The adapter accepts full IDs or the short names `clef`, `clef-flash` and `clef-omni`. Restart after changing environment values. The [provider guide](provider-setup.md) covers saved profiles and the existing-Wrangler-login helper, including its expiring credential snapshot.

## Evaluate a model choice

Contract tests cover malformed output, abstention, unknown choices, invalid usage, account-path validation and provider errors. Recorded live Clef-flash calls returned valid low-confidence abstentions under unchanged thresholds. That establishes transport compatibility for those calls, not candidate-selection quality. [Testing](testing.md) gives the current evidence.

Compare models on the same labeled candidate sets and graph evidence. Keep evaluation labels outside model inputs, separate tuning from held-out evaluation, and measure correct selection, unsafe choices, abstention, latency and usage. Decision confidence is not vulnerability probability. Consult current [model documentation](https://developers.cloudflare.com/workers-ai/models/) and [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) for availability and rates.
