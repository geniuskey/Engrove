# Phase 8 local verification

Verified on 2026-08-01 against a clean Community stack.

## Implemented

- Completed, versioned Test & Characterization template v6 with idempotent upgrades and preservation of user display customization and data.
- User-specific onboarding checklist for the end-to-end engineering evidence path.
- One-click synthetic demo containing template records, checksum-verified immutable raw CSV, worker-processed dataset and Parquet/preview artifacts, exact-source chart, test-run evidence references, and linked follow-up task.
- In-product pilot feedback capture available to every authenticated role, with organization-scoped Admin/Owner review.
- Audited 30-day adoption summary for repeat users, real records, ready datasets, chart provenance links, task links, feedback, and demo installations.
- Community administrator and pilot guides.

## End-to-end evidence

`bash scripts/phase-8-smoke.sh` starts from empty PostgreSQL, Redis, and MinIO volumes, applies migration 0009, replays all Community Phase 2–7 API fixtures, installs the demo twice to verify idempotency, downloads the exact raw CSV, verifies dataset artifacts and chart provenance, follows the linked task and test-run evidence, simulates a v2-to-v6 template upgrade while preserving a user display-name change and existing dataset, completes onboarding, captures feedback, checks adoption metrics, and verifies Viewer write boundaries.

The external adoption targets—three repeat users, 100 real records, 10 real datasets, and partial replacement of a spreadsheet workflow—require a real field pilot. The product now measures those signals without treating synthetic demo content as evidence that they have been reached.
