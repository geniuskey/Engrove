# ADR-012: Immutable chart and dashboard configuration revisions

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#7-domain-model)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Represent chart and dashboard changes as immutable revisions with a movable current-version pointer.

## Consequences

Published views are reproducible, edits are auditable, and rollback does not destroy later history.

## Rejected alternatives

In-place JSON configuration updates and snapshots without stable revision identity.

## Implementation constraints

Data sources and fields are referenced by stable IDs; concurrent publication uses optimistic concurrency.
