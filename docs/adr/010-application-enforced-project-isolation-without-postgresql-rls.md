# ADR-010: Application-enforced project isolation without PostgreSQL RLS

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#11-authorization)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Enforce organization, workspace, and project scope in application authorization and repository APIs; do not enable PostgreSQL row-level security for the MVP.

## Consequences

Authorization behavior remains visible and testable in one layer while the initial operational model stays simple.

## Rejected alternatives

PostgreSQL RLS and implicit tenant filters hidden in generic ORM middleware.

## Implementation constraints

Every scoped query requires an explicit authorization context, and cross-project negative tests are mandatory.
