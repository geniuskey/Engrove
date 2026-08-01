# Engrove Phase 0 Execution Specification

> **Status:** Accepted for implementation  
> **Scope:** Community repository only  
> **Parent plan:** [Engrove Development Plan](../product/engrove-development-plan.md) Draft v0.6  
> **Last updated:** 2026-08-01

## 1. Outcome

Phase 0 produces a reproducible Community monorepo in which the web, API, Node orchestration worker, Python scientific worker, PostgreSQL, Redis, and MinIO start locally and are verified in CI.

It does not implement authentication, organizations, configurable records, units, files, datasets, charts, tasks, Enterprise modules, or other business behavior.

## 2. Fixed implementation choices

- license: AGPL-3.0,
- JavaScript runtime: Node.js 24 LTS, pinned in a repository version file,
- JavaScript package manager: pnpm, exact stable version in `packageManager`,
- JavaScript workspace orchestration: Turborepo,
- Python runtime: CPython 3.13, pinned in `.python-version`,
- Python project and lock manager: uv with committed `apps/worker-python/uv.lock`,
- backend framework: NestJS on the default Express adapter,
- frontend: React, TypeScript, and Vite,
- database: PostgreSQL 18,
- ORM and migrations: Drizzle with `node-postgres` and reviewed generated SQL,
- job transport: Redis and BullMQ from the Node orchestration worker only,
- scientific service: private Python FastAPI process,
- TypeScript tests: Vitest,
- Python tests: pytest,
- browser tests in later phases: Playwright,
- deployment baseline: Docker Compose.

All package versions and container tags selected during bootstrap must be stable and committed in lockfiles or manifests. CI records resolved tool versions. Release candidates, floating `latest` image tags, and unpinned Git dependencies are prohibited.

## 3. Community-only boundary

Phase 0 must not create:

- an Enterprise repository or directory,
- Enterprise package names or database schemas,
- license checks or commercial feature flags,
- disabled Enterprise UI,
- runtime plugin loading,
- empty extension interfaces for hypothetical future features.

The only Enterprise-related material allowed is the repository-boundary ADR and prose explaining that Community is independent.

## 4. Target repository shape

```text
engrove/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker-python/
│       ├── pyproject.toml
│       └── uv.lock
├── packages/
│   ├── config/
│   ├── database/
│   ├── shared/
│   └── ui/
├── deploy/
│   ├── compose/
│   └── docker/
├── docs/
│   ├── adr/
│   └── architecture/
├── scripts/
├── .github/workflows/
├── .env.example
├── .python-version
├── LICENSE
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── turbo.json
```

Do not create `units`, `permissions`, `sdk`, or other packages until their first Community consumer is implemented. The target layout in the parent plan describes the eventual monorepo, not a requirement for empty Phase 0 packages.

## 5. Package responsibilities

### `apps/web`

- Vite React application,
- React Router shell,
- basic Community landing/status page,
- API health status display with an actionable unavailable state,
- no authentication or product navigation placeholders,
- unit test for the landing/status behavior.

### `apps/api`

- NestJS HTTP entry point,
- separate Node worker entry command built from the same codebase and image,
- request ID middleware,
- structured JSON logging with secret redaction,
- configuration validation,
- liveness and readiness endpoints,
- PostgreSQL, Redis, and object-storage readiness probes,
- baseline Drizzle connection and empty initial migration,
- no business controllers or tables.

### `apps/worker-python`

- FastAPI service on the private Compose network,
- liveness, readiness, and capability endpoints,
- structured logs and request/job correlation fields,
- Ruff, mypy, and pytest,
- no PostgreSQL credentials,
- no BullMQ dependency,
- no CSV parser or scientific business processing yet.

### `packages/config`

- shared Node environment schema and parsing helpers,
- clear startup errors that name missing or invalid variables,
- no secrets printed in parsed configuration or errors.

### `packages/database`

- Drizzle schema root, connection factory, migration runner, and health probe,
- separate runtime and migration connection configuration,
- generated migrations checked into source control,
- production startup never runs schema push.

### `packages/shared`

- health response and request-correlation contracts actually shared by web and API,
- no generic utility collection.

### `packages/ui`

- only primitives used by the Phase 0 landing/status page,
- Radix and Tailwind integration,
- no speculative design system catalog.

## 6. Runtime processes

| Process       | Publicly exposed              | Phase 0 responsibility                                               |
| ------------- | ----------------------------- | -------------------------------------------------------------------- |
| web           | yes                           | serve the React application                                          |
| api           | yes                           | HTTP API and dependency health                                       |
| worker-node   | no                            | connect to PostgreSQL and Redis, publish heartbeat, no business jobs |
| worker-python | no                            | private FastAPI health and capability response                       |
| postgres      | development only              | metadata persistence and migrations                                  |
| redis         | development only              | BullMQ connection and ephemeral heartbeat                            |
| minio         | API endpoint development only | S3-compatible health and bootstrap bucket                            |
| storage-init  | no, one-shot                  | create the development bucket idempotently                           |

`worker-node` uses the API image with a different command. `worker-python` has an internal port but no host port in the default Compose configuration. Development-only infrastructure port exposure must be documented and separated from production guidance.

## 7. Health contracts

### API

- `GET /health/live` checks only that the process event loop is responsive,
- `GET /health/ready` checks PostgreSQL, Redis, MinIO, migration compatibility, and required configuration,
- successful responses include service, status, version, timestamp, and request ID,
- readiness failure returns 503 with dependency names and stable error codes but no credentials or connection strings.

### Node worker

- establishes PostgreSQL and Redis connections,
- writes a namespaced, expiring development heartbeat without claiming durable job state,
- exits non-zero when required configuration is invalid,
- handles SIGTERM by stopping new work and closing connections.

### Python worker

- `GET /health/live` checks the process,
- `GET /health/ready` checks configuration and scientific dependency imports,
- `GET /internal/v1/capabilities` reports service version, Python version, and an empty parser list,
- rejects calls without the configured internal service credential except health endpoints,
- handles SIGTERM without accepting new requests.

The Phase 0 heartbeat is operational scaffolding only. Durable `BackgroundJob` and lease semantics begin in Phase 4.

## 8. Configuration contract

`.env.example` documents at least:

```text
NODE_ENV
ENGROVE_PUBLIC_URL
ENGROVE_API_PORT
ENGROVE_WEB_PORT
DATABASE_URL
DATABASE_MIGRATION_URL
REDIS_URL
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_FORCE_PATH_STYLE
PYTHON_WORKER_BASE_URL
INTERNAL_SERVICE_SECRET
LOG_LEVEL
```

Rules:

- use obvious non-production development values only,
- production mode rejects default or placeholder secrets,
- browser-exposed variables use an explicit public prefix,
- service configuration is validated before listening on a port,
- `.env` and generated credentials remain ignored by Git,
- Compose secrets are not baked into images.

## 9. Root commands

The following commands must work from the repository root:

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm db:generate
pnpm db:migrate
docker compose up -d
docker compose down
```

Root scripts invoke uv with the committed lockfile for Python checks. CI uses frozen or locked installation modes and fails if either lockfile would change.

## 10. Docker requirements

- multi-stage application images,
- non-root runtime users,
- explicit stable base-image tags and recorded digests,
- health checks for long-running services,
- named development volumes for PostgreSQL, Redis, and MinIO,
- idempotent bucket initialization,
- dependency startup based on readiness rather than fixed sleeps,
- graceful shutdown for API and workers,
- no source mounts or development servers in production Dockerfiles,
- no credentials committed or copied into image layers.

Compose startup order does not establish correctness. Each application process must tolerate dependency startup delay with bounded retries and must expose not-ready state until dependencies are usable.

## 11. CI workflow

Pull requests run:

1. dependency installation from `pnpm-lock.yaml` and `apps/worker-python/uv.lock`,
2. formatting check,
3. JavaScript and Python lint,
4. TypeScript and Python type checks,
5. unit tests with coverage output,
6. production builds,
7. migration generation drift check,
8. Docker image builds,
9. Compose smoke test from clean volumes,
10. API, Node worker, and Python worker health verification,
11. secret and accidental Enterprise-path grep checks,
12. teardown with captured service logs on failure.

CI must not depend on a managed database, managed object store, external identity provider, Enterprise repository, or pre-existing network resource.

## 12. ADR deliverables

Create the ADR template and ADR-001 through ADR-014 from the accepted parent plan. Each ADR contains context, decision, consequences, rejected alternatives, implementation constraints, status `Accepted`, and a link to the relevant plan section.

Phase 0 may leave future domain tables unimplemented, but it must not leave an accepted architectural choice described as unresolved.

## 13. Work packages

### P0-A Repository and toolchain

- ENG-001, ENG-007, ENG-008,
- initialize workspaces, version files, lockfiles, license, ignores, and root scripts,
- completion evidence: clean locked installs for Node and Python.

### P0-B Architecture records and configuration

- ENG-004, ENG-006,
- implement environment validation and write ADR-001 through ADR-014,
- completion evidence: configuration tests and accepted ADR index.

### P0-C Local infrastructure and database

- ENG-002,
- add PostgreSQL 18, Redis, MinIO, storage initialization, Drizzle connection, and migration commands,
- completion evidence: clean-volume startup and migration smoke test.

### P0-D Community process skeletons

- create web, API, Node worker entry, and Python worker,
- implement structured logging and health contracts,
- completion evidence: all processes healthy and graceful shutdown verified.

### P0-E CI and developer handoff

- ENG-003, ENG-005,
- add CI, contribution guide, setup README, troubleshooting, and verification report,
- completion evidence: a second clean environment follows only the README and passes all checks.

Work packages merge in this order. Each package must leave root lint, typecheck, tests, and build green.

## 14. Required tests

- missing and malformed environment variables fail before port binding,
- structured logs redact all configured secret values,
- API liveness works while dependencies are unavailable,
- API readiness reports each dependency failure safely,
- migration role and runtime role configuration cannot be silently interchanged in production mode,
- MinIO bucket initialization is idempotent,
- Node worker heartbeat expires when the worker stops,
- Python internal capability endpoint requires service authentication,
- SIGTERM closes servers and dependencies within the Compose grace period,
- web renders API unavailable and recovered states,
- Compose starts successfully from empty volumes twice,
- no Enterprise source, schema, package, route, or feature gate exists.

## 15. Completion evidence

Phase 0 is complete only when the repository contains:

- passing CI run link or archived local-equivalent report,
- resolved Node, pnpm, uv, Python, package, and image versions,
- output from lint, typecheck, test, build, and migration drift checks,
- Compose service health summary from clean volumes,
- ADR index showing ADR-001 through ADR-014 as accepted,
- README setup and troubleshooting verified by a clean checkout,
- confirmation that only Community artifacts were built.

## 16. Explicit non-goals

- user registration or login,
- organization, workspace, or project business APIs,
- domain migrations beyond infrastructure scaffolding,
- real background jobs or Python parsers,
- file upload or object mutation,
- templates or demo data,
- Kubernetes,
- cloud-managed dependencies,
- backup implementation before Phase 7,
- Enterprise scaffolding or compatibility code.
