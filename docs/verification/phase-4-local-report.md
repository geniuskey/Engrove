# Community Phase 4 Verification Report

Verified on 2026-08-01 against the Files and Datasets acceptance criteria in the development plan.

## Automated checks

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass across the TypeScript and Python workspaces;
- `pnpm units:check` confirms the generated cross-language unit registry is current;
- `scripts/phase-4-smoke.sh` builds the release containers, applies every migration to empty PostgreSQL, and executes the Phase 0–4 API flows;
- the Python dataset tests parse CSV to Zstandard-compressed Parquet and derive an XY table from stable column IDs;
- database triggers reject changes to available file content, ready dataset content, and dataset artifacts.

## Acceptance evidence

The Phase 4 smoke test verifies:

- a short-lived browser URL can write only a random staging key; the server streams the complete object, verifies its exact size and SHA-256, writes and re-reads a never-reused committed key, and makes completion idempotent;
- a second file-series version has a distinct `FileObject`, key, checksum, storage version, and previous-version link while the first exact version remains downloadable;
- equivalent dataset inputs return the same immutable fingerprint and dataset;
- PostgreSQL outbox and job rows survive `FLUSHALL`; the reconciler reconstructs BullMQ delivery and processing completes;
- CSV processing produces immutable Parquet and preview artifacts with schema, row count, null/numeric statistics, exact source-file lineage, and no implicit measurement result;
- XY derivation uses selected stable X/Y column IDs, validates axis units, and preserves tabular-dataset lineage;
- parser failures become visible terminal datasets with attempt history and can be retried explicitly;
- a scalar measurement can cite a ready dataset, while Test Run records use normalized exact file and dataset references rather than JSON values;
- archive and restore preserve file versions, artifacts, lineage, evidence links, and audit history;
- cleanup performs an audited dry run, applies a grace period, requires explicit execution confirmation, deletes only eligible object versions, excludes active upload keys, and leaves committed file/artifact references readable;
- the Test & Characterization v3 upgrade adds Procedure File, Raw File, and Dataset fields without replacing existing records.

## Recovery design exercised

The Node worker atomically leases PostgreSQL jobs, records immutable attempts, checkpoints intended artifact IDs, keys, checksums, and storage versions before domain commit, and reuses a matching checkpointed object after a retry. Expired leases return to PostgreSQL's queue, already-ready datasets reconcile jobs to succeeded, terminal validation failures do not retry, and outbox dispatch uses `FOR UPDATE SKIP LOCKED` with PostgreSQL as the durable authority. The Python service has no database credentials and no published host port.

The web application exposes file upload/version history/download/archive/restore, tabular and XY dataset creation, live processing/error status, previews, lineage, retry controls, and exact file/dataset record reference inputs.
