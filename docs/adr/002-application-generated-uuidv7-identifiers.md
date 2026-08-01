# ADR-002: Application-generated UUIDv7 identifiers

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#8-engineering-type-system)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Generate UUIDv7 identifiers in the application before persistence.

## Consequences

Identifiers remain globally unique and time-sortable, and workflows can refer to objects before a database round trip.

## Rejected alternatives

Database sequences, random UUIDv4 as the default, and database-generated identifiers.

## Implementation constraints

The generator must be covered by monotonicity and collision tests and shared by all TypeScript write paths.
