.PHONY: configure up down test format check web e2e doctor
configure:
	python scripts/configure.py
up:
	docker compose up --build -d
down:
	docker compose down
test:
	ARCLOOM_TEST_GRAPH=lite uv run --extra dev --extra lite pytest -q --cov=arcloom
format:
	uv run --extra dev ruff check src tests scripts --fix
	uv run --extra dev ruff format src tests scripts
	cd apps/web && npm run format
check:
	uv run --extra dev ruff check src tests scripts
	uv run --extra dev ruff format --check src tests scripts
	cd apps/web && npm run typecheck && npm test
web:
	cd apps/web && npm ci && npm run build
e2e:
	cd apps/web && npm run e2e
doctor:
	docker compose exec app arcloom doctor
