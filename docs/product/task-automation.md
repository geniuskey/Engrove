# Task automation

Automation status triggers, conditions, and actions use the active project workflow described in [Project task workflows](./task-workflow.md). Status actions must follow an allowed directed transition at execution time.

Engrove task automation provides a small, auditable subset of event-driven workflow automation for
project work. Project engineers and administrators can combine one task trigger, optional current
state conditions, and one or more field actions. Rules live in project settings, can be paused, and
can be archived without deleting their execution history.

## Supported rules

Triggers:

- task created;
- status changed, optionally limited by source and destination status;
- priority changed, optionally limited by source and destination priority;
- assignee changed, assigned, or unassigned.

Conditions can require the task's current status, priority, and assignment state. Actions can set
status, priority, and assignee (including unassigning). Rule names are case-insensitively unique
within a project, and an action assignee must remain an active organization member.

## Transaction and loop safety

Automation runs inside the same PostgreSQL transaction as the initiating task mutation. A
successful response therefore includes the final automated task state; clients never observe a
committed trigger without its corresponding automation actions. Automation field changes increment
the task row version, write status history when relevant, notify watchers and newly assigned
members, and append a `task.automated` audit event with the rule and trace identifiers.

Every initiating task mutation receives a unique automation trace. A rule may execute at most once
per trace, even when its action produces another matching event, and chained actions stop after ten
levels. Each attempted rule writes an execution row with `succeeded`, `no_change`, or `failed`.
That row snapshots the rule name, trigger type, and triggering event at execution time, so later
rule edits do not rewrite historical meaning. It also records duration, trace ID, chain depth,
applied field changes, and a stable failure code. An assignee that became unavailable records a
failed execution instead of preventing the user's unrelated task change. Applying a value already
present records `no_change` without incrementing the task row version or sending activity
notifications.

The rule list exposes cumulative failed execution count plus the latest outcome and error code.
Operators can open history already scoped to a rule, filter by outcome, expand a run to inspect its
trigger and changes, and follow the task link. Field actions are deliberately not retried
automatically: because they execute synchronously against mutable task state, replaying a failed
action later could overwrite a newer human decision. Operators diagnose the stable failure,
pause or repair the rule, and cause a fresh task event when another execution is appropriate.

## Authorization and API

The `task.automation.manage` permission is granted to owners, administrators, and engineers. It is
not available to personal API tokens because automation changes project-wide behavior. Browser
mutations require CSRF protection.

Project-scoped endpoints:

- `GET/POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-automations`
- `PATCH /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-automations/{ruleId}`
- `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-automations/{ruleId}/archive`
- `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-automations/executions`

The rule collection accepts a `limit` from 1–100 (default 50) and a zero-based `offset`.
`pageInfo.total` is the exact active-rule count and `pageInfo.hasNext` indicates whether another page
remains. The project settings screen uses the same contract and appends additional pages on demand.

Execution history is newest-first and accepts an optional `ruleId`,
`outcome=all|succeeded|no_change|failed`, a `limit` from 1–100 (default 50), and a zero-based
`offset`. `pageInfo` exposes the exact count for the selected rule and outcome and whether older
executions remain. `summary` always reports exact succeeded, no-change, and failed totals across
the selected rule's complete history (or the complete project history without `ruleId`),
independent of the selected outcome or current page. Rows expose `ruleName`, `triggerType`,
`triggerEvent`, `durationMs`, `traceId`, `depth`, `changes`, and `errorCode`; the first three are
immutable execution-time snapshots.

The first release intentionally excludes scheduled triggers and outbound actions. Those require a
durable scheduler, retry semantics, and delivery-specific security controls rather than being
silently approximated by request-time execution.
