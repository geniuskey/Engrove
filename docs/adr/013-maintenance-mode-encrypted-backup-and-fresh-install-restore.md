# ADR-013: Maintenance-mode encrypted backup and fresh-install restore

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#18-observability)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Create encrypted, versioned backups while writes are paused, and support restore only into a compatible fresh installation for the MVP.

## Consequences

Database and object-store snapshots have a defined consistency boundary and restore testing stays tractable.

## Rejected alternatives

Uncoordinated live copies and in-place restore over an active installation.

## Implementation constraints

Backups include a manifest, checksums, schema and application versions, encryption metadata, and restore verification.
