# ADR-014: Community-first repository and future Enterprise boundary

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#4-mvp-scope)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Keep Community independently buildable, deployable, and useful under AGPL-3.0. Any future commercial code belongs outside this repository and depends on stable published Community contracts.

## Consequences

The Community edition has no dormant commercial paths or license checks and can ship on its own cadence.

## Rejected alternatives

A monorepo containing disabled commercial modules and speculative plugin scaffolding.

## Implementation constraints

Community acceptance gates are completed first. No Enterprise package names, schemas, routes, feature gates, or UI are added here.
