# Phase 7 local verification

Verified on 2026-08-01 with release containers running Node 24.13.0, Python 3.13.12, PostgreSQL 18.1, Redis 8.4.0, MinIO, age 1.3.1, and the Keycloak 26.6.3 reference.

## Implemented

- Configurable OIDC Authorization Code flow with PKCE S256, state, nonce, signed short-lived state cookie, issuer discovery, client authentication, scope/claim mapping, allowed domains, auto-provisioning toggle, default role, HTTPS production enforcement, and normal opaque Engrove sessions.
- Disposable Keycloak reference realm/client/user and a full automated form sign-in that verifies provisioned email and role.
- Leased installation maintenance state that rejects authenticated business mutations with `503 MAINTENANCE_MODE` while preserving reads and pauses job claims/outbox dispatch.
- PostgreSQL custom-format plus exact-version object backup inventory, restrictive temporary permissions, SHA-256/size validation, manifest compatibility metadata, pinned age encryption, outer checksum, production plaintext rejection, verification-only mode, JSON operation reports, and textfile metrics.
- Fresh-install restore with bundle/dump compatibility checks, exact-key upload, destination version capture, read-back checksum verification, transactional maintenance-only metadata remap, session/setup/security-token revocation, interrupted job/outbox reconciliation, and retained maintenance mode on post-modification failure.
- Production Compose overlay with private host ports, separate migration/runtime/worker/backup PostgreSQL roles, scoped versioned MinIO user, non-root read-only runtime containers, dropped capabilities, `no-new-privileges`, and externally supplied secrets.
- API readiness for PostgreSQL, migration state, Redis, object storage, Node worker heartbeat, and Python parser compatibility; Prometheus HTTP, job, outbox, storage, dataset, maintenance, projection, and database metrics.
- Self-hosting, Keycloak, backup/restore, observability, and production security documentation.

## End-to-end evidence

`bash scripts/phase-7-smoke.sh` starts from clean volumes and includes all Phase 2–6 deterministic fixtures. It then verifies maintenance read/write behavior, readiness and metrics, rejects a production plaintext backup, creates and independently verifies an age-encrypted bundle containing committed file and dataset-artifact versions, deletes all PostgreSQL/Redis/MinIO volumes, restores into new PostgreSQL and MinIO services, checks restored object version metadata and credential revocation, restarts workers/API/web, and performs a golden-flow authenticated read.

The same command starts the Keycloak reference and completes a real Authorization Code + PKCE login for `engineer@example.com`. Finally it starts the production overlay on fresh volumes, verifies readiness through the private API network, checks role grants, confirms private ports and runtime hardening, and scans image environment/history metadata for the supplied test secrets.

Expected immutable-history trigger errors in the log are negative assertions inherited from Phases 3–6. Service logs are captured in `phase-7-compose.log`, `phase-7-keycloak-compose.log`, and `phase-7-production-compose.log`.
