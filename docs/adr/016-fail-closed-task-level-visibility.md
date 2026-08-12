# ADR-016: Fail-closed task-level visibility

- Status: Accepted
- Date: 2026-08-11
- Plan: [Task collaboration](../product/task-collaboration.md#authorization-and-integrity)

## Context

Project membership is too broad for supplier negotiations, security investigations, personnel
follow-up, and other sensitive work. Moving these tasks into separate projects damages the ordinary
workflow and evidence graph. Filtering only the task detail endpoint is insufficient because titles
and counts can leak through search, reports, relationships, notifications, and webhooks.

## Decision

Keep project visibility as the default and add an explicit restricted mode. Restricted tasks are
visible to owners, administrators, engineers, the creator, the assignee, selected active members,
and members of selected active groups. A shared SQL predicate implements the rule, while every
application repository remains responsible for applying it to each task-bearing query. Unauthorized
direct access returns the same not-found response as an absent task.

## Consequences

Sensitive work stays in its real project and workflow. API, UI, search, notification, reporting,
relationship, and key-date behavior share one authorization rule. Every new task projection must be
reviewed for indirect disclosure, and changing the rule requires a migration because the predicate
is a reviewed database function.

## Rejected alternatives

- Project-only access, because it forces artificial project boundaries.
- UI-only filtering, because API and indirect projections still leak data.
- PostgreSQL row-level security, because Engrove currently uses application-enforced scoping under
  ADR-010 and background processes require explicit, reviewable access behavior.
- Per-task arbitrary roles, because organization members and groups cover the current use cases
  without creating a second role system.

## Implementation constraints

- New tasks default to project visibility, and callers can create them restricted atomically.
- UUID and stable-key lookup, collections, search, counts, linked projections, notifications, and
  reports must fail closed through the same predicate.
- Restricted tasks do not emit project-wide webhook events; changing an existing task to restricted
  removes unauthorized watchers and notifications and cancels undispatched events.
- Visibility writes require optimistic concurrency, validate active subjects, and produce an audit
  event without copying the sensitive subject list into the audit payload.
- Integration tests must cover creator, assignee, direct member, group member, administrator, and
  unrelated-member behavior.
