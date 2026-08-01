FROM ghcr.io/astral-sh/uv:0.10.0 AS uv
FROM python:3.13.12-slim-bookworm AS build
COPY --from=uv /uv /uvx /bin/
WORKDIR /app
COPY apps/worker-python/pyproject.toml apps/worker-python/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/worker-python/src ./src
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.13.12-slim-bookworm AS runtime
ENV PATH=/app/.venv/bin:$PATH
WORKDIR /app
RUN groupadd --system engrove && useradd --system --gid engrove --home-dir /app engrove
COPY --from=build --chown=engrove:engrove /app/.venv ./.venv
USER engrove
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --retries=10 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=2)"]
CMD ["engrove-worker"]
