# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS web
WORKDIR /build/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM python:3.14-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PATH="/app/.venv/bin:$PATH"
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY src/ ./src/
RUN pip install --no-cache-dir uv==0.12.19 && uv sync --frozen --no-dev --no-editable && useradd --uid 10001 --create-home --shell /usr/sbin/nologin arcloom \
    && mkdir -p /app/data && chown -R 10001:10001 /app/data
COPY --from=web /build/apps/web/dist ./apps/web/dist
USER 10001:10001
EXPOSE 8000
CMD ["arcloom", "serve", "--host", "0.0.0.0", "--port", "8000"]
