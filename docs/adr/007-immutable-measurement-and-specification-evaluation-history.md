# ADR-007: Immutable measurement and specification evaluation history

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#7-domain-model)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Append measurement observations and specification evaluations; never rewrite a historical result after a specification changes.

## Consequences

Reports can explain exactly which value, unit registry, conversion, and specification revision produced a disposition.

## Rejected alternatives

Recomputing history against current limits and mutating past results.

## Implementation constraints

Evaluation records reference immutable specification and unit-registry versions and preserve decimal inputs and outputs.
