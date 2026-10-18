# Agent access to investigation memory

Arcloom exposes the same authenticated workspace through the browser, its HTTP
API and a read-only MCP bridge. Each surface returns existing evidence and graph
context; approval, execution and evidence acceptance remain separate UI/API actions.

## Verified handoff packet

`GET /api/memory/handoff` returns a versioned briefing for the signed-in member's
workspace. No tenant name, graph name or Cypher is accepted from the caller.

The packet contains the active revision, current confirmed findings, original
researcher attribution, evidence/run identifiers, SHA-256 digests and receipt
signature verification. Candidate follow-ups include their complete prerequisite
paths and named supporting findings. Reviewed negative and inconclusive results
remain observations, and blocked tests explain whether they need an initial
report, missing support, a depth allowance or a separate retry/revalidation path.

The builder validates findings against the journal, trusted test registry, signed
runner receipts and actual evidence bytes. Candidate paths come from FalkorDB and
must contain every required capability. A pending projection, invalid receipt,
invalid audit chain or changing source state produces an explicit error instead
of a partially verified briefing. Reading creates no agent session, model call,
investigation or approval.

The response includes `schemaVersion: 1`, `workspace`, `graph`, `audit`, `summary`,
`findings`, `candidates`, `observations`, `blocked` and `packet_sha256`. The digest
is SHA-256 over canonical UTF-8 JSON of the complete packet **without**
`packet_sha256`: sorted object keys, compact separators and unescaped Unicode,
matching `arcloom.storage.canonical`. It detects packet changes; it is not an
independently signed attestation or a replacement for reviewing original evidence.
The audit head likewise needs independent anchoring to detect wholesale history
replacement.

The overview's **Investigation handoff** briefing shows this data progressively.
Open a supporting investigation to inspect the receipt, or export the actual JSON
for another agent. A supported candidate is a reason to propose a test, not
permission to run it.

## MCP: connect an external agent

Install the locked Python environment and start the normal API and HTTP lab.
Create a **viewer** member token in Workspace policy for a read-only client, then
configure an MCP host with an absolute checkout path:

```json
{
  "mcpServers": {
    "arcloom": {
      "command": "uv",
      "args": [
        "--directory", "/absolute/path/to/arcloom",
        "run", "--locked", "arcloom-mcp"
      ],
      "env": {
        "ARCLOOM_MCP_URL": "http://127.0.0.1:8000",
        "ARCLOOM_MCP_TOKEN": "<workspace-viewer-member-token>"
      }
    }
  }
}
```

On Windows use an absolute Windows path with forward slashes, or escaped
backslashes. Keep the token in the host's private configuration or secret store,
never a committed configuration. The bridge deliberately reads its configuration
from the process environment, not the application's `.env` file. The server's
admin, graph, runner and provider credentials are unnecessary for the bridge.

| Tool | Inputs | Result |
| --- | --- | --- |
| `arcloom_handoff` | None | The verified current memory packet |
| `arcloom_investigations` | Optional `limit`, integer 1–20 | Workspace-visible investigation list |
| `arcloom_investigation` | Bounded `case_id` | One workspace-visible investigation and its recorded detail |

Each result has structured content `{ "ok": true, "data": ... }` and matching
JSON text. Failures set the MCP error flag and return a sanitized error code and
message. The official Python SDK handles stdio framing, discovery and negotiation.
The bridge requests only its fixed API routes, inherits the member's tenant and
authorization, and bounds request time and response size. It follows no redirects
and replays no cookies. HTTP is accepted only for a loopback API; use HTTPS for a
remote deployment. Report/evidence text is untrusted content, not instructions.

Suggested request to an agent: “Read the Arcloom handoff. Explain which follow-up
has complete current support, cite its supporting findings and evidence digests,
and distinguish reviewed observations from confirmed findings.”

## WebMCP: browser agents

In a browser implementing the current WebMCP imperative API, the signed-in
workspace registers the same three read-only tools with
`document.modelContext.registerTool`. Tool availability is shown only after
registration succeeds. Registration is removed on logout/unmount; requests use
the current authenticated same-origin session and honor cancellation. No tools
are exposed to additional origins, and no approval, execution, credential or
provider-setting tool is registered.

WebMCP is an evolving browser capability. If it is unavailable, the full ordinary
workspace and the standard MCP bridge continue to work. The project ships no
polyfill pretending that a browser-native API exists.

Sources: [official MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk),
[Chrome WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api),
[Chrome tool security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools).
