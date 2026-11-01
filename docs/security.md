# Security model

Arcloom executes a reviewed synthetic fixture catalog. No endpoint accepts an arbitrary scan URL, command, shell program, uploaded executable or production credential. Vulnerable fixture routes run through ASGI transport inside the authenticated runner and are not mounted on its public HTTP surface.

[Documentation index](index.md) · [Architecture](architecture.md) · [Operations](operations.md)

## Controls

- Separate private workspaces for individual email/password accounts; workspace-bound roles and high-entropy service tokens stored as hashes.
- Salted Argon2id passwords, bounded concurrent hashing, login/recovery rate limits, single-use hashed recovery codes and session rotation.
- Tenant-specific provider/OAuth/graph-staging credentials protected by authenticated encryption, with no inherited operator provider credentials.
- HttpOnly, SameSite=Strict browser sessions, CSRF validation and exact-origin mutation checks.
- Session expiry, token-rotation invalidation, member revocation and execution-time reviewer rechecks.
- Fixed Cypher templates, allowlisted labels/relationships and workspace-derived graph names.
- Registered test/asset pairing, revision and scope expiry, approval timeout, budgets and depth limits.
- Signed runner receipts matched to run/case/workspace/test/revision/asset and bounded upstream responses.
- Content-addressed artifacts, immutable-by-API writes, hash verification and symlink/path traversal rejection.
- Idempotency, transactional budget reservations, execution fencing and explicit retries after uncertain outcomes.
- Bounded model context without raw reports or execution credentials; invented evidence, invalid tools and unexpected fields are rejected.
- Ordinary HTTP logs exclude credentials and raw request bodies; validation errors omit input values.

[Testing](testing.md) identifies the exercised paths and their limits. These controls support a bounded demonstration; they do not establish a production security certification.

## Trust boundaries

The application and lab runner share a signing secret. HMAC receipts establish integrity relative to that trusted runner, rather than independent forensic attestation. Protect host access, configuration and data together. Before rotating the signing key, design historical-key lookup so earlier receipts remain verifiable.

A local hash chain detects inconsistent audit history relative to a trusted head. A host administrator able to replace the complete history can replace that chain as well. Export and independently anchor its head when you need protection against wholesale replacement.

The container network separates the reviewed lab; it is not a sandbox contract for arbitrary generated exploitation code. A broader enterprise integration needs signed asset inventory, per-target authorization, approved safe tests, egress enforcement, scoped credentials and explicit assessment approval. [Product direction](agent-expansion.md) describes a bounded extension.

See [account and credential storage](authentication.md) for exact password, recovery, key-management and migration behavior. The application does not encrypt the entire journal or evidence volume; deployment-level durable storage protection remains separate.

## Deployment requirements

Local development uses HTTP, so its session cookie is not Secure. A public deployment requires HTTPS, `ARCLOOM_COOKIE_SECURE=true`, exact hosts/origins and a reviewed reverse proxy. Keep graph and runner ports private. The Compose app and lab run without root/capabilities; the vendor graph image has its own entrypoint and should not be assumed non-root.

Use encrypted durable graph hosting for sensitive records. A plaintext Cloud Free instance is for disposable synthetic evaluation. Coordinate journal, graph, evidence and protected signing configuration in backups, and verify restoration before depending on a deployment. [Operations](operations.md) and [graph hosting](cloud-hosting.md) provide the procedure.

## Report an application issue

Contact the repository owner privately with a minimal synthetic reproduction and the affected revision. Exclude `.env`, tokens, customer records and private evidence. Test fixtures and public test credentials are labelled for disposable testing and must never be deployed.
