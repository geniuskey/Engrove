# Engrove Development Plan

> **Status:** Draft v0.9
> **Product:** Engrove  
> **Category:** Self-hosted Engineering Data & Operations Workspace  
> **Primary audience:** Manufacturing R&D, test, validation, reliability, and engineering teams  
> **Primary deployment:** Self-hosted / on-premise  
> **Implementation style:** Modular monolith with background workers  
> **Last decision update:** 2026-08-01

---

## 1. Purpose of This Document

This document is the implementation plan for Codex or another coding agent to build the first usable version of Engrove.

The goal is not to create a generic Airtable, NocoDB, Jira, Grafana, LIMS, PLM, or MES clone.

Engrove must become a focused engineering workspace that connects:

- engineering objects,
- samples and test items,
- physical quantities and units,
- measurements,
- datasets and raw files,
- specifications and pass/fail results,
- dashboards,
- follow-up tasks,
- and audit history.

Codex should treat this document as the product and technical source of truth for the MVP unless a later decision record explicitly overrides it.

### 1.1 Resolved MVP product decisions

The following decisions are fixed for the MVP:

1. Each installation has exactly one system-provisioned organization. Organization switching and organization CRUD are not exposed in the MVP UI.
2. A measurement field defines what is measured. Actual observations are stored as append-only `MeasurementResult` entities and may occur multiple times for the same record and field.
3. Corrections create a new measurement result that supersedes a previous result. Previously recorded results are never updated in place.
4. Specification definitions are revisioned. Every pass, warning, fail, or missing outcome is stored as a separate `SpecificationEvaluation` tied to the exact specification revision used.
5. CSV parsing creates datasets only. In the MVP, a user manually records a scalar measurement result and may link the source dataset as supporting evidence. Automatic metric extraction and curve-wide specification evaluation are deferred.
6. The Test & Characterization template is introduced incrementally from Phase 2 and completed in Phase 8.
7. The template uses the platform `Specification` and `Task` entities. Its `Issue` object type represents an investigation and may link to one or more platform tasks.
8. Formula fields and the formula expression engine are not part of the MVP.
9. The Community repository uses the AGPL-3.0 license. Future Enterprise-only modules live in a separate private repository and integrate only through documented public interfaces.
10. The backend uses Node.js 24 LTS, PostgreSQL 18, Drizzle ORM with `node-postgres`, and UUIDv7 identifiers.
11. Authentication uses opaque, revocable database-backed sessions. JWTs are not used as browser sessions, and Redis is not the authoritative session store.
12. First-run setup is protected by a one-time setup token and becomes permanently unavailable after the first Owner is created.
13. SMTP is optional. In the MVP, an Owner can issue a single-use password-reset link without an email delivery dependency.
14. A measurement field has at most one active unconditional specification in the MVP. Conditional specification selection is deferred.
15. Specification limits are inclusive. Current views use the evaluation of the latest non-superseded measurement, while all repeated-measurement evaluations remain queryable.
16. Configurable record properties use JSONB as the source of truth plus a transactionally maintained typed projection for filtering, sorting, grouping, and uniqueness.
17. The unit registry is a versioned repository-owned data file that generates matching TypeScript and Python artifacts. Third-party unit libraries are not authoritative.
18. Quantity conversion and persistence use decimal-safe representations rather than binary floating-point values.
19. PostgreSQL row-level security is not used in the MVP. Project isolation is enforced by the permission service, scoped repositories, normalized ownership keys, database roles, and cross-project isolation tests.
20. Every committed file version has a unique, never-reused object key. Application-level file series and exact version references are authoritative; bucket versioning is defense in depth only.
21. User-facing deletion of traceable entities is archive or tombstone behavior. Physical purge of committed records, raw files, datasets, specifications, and tasks is not available in the MVP.
22. A ready dataset is immutable. Changed parser versions, parameters, or XY selections create a new dataset with explicit lineage.
23. PostgreSQL background-job and outbox rows are the durable job source of truth. BullMQ is a delivery mechanism consumed by a Node orchestration worker.
24. The Node orchestration worker calls an internal Python FastAPI scientific service. The Python service does not write domain tables or consume the experimental Python BullMQ client.
25. Charts and dashboards use immutable, versioned configurations. Sources are exact dataset and chart revision IDs, and user configuration is validated safe data rather than executable ECharts, SQL, or JavaScript content.
26. Backups use a write-quiesced, manifest-driven bundle with PostgreSQL custom-format dump, exact referenced object versions, SHA-256 verification, and `age` recipient encryption by default.
27. Community is developed and delivered first. No Enterprise repository, module, database schema, license gate, feature flag, runtime plugin loader, or speculative extension hook is implemented during the MVP.
28. The object-type data grid provides spreadsheet-style direct editing for mutable records. Each cell save uses optimistic concurrency and the normal validated, audited record mutation transaction. Measurement observations and ready dataset contents remain immutable and are read-only in the grid.
29. The MVP record grid uses a data-workbench layout: table and view context remain visible, Fields/Filter/Sort controls are compact and contextual, rows support selection and authorized bulk archive, and a record may be created or edited in a side panel without losing grid context.
30. Named grid views are project-shared `RecordView` entities. A view persists visible-field order, field widths, filters, sorts, row density, and page size with optimistic concurrency and audit history. `schema.read` may list and use shared views; `schema.manage` is required to create, update, or archive one. The built-in `All records` view is virtual and cannot be modified or archived.

---

## 2. Product Vision

### 2.1 One-sentence definition

**Engrove is a self-hosted data and operations workspace built for engineers.**

### 2.2 Product promise

An engineer should be able to:

1. create a project,
2. define engineering object types,
3. register samples or test items,
4. define measurements with physical units,
5. upload raw data files,
6. parse tabular or XY datasets,
7. compare results,
8. evaluate results against specifications,
9. create follow-up tasks from failed results,
10. and trace every important change.

### 2.3 Tagline

**The data workspace for engineers.**

### 2.4 Core product principles

1. **Engineering context over generic tables**
2. **Traceability over convenience shortcuts**
3. **Structured data over unsearchable attachments**
4. **Good defaults over empty canvases**
5. **Self-hosted first**
6. **Raw data must remain immutable**
7. **Units and physical dimensions are first-class concepts**
8. **Tasks must connect to engineering data**
9. **Modular monolith before microservices**
10. **MVP depth before feature breadth**

---

## 3. Target Users

### 3.1 Primary users

- R&D engineers
- test and validation engineers
- reliability engineers
- process engineers
- quality engineers
- equipment engineers
- materials engineers
- engineering team leads

### 3.2 Initial organization profile

- manufacturing or engineering company,
- 10 to 100 engineers in the target team,
- heavy use of Excel and shared drives,
- measurements stored in CSV, spreadsheets, images, logs, or proprietary files,
- weak connection between project tasks and engineering data,
- on-premise or private-network requirements,
- SSO and audit requirements.

### 3.3 Common pain points

- measurement data is spread across Excel and NAS folders,
- sample identity is inconsistent,
- units are embedded in column names or comments,
- raw files are difficult to locate,
- charts are rebuilt manually,
- failed measurements do not reliably create follow-up work,
- nobody knows which file or calculation produced a reported result,
- data structures differ by engineer,
- access control is too coarse,
- existing no-code databases do not understand engineering data.

---

## 4. MVP Scope

### 4.1 Golden flow

The MVP is successful when the following workflow works without manual database changes:

1. User signs in.
2. User creates a workspace.
3. User creates a project.
4. User installs the `Test & Characterization` template.
5. User registers equipment, test items, and samples.
6. User defines a scalar measurement field with a physical dimension and allowed unit.
7. User uploads a CSV as a raw file, Engrove creates a tabular dataset, and the user derives an XY dataset by selecting columns when needed.
8. User displays multiple exact dataset versions on one chart.
9. User defines a revisioned scalar specification for the measurement field.
10. User records a scalar measurement result and optionally links the source dataset.
11. Engrove stores an evaluation against the current specification revision as pass, warning, fail, or missing.
12. User creates a task directly from a failed evaluation.
13. User views related measurements, evaluations, datasets, files, tasks, and audit history from the sample record.
14. User adds selected metrics and charts to a dashboard.

### 4.2 Required MVP capabilities

#### Platform

- local user authentication,
- OIDC authentication,
- workspace management,
- project management,
- role-based access control,
- audit log,
- REST API,
- Docker Compose deployment,
- PostgreSQL persistence,
- S3-compatible object storage,
- backup and restore documentation.

#### Data modeling

- user-defined object types,
- user-defined fields,
- record create, read, update, archive, and restore,
- grid view,
- record detail view,
- filtering,
- sorting,
- grouping,
- CSV import and export,
- relation fields.

#### Engineering types

- quantity,
- unit,
- physical dimension,
- range,
- tolerance,
- revisioned specification,
- append-only scalar measurement result,
- specification evaluation history,
- XY dataset,
- tabular dataset,
- file reference,
- sample reference,
- equipment reference.

#### Analysis

- line chart,
- scatter chart,
- histogram,
- box plot,
- KPI card,
- specification status card,
- saved chart configuration,
- dashboard layout.

#### Work management

- task,
- status,
- assignee,
- due date,
- priority,
- related records,
- related datasets,
- Kanban view,
- calendar view.

### 4.3 Explicit non-goals for MVP

Do not implement the following unless required to unblock the golden flow:

- full Jira replacement,
- full PLM or BOM management,
- MES production execution,
- CAD parsing,
- electronic lab notebook editor,
- real-time equipment control,
- workflow BPMN engine,
- arbitrary Python notebook execution,
- AI assistant,
- mobile application,
- SAML,
- SCIM,
- direct LDAP integration,
- field-level permissions,
- record-level policy language,
- advanced approval workflow,
- Gantt dependency engine,
- plugin marketplace,
- real-time multiplayer editing,
- high-frequency time-series database,
- image cube or 3D dataset visualization,
- regulatory electronic signatures,
- formula fields and spreadsheet-style expression evaluation,
- automatic scalar metric extraction from datasets,
- curve-wide or dataset-wide specification evaluation.

---

## 5. Recommended Technology Stack

### 5.1 Monorepo

Use `pnpm` workspaces with Turborepo.

```text
engrove/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker-python/
├── packages/
│   ├── ui/
│   ├── shared/
│   ├── database/
│   ├── units/
│   ├── permissions/
│   ├── sdk/
│   └── config/
├── templates/
│   └── test-characterization/
├── deploy/
│   ├── docker/
│   └── compose/
├── docs/
│   ├── product/
│   ├── architecture/
│   └── adr/
├── scripts/
├── .github/
│   └── workflows/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

### 5.2 Frontend

- React
- TypeScript
- Vite
- React Router
- TanStack Query
- TanStack Table
- React Hook Form
- Zod
- ECharts
- dnd-kit for dashboard layout
- Tailwind CSS
- Radix UI primitives

### 5.3 Backend

- Node.js 24 LTS
- TypeScript
- NestJS
- PostgreSQL 18
- Drizzle ORM with `node-postgres`
- Redis
- BullMQ
- OpenAPI
- Zod for shared request and response validation

Use released stable Drizzle packages only; do not adopt release candidates in the MVP. Generate reviewed SQL migration files with Drizzle Kit and apply migrations explicitly. Do not use schema push as a production migration mechanism. Database constraints are part of the domain model and must not exist only in application validation.

### 5.4 Scientific worker

- Python 3.13
- uv with committed `apps/worker-python/uv.lock`
- FastAPI on the private Compose network
- pandas
- NumPy
- SciPy
- PyArrow
- Pydantic

The worker is responsible for:

- CSV parsing,
- tabular profiling,
- XY extraction,
- summary statistics,
- histogram generation data,
- dataset preview generation,
- future scientific processing.

The Python service is a stateless compute boundary. It receives a signed job capability plus time-limited input and staging-output URLs from the Node orchestration worker. It does not hold application database credentials, modify domain state, or consume BullMQ directly.

### 5.5 Storage

- PostgreSQL for metadata and application records,
- S3 or MinIO for raw and processed files,
- Redis for BullMQ jobs, rate limiting, and ephemeral caching.

PostgreSQL is the authoritative store for users and sessions. Losing Redis data may interrupt or retry background jobs but must not sign users out or lose domain state.

### 5.6 Deployment

MVP deployment must run with:

```bash
docker compose up -d
```

Required services:

- web,
- api,
- postgres,
- redis,
- minio,
- worker-node,
- worker-python.

`worker-node` uses the API codebase and container image with a different entry command. It is a separate runtime process for queue consumption and orchestration, not an independently deployed domain service or a separate repository module.

### 5.7 License and repository boundary

- the Community repository is licensed under AGPL-3.0,
- all MVP capabilities described in this document belong to the Community repository,
- the Community codebase must build and run without any Enterprise repository,
- future Enterprise modules live in a separate private repository,
- Community modules must not import Enterprise code,
- future Enterprise integration must use documented APIs, events, or package extension points,
- contributor documentation must clearly state the license and contribution terms.

Community-first delivery rules:

- every phase and every issue in this MVP plan targets the Community repository,
- the Community repository is the only repository required or scaffolded during MVP development,
- do not create Enterprise packages, schemas, migrations, images, placeholders, feature gates, or disabled menu items,
- do not generalize Community code around hypothetical Enterprise requirements,
- REST API, SDK, and domain-event contracts are implemented only when a Community feature consumes them,
- Community builds, tests, migrations, images, Compose deployment, backup, and restore remain independently complete,
- Enterprise work may begin only after the Community MVP acceptance statement is met and a new explicitly approved plan is added.

The future boundary remains architectural guidance only: a separate Enterprise repository may depend on versioned Community packages, REST APIs, SDKs, container bases, and domain-event schemas through build-time composition. Community code must never import Enterprise code. Future Enterprise database objects use a separate schema and migration namespace and must not patch Community core tables. Runtime plugin loading remains outside the MVP.

### 5.8 Backup and restore

The Community distribution provides `engrove backup create`, `engrove backup verify`, and `engrove backup restore` administration commands. MVP backup is a coordinated maintenance operation, not a zero-downtime or point-in-time recovery system.

Backup creation:

1. Acquire an installation-wide PostgreSQL advisory lock and create a leased maintenance-mode record.
2. Reject new business mutations with `503 MAINTENANCE_MODE`, pause outbox dispatch and new job claims, and keep authorized reads available.
3. Wait for running jobs and file finalizations to finish. If the configured drain timeout expires, abort without producing a successful backup.
4. Run PostgreSQL 18 `pg_dump -Fc` using a dedicated backup role.
5. Build an inventory of every committed `FileObject` and `DatasetArtifact` exact object key and storage version referenced by the quiesced database.
6. Stream those exact objects into the bundle and verify their recorded size and SHA-256 checksum.
7. Add `manifest.json` containing backup format version, application version, schema migration version, PostgreSQL major version, unit-registry version, template versions, creation time, object inventory, and checksums.
8. Stream the complete bundle through the pinned stable `age` CLI to one or more operator-supplied recipient public keys.
9. Verify that the encrypted bundle can be parsed and that its outer checksum matches before reporting success, then release maintenance mode.

Private age identities, database passwords, OIDC client secrets, object-storage credentials, `.env` files, and plaintext setup or reset tokens are never included. Redis is not backed up; durable jobs and outbox state are reconstructed from PostgreSQL. Unencrypted output is allowed only with an explicit development-mode flag and a warning and is rejected when production mode is enabled.

Restore behavior:

- restore targets a fresh, empty, supported Community installation and runs in maintenance mode,
- decrypt and validate bundle format, application compatibility, manifest, database dump, object inventory, and every checksum before making the restored installation writable,
- restore PostgreSQL with `pg_restore` and write each backed-up source object version to its exact application key without overwriting an existing installation,
- capture destination-provider version IDs and update only the restored `storageVersionId` metadata through a maintenance-only remap before the installation becomes writable,
- re-read restored objects and compare size and SHA-256 with database metadata,
- revoke all browser sessions, invitations, password-reset tokens, setup tokens, and internal capabilities after restore,
- convert interrupted `running` jobs to recoverable queued state and let the Node reconciler reconstruct BullMQ delivery,
- require externally configured secrets and OIDC settings rather than restoring old secret material,
- emit a restore report and keep maintenance mode active when any verification fails,
- support `backup verify` without modifying a running installation.

Phase 7 CI creates an encrypted backup from deterministic fixtures, restores it into fresh PostgreSQL, Redis, and MinIO services, and runs integrity and golden-flow read checks. Backup key custody, off-site replication, rotation, scheduling, incremental backup, and high-availability recovery remain operator concerns beyond the MVP scripts.

---

## 6. Architecture

### 6.1 Architecture style

Use a modular monolith.

Each domain module owns:

- controllers,
- application services,
- domain logic,
- persistence repositories,
- authorization checks,
- events,
- tests.

Avoid cross-module database access except through documented service interfaces.

### 6.2 Initial backend modules

```text
auth
users
organizations
workspaces
projects
memberships
object-types
fields
records
relations
units
quantities
specifications
measurements
files
datasets
charts
dashboards
tasks
templates
audit
jobs
health
```

### 6.3 Background processing

Use a transactional outbox plus durable PostgreSQL job state. BullMQ transports wake-up and retry messages but is not the authoritative record of whether domain work is required or complete.

File finalization flow:

1. API creates `FileObject` and `FileUploadSession` rows and assigns a random staging key.
2. API issues a short-lived pre-signed upload URL for the staging key and the expected size and SHA-256 checksum.
3. Client uploads only to staging and calls the completion endpoint.
4. API changes the upload session to `verifying` and verifies object existence, size, content type, and a storage-provider-calculated full-object checksum. If the provider cannot return a trustworthy full-object SHA-256, a worker streams the staging object and computes it.
5. The storage adapter copies the verified bytes to the unique final key for that exact file version. Browser credentials are never allowed to write the final prefix.
6. API or the finalization worker records the final object version ID, checksum, and size, marks the file `available`, and writes audit and outbox events in one database transaction.
7. The staging object becomes eligible for cleanup only after the committed final object has been re-read and verified.

Dataset job flow:

1. An authorized request canonicalizes parser or transformation inputs and computes `inputFingerprint`.
2. In one transaction, API returns an existing matching dataset or creates the `Dataset`, `BackgroundJob`, outbox event, and audit event.
3. The Node dispatcher claims outbox rows with `FOR UPDATE SKIP LOCKED`, then enqueues BullMQ using the PostgreSQL job ID as the BullMQ job ID.
4. The Node orchestration worker atomically leases the PostgreSQL job. A completed job is a no-op; an unexpired lease is not processed twice.
5. Node issues short-lived input, staging-output, progress-callback, and job-capability tokens and calls the private Python FastAPI service.
6. Python downloads the exact source version, parses or transforms it, uploads staged artifacts, and returns schema, statistics, checksums, parser version, and deterministic result metadata. It does not write domain tables.
7. Node verifies the returned artifacts, copies them to never-reused final keys, and commits `DatasetArtifact`, lineage, dataset `ready`, job `succeeded`, audit, and domain events in one transaction.
8. Failures record a sanitized error code and retry classification. Retryable attempts use bounded exponential backoff; terminal failures remain visible and may be retried manually with the same immutable inputs.

Progress callbacks are signed, scoped to one job, idempotent, and throttled before persistence. The Python port is not published outside the private deployment network.

### 6.4 Domain events

Initial event names:

```text
workspace.created
project.created
object_type.created
field.created
record.created
record.updated
file.uploaded
file.finalized
file.archived
dataset.parse_requested
dataset.parsed
dataset.parse_failed
dataset.archived
job.retry_scheduled
job.terminal_failed
specification.evaluated
measurement_result.created
measurement_result.superseded
specification.revised
task.created
task.status_changed
member.added
installation.setup_completed
session.revoked
password_reset.completed
```

Events must have:

- event ID,
- event type,
- actor ID,
- workspace ID,
- project ID when applicable,
- entity type,
- entity ID,
- timestamp,
- version,
- metadata.

### 6.5 Background recovery guarantees

The Node worker runs a reconciler in addition to consuming BullMQ:

- undispatched outbox rows are retried with the same event and job IDs,
- queued PostgreSQL jobs missing from BullMQ are re-enqueued,
- running jobs with expired leases return to queued state unless their domain result is already committed,
- a job whose dataset is already ready is marked succeeded without re-running Python,
- BullMQ loss or Redis restart reconstructs pending delivery from PostgreSQL,
- a Node crash releases work through lease expiry,
- Python timeout, crash, or unavailable service records the attempt and retries up to the default maximum of three with bounded exponential backoff,
- signed capabilities and pre-signed URLs expire independently and are regenerated for each attempt,
- after a staged artifact is verified, the intended final artifact ID and key are checkpointed before copy,
- if final copy succeeds but the database transaction fails, retry checks the checkpointed final object; a matching checksum is committed without copying again, while a mismatch is quarantined and fails with `ARTIFACT_CHECKSUM_CONFLICT`,
- non-retryable parser or validation failures immediately produce a visible terminal failure,
- operators may retry a terminal failure with the same immutable fingerprint or create a new dataset with changed inputs.

Cleanup never uses age alone for committed prefixes. It first checks database references and active job checkpoints, applies a configurable grace period, and records a dry-run report before deletion. Recovery and cleanup behavior is covered by failure-injection integration tests.

---

## 7. Domain Model

### 7.1 Organization hierarchy

```text
Organization
└── Workspace
    └── Project
        ├── Object Type
        │   └── Record
        ├── Dataset
        ├── Dashboard
        └── Task
```

For MVP, a single installation contains exactly one organization. The application creates it during first-run bootstrap. Organization selection, creation, deletion, and cross-organization membership are not exposed through the MVP UI or public API. The organization boundary remains in the schema so multi-organization support can be added later without changing workspace ownership.

### 7.2 Core entities

#### Organization

- id
- name
- slug
- createdAt
- updatedAt

MVP behavior:

- exactly one row is active per installation,
- the bootstrap transaction creates the organization and first Owner membership,
- workspace creation always derives `organizationId` from the installation context rather than accepting an arbitrary organization ID from the client.

#### InstallationMaintenance

- id
- operationType
- operationId
- status
- leaseOwner
- leaseExpiresAt
- startedAt
- completedAt
- failureCode

Only one maintenance operation may be active. Backup and restore commands combine a PostgreSQL advisory lock with a renewable database lease so a crashed command can be detected and recovered deliberately. Maintenance-mode entry, lease recovery, completion, and failure are audited.

#### Workspace

- id
- organizationId
- name
- slug
- description
- createdBy
- createdAt
- updatedAt
- archivedAt
- archivedBy
- archiveReason

#### Project

- id
- workspaceId
- name
- key
- description
- status
- createdBy
- createdAt
- updatedAt
- archivedAt
- archivedBy
- archiveReason

#### ObjectType

Defines a user-configurable engineering entity such as Sample or Equipment.

- id
- projectId
- name
- pluralName
- key
- icon
- description
- system
- createdAt
- updatedAt

#### FieldDefinition

- id
- projectId
- objectTypeId
- name
- key
- fieldType
- required
- unique
- order
- config JSONB
- defaultValue JSONB
- createdAt
- updatedAt

`fieldType = measurement` defines an observable scalar quantity. Its `config` must contain the physical dimension, canonical unit, allowed input units, and optional display precision. Measurement observations are not stored in `Record.values`.

The field type and key are immutable after the field contains data in the MVP. Display name, description, order, required state, and compatible display configuration may change. A destructive type migration requires a future explicit schema-migration workflow and must not be simulated by silently coercing existing values.

#### Record

- id
- objectTypeId
- projectId
- displayName
- values JSONB
- createdBy
- updatedBy
- createdAt
- updatedAt
- archivedAt
- archivedBy
- archiveReason

For MVP, dynamic values may be stored in JSONB. Frequently filtered system fields and relation edges must use normalized columns/tables.

`Record.values` stores configurable record properties, including `quantity` properties such as a nominal length. It must not store `measurement` observations. The record grid may project the latest non-superseded measurement result for a measurement field, but that projection is derived data and is not the source of truth.

#### RecordView

- id
- projectId
- objectTypeId
- name
- viewType (`grid` in the MVP)
- config JSONB
- rowVersion
- createdBy
- updatedBy
- createdAt
- updatedAt
- archivedAt
- archivedBy
- archiveReason

`RecordView.config` contains field IDs in display order, per-field pixel widths, validated record filters and sorts, row density, and page size. Every referenced field must belong to the same object type. Active view names are case-insensitively unique within an object type. Updates and archive operations require the last-read `rowVersion`; a stale write returns `VERSION_CONFLICT`. Views are shared project configuration rather than private browser preferences, and all mutations write audit events.

#### RecordIndexValue

Typed projection used for record queries:

- id
- projectId
- objectTypeId
- recordId
- fieldId
- ordinal
- valueKind
- textValue
- numericValue
- booleanValue
- dateValue
- datetimeValue
- uuidValue
- uniqueKey
- projectionVersion
- updatedAt

Projection rules:

- `Record.values` remains the source of truth,
- a record mutation validates the JSONB value and replaces its projection rows in the same database transaction,
- scalar fields create at most one projection row with `ordinal = 0`,
- multi-valued supported fields create one row per item with a stable ordinal,
- exactly one typed value column is non-null on each projection row, enforced by a database CHECK constraint,
- empty or null values create no projection row,
- relations, measurements, files, and datasets use their normalized tables rather than this projection,
- filters, sorts, groups, and unique validation address fields by `fieldId`; user-controlled JSON paths or SQL fragments are never interpolated,
- projection rows may be deleted and rebuilt because they are derived, but rebuilding never changes `Record.values`.

`uniqueKey` is populated only for scalar fields configured as unique. It is a type-prefixed canonical serialization: Unicode NFC text remains case-sensitive, decimals remove insignificant trailing zeros, dates use ISO calendar form, datetimes use UTC, select values use stable option keys, users use UUIDs, and quantities use the canonical dimension, unit, and decimal value. A partial unique index on `(fieldId, uniqueKey)` where `uniqueKey IS NOT NULL` enforces uniqueness. Boolean, multi-valued, range, file, dataset, and measurement fields cannot be configured as unique in the MVP.

Projection code has a version shared by online writes and rebuild jobs. A projection-version change requires a deterministic rebuild command and fixture comparison against `Record.values`. A field whose projection is rebuilding remains readable, but filtering, sorting, grouping, export, and uniqueness changes on that field return `FIELD_INDEX_REBUILDING` until verification succeeds.

#### RelationEdge

- id
- projectId
- sourceRecordId
- sourceFieldId
- targetRecordId
- createdAt

#### FileSeries

- id
- workspaceId
- projectId
- name
- latestVersionNumber
- createdBy
- createdAt
- updatedAt
- archivedAt
- archivedBy
- archiveReason

`FileSeries` is the logical identity shown in version history. It never resolves references implicitly to the latest version.

#### FileObject

- id
- workspaceId
- projectId
- fileSeriesId
- versionNumber
- previousFileId
- finalObjectKey
- storageVersionId
- originalName
- contentType
- sizeBytes
- checksumAlgorithm
- checksum
- status
- failureCode
- uploadedBy
- createdAt
- availableAt
- archivedAt
- archivedBy
- archiveReason

`status` is `pending_upload`, `verifying`, `available`, or `failed`. `(fileSeriesId, versionNumber)` and `finalObjectKey` are unique. Version creation locks the series, increments by one, and points `previousFileId` to the prior latest version, preventing branches. All record fields, measurements, datasets, tasks, and audit references point to an exact `FileObject.id`, never only to `FileSeries` or “latest.”

The final key contains installation, project, series, file-version, and random identifiers but never the original filename. `originalName` is sanitized for display and `Content-Disposition`. After `available`, object identity, checksum, size, content type, and final key are immutable. If bucket versioning is enabled, `storageVersionId` is recorded and used on every read. A verified fresh-install restore may remap only the provider-local `storageVersionId` while preserving application IDs, keys, checksums, and audit evidence.

Finalization verifies the checksum of the copied final object, not only the earlier staging object, before committing `available`. This prevents a staging overwrite race from committing different bytes. A final object that fails verification has no `FileObject` reference and is handled only as a quarantined cleanup candidate.

#### FileUploadSession

- id
- projectId
- fileId
- stagingObjectKey
- expectedSizeBytes
- expectedChecksum
- status
- expiresAt
- completedAt
- failureCode
- createdBy
- createdAt

`status` is `issued`, `verifying`, `finalized`, `expired`, or `failed`. Staging keys are random, never referenced by domain entities, and never reused. Completion and expiration are idempotent. Only expired, failed, or successfully finalized staging objects may be physically removed by the cleanup job.

#### Dataset

- id
- projectId
- sourceFileId
- sourceDatasetId
- datasetType
- name
- status
- transformationName
- transformationVersion
- parameters JSONB
- inputFingerprint
- schema JSONB
- statistics JSONB
- rowCount
- unitRegistryVersion
- failureCode
- failureDetails JSONB
- createdBy
- createdAt
- updatedAt
- readyAt
- archivedAt
- archivedBy
- archiveReason

Exactly one of `sourceFileId` and `sourceDatasetId` is present in the MVP. `status` is `pending`, `processing`, `ready`, or `failed`. Allowed processing transitions are `pending -> processing -> ready|failed`, `failed -> pending` for an explicit retry, and expired-lease recovery from `processing -> pending`. `ready` is terminal for content.

`inputFingerprint` is a unique hash within a project over the exact source ID and storage version, dataset type, transformation name and version, canonical parameters, and unit-registry version. Repeating a request with the same fingerprint returns the existing dataset. Changing any content-producing input creates a new dataset. Display name and archive metadata may change after ready, but source, transformation, parameters, schema, statistics, row count, registry version, and artifacts may not. A database trigger rejects content mutation after `ready`.

#### DatasetArtifact

- id
- projectId
- datasetId
- artifactKind
- objectKey
- storageVersionId
- contentType
- sizeBytes
- checksumAlgorithm
- checksum
- createdAt

Artifacts include `parquet`, `preview`, and other explicitly versioned derived outputs. Every artifact key is unique and never reused. An artifact row becomes visible only in the same transaction that makes its dataset ready. Reads use the recorded storage version when available. The same maintenance-only provider-version remap rule applies during verified fresh-install restore.

#### Chart

- id
- projectId
- name
- description
- currentRevisionId
- createdBy
- createdAt
- updatedAt
- archivedAt
- archivedBy
- archiveReason

#### ChartRevision

- id
- projectId
- chartId
- revisionNumber
- configVersion
- chartType
- config JSONB
- changeNote
- createdBy
- createdAt

#### ChartDatasetSource

- id
- projectId
- chartRevisionId
- sourceKey
- datasetId
- sourceRole
- seriesOrder

`Chart` is the stable identity and `ChartRevision` is immutable. Editing creates a new revision and atomically advances `currentRevisionId`. Dataset foreign keys are normalized in `ChartDatasetSource`; chart config refers to `sourceKey`, never embeds an unchecked dataset ID. Every source is an exact ready dataset, including archived datasets when the viewer has permission to inspect historical content.

#### Dashboard

- id
- projectId
- name
- description
- currentRevisionId
- createdBy
- createdAt
- updatedAt
- archivedAt
- archivedBy
- archiveReason

#### DashboardRevision

- id
- projectId
- dashboardId
- revisionNumber
- layoutVersion
- changeNote
- createdBy
- createdAt

#### DashboardCard

- id
- projectId
- dashboardRevisionId
- cardType
- chartRevisionId
- configVersion
- config JSONB
- x
- y
- width
- height
- order

Dashboard revisions and cards are immutable after publication. A chart card pins an exact `ChartRevision`; it never follows `Chart.currentRevisionId` implicitly. KPI and specification-status cards use versioned safe config and normalized source identifiers. Editing layout, card config, or chart pinning publishes a new dashboard revision.

#### Specification

- id
- projectId
- name
- measurementFieldId
- status
- createdBy
- createdAt
- updatedAt
- archivedAt
- archivedBy
- archiveReason

`Specification` is the stable identity. `status` is `active` or `archived`. Limits live in immutable revisions. A PostgreSQL partial unique index permits at most one active specification per measurement field in the MVP.

#### SpecificationRevision

- id
- specificationId
- revisionNumber
- quantityDimension
- canonicalUnit
- targetValue
- lowerLimit
- upperLimit
- warningLowerLimit
- warningUpperLimit
- unitRegistryVersion
- changeNote
- createdBy
- createdAt

Creating or changing limits always inserts a new revision. Existing revisions are immutable. Exactly one revision is current for a specification, determined by the greatest committed `revisionNumber`.

#### MeasurementResult

- id
- projectId
- recordId
- fieldId
- canonicalValue
- canonicalUnit
- originalValue
- originalUnit
- precision
- uncertaintyValue
- uncertaintyUnit
- unitRegistryVersion
- measuredAt
- equipmentRecordId
- datasetId
- supersedesResultId
- correctionReason
- recordedBy
- createdAt

Measurement results are append-only. A correction inserts a new result with `supersedesResultId` pointing to the result being corrected and requires a correction reason. A result that has been superseded remains queryable but is excluded from the current-result projection. A result and the result it supersedes must belong to the same project, record, and measurement field.

Only a non-superseded result may be corrected, and a result may have at most one direct successor. For a record grid cell, the latest-result projection selects the non-superseded observation with the greatest `measuredAt`, then `createdAt`, then ID as deterministic tie-breakers. Record detail always exposes the complete observation and correction history.

#### SpecificationEvaluation

- id
- projectId
- specificationRevisionId
- recordId
- measurementFieldId
- measurementResultId
- status
- evaluatedCanonicalValue
- unitRegistryVersion
- evaluatorVersion
- reasonCode
- inputFingerprint
- evaluatedAt
- createdAt

`status` is one of `pass`, `warning`, `fail`, or `missing`. `measurementResultId` and `evaluatedCanonicalValue` are nullable only for `missing`. Evaluations are append-only and always reference the exact specification revision used. `inputFingerprint` uniquely identifies the specification revision, record, measurement result or missing sentinel, and evaluator version so job retries are idempotent. When a specification revision changes, the system creates new evaluations for the affected current results; it never overwrites historical evaluations.

#### Task

- id
- projectId
- title
- description
- status
- priority
- assigneeId
- dueDate
- createdBy
- createdAt
- updatedAt
- archivedAt
- archivedBy
- archiveReason

#### TaskLink

- id
- projectId
- taskId
- entityType
- entityId
- createdAt

#### TemplateInstallation

- id
- projectId
- templateKey
- appliedVersion
- installedBy
- installedAt
- updatedAt

There is at most one installation row per project and template key. `appliedVersion` advances only after the corresponding transactional template upgrade succeeds.

#### BackgroundJob

- id
- projectId
- jobType
- entityType
- entityId
- inputFingerprint
- payload JSONB
- status
- attemptCount
- maxAttempts
- progress
- leaseOwner
- leaseExpiresAt
- scheduledAt
- startedAt
- completedAt
- errorCode
- errorDetails JSONB
- retryable
- createdAt
- updatedAt

`status` is `queued`, `running`, `succeeded`, or `failed`. Payloads contain immutable identifiers and canonical parameters, never pre-signed URLs, raw credentials, or plaintext capability tokens. Job leasing, attempt increments, terminal updates, and domain state changes use compare-and-set updates or transactions. A unique job fingerprint prevents duplicate active work for the same immutable inputs. A retryable failed attempt returns the job to `queued` with `scheduledAt`; only exhaustion or a non-retryable error sets job and dataset to `failed`. Manual retry changes the same failed job and dataset back to `queued` and `pending` in one transaction and preserves all prior attempt rows.

#### BackgroundJobAttempt

- id
- projectId
- jobId
- attemptNumber
- workerIdentity
- status
- progress
- resultCheckpoint JSONB
- startedAt
- heartbeatAt
- completedAt
- errorCode
- errorDetails JSONB
- retryable

There is one row per attempted execution. `resultCheckpoint` may contain staged object identity, intended final artifact ID and key, sizes, and checksums, but never credentials or signed URLs. Attempt rows are append-only after completion and provide the recovery and operator-visible attempt history.

#### OutboxEvent

- id
- projectId
- eventType
- entityType
- entityId
- payload JSONB
- occurredAt
- dispatchedAt
- dispatchAttemptCount
- lastDispatchError

Outbox rows are inserted in the same transaction as the domain change. Dispatch is at-least-once; consumers must be idempotent. Outbox cleanup occurs only after the retention window and after the corresponding job or event effect is durably observable.

#### AuditEvent

- id
- workspaceId
- projectId
- actorId
- action
- entityType
- entityId
- before JSONB
- after JSONB
- metadata JSONB
- createdAt

### 7.3 IDs

Use UUIDv7 for sortable globally unique IDs and store them in native PostgreSQL `uuid` columns.

Application services generate IDs before persistence so the same ID can be used across the primary write, outbox event, audit event, logs, and object-storage metadata. PostgreSQL 18 UUIDv7 generation may be used only in migrations or database-local operations where application-side generation is unavailable. The selected TypeScript and Python UUIDv7 libraries must pass the same RFC 9562 compatibility fixtures.

### 7.4 Archive and tombstone policy

Traceable MVP entities do not expose physical delete operations. Workspace, Project, Record, FileSeries, FileObject, Dataset, Specification, and Task use explicit archive and restore commands.

- archive records actor, timestamp, and reason and writes an audit event,
- archived entities are hidden from default lists but retain stable URLs and may be requested explicitly by authorized users,
- links, lineage, evaluations, task links, file bytes, dataset artifacts, and audit events remain intact,
- restoring an entity revalidates uniqueness, active-specification, schema, and parent-scope constraints and fails with an actionable conflict rather than changing other entities,
- archiving a parent scope prevents new writes beneath it but does not cascade archive timestamps into every child,
- database foreign keys for committed traceable data use `RESTRICT` or equivalent non-cascading behavior,
- public business APIs do not expose `DELETE` for these entities; use `/archive` and `/restore` actions,
- physical cleanup is limited to expired upload staging objects, failed uncommitted outputs, and verified orphan artifacts that have no committed database reference,
- cleanup uses a grace period, dry-run mode, structured logs, and metrics.

Permanent data purge, legal hold, retention schedules, and cascading erasure are deferred and require a separate product and security decision.

### 7.5 Visualization configuration invariants

Chart config is a Zod-validated, versioned discriminated union with initial types `line`, `scatter`, `histogram`, and `box_plot`. Common config contains title, legend, normalized source keys, encodings, axes, display units, safe filters, and missing-data behavior. Type-specific config contains only the options required for that chart type.

- line and scatter charts accept ready XY datasets and map stable X/Y column identifiers,
- histogram config pins a ready dataset, numeric column, bin strategy, and optional fixed range,
- box-plot config pins a ready dataset, numeric value column, and optional grouping column,
- a filter is a bounded AST of `and`, `or`, comparison, membership, null, and range nodes over known field or column IDs and typed literal values,
- config cannot contain SQL, JavaScript, executable expressions, HTML, formatter functions, URLs, or arbitrary ECharts option objects,
- server validation checks project scope, source readiness, column existence and type, unit dimensions, logarithmic-axis constraints, filter depth, and series limits,
- series sharing an axis must have compatible physical dimensions; display-unit conversion is explicit and never changes source data,
- rendering code translates the validated product schema to ECharts options at runtime,
- unknown `configVersion` or discriminant values fail with `CHART_CONFIG_VERSION_UNSUPPORTED` rather than being guessed,
- revisions retain their source dataset IDs even when a newer dataset or chart revision exists.

Dashboard configs follow the same non-executable rule. MVP cards are chart revision, KPI, specification status, recent dataset, and overdue-task cards. Applying a newer chart or dataset to a dashboard always requires an explicit edit and creates a new dashboard revision.

---

## 8. Engineering Type System

### 8.1 Field types

Initial field type identifiers:

```text
text
long_text
integer
decimal
boolean
date
datetime
single_select
multi_select
user
relation
file
quantity
measurement
range
specification
dataset
```

### 8.2 Quantity representation

Each quantity must distinguish:

- original value,
- original unit,
- canonical value,
- canonical unit,
- physical dimension,
- precision,
- uncertainty.

Example:

```json
{
  "value": "1000",
  "unit": "um",
  "canonicalValue": "0.001",
  "canonicalUnit": "m",
  "dimension": "length",
  "precision": 1,
  "uncertainty": "2",
  "unitRegistryVersion": "2026.1+sha256:..."
}
```

### 8.3 Unit registry

The authoritative source is `packages/units/registry/units.yaml`. A build step validates it, produces canonical JSON, and generates TypeScript and Python artifacts. Generated files carry both a human-readable registry version and the SHA-256 digest of the canonical JSON. CI fails if generated artifacts are stale or TypeScript and Python fixture outputs differ.

The unit registry must support:

- dimension identifier,
- unit identifier,
- symbol,
- display name,
- conversion scale,
- conversion offset,
- SI prefix handling,
- aliases.

Each affine conversion to the canonical unit is defined as:

```text
canonicalValue = inputValue * scaleNumerator / scaleDenominator
               + offsetNumerator / offsetDenominator
```

Conversion coefficients are signed decimal integers stored as strings. SI prefixes use exact powers of ten. Absolute temperature conversion applies both scale and offset; temperature differences and uncertainty apply scale only. A unit identifier and its conversion meaning are immutable after release. Correcting a published conversion requires an explicit data migration and registry-version decision record rather than silently changing historical interpretation.

Third-party libraries may assist parsing or display but must not supply conversion factors at runtime. The generated registry is the only conversion authority in the TypeScript API, browser validation, and Python worker.

Initial dimensions:

- dimensionless,
- length,
- area,
- volume,
- mass,
- time,
- temperature,
- electric current,
- voltage,
- resistance,
- power,
- energy,
- pressure,
- force,
- frequency,
- wavelength,
- angle,
- luminous intensity.

Temperature conversions require offsets and must not be treated as scale-only units.

### 8.4 Decimal representation

- scalar quantity, limit, uncertainty, and canonical values use PostgreSQL `numeric`,
- Drizzle and API boundaries represent decimals as canonical decimal strings, not JSON numbers,
- TypeScript uses an arbitrary-precision decimal library and Python uses `decimal.Decimal`,
- conversion and specification evaluation use at least 34 significant decimal digits with round-half-even,
- inputs are limited to 34 significant digits and a documented exponent range to prevent pathological resource use,
- rounding occurs only at an explicitly declared storage or display boundary; intermediate conversion does not round to display precision,
- chart and Parquet pipelines may use binary floating point for dense dataset coordinates, but they must not replace the decimal scalar measurement source of truth,
- cross-language fixtures cover exact powers of ten, offset temperatures, temperature differences, negative values, boundary comparisons, and round-trip serialization.

### 8.5 Quantity validation

The API must reject:

- unknown units,
- units from the wrong physical dimension,
- non-finite values,
- invalid uncertainty values,
- incompatible specification comparisons.

### 8.6 Measurement fields

A measurement field is distinct from a quantity property:

- `quantity` stores one editable engineering property in `Record.values`, such as nominal thickness,
- `measurement` defines a scalar measurand and stores observations in `MeasurementResult`,
- a measurement field declares one physical dimension and canonical unit,
- each observation preserves the original value and unit,
- repeated observations are allowed,
- corrections use supersession and never mutate an observation in place,
- the latest non-superseded observation may be projected into grids and detail views,
- a specification may target only a compatible measurement field.

Formula fields and expression evaluation are deferred beyond the MVP. When introduced, they require a separate ADR covering the parser, determinism, unit-aware arithmetic, dependency tracking, and cycle detection. Arbitrary JavaScript evaluation is prohibited.

### 8.7 Scalar specification evaluation

MVP specifications are unconditional and apply to every non-archived record of the object type that owns the targeted measurement field. Conditional selection by sample metadata, test method, equipment, environment, or effective date is deferred.

Limit validation rules:

- at least one hard limit must be present,
- all supplied limits use the specification canonical unit,
- for a two-sided specification, `lowerLimit <= upperLimit`,
- when supplied, `lowerLimit <= warningLowerLimit <= warningUpperLimit <= upperLimit`, omitting absent one-sided values from that comparison,
- `targetValue` is optional metadata and does not affect status,
- incompatible dimensions, non-finite limits, and invalid ordering are rejected before a revision is committed.

Evaluation precedence:

1. `missing` when the record has no non-superseded measurement result for the field.
2. `fail` when the canonical value is strictly below `lowerLimit` or strictly above `upperLimit`.
3. `warning` when the value remains inside the inclusive hard limits but is strictly below `warningLowerLimit` or strictly above `warningUpperLimit`.
4. `pass` otherwise.

Hard and warning boundary values themselves are inside the better status. An absent lower or upper limit means that side is unbounded. An absent warning limit means no warning band exists on that side.

Evaluation triggers:

- creating a record creates a `missing` evaluation for each active specification targeting one of its measurement fields,
- recording a measurement creates an evaluation for that observation against the current specification revision,
- correcting a measurement evaluates the replacement result and retains all evaluations for the superseded result,
- committing a new specification revision evaluates the latest non-superseded result of every applicable record, or creates `missing` when no result exists,
- an explicit retry with the same immutable inputs returns the existing evaluation identified by `inputFingerprint`.

Every repeated observation is evaluated and remains queryable. Grid cells, status cards, and default dashboards show the evaluation for the latest non-superseded observation using the deterministic ordering in Section 7.2. If that observation has not yet been evaluated, the UI shows `pending`; it must not reuse the status of an older observation.

---

## 9. Dataset Model

### 9.1 Dataset types

#### XY dataset

Use for curves, spectra, time-series-like measurements, and characteristic sweeps.

Required metadata:

- X column ID,
- X field name,
- X dimension,
- X unit,
- Y column ID,
- Y field name,
- Y dimension,
- Y unit,
- row count,
- minimum and maximum,
- source file,
- parser version.

#### Tabular dataset

Use for general measurement tables.

Required metadata:

- column definitions with stable column IDs,
- inferred data types,
- units where declared,
- row count,
- null counts,
- basic statistics.

### 9.2 Dataset storage

For small preview data, PostgreSQL JSONB may be used.

For full processed data:

- store Parquet in a never-reused `DatasetArtifact` object key,
- store schema and statistics in PostgreSQL,
- record the artifact checksum and storage version ID,
- never overwrite the raw uploaded file or a ready artifact,
- do not expose staged artifacts through dataset read APIs.

### 9.3 Dataset lineage

Every derived dataset must reference:

- source dataset or file,
- transformation name,
- transformation version,
- parameters,
- actor or worker identity,
- creation timestamp.

CSV parsing first creates a tabular dataset from an exact file version. Selecting X and Y columns creates a new XY dataset whose `sourceDatasetId` points to that tabular dataset and whose canonical parameters contain stable column identifiers and unit assignments. Re-selecting columns or changing units creates another dataset rather than mutating the prior XY dataset.

Saved charts, dashboards, measurements, tasks, and exports reference exact dataset IDs. They do not follow a “latest dataset” pointer. The UI may offer an explicit action to create a new chart revision using a newer dataset, but it must not update sources silently.

### 9.4 MVP dataset and measurement boundary

Dataset parsing and measurement recording are separate operations in the MVP:

- parsing a CSV creates a tabular or XY dataset but does not create measurement results,
- a user records a scalar measurement result explicitly and may attach one supporting dataset,
- the dataset link is provenance evidence; the system does not claim that the scalar was computed from the dataset,
- automatic extraction of mean, maximum, fitted parameters, interpolated values, or other derived metrics is deferred,
- specifications evaluate scalar measurement results only and do not evaluate an entire curve or table.

### 9.5 Dataset state and idempotency

- dataset creation canonicalizes all content-producing parameters before hashing,
- the project-scoped `inputFingerprint` makes equivalent create and retry requests idempotent,
- a failed dataset may be retried only with the same fingerprint; changed inputs create a new dataset,
- `ready` content fields and artifact rows are immutable,
- a ready dataset may be archived and restored without changing content,
- failed datasets retain sanitized failure details and attempt history,
- a chart or measurement cannot reference a dataset until it is ready,
- orphan object cleanup requires proving that no `FileObject`, `DatasetArtifact`, active staging session, or running job references the key.

---

## 10. Default Template: Test & Characterization

### 10.1 Object types

#### Test Item

Fields:

- Name
- Part Number
- Revision
- Description
- Status

#### Sample

Fields:

- Sample ID
- Test Item relation
- Lot
- Batch
- Serial Number
- Received Date
- Status
- Notes

#### Equipment

Fields:

- Equipment ID
- Name
- Manufacturer
- Model
- Serial Number
- Calibration Due Date
- Status

#### Test Method

Fields:

- Name
- Method Version
- Description
- Default Equipment
- Procedure File
- Status

#### Test Run

Fields:

- Run ID
- Sample relation
- Test Method relation
- Equipment relation
- Operator
- Start Time
- End Time
- Environment Temperature
- Status
- Raw File
- Dataset

#### Issue

Fields:

- Title
- Related Sample
- Related Test Run
- Severity
- Status
- Root Cause
- Corrective Action

The template does not create configurable `Specification` or `Task` object types. It installs platform specifications through the core specification module and uses platform tasks for follow-up actions. An Issue is an investigation record; tasks may link to it through `TaskLink`.

### 10.2 Incremental template delivery

- the template has the stable key `test-characterization` and a monotonically increasing integer version,
- each project stores the last successfully applied template version,
- installation and upgrade run in a database transaction and are idempotent,
- stable object-type and field keys, not display names, identify template-managed schema,
- an upgrade may add schema and defaults but must not delete user records, overwrite user values, or silently replace user-modified display settings,
- key conflicts or incompatible user schema changes stop the upgrade with an actionable error,
- Phase 2 installs the object types and the simple fields supported at that point,
- Phase 3 adds the `Environment Temperature` quantity field and enables core measurement and specification views without creating configurable Specification records,
- Phase 4 adds `Procedure File`, `Raw File`, and `Dataset` fields,
- Phase 5 adds the default dashboard and saved charts.
- Phase 6 enables task links to Issue, Sample, Test Run, measurement result, evaluation, and dataset entities.
- Phase 8 adds onboarding, demo data, documentation, migration checks, and the final golden-flow verification.

### 10.3 Default dashboard

- total samples,
- tests by status,
- pass rate,
- failed specification evaluations,
- measurements by equipment,
- recent datasets,
- overdue tasks.

---

## 11. Authorization

### 11.1 MVP roles

- Owner
- Admin
- Engineer
- Contributor
- Viewer

### 11.2 Initial permission actions

```text
workspace.read
workspace.manage
project.create
project.read
project.update
project.archive
project.restore
schema.read
schema.manage
record.create
record.read
record.update
record.archive
record.restore
file.upload
file.read
file.archive
file.restore
dataset.upload
dataset.read
dataset.archive
dataset.restore
job.read
job.retry
measurement.create
measurement.correct
measurement.read
specification.read
specification.manage
dashboard.manage
task.create
task.read
task.update
task.archive
task.restore
member.manage
audit.read
export.execute
```

### 11.3 Authorization rules

- all business endpoints must check permissions,
- authorization logic must live in a dedicated permissions package or module,
- UI permission checks are for presentation only,
- API checks are mandatory,
- audit log access is restricted,
- exports require explicit permission.

Field-level and record-level permissions are deferred but the authorization interface should allow future resource conditions.

### 11.4 Project isolation without PostgreSQL RLS

PostgreSQL RLS is intentionally not enabled in the MVP. Isolation must therefore be structural and testable:

- every project-owned table includes `projectId`, including projection and link tables,
- cross-table references between project-owned entities use composite foreign keys containing both `projectId` and entity ID where practical,
- a `RequestScope` contains actor, organization, workspace, and project IDs after authentication and membership resolution,
- project repository instances require a `RequestScope`; business code cannot instantiate an unscoped project repository,
- repository lookups constrain both entity ID and project ID, including update and delete statements,
- global repositories are limited to authentication, first-run setup, organization bootstrap, and other explicitly reviewed installation-wide operations,
- an identifier that exists only in another project returns the same not-found response as an unknown identifier,
- relation, task-link, measurement, specification, file, and dataset writes reject cross-project references at both service and foreign-key boundaries,
- background jobs include project scope and an immutable initiating actor or system identity, then reload scoped entities before work begins,
- raw SQL is allowed only in the database package and must expose a scoped repository method when it reads or writes project data.

Database roles:

- the migration role owns schema changes and is not used by running services,
- the API runtime role has only required DML and sequence privileges,
- the Node orchestration worker role is separately limited to job, dataset, file, outbox, and required audit operations,
- the Python scientific worker has no PostgreSQL role or connection string,
- the backup role may read application tables and use `pg_dump` but cannot perform business mutations or schema migrations,
- neither runtime role is a PostgreSQL superuser or table owner,
- application startup fails readiness when configured with the migration role in production.

Integration tests create at least two workspaces and projects and attempt every project-owned read, update, delete, relation, export, and background-job path using foreign IDs. Adding a project-owned repository method without an isolation test fails the definition of done. PostgreSQL RLS may be evaluated later as defense in depth, but it must not replace API authorization.

---

## 12. Authentication

### 12.1 Local authentication

MVP local authentication must support:

- email and password,
- Argon2id password hashing with a unique salt per password,
- email normalization,
- password reset token workflow,
- session revocation,
- optional invitation-only registration.

Password hashing parameters must be configurable and benchmarked on the deployment hardware. The default must be no weaker than the current OWASP Argon2id minimum at implementation time. Stored hashes must include the algorithm and work parameters so they can be upgraded on a later successful login.

#### First-run Owner setup

1. Database bootstrap creates the single Organization and an incomplete installation setup row.
2. If `ENGROVE_SETUP_TOKEN` is supplied, the API hashes that token. Otherwise it generates 32 cryptographically random bytes and prints the plaintext setup URL once to the startup console.
3. Only the token hash is stored. The token must not appear in later logs, audit payloads, or API responses.
4. `/setup` accepts the token, email, display name, and password, then creates the first user, Owner membership, and setup-completed marker in one serializable transaction.
5. Concurrent or repeated setup completion attempts must not create another Owner.
6. After successful setup, the token hash is deleted and `/setup` returns `404 SETUP_NOT_AVAILABLE` permanently.
7. Before setup completes, an operator may rotate a lost setup token through a documented local administration command. The command is unavailable after setup completes.

#### Invitations and password reset

- SMTP is not required for the MVP,
- an Owner or Admin with `member.manage` may create an invitation or password-reset URL and copy it through an authenticated UI,
- tokens contain at least 32 cryptographically random bytes, are stored only as SHA-256 hashes, expire after 30 minutes by default, and are single-use,
- invitation and reset URLs use the configured public base URL and never trust the request `Host` header,
- reset requests and token attempts are rate-limited and return non-enumerating errors,
- completing a password reset invalidates all existing local sessions for that user and does not automatically sign the user in,
- token creation, use, expiration, and revocation are audited without recording the plaintext token,
- automatic SMTP delivery may be added later without changing token semantics.

### 12.2 OIDC

OIDC settings:

- issuer URL,
- client ID,
- client secret,
- scopes,
- claim mapping,
- allowed domains,
- auto-provisioning toggle.

Reference deployment should support Keycloak.

### 12.3 Session security

- the browser receives a 32-byte cryptographically random opaque token encoded with Base64url,
- only a SHA-256 hash of the token is stored in PostgreSQL,
- the cookie is HTTP-only, `SameSite=Lax`, `Path=/`, and `Secure` in production,
- session identifiers are accepted only from the cookie and never from a URL or request body,
- state-changing requests require CSRF protection in addition to SameSite cookies,
- authentication endpoints and invalid-session attempts are rate-limited,
- sessions rotate after authentication, password changes, and other security-sensitive identity transitions,
- authorization is evaluated from current membership data rather than role claims embedded in the session token,
- idle and absolute lifetimes are configurable and enforced server-side,
- sign-out, password reset, administrator revocation, and account disablement take effect without waiting for Redis cache expiration,
- raw session tokens are never logged; logs may use a separate non-reversible correlation value.

The session table contains:

- id,
- userId,
- tokenHash,
- createdAt,
- lastSeenAt,
- idleExpiresAt,
- absoluteExpiresAt,
- rotatedFromSessionId,
- revokedAt,
- revokedReason.

`tokenHash` is unique. Expired and revoked sessions are rejected before business authorization. Cleanup may delete expired session rows only after the configured audit retention interval.

---

## 13. Audit and Traceability

Audit events are required for:

- first-run setup completion and rejected setup attempts,
- login success and failure,
- invitation and password-reset token lifecycle events,
- session creation, rotation, and revocation,
- workspace creation and update,
- project creation and update,
- schema changes,
- record creation, update, archive, and restore,
- file upload finalization, version creation, archive, and restore,
- dataset parse and transformation,
- dataset archive and restore,
- cleanup dry runs and physical removal of uncommitted objects,
- maintenance-mode, backup, verification, and restore operations,
- measurement result creation and supersession,
- specification changes,
- specification evaluations,
- task state changes,
- role and membership changes,
- export operations.

Sensitive secrets must never be stored in audit payloads.

Audit records should be append-only from the application perspective.

---

## 14. API Design

### 14.1 General rules

- REST JSON API,
- `/api/v1`,
- OpenAPI generated automatically,
- pagination for list endpoints,
- stable error format,
- request IDs,
- idempotency keys for critical creation/import endpoints,
- optimistic concurrency for record updates,
- explicit archive and restore actions instead of physical delete endpoints for traceable entities.

### 14.2 Error format

```json
{
  "error": {
    "code": "FIELD_VALIDATION_FAILED",
    "message": "The supplied value is invalid.",
    "details": [
      {
        "field": "thickness",
        "reason": "Unit 'kg' is incompatible with dimension 'length'."
      }
    ],
    "requestId": "..."
  }
}
```

### 14.3 Initial endpoint groups

```text
/setup
/auth
/users
/workspaces
/projects
/object-types
/fields
/records
/files
/file-upload-sessions
/datasets
/background-jobs
/measurement-results
/specifications
/specification-evaluations
/charts
/dashboards
/tasks
/audit-events
/templates
```

---

## 15. Frontend Information Architecture

### 15.1 Global navigation

```text
Home
Workspaces
Projects
Templates
Administration
```

### 15.2 Project navigation

```text
Overview
Data
Datasets
Dashboards
Tasks
Files
Activity
Settings
```

### 15.3 Primary screens

1. Sign in
2. Workspace list
3. Project list
4. Project overview
5. Object type data grid
6. Record detail
7. Object type schema editor
8. File browser
9. Dataset detail and chart
10. Dashboard editor
11. Task board
12. Calendar
13. Activity and audit view
14. Project settings
15. Workspace administration

### 15.4 Record detail layout

The record detail screen should prioritize context.

Suggested layout:

```text
Header
├── Record name
├── Object type
├── Status
└── Actions

Main
├── Properties
├── Measurements
├── Specification evaluations
├── Relations
├── Datasets
├── Files
├── Tasks
└── Activity
```

---

## 16. UX Requirements

- keyboard-friendly data grid,
- direct cell editing for mutable record names, properties, relations, and exact file or dataset references,
- persistent table/view context beside the grid and a compact contextual toolbar,
- field visibility, row density, ascending or descending sort, and typed filter controls,
- page-scoped row selection with permission-aware bulk archive,
- new and existing record side panels that preserve the underlying grid context,
- Enter or focus exit saves a cell, Escape cancels editing, and validation or concurrency errors remain attached to the edited cell,
- measurement projections are read-only in the grid and link to the append-only measurement workflow,
- inline validation,
- clear unit display,
- no silent unit conversion,
- preserve original entered value and unit,
- destructive actions require confirmation,
- empty states must explain the next action,
- background jobs must show progress and failure reason,
- errors must be actionable,
- record and dataset URLs must be stable and shareable,
- no horizontal overflow for common desktop resolutions,
- minimum WCAG AA contrast target,
- loading skeletons for primary screens,
- optimistic updates only where rollback is reliable.

---

## 17. Security Requirements

- use parameterized queries or ORM protections,
- validate all input,
- sanitize uploaded file names,
- never execute uploaded content,
- store secrets outside source control,
- support rotating OIDC client secrets,
- enforce maximum upload size,
- content-type and extension checks,
- checksum every uploaded file,
- prevent browser and Python worker credentials from writing committed object prefixes directly,
- scope internal job capabilities to one job, audience, action set, and short expiry,
- keep the Python worker endpoint on the private deployment network,
- rate-limit authentication and import endpoints,
- prevent SSRF in any future remote import feature,
- use least-privilege database and object-storage credentials,
- require restrictive local permissions for temporary backup material and remove it after success or failure,
- never accept backup decryption identities through API requests or store them in application configuration,
- provide a production security checklist.

---

## 18. Observability

### 18.1 Logging

Use structured JSON logs containing:

- timestamp,
- level,
- service,
- request ID,
- actor ID when available,
- workspace ID,
- project ID,
- event name,
- duration,
- error code.

Never log passwords, access tokens, client secrets, or raw file content.

### 18.2 Metrics

Initial metrics:

- HTTP request count,
- HTTP latency,
- error rate,
- active jobs,
- job failure count,
- outbox dispatch lag and undispatched count,
- expired job lease and reconciliation count,
- orphan cleanup candidate and deletion counts,
- staging upload expiry count,
- maintenance-mode duration and failed drain count,
- backup and restore duration, bytes, and verification failure count,
- dataset parse duration,
- record projection rebuild count and duration,
- cross-project access rejection count,
- uploaded bytes,
- database connection usage.

### 18.3 Health endpoints

- liveness,
- readiness,
- PostgreSQL connectivity,
- Redis connectivity,
- object storage connectivity,
- Node orchestration worker heartbeat,
- Python scientific worker heartbeat and compatible parser versions.

---

## 19. Testing Strategy

### 19.1 Unit tests

Required for:

- unit conversion,
- TypeScript and Python unit-registry fixture parity,
- decimal serialization and canonical unique keys,
- dimension compatibility,
- specification evaluation,
- inclusive specification boundaries and one-sided limits,
- evaluation trigger idempotency,
- permission rules,
- measurement supersession rules,
- specification revision immutability,
- file-series linear version rules,
- dataset input fingerprint canonicalization,
- background-job state transitions and retry classification,
- chart config schema validation, filter AST bounds, and unit-compatible axes,
- dataset schema inference,
- audit payload filtering.

### 19.2 Integration tests

Required for:

- first-run setup concurrency and permanent closure,
- authentication,
- session rotation and immediate revocation,
- invitation and password-reset token expiry and single use,
- workspace and project creation,
- object type and field creation,
- record create, read, update, archive, and restore,
- transactional record projection updates and rebuild verification,
- typed filtering, sorting, grouping, and unique conflicts,
- relation creation,
- staging upload checksum verification and immutable file finalization,
- linear file version creation and exact-version reads,
- archive and restore without link or object removal,
- dataset parse and XY derivation jobs,
- ready-dataset and artifact immutability,
- outbox duplicate delivery and BullMQ duplicate delivery,
- Redis loss, expired lease, Node crash, Python timeout, and post-copy database failure recovery,
- orphan cleanup dry-run and reference protection,
- chart and dashboard revision immutability and exact source pinning,
- measurement result creation and correction,
- specification evaluation,
- specification revision re-evaluation and missing results,
- task linking,
- permissions,
- cross-workspace and cross-project isolation for every project-owned repository,
- runtime and migration database-role separation,
- encrypted backup verification and fresh-install restore,
- audit events.

Use ephemeral PostgreSQL, Redis, and MinIO containers in CI where practical.

### 19.3 End-to-end tests

Use Playwright.

Critical E2E scenarios:

1. create account and workspace,
2. create project,
3. install template,
4. create sample,
5. upload and finalize an immutable CSV file,
6. parse a tabular dataset,
7. derive an XY dataset by selecting columns,
8. create a chart referencing exact dataset IDs,
9. create a specification,
10. record a scalar measurement linked to the dataset,
11. observe a failed evaluation tied to the specification revision,
12. create a linked task,
13. inspect file versions, dataset lineage, activity history, and the supersession trail.

### 19.4 Test data

Provide deterministic fixture data for:

- material tensile test,
- voltage-current sweep,
- temperature trend,
- spectral response,
- pass/fail sample set.

---

## 20. Definition of Done

A feature is done only when:

- acceptance criteria are met,
- API authorization is implemented,
- validation is implemented,
- audit behavior is considered,
- unit or integration tests exist,
- loading, empty, and error states exist,
- documentation is updated,
- no known critical accessibility issue exists,
- database migration is included,
- generated unit-registry artifacts and record projection fixtures are current,
- new project-owned repository paths include cross-project isolation tests,
- local Docker development works,
- lint and type checks pass.

---

## 21. Development Phases

## Phase 0: Repository and Decisions

### Goals

- establish the monorepo,
- establish coding standards,
- resolve major technical choices,
- make local startup reliable.

### Tasks

- initialize Git repository,
- add the AGPL-3.0 license and contribution notice,
- pin Node.js 24 and the package-manager version,
- configure pnpm and Turborepo,
- create web, API, and Python worker apps,
- create shared packages,
- configure ESLint and Prettier,
- configure TypeScript strict mode,
- configure Python Ruff and mypy,
- pin Python 3.13 and commit the uv lockfile,
- create Docker Compose,
- create CI,
- create `.env.example`,
- add architecture decision record template,
- write contribution guide.

### Required ADRs

- ADR-001 Drizzle ORM and reviewed SQL migrations
- ADR-002 application-generated UUIDv7 identifiers
- ADR-003 PostgreSQL-backed opaque browser sessions
- ADR-004 JSONB records with typed query projections
- ADR-005 immutable files, datasets, and processed artifact storage
- ADR-006 PostgreSQL outbox and job state with BullMQ delivery
- ADR-007 immutable measurement and specification evaluation history
- ADR-008 template versioning and idempotent upgrades
- ADR-009 versioned cross-language unit registry and decimal arithmetic
- ADR-010 application-enforced project isolation without PostgreSQL RLS
- ADR-011 archive, tombstone, and physical purge boundaries
- ADR-012 immutable chart and dashboard configuration revisions
- ADR-013 maintenance-mode encrypted backup and fresh-install restore
- ADR-014 Community-first repository and future Enterprise boundary

### Exit criteria

```bash
pnpm install
docker compose up -d
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm format:check
uv lock --check
```

All commands work from a clean checkout.

---

## Phase 1: Authentication and Workspace Foundation

### Features

- local authentication,
- session management,
- protected first-run Owner setup,
- invitation and manual password-reset URL workflows,
- single-organization bootstrap,
- workspace,
- project,
- membership,
- MVP roles,
- base audit events.

### Acceptance criteria

- an unauthenticated caller cannot complete setup without the one-time setup token,
- two concurrent valid setup submissions create exactly one Owner,
- setup cannot be reopened after completion,
- user can sign in and sign out,
- sign-out and administrator revocation invalidate a session immediately without Redis,
- an invitation or password-reset token expires, is single-use, and is never stored or logged in plaintext,
- password reset revokes all of the user's existing local sessions,
- first-run bootstrap creates exactly one organization and the first Owner,
- user can create a workspace,
- user can create a project,
- project archive and restore preserve membership and audit history,
- user can invite or add another user,
- Viewer cannot update a project,
- role changes are audited,
- unauthorized API access returns 403.

---

## Phase 2: Configurable Data Model

### Features

- object types,
- field definitions,
- records,
- typed record query projection,
- deterministic projection rebuild command,
- grid,
- record detail,
- filters,
- sorts,
- CSV import/export,
- incremental Test & Characterization template installer.

### Initial field types

- text,
- long text,
- integer,
- decimal,
- boolean,
- date,
- datetime,
- single select,
- multi select,
- user,
- relation.

### Acceptance criteria

- user can create a Sample object type,
- user can install the Phase 2 Test & Characterization template without creating duplicate object types,
- user can add fields,
- user can create and edit records,
- user can edit a mutable record cell directly from the spreadsheet view without opening record detail,
- user can hide fields, change row density, filter, and sort ascending or descending without leaving the grid,
- user can select visible rows and archive them in bulk when authorized,
- user can create or edit a record in a side panel while retaining grid context,
- direct cell edits validate the field type, update JSONB and typed projections atomically, create an audit event, and reject stale `rowVersion` values,
- measurement cells remain read-only and ready datasets are never mutated by the spreadsheet view,
- user can archive and restore a record without losing relations or history,
- record JSONB and typed projection update atomically,
- typed filters and sorts produce correct numeric, date, and text ordering,
- a unique scalar field rejects a duplicate canonical value,
- projection rebuild verification reproduces the JSONB source without changing it,
- index-dependent operations return `FIELD_INDEX_REBUILDING` while a field projection is unavailable,
- user can create relations between records,
- grid supports pagination,
- CSV import reports row-specific validation errors,
- schema changes are audited.

---

## Phase 3: Units, Quantities, and Specifications

### Features

- unit registry,
- quantity field,
- range field,
- measurement field,
- append-only measurement result,
- specification identity and immutable revisions,
- append-only specification evaluation,
- automatic canonical conversion,
- pass/warning/fail/missing evaluation.

### Acceptance criteria

- `1 mm`, `0.001 m`, and `1000 um` compare as equal,
- TypeScript and Python generate identical canonical values and registry digests for the shared fixtures,
- scalar decimal values round-trip through API and PostgreSQL without conversion to a JSON number,
- incompatible dimensions are rejected,
- Celsius and Kelvin convert correctly,
- original value and unit are preserved,
- repeated measurements can be recorded for the same record and field,
- correcting a measurement preserves the previous result and records the supersession link,
- a specification can evaluate only a dimension-compatible measurement field,
- a measurement field cannot have two active specifications,
- hard and warning limits are inclusive and support one-sided specifications,
- a record without a current measurement receives a missing evaluation,
- repeated job delivery does not create a duplicate evaluation for identical immutable inputs,
- changing specification limits creates a new revision and new evaluations,
- historical evaluations retain their original result, specification revision, status, and evaluator version,
- archiving and restoring a specification preserves every revision and evaluation,
- evaluations are reproducible and audited,
- the template upgrade adds the quantity field and core measurement/specification views without replacing existing template records or creating configurable Specification records.

---

## Phase 4: Files and Datasets

### Features

- staging-only pre-signed file upload,
- full-object SHA-256 verification and immutable finalization,
- file series and exact version references,
- archive and restore,
- PostgreSQL outbox and background jobs,
- Node orchestration worker and recovery reconciler,
- private Python FastAPI scientific worker,
- CSV parsing job,
- tabular dataset,
- derived XY dataset,
- immutable dataset artifacts,
- dataset preview,
- statistics.

### Acceptance criteria

- user can upload a CSV,
- a browser cannot write the final committed object prefix,
- finalizing the same upload request is idempotent,
- a new file version receives a new FileObject, object key, checksum, and exact reference while the prior version remains readable,
- raw file and ready dataset artifacts remain immutable,
- parser errors are visible,
- user can select X and Y columns from a ready tabular dataset to create a distinct derived dataset,
- units can be assigned to axes,
- processed dataset is stored as Parquet,
- lineage links XY dataset to tabular dataset and tabular dataset to an exact raw file version,
- equivalent create or retry requests return the dataset with the same input fingerprint,
- Redis loss and worker crashes do not lose durable job intent and reconciliation completes or visibly fails the dataset,
- Python worker cannot write domain tables and is not exposed outside the private deployment network,
- archive and restore preserve files, artifacts, lineage, links, and audit history,
- cleanup cannot delete an object referenced by committed data, an active upload, or a running job checkpoint,
- parsing a dataset does not create a measurement result,
- a manually recorded scalar measurement can link the dataset as supporting evidence,
- the template upgrade adds file and dataset fields without replacing existing template records.

---

## Phase 5: Charts and Dashboards

### Features

- chart identity and immutable revisions,
- normalized exact dataset sources,
- versioned safe chart config and filter AST,
- line chart,
- scatter plot,
- histogram,
- box plot,
- KPI card,
- saved chart configuration,
- dashboard,
- immutable dashboard revisions and layout persistence.

### Acceptance criteria

- user can overlay multiple XY datasets,
- saved charts reference exact ready dataset IDs and stable column IDs,
- editing a chart creates a new immutable revision,
- invalid, executable, over-deep, or unknown-version config is rejected,
- incompatible physical dimensions cannot share an axis,
- axes display units,
- chart links back to source datasets,
- filters are persisted,
- dashboard cards reload consistently,
- chart cards pin exact chart revisions and change only through an explicit dashboard edit,
- editing a dashboard publishes a new immutable revision,
- missing or invalid data is clearly indicated,
- the template upgrade installs its default saved charts and dashboard idempotently.

---

## Phase 6: Tasks and Engineering Workflow

### Features

- task create, read, update, archive, and restore,
- status,
- priority,
- assignee,
- due date,
- task links,
- Kanban,
- calendar.

### Acceptance criteria

- user can create a task from a failed specification evaluation,
- task links to sample, Issue, measurement result, specification evaluation, and dataset,
- linked task appears in record detail,
- status changes are audited,
- archiving and restoring a task preserves its engineering links and status history,
- Viewer cannot modify tasks,
- the template upgrade enables the supported task links without creating a duplicate Task object type.

---

## Phase 7: OIDC and Deployment Hardening

### Features

- OIDC configuration,
- Keycloak reference setup,
- production Docker images,
- backup and restore scripts,
- maintenance mode and job draining,
- age-encrypted manifest backup,
- health checks,
- observability baseline,
- security checklist.

### Acceptance criteria

- user can sign in through Keycloak,
- clean self-hosted installation is documented,
- backup can be restored into a fresh instance,
- production backup rejects unencrypted output,
- restore verifies database and exact object checksums and revokes restored sessions and reset tokens,
- interrupted durable jobs are reconciled after restore,
- services expose readiness checks,
- secrets are not embedded in images.

---

## Phase 8: Pilot Release

### Features

- completed Test & Characterization template,
- onboarding flow,
- demo dataset,
- admin documentation,
- pilot feedback capture,
- template upgrade and migration verification.

### Pilot success criteria

- at least 3 repeat users,
- at least 100 real records,
- at least 10 datasets,
- at least one existing spreadsheet workflow partially replaced,
- engineers can trace a chart to its raw source,
- engineers can create follow-up tasks from results,
- no critical data loss or permission issue.

---

## 22. Codex Working Rules

Codex must follow these rules during implementation:

1. Read this document before starting a major phase.
2. Read existing ADRs before changing architecture.
3. Do not add a new infrastructure dependency without an ADR.
4. Implement one vertical slice at a time.
5. Keep commits focused and reviewable.
6. Add tests with each feature.
7. Do not bypass authorization in development code.
8. Do not introduce formula execution in the MVP. Future formula work must not use `eval`.
9. Do not mutate raw uploaded files.
10. Do not silently coerce incompatible units.
11. Do not create microservices without explicit approval.
12. Do not expand MVP scope without updating this file.
13. Prefer clear code over abstraction-heavy frameworks.
14. Avoid generic utility packages until duplication is proven.
15. Return actionable errors.
16. Keep API and database naming in English.
17. Keep all timestamps in UTC.
18. Preserve original user-entered quantity values.
19. Use database transactions for multi-entity writes.
20. Run lint, tests, and type checks before declaring a task complete.
21. Do not physically delete committed traceable entities or storage objects in MVP business code.
22. Treat PostgreSQL job state and outbox rows as authoritative; never infer durable completion from BullMQ alone.
23. Implement Community capabilities only until the Community MVP is accepted. Do not scaffold or anticipate Enterprise code paths.

---

## 23. Recommended Issue Breakdown

Create GitHub issues or local task files in this order:

### Epic 0: Foundation

- ENG-001 Initialize monorepo
- ENG-002 Add Docker Compose development stack
- ENG-003 Configure CI
- ENG-004 Add application configuration system
- ENG-005 Add structured logging
- ENG-006 Create ADR framework
- ENG-007 Add AGPL-3.0 license and repository boundary documentation
- ENG-008 Pin Node.js 24 and the package-manager toolchain

### Epic 1: Identity and Access

- ENG-101 Implement local authentication
- ENG-102 Implement sessions
- ENG-103 Add single-organization bootstrap
- ENG-104 Add workspaces
- ENG-105 Add projects
- ENG-106 Add memberships and roles
- ENG-107 Add permission service
- ENG-108 Add audit foundation
- ENG-109 Add protected first-run Owner setup
- ENG-110 Add invitation and password-reset tokens
- ENG-111 Add workspace and project archive/restore lifecycle

### Epic 2: Engineering Data Model

- ENG-201 Add object types
- ENG-202 Add field definitions
- ENG-203 Add records
- ENG-204 Add typed record query projection and rebuild command
- ENG-205 Add grid API
- ENG-206 Add grid UI
- ENG-207 Add record detail UI
- ENG-208 Add relations
- ENG-209 Add CSV import
- ENG-210 Add CSV export
- ENG-211 Add versioned, idempotent template installer
- ENG-212 Add Phase 2 Test & Characterization template schema
- ENG-213 Add record archive/restore lifecycle

### Epic 3: Engineering Types

- ENG-301 Add authoritative unit registry and artifact generator
- ENG-302 Add decimal serialization and cross-language fixtures
- ENG-303 Add conversion engine
- ENG-304 Add quantity field
- ENG-305 Add range field
- ENG-306 Add measurement fields and latest-result projection
- ENG-307 Add append-only measurement results and supersession
- ENG-308 Add specification identities and immutable revisions
- ENG-309 Add append-only specification evaluation
- ENG-310 Add Phase 3 template upgrade
- ENG-311 Add unit tests for dimensions, conversions, and registry parity

### Epic 4: Files and Datasets

- ENG-401 Add scoped object-storage adapter and prefix policy
- ENG-402 Add file series and immutable file versions
- ENG-403 Add staging upload sessions and pre-signed upload
- ENG-404 Add checksum verification and immutable file finalization
- ENG-405 Add archive, restore, and safe staging cleanup
- ENG-406 Add PostgreSQL background jobs and transactional outbox
- ENG-407 Add Node BullMQ orchestration worker and reconciler
- ENG-408 Add private Python FastAPI worker and job capabilities
- ENG-409 Add CSV parser
- ENG-410 Add immutable tabular datasets
- ENG-411 Add derived XY datasets
- ENG-412 Add immutable Parquet and preview artifacts
- ENG-413 Add dataset lineage and input fingerprints
- ENG-414 Add explicit measurement-to-dataset evidence link
- ENG-415 Add failure-injection and orphan-recovery tests
- ENG-416 Add Phase 4 template upgrade

### Epic 5: Visualization

- ENG-501 Add chart identities, revisions, and normalized dataset sources
- ENG-502 Add versioned safe chart config and bounded filter AST
- ENG-503 Add line chart
- ENG-504 Add scatter plot
- ENG-505 Add histogram
- ENG-506 Add box plot
- ENG-507 Add KPI and specification-status cards
- ENG-508 Add dashboard identities, revisions, and pinned cards
- ENG-509 Add explicit-revision dashboard editor
- ENG-510 Add Phase 5 template charts and dashboard

### Epic 6: Work Management

- ENG-601 Add tasks
- ENG-602 Add task links
- ENG-603 Add Kanban board
- ENG-604 Add calendar
- ENG-605 Add failed-evaluation task creation
- ENG-606 Add Issue and engineering entity task links
- ENG-607 Add Phase 6 template upgrade

### Epic 7: Identity and Deployment Hardening

- ENG-701 Add OIDC
- ENG-702 Add Keycloak example
- ENG-703 Add maintenance mode and age-encrypted manifest backup
- ENG-704 Add verified fresh-install restore and recovery
- ENG-705 Add health checks
- ENG-706 Add metrics
- ENG-707 Add Community production security guide

### Epic 8: Pilot

- ENG-801 Complete and verify Test & Characterization template upgrades
- ENG-802 Add demo data
- ENG-803 Add onboarding
- ENG-804 Add pilot documentation
- ENG-805 Run full golden-flow E2E test

---

## 24. First Codex Task

Codex should begin with the following task:

### Task: Bootstrap the Engrove monorepo

The normative task breakdown, service contracts, test matrix, and completion evidence are defined in `docs/architecture/phase-0-execution-spec.md`.

#### Deliverables

- pnpm workspace,
- Turborepo,
- `apps/web`,
- `apps/api`,
- `apps/worker-python`,
- Node orchestration worker entry command in `apps/api`,
- shared packages,
- strict TypeScript,
- Python 3.13, uv lockfile, Ruff, mypy, and pytest,
- Docker Compose with web, API, Node worker, Python worker, PostgreSQL, Redis, and MinIO,
- Drizzle ORM and reviewed SQL migrations,
- health endpoint in API,
- basic landing page in web,
- Node and Python worker health and heartbeat endpoints,
- GitHub Actions or equivalent CI,
- root README with setup commands,
- `.env.example`,
- AGPL-3.0 `LICENSE`,
- pinned Node.js 24 and package-manager versions,
- ADR template and accepted ADR-001 through ADR-014.

#### Constraints

- no business feature implementation yet,
- no Kubernetes,
- no domain microservices beyond the planned web, API, Node orchestration worker, and Python scientific worker processes,
- no external managed service dependency,
- no Enterprise scaffolding, packages, schemas, routes, or feature gates,
- all services must run locally.

#### Completion checks

```bash
pnpm install
docker compose up -d
pnpm lint
pnpm typecheck
pnpm test
pnpm dev
```

A clean checkout must be usable by another developer using only the README.

---

## 25. Initial README Summary

The root README should begin with:

```markdown
# Engrove

Engrove is a self-hosted data and operations workspace built for engineers.

It connects engineering objects, physical quantities, measurements, datasets,
files, specifications, dashboards, tasks, and audit history in one traceable
workspace.

This repository contains Engrove Community, licensed under AGPL-3.0.
Community is the sole development and delivery focus until the Community MVP
acceptance criteria are met.

## Status

Engrove is in early development and is not ready for production use.
```

---

## 26. Open Decisions

No unresolved product or architecture decision currently blocks the Community MVP phases in this document. ADR-001 through ADR-014 must record the accepted decisions before or during Phase 0, with the relevant ADR merged before affected implementation code.

Exact dependency patch versions and container image digests are implementation selections rather than open architecture decisions. They must be pinned in lockfiles or deployment manifests, use stable releases, and be recorded in the Phase 0 verification report.

---

## 27. Long-term Direction, Not MVP

These ideas are intentionally deferred:

- equipment connectors,
- automatic file ingestion,
- Python analysis recipes,
- approval workflows,
- engineering report generation,
- AI-assisted schema creation,
- AI-assisted anomaly explanation,
- record-level access policies,
- field-level permissions,
- SAML and SCIM,
- electronic signatures,
- data retention policies,
- high availability,
- Kubernetes Helm chart,
- plugin SDK,
- external database connectors,
- image and wafer-map data types,
- DOE analysis,
- control charts,
- notebook integration,
- formula fields and deterministic unit-aware expression evaluation,
- automatic scalar metric extraction from datasets,
- curve-wide and dataset-wide specification evaluation,
- multiple organizations per installation,
- conditional specifications and specification selection precedence,
- automatic SMTP delivery for invitations and password resets,
- PostgreSQL row-level security as an additional defense-in-depth layer,
- separate Enterprise repository and build-time composition after Community MVP acceptance.

They must not distract from delivering the golden flow.

---

## 28. Final MVP Acceptance Statement

The MVP is complete when a manufacturing R&D engineer can install Engrove on-premise, model samples and equipment, record append-only unit-aware scalar measurements, upload and parse immutable raw CSV files, link a dataset as supporting evidence, compare datasets on charts, reproduce every result against the exact specification revision used, create tasks from failed evaluations, and trace all important changes without requiring direct database access.
