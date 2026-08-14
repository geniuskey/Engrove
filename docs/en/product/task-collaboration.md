# Task collaboration

Engrove task detail is the collaboration surface for small, actionable project work. The board
remains a compact status overview; opening a card provides editing, linked evidence, activity,
comments, mentions, watching, and task relationships without navigating away from the board.

Each task receives an immutable project-scoped number and exposes a human-readable key such as
`MOTOR-42`. The project key is immutable, and number allocation is serialized inside the creation
transaction, so keys remain stable and unique under concurrent API requests. Cards, calendar rows,
detail, related-task links, search, and copy actions expose the key; the UUID remains the internal
referential identifier. Every task-specific REST path accepts either form for `{taskId}`: callers may
use a UUID or the case-insensitive stable key. Key resolution occurs only after workspace, project,
role, and token scope checks and only inside that project, so a key from another project is reported
as not found. Responses continue to include both identifiers; body fields that express hierarchy or
relationships keep UUIDs as their explicit referential contract.

Browser and integration creation requests carry a unique idempotency key. If a response is lost,
retrying the same task or key-date body within 24 hours returns the original resource instead of
allocating another task number or repeating audit, notification, automation, webhook, or link side
effects. The browser keeps the key while a failed form remains unchanged and generates a new key
when the intended body changes. A reused key with different content is rejected explicitly.

An active task can be duplicated from its detail header or card context menu. Engrove opens the
ordinary create form as a visibly unsaved, editable draft rather than committing immediately. The
draft copies description, priority, labels, assignee, due date, and parent, prefixes the title, and
starts in the workflow's entry status. Comments, children, evidence links, attachments, activity,
watchers, and current status stay with the original. Creation passes `cloneSourceTaskId`; the new
task, a symmetric `relates_to` relationship back to the active same-project source, and a
`task.cloned` audit event commit atomically under the existing idempotency key. This preserves why
the similar work exists without copying historical evidence or producing an unreviewed duplicate.

A failed specification evaluation exposes one compact, tooltip-labelled follow-up action in the
measurement history. The first successful request creates a high-priority task with exact record,
evaluation, measurement-result, specialized-record, and supporting-dataset links. Project-level
transaction locking makes concurrent clicks and requests converge on the same task across API
replicas. Task allocation, engineering links, generic and evaluation-origin audit events,
automations, notifications, and the webhook outbox commit together; a rollback leaves none of
them. After success the action becomes the stable task key plus an icon link to the ordinary task
detail, so the operator can see what happened without searching the board.

The global command palette (`⌘K` on macOS or `Ctrl+K` elsewhere) searches active projects, tasks,
and tables across the current workspace as well as ordinary navigation commands. Server-ranked
results favor exact stable keys such as `MOTOR-42`, wait until two characters are entered, debounce
requests, and expose an explicit truncated-result hint. Selecting a task opens its existing detail
drawer directly, preserving the board as context instead of navigating to an isolated edit page.
Task labels participate in the same workspace search, so cross-cutting classifications remain
discoverable without becoming workflow statuses.

Every task detail exposes an icon-only, tooltip-labelled copy-link action that produces a canonical
workspace/project task URL using the stable task key rather than the internal UUID and without
transient board filters. The same canonical key link is emitted from My work, workspace search, key
dates, record evidence, automation history, notifications, and the card context menu. Existing UUID
bookmarks still resolve, then replace only the task parameter with the canonical key while preserving
saved-filter and view state. While the detail drawer has focus context, `W` toggles watching and `M`
focuses the comment composer; inputs, selects, textareas, and editable content always retain ordinary
typing behavior. Activity can be narrowed to comments or immutable change history and reversed
between newest-first and oldest-first without mutating or discarding the loaded activity page. These
controls mirror the high-frequency collaboration affordances of mature issue trackers while keeping
Engrove's dense, icon-led interface.

## Behavior

- Task creation and detail editing are explicit-save surfaces. Once a persisted field, assignee,
  parent, comment draft, comment edit, external-link draft, mention set, or relationship candidate
  changes, the drawer shows an unsaved badge. Closing by button, backdrop, or Escape and switching
  to a linked task or key date require confirmation before discarding that work. Browser unloads
  also use the native unsaved-work guard. Successful task saves, comment posts, and link or
  relationship creation clear only the draft they committed; opening another task resets every
  task-local composer so a URL or comment cannot leak into the next task.
- Duplicating is blocked while the open task has unsaved fields or collaboration drafts. The
  operator must save or discard those changes first, so the clone never silently mixes persisted
  and uncommitted state.
- A task creator watches the task according to their personal automatic-watch preference. The
  current assignee is watched automatically and receives assignment notifications independently.
- Any signed-in member can watch or stop watching a task. Watching is personal state and is not
  available through personal API tokens.
- Contributors and reviewers can comment. A commenter may opt into watching in the composer.
- A comment author can edit their own active-task comment. Each save submits the last-read comment
  row version; a concurrent edit returns `TASK_COMMENT_VERSION_CONFLICT` instead of overwriting it.
  The current comment shows an edited marker, and its history control pages through every
  superseded body, mention set, editor, and edit time from immutable audit events only when opened.
  Other members, including project administrators, cannot rewrite the author's words.
- Mentions are limited to active members of the task's organization. Mentioned members receive one
  in-app notification even when they also watch or are assigned to the task. Editing notifies only
  newly added mentions through the mention channel.
- Watchers and the current assignee are notified about comments, edits, status changes, archive, and
  restore events. The actor never receives a notification for their own action.
- The sidebar notification center shows unread count, supports marking one or all items read, and
  opens the exact task detail using its workspace and project route.
- Personal settings control automatic watching after create/comment and in-app assignment, mention,
  watched-activity, and due-date notifications. A member can disable deadline reminders or choose
  the due date, one day, three days, or seven days as the approaching reminder threshold. The
  assigned member receives one approaching reminder and, if the task remains incomplete, one
  overdue reminder per task/due-date pair. A deterministic event identity and database uniqueness
  make repeated scans and multiple worker replicas safe. Completed, archived, unassigned, and
  disabled-member tasks are excluded. Defaults are enabled until the user stores a preference.

Assignment controls do not preload the complete organization directory. They start with a bounded
page and search active members by display name or email as the operator types. The same server-side
picker is used for task filters, creation, detail editing, and bulk changes, so a teammate beyond the
first page remains assignable in a large organization. The directory returns exact filtered and
overall totals and caps every response at 100 members; selected assignees embedded in task rows stay
readable even if they are outside the current directory page.

Record review controls follow the same directory contract. Opening a record never downloads the
organization roster: reviewer and notification pickers request a bounded 20-member page only when
opened and search active members by literal display name or email. The participant API caps pages
at 100, reports exact filtered and unfiltered totals, and can restrict results to members whose role
can resolve a review. That eligibility rule is also enforced in the repository, so a direct API
request cannot assign a decision to a view-only member. View-only members remain valid notification
recipients. Review messages embed the display names of their mentioned users, preserving readable
history without relying on whichever participant page happens to be loaded in the browser.

Record pages also keep the discussion history bounded. They request 20 open threads initially and
can page through additional or resolved threads using an exact filtered total; open and resolved
summary counts remain independent of the current page. Every thread embeds only its newest 20
messages and exposes the exact message total. Older messages are requested in reverse pages and
prepended chronologically, so the conversation remains readable without allowing one long-running
review to dominate the record payload. After a concurrent reply, clients should refresh the newest
page before continuing with an offset, matching the task-activity consistency rule.

## Personal work queue

The workspace sidebar exposes **My work** as a personal cross-project execution queue. It contains
only active, incomplete tasks assigned to the signed-in member and never duplicates the project
task board. Summary controls immediately isolate overdue, seven-day, and blocked work; text,
urgency, priority, and sort state remain in the URL so a filtered queue survives reload and can be
shared as navigation state. The default attention order prioritizes overdue work, then unresolved
blockers, nearby due dates, task priority, and recent updates. Selecting a stable task key opens the
existing project task detail panel, preserving one editing and collaboration experience.

The backing API applies organization, workspace, project lifecycle, task lifecycle, assignee, and
workflow-category scope before pagination. It returns explicit totals and a bounded 200-row maximum,
and an assignee/lifecycle/due-date index keeps the cross-project query usable as task volume grows.

## Labels and flexible classification

A task can carry up to 12 project-scoped label values. Values are Unicode-aware, normalized to
lowercase NFKC, and restricted to letters, numbers, dots, hyphens, and underscores so API filters,
URLs, and saved views remain stable. Labels supplement status, priority, and assignee rather than
replacing them: status represents workflow, while labels capture cross-cutting concerns such as
`safety`, `supplier`, or `simulation`.

Cards show the first three labels compactly and preserve the complete list in task detail. The board
loads its label catalog from the server, exposes a label quick filter through a compact control, and
stores the selected label with personal or project-shared saved filters. Search includes labels. API
clients may repeat the `label` query parameter; repeated values use AND semantics so every selected
label must be present. Label changes use the task row version and appear in immutable task activity
alongside other field changes.

## External evidence links

Task detail accepts a title and HTTP(S) URL without requiring users to find or paste an internal
UUID. Adding the link atomically creates a project traceability source and attaches it to the task,
so a failed request cannot leave a half-created source or link. The source provider defaults to the
URL hostname, while callers may supply provider, external ID, version, observation date, and notes
through the API when stronger trace metadata is available.

Linked external evidence is shown by title and provider and opens in a new browser context. Archived
sources remain visibly marked instead of disappearing from historical work. Removing a link only
removes the task association; it deliberately preserves the project source and immutable audit
trail. Link and unlink actions appear in the same chronological activity stream as field changes,
status transitions, and comments, and watched-task notifications use the existing activity channel.

Task detail embeds only the 50 newest activity entries and reports the exact total. Earlier status
changes, field changes, evidence-link events, and comments load in deterministic 50-entry pages from
the same drawer. Comment edit bodies are not nested into that initial payload: the edited marker and
exact revision count remain visible, while the history control fetches 20 immutable revisions at a
time. This keeps old, highly active tasks responsive without discarding their audit trail. Activity
uses offset pagination deliberately; after a concurrent activity mutation, clients should refresh
the first page before continuing so a newly inserted newest event cannot shift an offset unnoticed.

API clients use `POST .../tasks/{taskId}/external-links` to create and attach an external source in
one transaction and `DELETE .../tasks/{taskId}/links/{linkId}` to detach evidence. Task detail returns
typed `links` metadata and `link_history`; no browser-only preferences are involved, so personal API
tokens can use both operations when their role grants `task.update`.

## File attachments

Small contextual evidence can be dropped directly on the linked-evidence area or selected through
its tooltip-labelled upload icon. Engrove uses the existing two-phase, checksum-verified file upload
instead of creating a second attachment blob store. After object verification succeeds, the task
links the exact immutable file-object version; its original name, media type, byte size, series,
version, lifecycle, and permission-checked download remain visible from task detail. External source
systems should still use URL evidence links rather than duplicating their managed originals.

Uploads are capped at 100 MiB and require both `file.upload` and `task.update` in the browser. The
upload and link operations remain separate security boundaries: a finalized file is never deleted
if linking fails, and the user is told that it remains available in project files. Linking an
existing version through `POST .../tasks/{taskId}/file-links` requires `task.update`, accepts only an
available non-archived file from the same project, and is idempotent when the same active version is
already attached. A previously detached version creates a new association when attached again; the
old association, its removal marker, and every link/unlink audit event remain immutable. Download
continues through the ordinary `file.read` endpoint and a five-minute signed object URL.

Detaching a file uses the same `DELETE .../tasks/{taskId}/links/{linkId}` operation as other evidence.
It removes only the task association: the immutable file version, checksum, series lineage, and
project audit history remain intact.

## Relationships and blockers

Task detail supports **blocks**, **is blocked by**, and symmetric **relates to** links within the
current project. The board and detail panel show the number of blockers that are active and not
done; a linked task does not silently change workflow status. This keeps external blockers possible
while making known task dependencies visible.

Blocking links form a directed acyclic graph. Creation takes a project-scoped PostgreSQL advisory
transaction lock and checks reachability with a recursive query before insertion, preventing both
ordinary and concurrent dependency cycles. Symmetric links use canonical UUID ordering so the same
relationship cannot be inserted from the opposite task. New links require two active tasks in the
same project, and relationship changes are audited and notify affected task watchers.

## Parent work and subtasks

A standard task can group directly actionable subtasks in one project. The hierarchy is deliberately
limited to one level: a subtask cannot become a parent, and a task that already has active children
cannot itself become a subtask. This keeps the board understandable and leaves date-only project
checkpoints in the milestone timeline instead of turning tasks into a second planning hierarchy.

Parent cards and detail show child completion as a derived `done / total` count; users never type a
subjective percentage. Subtask cards show the parent key, task search includes the parent key and
title, and opening a child retains a direct link back to its parent. The repository serializes
hierarchy changes per project and enforces same-project active parents. A parent with active children
must not be archived, and an archived parent's child must not be restored until the parent is active.
These lifecycle rules prevent active work from becoming attached to an invisible parent.

Parent and relationship pickers do not preload the project's task catalog. They wait for at least
two key/title characters, debounce the request, and show the newest 20 matching active tasks. Parent
search asks the server for top-level candidates only, while relationship search may return any
active task except the current one. The API exposes exact pagination metadata and a 100-row hard
maximum; when more than 20 matches exist, the picker asks for a narrower query instead of silently
pretending its first page is complete. This removes the former duplicate 5,000-task payload from
initial board loads and every filter refresh.

## Key dates and delivery work

Each project key date can link up to 200 active tasks from the same project. The chronological
timeline shows `done / total` and a compact derived bar, while key-date detail lists the stable task
keys and opens the existing task detail panel. Task detail returns the same connection in reverse,
including date, status, archived state, and a durable link that opens the exact key date after a
reload. The key date editor never accepts a subjective percentage: completion is recalculated from
each linked task's current workflow category, so custom statuses classified as `done` count
automatically.

Task completion deliberately does not mark the key date itself completed. A key date may represent
an approval, shipment, contractual deadline, or other outcome that still needs an explicit owner
decision after its preparation work is done. Archiving a task preserves an existing key-date link
for traceability, but newly linked tasks must be active and belong to the same project. Replacing the
link set uses the key date's optimistic row version and commits atomically with the date update.

## Repeated triage and bulk changes

The board persists a project-wide rank for every task. Dropping a card on a column places it at the
bottom; dropping it on another card places it immediately before that card, including within the
same status. Focused Board cards and rank-sorted List rows use `Alt+Up` / `Alt+Down` for relative
movement, while `Alt+Left` / `Alt+Right` retain workflow transitions. The keyboard-accessible context
menu can move a task to the absolute top or bottom of its status, including when a filter or paged
board has not loaded every peer. Rank and any workflow transition are committed in one serialized
transaction using the last-read row version. A stale move is rejected and the board reloads
authoritative order instead of silently overwriting another member's change. Sparse integer ranks
make ordinary moves constant-cost; the repository rebalances them transactionally only when no
insertion gap remains. Rank changes, status history, notifications, and task automations remain
auditable and consistent.

The board also has an explicit selection mode so ordinary card clicks continue to open task detail.
In selection mode, card clicks toggle a visible checked state, dragging is disabled, and operators
can change status, priority, or assignee for up to 100 tasks. The client submits every last-read row
version and the repository locks the selected rows in one transaction. If one task is archived,
missing, or stale, the entire request returns
`TASK_BULK_VERSION_CONFLICT` without a partial update. A second confirmation action is required
before submission, and every changed task retains its own audit and status-history events.

Members can save the current query, assignee, priority, and board/calendar choice as a personal
project filter. Members with `project.update` may instead publish a project filter for the whole
team. The creator remains its owner and is the only member who can replace or delete it; other
members can apply it and keep their own favorite state without changing the shared definition.
Personal names are case-insensitively unique per member and project, while shared names are unique
across the project. Newly created filters are favorited for their creator, favorites sort before
other filters, and an owner can replace a filter with the current board conditions. Filters are
stored on the server for cross-device use and remain unavailable to personal API tokens because
they represent interactive UI state rather than integration data.

The compact selector keeps the newest favorite-first page fast while a dedicated finder searches
the complete visible filter directory by filter name or owner. Results are server-paged with an
exact total and can continue through older matches, so a large shared-filter catalog never becomes
an unbounded project payload or an unusable native select. A visible filter can also be restored by
its stable ID, which is safer than depending on a mutable or duplicated display name.

Applying a saved filter writes that stable ID to the task URL while preserving an open task detail
deep link. Reloading or sharing the URL restores the exact visible filter from the server before
running its task query. If a member manually changes any search, filter, view, grouping, sorting, or
column setting, the filter ID is removed immediately so the URL never claims to represent a saved
definition that has already diverged. Missing or newly private filters fail closed with a visible
message and a clean task URL.

Search, assignee, priority, and label filters are also executed by the server, so a saved filter can
find tasks outside the first result window. The board requests each visible workflow status
independently in pages of 50. Every column shows its exact filtered total and offers its own **Load
more** action, so a large backlog in an early status cannot hide work in a later status. List and
calendar views start with 100 active tasks and page independently; the calendar requests due-date
ordering so dated work is returned before undated work. General API clients default to 100 tasks and
page with `limit`, `offset`, and returned `pageInfo` metadata. Active and archived tasks use separate
server queries, so a large archive cannot displace live work; the archive preview is independently
capped at 100 and reports when more results exist.

The task detail drawer keeps the current board, list, or calendar result order as its review queue.
Compact previous/next icon actions and `Alt+↑` / `Alt+↓` move through the currently loaded filtered
results without closing the drawer or dropping the saved-filter query state. A task opened directly
outside the loaded result page has no implied neighbors. Navigation uses the canonical human-readable
task key and applies the same unsaved-draft confirmation as closing or opening another task.

Notifications are intentionally in-app only in this release. Email delivery requires a separate
outbound-mail security and operations decision. Notification rows and personal preferences are
included in normal database backup and restore. They are not automatically purged until the operator
defines an organization retention policy; monitor `engrove_notifications_unread` and
`engrove_notification_oldest_unread_age_seconds` for abnormal growth.

The inbox initially requests the newest 30 notifications and can continue through older activity
without discarding already loaded items. `GET /api/v1/notifications` accepts `limit` from 1–100, a
zero-based `offset`, and `unreadOnly=true|false`; `pageInfo.total` describes the selected filter while
`unreadCount` always describes the member's complete unread inbox. Refresh polling merges the newest
page into the open history, so a newly delivered notification does not collapse an investigator's
older context.

## Authorization and integrity

Tasks are project-visible by default. Owners, administrators, and engineers can instead mark a task
restricted before entering sensitive content, then grant additional access to active organization
members or active member groups. The creator and current assignee retain implicit access; security
administrators retain access so a task cannot become orphaned. Hidden tasks resolve as
`TASK_NOT_FOUND`, including when addressed by UUID or stable task key, rather than revealing that a
restricted row exists.

The same fail-closed predicate is applied to board/list/calendar pages, candidates, labels, flow
insights, workspace search, My work, workspace task totals, linked key-date task summaries,
relationships, children, notifications, and API responses. Restricting an existing task removes
unauthorized watchers and notifications and cancels undispatched project webhook events. A task
created as restricted never enters the project webhook outbox. Visibility changes use the task row
version, replace the complete explicit subject set in one transaction, and record counts—not
subject identifiers—in the immutable audit payload.

Comment and watch mutations require CSRF protection for browser sessions. Notification inbox access
is always scoped by both organization and recipient, so another member's notification cannot be
read or acknowledged. Task, watcher, comment, mention, and notification rows all retain project or
organization scope in PostgreSQL, and event-recipient uniqueness prevents duplicate notification
rows for one action. Comment edits lock the scoped comment row, enforce author ownership and
optimistic concurrency, replace current mentions in the same transaction, and retain previous
content in the append-only audit trail. Relationship foreign keys enforce same-project tasks,
uniqueness constraints prevent duplicates, and repository-level serialization prevents cycles.
Task activity lookups use a project/target/time audit index and fixed page limits; evidence links,
relationships, watchers, children, and linked key dates are still separate bounded-domain concerns
and are not described as part of the activity-page guarantee.
