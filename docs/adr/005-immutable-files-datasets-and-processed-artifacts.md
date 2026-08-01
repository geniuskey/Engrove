# ADR-005: Immutable files, datasets, and processed artifacts

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#9-dataset-model)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Treat uploaded files, dataset versions, and processed artifacts as immutable content-addressed objects.

## Consequences

Reprocessing is reproducible and provenance remains intact. Corrections create new versions instead of overwriting evidence.

## Rejected alternatives

Mutable object keys and in-place dataset replacement.

## Implementation constraints

Persist checksums, sizes, media types, parent lineage, creator, and timestamps before an artifact becomes available.
