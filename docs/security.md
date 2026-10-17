# Security model

The permitted target is the reviewed synthetic fixture catalog. No endpoint accepts an arbitrary scan URL, command, shell program, uploaded executable or production credential. Deliberately vulnerable fixture routes are exercised through an ASGI transport inside the runner process and are not mounted on its HTTP server.

## Controls implemented and tested

- Workspace-bound roles and high-entropy access tokens, stored only as hashes.
- HttpOnly, SameSite=Strict browser sessions; CSRF validation and exact-origin checks on mutations.
- Session expiry, token-rotation invalidation, member revocation and execution-time reviewer rechecks.
- Fixed Cypher templates and allowlisted labels/relationships; tenant-derived graph names.
- Registered test/asset pairing, revision and scope expiry, approval timeout, budgets and depth limits.
- Signed runner receipts matched against run/case/tenant/test/revision/asset; strict bounds on upstream responses.
- Content-addressed artifacts, immutable-by-API writes, hash verification, symlink/traversal rejection.
- Idempotent request keys, transactional budget reservations, execution fencing and manual retries after uncertain outcomes.
- No raw reports or execution credentials in model context. Invalid tools, invented evidence and arbitrary fields are rejected.
- No credentials or raw request bodies in ordinary HTTP logs; input values are removed from validation errors.

## Boundaries and remaining work

This is not a sandbox for executing untrusted generated code. The container isolation and internal network strengthen separation of the reviewed lab; they are not a license to add arbitrary exploitation tools. A real enterprise integration requires a new authorization model, signed asset inventory, egress enforcement, scoped credentials, safe test definitions and explicit assessment approval.

The app and lab runner share a signing secret. HMAC receipts establish integrity relative to that trusted runner, not independent forensic attestation. Rotating the runner key requires a versioned historical-key design before old receipts can be revalidated; that key-ring workflow is not implemented. Protect the journal, graph volume, artifacts and secrets together.

A hash-chained audit log cannot prevent a host administrator from replacing the complete chain. Export and independently anchor the head hash. There is no KMS integration, external immutable audit sink, penetration-test certification, production load guarantee or managed backup/restore service.

The default localhost session cookie is not Secure because development uses HTTP. Public deployment requires HTTPS, `ARCLOOM_COOKIE_SECURE=true`, exact allowed hosts/origins and a reviewed reverse proxy. Do not expose the development instance, graph port or runner port publicly. Docker app and lab run without root/capabilities; the vendor graph image has its own entrypoint and should not be assumed non-root.

## Reporting a problem

Use a private issue or contact the repository owner. Do not paste `.env`, real secrets or customer records. Describe the minimal synthetic reproduction and affected revision. Test-only fixtures and credentials are explicitly labelled and never intended for deployment.
