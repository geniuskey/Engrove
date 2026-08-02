# ADR-015: Workspace-shared tables with optional project context

- Status: Accepted
- Date: 2026-08-02
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#12-nocodb-compatibility-baseline)

## Context

Users often manage one row per project and need to enter a new row while comparing it with every other project. Project-owned configurable tables fragment that workflow and make the project navigation boundary obstruct spreadsheet-style entry.

## Decision

Configurable tables, fields, views, and records are shared at workspace level. A record may reference one ordinary project through an optional `context_project_id`; that reference supplies context and filtering but does not control record visibility or ownership.

Engineering resources whose traceability depends on project ownership—files, datasets, measurements, specifications, visualizations, and tasks—remain project-scoped.

The first compatible implementation stores workspace-shared configurable data in one hidden system project per workspace. Repository scope remains explicit, while the public UI and API bootstrap route expose it as workspace data. System projects never appear in normal project lists and cannot be edited or archived through project endpoints.

## Consequences

Users can compare and edit all project rows in one compact grid, and project association can be changed without moving a row. Existing configurable-data validation, relations, saved views, optimistic concurrency, and audit transactions remain reusable during the transition.

The hidden backing scope is an implementation bridge. Future schema normalization may replace it with direct workspace ownership without changing the user-facing workspace-table contract.

## Rejected alternatives

- Duplicating the same table schema and rows into every project.
- Treating project association as record ownership and hiding other projects' rows.
- Removing project boundaries from immutable engineering resources.

## Implementation constraints

Linked projects must belong to the same workspace and must not be system projects. Workspace data initialization is idempotent and audited. Every record response preserves the optional project context, and project-name search may match it.

Existing project-owned configurable schemas are not automatically re-owned because they may carry
measurement, file, dataset, specification, and task traceability that must remain project-scoped.
During the compatibility transition, the workspace Data screen detects and links those schemas as
project Engineering Records. New general-purpose tables are created in the workspace data scope.
