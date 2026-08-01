# Community Phase 2 Verification Report

Verified on 2026-08-01 against the configurable-data acceptance criteria in the development plan.

## Automated checks

- formatting, lint, type checking, unit tests, and production builds pass across the TypeScript and Python workspaces;
- migration generation reports no schema drift after `0002_nice_warlock.sql`;
- `scripts/phase-2-smoke.sh` passes from clean Compose volumes and removes its isolated resources;
- database tests cover canonical decimal strings, CSV parsing, field configuration, and typed-value validation;
- web component tests cover the project data grid and existing application status behavior.

## Acceptance evidence

The Phase 2 API smoke test verifies:

- project-scoped object types, immutable field keys/types, required/default/unique constraints, and schema audit events;
- JSONB records and same-transaction typed projections for text, numeric, date, boolean, user, and relation values;
- filtering, stable typed sorting, grouping, cursor pagination, record updates, archive, and restore;
- relations survive archive/restore and cross-project records cannot be read or referenced;
- exact decimal values remain strings and equivalent canonical numeric values enforce uniqueness;
- CSV import returns row-specific errors, preserves stable field keys, and is idempotent for a request key;
- CSV export is auditable and both reads and writes fail closed while a required projection is rebuilding;
- deterministic projection rebuild leaves source JSON unchanged and verifies every projected row;
- the Phase 2 Test & Characterization template installs all six object types transactionally and repeated installation creates no duplicates.

The React interface supplies object-type navigation, schema creation, a typed grid with query controls, record detail/edit/archive/restore, CSV import results, CSV export, and the template installer. Permission checks are enforced by the API; the interface also hides actions that the current role cannot perform.

The captured service log is written to `docs/verification/phase-2-compose.log` during local runs and uploaded by CI only on failure. Log files are intentionally ignored by Git.
