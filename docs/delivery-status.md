# Development handoff

Validated on 17 October 2026 in the isolated development environment. This is a synthetic-lab development release, not a production security assessment service.

## Executed checks

| Check | Result |
|---|---|
| Backend, policy, evidence, and actual FalkorDB integration | 124 tests passed |
| UI component tests | 5 tests passed |
| Chromium browser scenarios | 3 tests passed |
| Clean npm installation | Passed |
| TypeScript and Vite production build | Passed |
| Frozen Python dependency installation, including dev and lite extras | Passed |

The browser suite exercises login, report submission, approval, evidence review, an independent graph-backed follow-up, chain verification, revision invalidation and revalidation. Separate scenarios cover mobile navigation and invalid credentials. The backend suite includes a separate operating-system-process memory handoff.

An earlier handoff reported a login regression. The subsequent clean installation, rebuild and full browser run passed. No specific root cause is claimed for that earlier report.

## Dependency lock

`uv.lock` preserves all 38 resolved package versions, dependency relationships, and source distribution hashes. Its wheel list is deliberately reduced to portable wheels and the tested CPython 3.14 Linux x86-64 wheels. Other platforms may build native dependencies from the pinned source distributions; they have not been validated. The Docker configuration uses Python 3.14. The npm lock retains the complete original dependency resolution.

## Limits of validation

- Docker-engine startup and container-network isolation have not been executed in this development environment. The Compose configuration is provided for local verification.
- OpenAI and Anthropic adapters were tested using provider-response mocks, not paid live API calls. The default planner is explicitly deterministic and does not call an LLM.
- Local passing tests do not establish a passing GitHub Actions run. The earlier repository preflight failed at startup before any job ran; its cause was not established.
- No public production deployment, real-target assessment, or hackathon submission has been performed.
- Test coverage is not exhaustive, and the result is not a guarantee that the software is free of defects.

## Start locally

```sh
python scripts/configure.py
docker compose up --build -d
```

Open `http://localhost:8000` and sign in with the value of `ARCLOOM_ADMIN_TOKEN` from your locally generated `.env`. Never commit or share that file. See `README.md`, `docs/operations.md`, and `docs/demo.md` for the workflow and remaining deployment checks.
