# ADR-009: Versioned cross-language unit registry and decimal arithmetic

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#8-engineering-type-system)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Use one versioned unit registry consumed by TypeScript and Python, with decimal arithmetic at storage and calculation boundaries.

## Consequences

Conversions are reproducible across services and avoid binary floating-point drift in engineering values.

## Rejected alternatives

Independent service registries and binary floating-point for canonical quantities.

## Implementation constraints

Every derived value records registry version, source unit, canonical unit, precision, and rounding policy.
