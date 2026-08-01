# Community Phase 3 Verification Report

Verified on 2026-08-01 against the units, quantities, measurements, and specifications acceptance criteria in the development plan.

## Automated checks

- `packages/units/registry/units.yaml` generates canonical JSON and digest-stamped TypeScript and Python artifacts; `pnpm units:check` rejects stale outputs;
- shared fixtures pass in Decimal.js and Python `decimal.Decimal` with 34 significant digits and half-even rounding;
- type checking and unit tests pass across all TypeScript and Python workspaces;
- `scripts/phase-3-smoke.sh` applies migrations to clean PostgreSQL and exercises the complete Phase 2 and Phase 3 API flows;
- immutable database triggers reject updates and deletes of measurement results, specification revisions, and evaluations.

## Acceptance evidence

The Phase 3 smoke test verifies:

- `1 mm`, `0.001 m`, and `1000 um` share the exact canonical value; unique quantity constraints treat them as equal;
- Celsius and Kelvin conversions agree, source values/units remain intact, and wrong dimensions or disallowed units are rejected;
- quantity and range fields round-trip decimal strings through JSONB and PostgreSQL without JSON numbers;
- repeated observations coexist, while a correction supersedes exactly one current result and preserves the prior row and evaluation;
- record reads project only the deterministically latest non-superseded measurement and its matching current evaluation;
- specification creation evaluates existing records as missing and prevents a second active specification for the field;
- hard and warning boundaries are inclusive, one-sided limits work, and incompatible fields cannot be targeted;
- changing limits appends a revision and new evaluations; identical immutable retry inputs return the same evaluation ID;
- archive and restore preserve all revisions and evaluations, and lifecycle/evaluation actions are audited;
- the idempotent Test & Characterization v2 upgrade adds Environment Temperature as a quantity without replacing records or creating a configurable Specification object type.

The web interface supports engineering field configuration, quantity/range entry, canonical display, measurement entry and correction selection, complete observation history, evaluation status, specification creation/history, and latest-result grid cells.
