# ADR-001: Drizzle ORM and reviewed SQL migrations

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#5-recommended-technology-stack)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Use Drizzle ORM with node-postgres. Generate SQL into source control, review it, and apply it only through the migration command.

## Consequences

The application keeps type-safe queries while operators retain auditable SQL. Schema changes require an explicit generation and review step.

## Rejected alternatives

Prisma, TypeORM, runtime schema synchronization, and production schema push.

## Implementation constraints

Production application startup must never mutate schema. Migration and runtime database roles are separate in production.
