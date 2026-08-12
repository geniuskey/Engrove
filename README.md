# Engrove Community

Engrove is a self-hosted data and operations workspace built for engineers. The repository contains a reproducible Community stack: a React web app, NestJS API, Node orchestration worker, private Python scientific worker, PostgreSQL, Redis, and S3-compatible object storage.

Community Phases 0–8 are implemented. Projects provide configurable engineering records, exact engineering quantities and measurement history, immutable specifications, exact-version file evidence, durable background jobs, CSV-to-Parquet datasets, derived XY datasets, revisioned charts and dashboards, and audited engineering tasks with exact evidence links, Kanban, and calendar views. Record discussions support mentions, assigned reviews, approval or change-request decisions, a project review inbox, and a dedicated read-only Reviewer role. OIDC, hardened production composition, readiness/metrics, age-encrypted fresh-install backup and restore, the completed Test & Characterization v6 template, traceable demo data, onboarding, and pilot feedback/adoption reporting are included.

## Prerequisites

- Node.js 24.13.0 and pnpm 10.29.2 (Corepack)
- Python 3.13.12 and uv 0.10.0
- Docker Engine with Docker Compose v2

Do not reuse the example credentials outside local development.

## Local setup

```bash
cp .env.example .env
corepack enable
pnpm install --frozen-lockfile
uv sync --project apps/worker-python --locked
docker compose -f deploy/compose/compose.yaml up -d --build
```

Open the application at <http://localhost:4173> and complete the one-time setup with the development token from `.env`. The API exposes liveness at <http://localhost:3000/health/live>, dependency readiness at <http://localhost:3000/health/ready>, Prometheus metrics at <http://localhost:3000/metrics>, and OpenAPI documentation at <http://localhost:3000/api/docs>. MinIO's development console is at <http://localhost:9001>.

If no `ENGROVE_SETUP_TOKEN` is configured, the API generates a setup URL and prints it once at startup. Before setup completes, rotate a lost generated token with:

```bash
pnpm --filter @engrove/api setup:rotate
```

PostgreSQL, Redis, MinIO API, and the MinIO console are exposed on the host for local development only. Use the documented [production self-hosting overlay](docs/operations/self-hosting.md) for separate database roles, scoped object-storage credentials, private ports, read-only non-root containers, TLS ingress, and explicit migrations.

Before a production installation or upgrade, validate the private mode-`0600` environment file and
the fully rendered hardened composition without printing its secrets:

```bash
pnpm production:preflight -- --env-file /etc/engrove/production.env
```

Stop the stack without deleting development data:

```bash
docker compose -f deploy/compose/compose.yaml down
```

## Repository checks

Run the complete review and verification gate with the Node version pinned by the repository:

```bash
bash scripts/project-loop.sh
```

The loop bootstraps the pinned Node release when the current shell is on another version and fails
if engine or oversized-bundle warnings remain. See the
[project-loop guide](docs/development/project-loop.md) for review priorities and completion criteria.

Individual checks remain available:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:community
```

Generate and review migrations with `pnpm db:generate`; apply them with `pnpm db:migrate`. CI rejects migration drift. `bash scripts/phase-7-smoke.sh` covers operational hardening, encrypted fresh-volume restore, production composition, and a real Keycloak Authorization Code + PKCE sign-in. `bash scripts/phase-8-smoke.sh` runs the complete Community product golden path, including demo evidence provenance, template migration, onboarding, feedback, and authorization. The lower-level phase checks remain available in `scripts/`.

After editing `packages/units/registry/units.yaml`, run `pnpm units:generate`. CI runs `pnpm units:check` and rejects stale TypeScript, Python, canonical JSON, or digest artifacts.

Rebuild one project's typed record projections without modifying its JSONB source of truth with `pnpm projection:rebuild -- --project-id <uuid>`. Add `--field-id <uuid>` to rebuild a single field. Index-dependent operations return `FIELD_INDEX_REBUILDING` until verification succeeds.

## Troubleshooting

- An engine warning means your shell is not using `.node-version`; switch to Node 24 before treating results as release evidence.
- If readiness returns 503, inspect the response's stable dependency codes and run `docker compose -f deploy/compose/compose.yaml ps` followed by `logs api postgres redis minio storage-init migrate`.
- If MinIO is healthy but the API is not, rerun the idempotent `storage-init` service and confirm `S3_BUCKET` matches across services.
- If Python commands choose the wrong interpreter, run `uv python install 3.13.12` and repeat the locked sync.
- If local ports conflict, change `ENGROVE_API_PORT` or `ENGROVE_WEB_PORT` in `.env`; internal container ports stay unchanged.

## Documentation

- [Development plan](docs/product/engrove-development-plan.md)
- [Phase 0 execution specification](docs/architecture/phase-0-execution-spec.md)
- [Accepted architecture decisions](docs/adr/README.md)
- [Self-hosting](docs/operations/self-hosting.md)
- [Backup and restore](docs/operations/backup-restore.md)
- [OIDC and Keycloak](docs/operations/oidc-keycloak.md)
- [Observability](docs/operations/observability.md)
- [API access and personal tokens](docs/operations/api-access.md)
- [TypeScript API client](packages/sdk/README.md)
- [Project webhooks](docs/operations/webhooks.md)
- [Task collaboration](docs/product/task-collaboration.md)
- [Production security checklist](docs/operations/security-checklist.md)
- [Community administrator guide](docs/operations/administrator-guide.md)
- [Pilot guide](docs/operations/pilot-guide.md)
- [Contributing guide](CONTRIBUTING.md)
- [Resolved Phase 0 versions](docs/verification/phase-0-versions.md)
- [Phase 1 verification report](docs/verification/phase-1-local-report.md)
- [Phase 2 verification report](docs/verification/phase-2-local-report.md)
- [Phase 3 verification report](docs/verification/phase-3-local-report.md)
- [Phase 4 verification report](docs/verification/phase-4-local-report.md)
- [Phase 5 verification report](docs/verification/phase-5-local-report.md)
- [Phase 6 verification report](docs/verification/phase-6-local-report.md)
- [Phase 7 verification report](docs/verification/phase-7-local-report.md)
- [Phase 8 verification report](docs/verification/phase-8-local-report.md)

## License

Engrove Community is licensed under [AGPL-3.0-only](LICENSE).
