# ADR-011: Archive, tombstone, and physical purge boundaries

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#13-audit-and-traceability)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Use archive for reversible hiding, tombstones for logically removed referenced objects, and a separate privileged physical purge.

## Consequences

References and audit history remain meaningful while administrators retain a deliberate erasure path.

## Rejected alternatives

Immediate cascading deletion and a single ambiguous deleted flag.

## Implementation constraints

Purge must enumerate object-store and database effects, require confirmation, and emit an audit event.
