# ADR-004: JSONB records with typed query projections

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#7-domain-model)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Store configurable record payloads in JSONB while maintaining typed projection columns or indexes for supported queries.

## Consequences

Templates can evolve without a table per record type, while curated queries remain predictable.

## Rejected alternatives

Entity-attribute-value storage, a physical table per template, and unrestricted JSON-only querying.

## Implementation constraints

Every field definition has a stable ID and value kind. Queryable fields must declare and maintain their projection.
