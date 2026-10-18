# Provider setup

Arcloom starts in deterministic mode: the graph, lab execution, evidence review and persistence workflow need no external model key. Connect a provider when you want a live model to select among verified graph candidates. Each operator supplies their own account, credentials and quota; no development provider profile is included in a fresh checkout.

[Documentation index](index.md) · [Validation results](testing.md)

## Configure in the workspace

Sign in as administrator and open **Workspace policy → Planner configuration**. Choose deterministic, OpenAI API, ChatGPT subscription, Anthropic, Gemini or Cloudflare Workers AI.

For an API provider, enter a model ID supported by your account and its API key; Cloudflare also needs an account ID. **Save provider** applies the selection to new investigations without restarting. Each provider keeps a separate model and credential. Leaving the key blank preserves that provider's saved credential. Stored keys are never returned to the browser.

**Test connection** makes a bounded live diagnostic request, consuming available quota and model-call budget. A successful diagnostic establishes that request's transport and response contract; it does not create evidence or prove investigation quality. Authentication alone is not an inference test.

Initial values come from `.env`. Saved profiles in ignored `data/private/providers.json` take precedence. Environment-backed credentials remain environment references. An investigation already running retains its original provider, model and connected account. Failures stay attached to the selected provider; the application does not silently switch services.

## API providers

Set these privately in `.env` if you prefer initial environment configuration, then restart the API:

```dotenv
ARCLOOM_PROVIDER=openai
ARCLOOM_MODEL=<tool-capable model ID available to your account>
ARCLOOM_MODEL_API_KEY=<your provider API key>
```

| Provider value | Model and authentication | Official setup |
| --- | --- | --- |
| `openai` | OpenAI project API key and a compatible Responses model | [API quickstart](https://developers.openai.com/api/docs/quickstart) |
| `anthropic` | Claude API key and a tool-capable model; use a single-workspace key for this adapter | [Claude API](https://platform.claude.com/docs/en/api/overview) |
| `gemini` | Google AI Studio key and a bare Gemini model ID | [API keys](https://aistudio.google.com/api-keys), [model catalog](https://ai.google.dev/gemini-api/docs/models) |
| `cloudflare` | Workers AI token, account ID and one supported Clef model | [REST setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) |

The application reads `ARCLOOM_MODEL_API_KEY`; generic SDK variables such as `OPENAI_API_KEY` are not its configuration contract. Provider APIs have independent model access, billing, quota and data policies. Use synthetic data when evaluating free tiers. Consult each provider's current catalog rather than assuming an example model is available to every account.

### Cloudflare

Add the account ID and a supported model:

```dotenv
ARCLOOM_PROVIDER=cloudflare
ARCLOOM_MODEL=@cf/cloudflare/clef-flash
ARCLOOM_CLOUDFLARE_ACCOUNT_ID=<your account ID>
ARCLOOM_MODEL_API_KEY=<your scoped Workers AI token>
```

A Workers AI API token should be scoped to the intended account. No Worker deployment is required; FastAPI calls the REST API directly. The adapter accepts Clef, Clef-flash and Clef-omni for structured text decisions. See the [decision contract](cloudflare-clef.md).

For local development with an existing Wrangler login:

```powershell
uv run --frozen python scripts/cloudflare_setup.py --account-id <your account ID>
```

The helper privately copies the current credential into `.env`, selects Clef-flash,
preserves other settings and prints no token. `CLOUDFLARE_API_TOKEN`, if set, takes
precedence. Cloudflare controls the copied OAuth token's expiry.

For a bounded local presentation period, initial setup also accepts
`--wrangler-until <Unix UTC deadline>` within the next four days. After one backend
restart, Arcloom obtains a current Wrangler credential before an actual
environment-owned Cloudflare planning call, within that fixed window. It preserves
the selected provider/model and captured plans; status reads and UI-saved keys do
not invoke Wrangler. Renewal shares the planning time budget and stops explicitly
if the CLI session is unavailable. It does not extend Cloudflare's grant lifetime.

Scheduled local maintenance can run the following credential-only command. It
requires the existing matching Cloudflare account and unexpired opt-in deadline,
and never changes the provider/model or extends that deadline:

```powershell
uv run --frozen python scripts/cloudflare_setup.py --refresh-only --account-id <account ID> --env-file <absolute path to .env>
```

The local machine and valid Wrangler login must remain available. Outside that
window, refresh deliberately and restart as needed, or use a scoped API token
for unattended hosting. Keep scheduled jobs and credentials in private machine
configuration rather than the public repository.

## ChatGPT subscription

Choose **ChatGPT subscription → Continue with ChatGPT**, review the consent screen, and return to the workspace. Select a model from the connected account's catalog, then **Save provider** and **Test connection**. The displayed configured planner account is separate from the most recent sign-in; adding an account does not silently change the planner.

This local-app connection uses dynamic client registration, PKCE, state/nonce and signed identity-token validation. Authorized credentials are encrypted with Windows DPAPI on Windows and protected with owner-only file permissions on Unix. Refresh is serialized across processes and replaces rotating tokens together. Disconnect attempts remote revocation and reports when that cannot be confirmed.

Subscription inference uses Responses streaming with `store:false`, terminal-completion checks and bounded time, size and output. The connection imports no browser cookies, Codex credentials or ChatGPT conversation history. An OAuth grant does not belong in the API-key field. OpenAI API-key mode has separate API billing. Check the [official local-app integration](https://developers.openai.com/siwc/token-sharing-open-source), [inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) and applicable requirements before changing the deployment model.

CLI equivalents are `arcloom providers`, `arcloom provider-test` and `arcloom chatgpt-login`.

## Verify a live investigation

Run `uv run --frozen arcloom doctor` to check local services. Doctor checks readiness; it makes no paid inference request and does not prove a provider credential.

Use a fresh isolated evaluation workspace with an eligible graph candidate. Run a diagnostic or request a new investigation, then inspect its provider, model, usage and decision receipt. A valid abstention is a valid transport result, not a successful candidate choice. Keep exhausted or failed attempts in memory; do not erase evidence merely to force another model call.

[Testing](testing.md) records which adapters have completed live calls and which have contract-test coverage. The [graph connection guide](cloud-hosting.md) covers Server/Cloud setup independently of model providers.
