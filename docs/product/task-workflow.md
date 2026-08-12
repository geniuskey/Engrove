# Project task workflows

Engrove task status is configured per project. A workflow consists of ordered statuses and directed transitions. The task board, task detail editor, bulk changes, API updates, and automation engine all use the same definition.

## Status model

Every active status has:

- an immutable `key` used by APIs and automation rules;
- an editable display name, color, and board position;
- one category: `todo`, `in_progress`, or `done`;
- an optional WIP limit from 1 to 999;
- an `initial` flag. Exactly one active status is initial.

Completion metrics use the category, not a hard-coded status key. This lets a project add statuses such as `quality_review` or `released` without breaking open/completed task counts. The `blocked` key remains a useful conventional status for attention metrics but is not required by the category model.

When the number of active cards in a status exceeds its WIP limit, the board marks that column and shows the current count against the limit. The limit is an operational signal rather than a hard write restriction: urgent work can still move forward, while the overload remains visible to the team.

## Transitions and safety

Transitions are directed. Moving from status A to status B requires an active A→B transition. This rule is enforced for single-task updates, atomic bulk updates, board drag and drop, detail editing, and automation actions.

- New tasks start in the project's initial status unless a valid status is explicitly supplied through the API.
- A status cannot be archived while active tasks or active automation rules reference it.
- The initial status cannot be archived until another status is selected as initial.
- Archiving a status removes its transitions but preserves task history.
- An automation action that is no longer allowed records a failed execution with `TRANSITION_NOT_ALLOWED`; it does not roll back the user action that triggered the automation.

## Task activity and accountability

Task detail merges comments, status transitions, and field-change history into one chronological
activity stream. Title, description, priority, assignee, and due-date changes are persisted in the
immutable audit event written by the same transaction as the task update. Bulk edits retain the
before and after values for every affected task. Automation changes also include the rule name, so a
user can distinguish a teammate's edit from a rule-driven update.

Status transitions continue to use the dedicated status history, including the actor and previous
and next status. They are not duplicated as generic field edits. Historical assignee IDs remain
auditable even after a member becomes inactive; the UI labels an unavailable identity instead of
silently attributing it to the current assignee.

The board's non-blocking **Flow insights** panel turns that immutable history into project-level
operating signals without asking users to maintain another progress field. It shows current active
work and WIP, status-entry age, a configurable seven-day stale-work signal, completed throughput,
median cycle time, an 85th-percentile predictability bound, the oldest active tasks, and a bounded
completed-work distribution. A cumulative-flow chart reconstructs the end-of-day task count in
every current or historical workflow status, making a widening band an explicit signal that work is
accumulating. Task archive and restore events delimit the periods counted as active; a task is not
silently included while archived. The server folds status and lifecycle interval boundaries into
daily UTC deltas, then cumulatively sums only `days × workflow statuses`; it does not rescan every
task interval for every chart day. WIP overload and stale age are warnings, not write restrictions.

The companion **Created vs completed** chart buckets task creation and the most recent qualifying
completion by UTC day. Creation counts every task entering the project in the rolling window even
if it is later archived. Completion includes a task only while its current workflow category is
still `done`; reopening removes the earlier completion until the task completes again. Consequently
`created − completed` is an intake-pressure signal, not an exact active-backlog delta when archive,
restore, or reopen events occur.

Cycle time is the sum of intervals in statuses whose category is `in_progress`, ending at the most
recent transition into a `done` category while the task remains done. A reopened task therefore
includes its later in-progress interval. Direct `todo`→`done` transitions have zero working-status
cycle time rather than being treated as missing data. The completion window is 30, 60, or 90 days
in the browser; the API accepts 7–365 days. Status aging always describes the current complete
project and is deliberately independent of transient board filters. The UI states this scope to
avoid presenting a filtered board beside misleading partial operational metrics.

`GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}` returns the typed
`status_history`, `change_history`, and `comments` collections used by the merged activity stream.

## API

All routes are scoped by workspace and project:

- `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-workflow`
- `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-workflow/statuses`
- `PATCH /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-workflow/statuses/{statusId}`
- `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-workflow/statuses/{statusId}/archive`
- `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-workflow/transitions`
- `DELETE /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-workflow/transitions/{transitionId}`
- `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-flow-insights`

Reading uses `task.read`. Workflow mutation uses `task.workflow.manage`, which is granted to owners and administrators by default. Request and response schemas are available in the OpenAPI document.

## Migration compatibility

Existing projects are seeded with `todo`, `in_progress`, `blocked`, and `done`. Existing task and history values remain unchanged. All directed pairs among those four statuses are seeded so upgrades do not unexpectedly invalidate an existing move; administrators can then remove transitions that their process should forbid.
