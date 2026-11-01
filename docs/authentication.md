# Accounts, private workspaces and credential storage

The main application uses real authenticated APIs. Creating an individual account
starts a separate, empty workspace; no reports, findings, agents or execution
history are invented. The registered synthetic fixture catalog remains because
it powers the actual controlled lab. The separate recorded-tour build is not
bundled in the ordinary application. Default deployment configuration builds the
ordinary application; the recorded-tour Vercel configuration requires explicit
selection. A static-only host still needs a persistent same-origin backend for
account access.

## Sign in and recover access

Choose **Sign in**, then use an email and password or **Create account**. An email
is a normalized login identifier; ownership is not verified and no mail delivery
service is configured. A new account owns only its own workspace. Existing teams
and operator tools can continue to use **Advanced workspace token access**;
registration never grants access to an existing workspace.

At signup, save the recovery code shown once. Downloading it is an explicit user
action; the application does not put passwords, tokens, session cookies or recovery
codes in local/session storage. A forgotten password requires the account email,
saved recovery code and a new password through **Reset account access**. Successful
recovery signs out existing sessions and replaces the code. There is no reset
email or recoverable copy of a lost code. An authenticated account can change its
password in **Workspace policy → Account & sign-in**, with current-password proof.
That also rotates the session and signs out other sessions.

Passwords are preserved exactly, including spaces, and require 12–128 Unicode
characters, at most 512 UTF-8 bytes, without control characters or lone surrogate
values. They use salted Argon2id (64 MiB, three iterations, four lanes); expensive
hash work is process-bounded. Passwords are never reversibly stored. Random
recovery codes, service tokens and session tokens use SHA-256 hashes because
they are high-entropy server-generated credentials. Wrong-account login/recovery
responses are generic, and request validation never echoes credential values.

Sessions remain server-side, with HttpOnly SameSite=Strict cookies, expiry,
exact-origin mutation checks and CSRF tokens held in application memory. Role
checks and tenant predicates still apply to every protected API. Registration
creates the tenant, owner, budget, catalog projection event and session atomically.
A graph outage preserves the account but blocks graph-dependent work.

Operators can set `ARCLOOM_SIGNUP_ENABLED=false` to close registration while
existing sign-ins continue. Public hosting requires HTTPS,
`ARCLOOM_COOKIE_SECURE=true`, exact allowed hosts/origins and a correctly reviewed
reverse proxy. These changes do not publish or configure a public host.

## Reusable service credentials

Provider API keys, ChatGPT profiles and staged graph passwords must be readable
by the server to connect, so they use authenticated encryption instead of password
hashing. Provider, OAuth, discovery settings and staged graph targets are isolated
per workspace. New accounts start with the deterministic provider and inherit no
operator provider key or OAuth identity. Shared graph/runner transport remains
internal infrastructure; tenant graph namespaces and journal records remain
separate, and operator connection metadata is not exposed to new accounts.

Protected files use a Fernet envelope bound to their tenant and purpose. Supply
`ARCLOOM_PRIVATE_ENCRYPTION_KEY` securely through your deployment's secret manager,
or the application creates a separate `0600` `.private-key` inside each private
workspace directory. Existing validated local plaintext provider/OAuth/staging
files migrate atomically on read. Tampering, missing keys and unsafe paths fail
closed. Windows ChatGPT DPAPI protection remains inside the envelope.

Back up the encryption key together with its encrypted files, plus the journal,
graph, evidence and signing configuration. Do not replace a key without decrypting
and re-encrypting the existing data. A local key file does not protect against a
full host compromise. Initial operator credentials in environment/`.env` still
need deployment secret management; the entire journal/evidence volume is not
encrypted by this feature. Database passwords are never returned in API responses.

## Dashboard preferences and complete identifiers

**Customize layout** enables mouse/touch handles, keyboard movement, explicit
move controls, standard/full-width panels and reset. Only versioned widget IDs
and width preferences are stored locally, under a key scoped to workspace and
account. Credentials and API records are never persisted there; blocked or corrupt
storage falls back to a usable default layout.

Case, run, graph, actor and artifact IDs remain complete and wrap on narrow
screens. **Copy** uses the exact value; if clipboard access is unavailable, a
selected manual-copy field is offered. Changing a displayed identifier never
changes or shortens the value used by evidence verification.
