# ADR-006: PostgreSQL outbox and job state with BullMQ delivery

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#6-architecture)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Persist business job state and an outbox transactionally in PostgreSQL; use BullMQ only for delivery and leases.

## Consequences

Redis loss cannot erase authoritative state, and dispatch can be retried idempotently.

## Rejected alternatives

BullMQ as the system of record and direct post-commit publishing without an outbox.

## Implementation constraints

Consumers must be idempotent. Lease expiry, retry policy, and terminal state live in PostgreSQL.
