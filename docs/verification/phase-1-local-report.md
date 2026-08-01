# Community Phase 1 Verification Report

Verified on 2026-08-01 against the acceptance criteria in the development plan.

## Automated checks

- `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- `pnpm db:generate` reports no schema drift after migration `0001_pale_silver_centurion.sql`.
- `scripts/phase-1-smoke.sh` passes from clean Compose volumes and removes its isolated resources after completion.
- The container build and runtime use the pinned Node.js 24.13.0 toolchain. The host verification shell used Node.js 22.17.1 and therefore emitted the expected engine warning; it is not release runtime evidence.

## Acceptance evidence

The Phase 1 API smoke test verifies:

- an invalid setup token is rejected and audited;
- two concurrent valid setup requests create exactly one Owner, and setup remains permanently closed;
- sign-in creates opaque, database-backed session and CSRF cookies;
- sign-out, password reset, and administrator revocation invalidate existing sessions immediately;
- invitation and password-reset secrets are single-use SHA-256-hashed tokens;
- invitation revocation and lazy expiration are rejected and audited without plaintext token data;
- one organization, workspace, project, and invited member can be created;
- project optimistic-concurrency conflicts, Viewer write denial, archive, and restore behave as specified;
- role changes and the security-sensitive lifecycle actions appear in append-only audit history;
- the complete stack becomes healthy with PostgreSQL 18, Redis, MinIO, API, web, and both workers.

The captured service log is written to `docs/verification/phase-1-compose.log` during local runs and uploaded by CI only on failure. Log files are intentionally ignored by Git.
