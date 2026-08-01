# ADR-003: PostgreSQL-backed opaque browser sessions

- Status: Accepted
- Date: 2026-08-01
- Plan: [Engrove Development Plan](../product/engrove-development-plan.md#12-authentication)

## Context

Engrove needs a durable Community architecture that preserves engineering traceability and remains operable by a small self-hosting team.

## Decision

Use opaque, random browser session tokens whose hashes and lifecycle state are stored in PostgreSQL.

## Consequences

Sessions can be revoked, rotated, audited, and invalidated centrally without exposing claims to browsers.

## Rejected alternatives

Stateless JWT browser sessions and storing raw session tokens.

## Implementation constraints

Cookies must be HttpOnly, Secure in production, SameSite=Lax, narrowly scoped, and CSRF-protected on unsafe requests.
