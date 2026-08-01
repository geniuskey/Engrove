# ADR-008: Template versioning and idempotent upgrades

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#10-default-template-test--characterization)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Version templates explicitly and apply upgrades as idempotent, resumable operations recorded per workspace.

## Consequences

Built-in templates can evolve without silently changing user data or duplicating objects after retries.

## Rejected alternatives

Unversioned seed data and destructive reset-based upgrades.

## Implementation constraints

User-owned customizations are preserved; every operation has a stable key and may be run more than once safely.
