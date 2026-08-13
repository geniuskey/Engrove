# API access

Engrove exposes its versioned REST surface under `/api/v1` and interactive OpenAPI documentation
at `/api/docs`. Browser requests use the `engrove_session` cookie and CSRF token. Scripts, CI jobs,
and external services should use a personal API token instead.

The OpenAPI document publishes the supported cookie/token security alternatives, executable Zod-
derived request schemas for the core platform, programmable-record, and task APIs, typed success
representations, stable error envelopes, request tracing, and quota headers. The core platform
contract includes setup and sign-in, invitations and password reset, workspace and project
management, member roles, and member groups. These request schemas are also used for runtime
validation, so required fields, enums, lengths, patterns, and unknown-property rejection cannot
silently drift from generated clients. Download `/api/docs-json` for code generation or contract
tests.

When a configurable table is open, use the `</>` **Table API** action beside the table title. The
inline quickstart exposes the workspace, project, table, and field identifiers used by the current
resource, plus token-safe cURL and JavaScript examples for typed queries, record creation, and CSV
export. Generated snippets reference `ENGROVE_API_URL` and `ENGROVE_API_TOKEN`; they never place an
issued secret in page content. Creation examples are templates, so review required fields and linked
IDs before running them.

## Use the TypeScript SDK

`@engrove/sdk` is Engrove's dependency-free, publish-ready Node.js 24 client. In this repository,
add it to a workspace integration with `pnpm add @engrove/sdk@workspace:*`, or build and package the
release artifact with `pnpm --filter @engrove/sdk build` and `pnpm --filter @engrove/sdk pack`. The
package is not automatically published by this repository.

```ts
import { EngroveClient } from '@engrove/sdk';

const engrove = new EngroveClient({
  baseUrl: process.env.ENGROVE_API_URL!,
  token: process.env.ENGROVE_API_TOKEN!,
});

const table = engrove.table<{ serialNumber: string; status: string }>({
  workspaceId: 'w…',
  projectId: 'p…',
  tableId: 't…',
});

for await (const record of table.records({ pageSize: 100, archiveState: 'active' })) {
  console.log(record.displayName, record.values.serialNumber);
}
```

The client returns `{ data, requestId, etag, rateLimit }` and throws `EngroveApiError` with the
stable API error code, HTTP status, validation details, request ID, and `Retry-After` value. It
automatically retries temporary network failures and `429`, `502`, `503`, or `504` responses only
for reads or mutations carrying an idempotency key. Ordinary create, update, archive, and restore
calls and bulk field updates are never replayed implicitly. Bulk-create generates one key per
invocation and preserves that key and request body across retries.

The low-level client accepts only relative `/api/v1/` paths and validates the configured HTTP(S)
origin, preventing a malformed path from forwarding the bearer token to another host. Keep the
token in a server-side environment or secret manager; never bundle a personal API token into a
public browser application. See the
[`packages/sdk` README](https://github.com/geniuskey/Engrove/tree/main/packages/sdk) for the
complete typed table example.

## Automate project tasks

Use `client.tasks({ workspaceId, projectId })` for the same core work lifecycle exposed by the task
board: bounded search and paging, exact task lookup, idempotent creation, version-checked editing and
ranking, atomic bulk changes, comments, watching, archiving, and restoring. Task lookup accepts both
the internal UUID and the immutable project key, so integrations can persist a readable `FORCE-6`
reference without scanning a project list.

```ts
const work = engrove.tasks({ workspaceId: 'w…', projectId: 'p…' });

const created = await work.create(
  {
    title: 'Review force curve',
    priority: 'high',
    labels: ['validation'],
  },
  { idempotencyKey: 'lab-run-2026-08-11-review-task' },
);

const moved = await work.move(created.data.task_key, {
  status: 'in_progress',
  rowVersion: created.data.row_version,
  placement: 'top',
});

await work.comment(moved.data.task_key, {
  body: 'Started reviewing the traceable result.',
  watch: true,
});
```

`pages()` and `all()` advance through the server's bounded offset contract and stop on the
authoritative `hasNext` value; they never preload an unbounded backlog. Task responses deliberately
retain their public JSON names (`task_key`, `row_version`, and similar) so OpenAPI examples, webhook
fixtures, and SDK values remain interchangeable. A `409 VERSION_CONFLICT` means the integration must
read the current task and review its intended change rather than replaying an obsolete mutation.

## Create a token

Open **Settings → API tokens**. Give the token a purpose-specific name, choose read-only or
read-and-write access, select only the required capability areas, choose a 30, 90, or 365 day
expiry, and optionally restrict it to one workspace. Capability areas independently cover workspace
discovery, projects, data and engineering, tasks, key dates, and reviews. The secret is displayed
once. Store it in an environment variable or secret manager; Engrove stores only its SHA-256 digest
and cannot recover it later.

New tokens inherit the current organization role but never receive organization administration,
audit-log, pilot administration, storage-cleanup, or workspace-administration capabilities. A
read-only token can call `*.read` operations and exports only. A workspace-scoped token receives a
404 for other workspaces so integrations cannot use it to discover inaccessible workspace IDs.

## Authenticate

Send the token using the standard Bearer scheme:

```bash
export ENGROVE_API_TOKEN='eng_pat_replace_me'
export ENGROVE_API_URL='https://engrove.example.com'

curl --fail-with-body \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  "$ENGROVE_API_URL/api/v1/workspaces"
```

Bearer requests do not use browser CSRF cookies. Invalid, expired, or revoked credentials return
`401 AUTHENTICATION_REQUIRED`. A role or token access mismatch returns `403`; a workspace-scope
mismatch returns `404 WORKSPACE_NOT_FOUND`.

The token's role, read/write level, capability scope, and optional workspace restriction are all
upper bounds: a request must pass every bound. For example, a write token scoped only to **Tasks**
can create and update tasks but receives `403 API_TOKEN_SCOPE_DENIED` for records and key dates.
Tokens created before capability scopes were introduced retain their previous access; their token
list entry displays the equivalent complete capability set so they can be identified and replaced
with narrower credentials.

## Page organization directories

Organization administration uses session-authenticated `GET /api/v1/members` and
`GET /api/v1/member-groups`. Both endpoints accept a literal, case-insensitive `query`, `limit`
from 1–100, and a zero-based `offset`; they return an exact filtered `pageInfo.total`, stable
organization-wide `overallTotal`, and `hasNext` flag.
Member search covers display name, email, and role. Group search covers name and description, and
archived groups are excluded. The browser requests 50 rows at a time and searches on the server, so
large organizations do not preload their complete member and group directories.

Member-group rows include the selected member UUIDs required by the existing atomic replacement
operation. That operation accepts at most 500 unique organization members; clients must preserve
IDs not currently visible in a filtered member page when updating a group.

## Discover workspaces without unbounded lists

`GET /api/v1/workspaces` is a bounded portfolio endpoint. `limit` accepts 1–100 and defaults to 50;
`offset` and the optional 120-character `query` support server-side paging and search across the
workspace name, key, description, and public ID. The response includes `pageInfo.total` for the
filtered result, `overallTotal` for every workspace visible to the caller, and `hasNext`.

Use `GET /api/v1/workspaces/{workspaceId}` to restore a bookmarked or currently selected workspace
instead of scanning list pages. Both endpoints accept stable public IDs and enforce the same
organization and optional API-token workspace scope. A scoped token therefore receives only its
workspace in the portfolio response and a `404` for every other exact identifier.

Organization membership is not universal discovery. Workspace and project lists include only
resources visible to the token owner. A restricted workspace admits selected active members or
groups, owners, administrators, and its creator. A restricted project narrows that inherited set
again and can never widen the workspace boundary. Hidden identifiers return the same `404` as
missing identifiers, including through search, overview, My Work, task, key-date, and notification
APIs.

Owners and administrators can read or atomically replace policies with
`GET|PATCH /api/v1/workspaces/{workspaceId}/access` and
`GET|PATCH /api/v1/workspaces/{workspaceId}/projects/{projectId}/access`. PATCH accepts
`visibility`, `userIds`, `groupIds`, and the last-read `accessVersion`; a concurrent change returns
`409`. Workspace creation accepts `visibility=organization|restricted`, while project creation
accepts `visibility=workspace|restricted`, so confidential resources never need a temporarily broad
creation step. Personal API tokens cannot manage access policies.

```bash
curl --fail-with-body --get \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --data-urlencode "query=materials" \
  --data-urlencode "limit=25" \
  --data-urlencode "offset=0" \
  "$ENGROVE_API_URL/api/v1/workspaces"
```

## Resolve projects without loading the workspace portfolio

Use `GET /api/v1/workspaces/{workspaceId}/projects` for project administration, reporting, and
external integrations. The response is limited to 100 rows and supports literal `query` search,
`archiveState=active|archived|all`, `limit`, and `offset`. The default archive state is `all` for
backward compatibility. `pageInfo.total` is the exact number matching the current search and archive
filter, while top-level `overallTotal` counts every non-system project in the workspace.

Use `GET /api/v1/workspaces/{workspaceId}/project-options` for project pickers and navigation.
The optional `query` searches active projects by name, key, or public ID; `limit` accepts 1–50 and
defaults to 20. `pageInfo.total` is the number of matches and `hasMore` tells an interactive client
to ask the user for a narrower search. This endpoint is preferable to the complete project list for
all interactive controls.

Records and saved filters may still reference an archived project that is absent from active search.
Resolve those labels with `POST /api/v1/workspaces/{workspaceId}/project-references/query` and a JSON
body such as `{"ids":["project-uuid"]}`. The request accepts at most 500 unique-or-duplicate IDs,
preserves the first-occurrence order, includes archived projects, and silently omits IDs outside the
workspace. It is a read operation despite using POST so that a bounded ID collection does not appear
in URLs or intermediary logs.

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"ids":["019…","019…"]}' \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/project-references/query"
```

## Page saved table views

`GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/views`
accepts a literal, case-insensitive `query`, a `limit` from 1–100 (default 50), and a zero-based
`offset`. The response includes the exact filtered `pageInfo.total` and `hasNext`; it never returns
an unbounded view catalog. Use `GET .../views/{viewId}` to restore a bookmarked view by its stable
public ID without scanning earlier pages. The table sidebar follows the same pattern: it opens the
first page, resolves a deep link exactly when necessary, and loads later pages only on request.
Dashboard composition also searches this endpoint remotely instead of placing only the first page
in a select control. It keeps the chosen view configuration independently from the current search
page so its filters, sorts, and visible fields remain stable while the user finishes the card.

## Export the current table view

Create new integrations with
`POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/exports`.
This returns `202 Accepted` immediately and prepares the complete matching scope in the background,
not only the currently loaded page. Send a unique `Idempotency-Key` header and the same `filters`,
`sorts`, `search`, `contextProjectId`, and `archiveState` boundary as a record query, plus `fieldKeys`
for the visible columns. A repeated key with the same scope returns the same job; reusing it with a
different scope returns `409`.

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "Idempotency-Key: export-$(uuidgen)" \
  --header "Content-Type: application/json" \
  --data '{"fieldKeys":["serial-number","status"],"filters":[],"sorts":[{"systemField":"displayName","direction":"asc"}],"archiveState":"active"}' \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/object-types/t…/records/exports"
```

Poll `GET .../records/exports/{exportId}` until `status` is `succeeded`, then request
`GET .../records/exports/{exportId}/download` for a five-minute signed URL. The collection
`GET .../records/exports?limit=50&offset=0` lists only the calling user's jobs. Artifacts are private,
expire after six hours, and are deleted by the orchestration worker. Each attempt writes a streamed
CSV to a distinct object key, so API memory and retry overwrites do not grow with the export. A job
is rejected above 1,000,000 matching records. The audit log records row and field counts, archive
scope, and whether narrowing was applied, but never search or filter values.

The browser uses this asynchronous contract and downloads the signed result when it is ready. The
bounded synchronous `POST .../records/export.csv` and the original all-active-record
`GET .../object-types/{objectTypeId}/export.csv` remain compatibility routes; new integrations should
use the job route.

## Preview and import CSV records

CSV import is a two-step contract. First send `{ "csv": "..." }` to
`POST .../object-types/{objectTypeId}/records/import-csv/preview`. The response contains the parsed
headers, total row count, three sample rows, supported destination fields, and conservative suggested
mappings based on stable field keys or display names. Preview validates the 5 MiB and 20,000-row
limits but does not write records.

After review, send the same CSV plus every source-column mapping to `POST .../records/import-csv`
with an `Idempotency-Key`. Map exactly one column to `displayName`; map unwanted columns to `null`.
`duplicateStrategy` is `allow`, `skip`, or `update`. Skip and update also require a mapped
`uniqueFieldKey`; update requires record-update permission and preserves every unmapped field.
Relations accept semicolon-separated active record names or IDs, and user fields accept an active
member email or ID. File, dataset, measurement, formula, lookup, and rollup fields are intentionally
excluded from CSV writes. The result separately reports created, updated, skipped, and failed rows,
with at most 200 detailed row errors.

Each saved view reports `permissionType` (`collaborative`, `personal`, or `locked`), `ownerId`, and
an optional `lockReason`. Data-scoped read/write API tokens may create and manage views through the
same endpoints as the browser, but repository ownership rules remain authoritative: Contributors
may edit collaborative views and their own personal views, cannot take over another author's
collaborative view, and cannot create or modify a locked view. Engineers and administrators may
change a view's mode with `PATCH .../views/{viewId}/permission`; a locked configuration must first
be changed back to collaborative or personal. All permission changes use `rowVersion` conflict
checks and are written to the audit log.

## Enforce table-specific access

Owner and Admin sessions can open the table title's **Table permissions** action or use
`GET` and `PATCH .../object-types/{objectTypeId}/permissions`. Each table independently controls
visibility, record creation, record updates, and record archive/restore. A policy may allow everyone,
Contributors and above, Engineers and above, Administrators and Owners, specific active organization
members or member groups, or nobody. `PATCH` replaces the complete policy and requires the last-read
`rowVersion`; a concurrent change returns `409 TABLE_PERMISSION_VERSION_CONFLICT` without discarding
the caller's draft.

Table policies narrow the global role and token grants; they never add a capability that the caller's
role or token lacks. A hidden table is omitted from table and schema catalogs and exact access returns
`404 OBJECT_TYPE_NOT_FOUND`, preventing API discovery through response differences. Allowed visible
tables include effective `recordPermissions` flags so clients can suppress unavailable create, update,
archive, and restore controls before a request. The repository still checks every single, bulk, CSV,
undo, archive, and restore mutation, so a handcrafted request cannot bypass the browser.

Data-scoped API tokens use the same table policy and current organization membership as browser
sessions. Public Form submissions evaluate the table's create policy against the share publisher's
current role, identity, and active groups; changing that policy to deny creation immediately closes
the intake path without rotating the share URL. Policy replacements and their subject counts are
audited as `schema.object_type_permissions_updated`. Treat specific-member policies as durable access
configuration and remove disabled users or archived groups during normal access reviews.

## Publish a read-only saved view

An Engineer, Admin, or Owner can select a persisted Grid, Gallery, Kanban, or Calendar view and use
the **Share view** icon. `POST .../views/{viewId}/share` creates or rotates a public link; the full
URL is returned once, while Engrove stores only a SHA-256 token digest and a short identifying
prefix. API tokens cannot manage public links. Share management requires a browser session, CSRF,
and the `view.share` action.

The management panel can set an optional password of at least eight characters, an expiry time, and
whether CSV download is allowed. `PATCH .../share` uses `rowVersion` optimistic concurrency without
changing the URL. `POST .../share/revoke` invalidates it immediately. Rotating invalidates the old
URL and preserves the current password unless a replacement is supplied. Every create, settings
change, rotation, and revocation is audited.

Anonymous readers use `/share/{token}`. A password-protected link initially returns no view name,
table name, fields, or records. Successful `POST /api/v1/shared-views/{token}/unlock` returns a
30-minute access token for the `x-engrove-share-access` header. Unlock attempts use a stricter
per-link and per-client rate limit in addition to normal anonymous API quotas.

Public queries are read-only and combine the owner's saved filters with the visitor's transient
search, visible-field filters, sorting, and pagination. Visitor changes are never persisted. Record
IDs are replaced with share-specific public identifiers; hidden fields, hidden-field search,
context-project search, user IDs, relation IDs, and file or dataset references are not exposed.
CSV export is disabled by default, capped at 10,000 matching records, and follows the same saved
scope and visible-column boundary. Public metadata, unlock, query, and export responses are marked
`no-store`. Form views cannot be published because anonymous data entry needs a separate submission
and abuse-control policy.

## Conditional reads and browser caches

Authenticated `GET` and `HEAD` responses under `/api/v1` use `Cache-Control: private, no-cache` and
an `ETag`. `private` prevents shared intermediary caches from storing a member-specific response;
`no-cache` permits a caller's private cache to retain it only when it revalidates before reuse.
Send the previous tag as `If-None-Match`; an unchanged representation returns `304 Not Modified`
without a response body. `ETag` is exposed through CORS for browser-based API clients, and responses
vary on `Authorization`, `Cookie`, and the allowed origin. Secret-bearing public-share reads override
the general read policy with `private, no-store`. Every versioned API mutation is also
`private, no-store`, so token, invitation, upload, and other mutation responses cannot be retained.
Health, metrics, Swagger UI, and the generated OpenAPI document use `no-store` as well.

The API origin emits `nosniff`, frame denial, `no-referrer`, and a restrictive permissions policy on
every response. Production responses also emit one-year `Strict-Transport-Security` with
`includeSubDomains`; a TLS edge must preserve or strengthen those headers rather than replacing them
with weaker values.

Conditional requests still count against request quotas and may still execute authorization and
database reads; they reduce transfer and parsing cost rather than bypassing access control. Always
paginate large collections, use webhooks instead of polling for record/task changes, and treat an
ETag as an opaque validator rather than deriving application state from it.

```bash
etag=$(curl --silent --dump-header headers.txt --output tasks.json \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/tasks?limit=100" \
  && sed -n 's/^etag: //Ip' headers.txt | tr -d '\r')

curl --include \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "If-None-Match: $etag" \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/tasks?limit=100"
```

## Request quotas

Every `/api/v1` request is counted in Redis using a hashed credential identity. API tokens,
browser sessions, and anonymous clients use separate buckets; raw credentials and IP addresses are
never stored in the quota key. Defaults are 300 token requests, 600 session requests, or 120
anonymous requests per 60 seconds. Configure the four `API_RATE_LIMIT_*` environment variables for
the deployment's capacity, while retaining stricter account-aware limits on sign-in and password
reset.

Successful responses include `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and
`RateLimit-Policy`. Exhausted quotas return `429 RATE_LIMITED` plus `Retry-After`; callers should use
bounded exponential backoff and honor that interval. If Redis cannot enforce the policy, versioned
API traffic fails closed with `503 RATE_LIMIT_UNAVAILABLE`, and readiness also reports Redis as
unavailable.

## Browser failure reports

`POST /api/v1/client-errors` is reserved for the authenticated Engrove browser session and does not
accept personal API tokens. It requires the session's CSRF token, returns `202` with the
caller-generated error UUID, and sets `Cache-Control: no-store`. Reports contain only `errorId`,
`render_error` or `chunk_load_error`, an internal pathname, the JavaScript error class name, and an
optional bounded React component stack. The strict schema rejects additional properties so error
messages, query strings, fragments, user-entered values, full URLs, and JavaScript error stacks
cannot be submitted accidentally.

The endpoint is an operational signal, not durable domain or audit storage. Use the displayed error
reference to correlate the user's report with structured API logs, and monitor
`engrove_client_render_errors_total` for release regressions.

## Retry task and key-date creation safely

Task and project key-date creation require a caller-generated `Idempotency-Key` header containing
8–200 characters. The key is scoped to the project, authenticated actor, and operation. Engrove
stores the normalized request fingerprint and created resource for 24 hours. An identical retry in
that window returns the current resource with `idempotent_replay: true`; the first response uses
`false`. Audit events, notifications, automations, webhook outbox events, task numbers, and linked
tasks are committed only by the first transaction.

Reusing the same key with different content returns `409 IDEMPOTENCY_KEY_REUSED`. Generate one key
for each intended creation, persist it until the operation receives a definitive response, and do
not derive it solely from a title. Expired keys are removed hourly and may be reused after the
24-hour window, so they are retry identifiers rather than permanent external IDs.

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: task-sync-2026-08-10-001" \
  --data '{"title":"Publish verification package","description":"","priority":"high","labels":["release"],"links":[]}' \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/tasks"
```

To create a reviewed duplicate, send the desired new task fields through the same endpoint and set
`cloneSourceTaskId` to an active task UUID in that project. The API does not copy hidden state:
clients choose the title, description, priority, labels, parent, assignee, due date, and evidence
links explicitly, while an omitted `status` uses the workflow entry status. Engrove creates a
`relates_to` relationship to the source and a `task.cloned` audit event in the same transaction as
the task. An archived, missing, or cross-project source returns `400 TASK_CLONE_SOURCE_INVALID` and
creates nothing. The source UUID participates in the idempotency fingerprint.

`POST .../specification-evaluations/{evaluationId}/task` is the purpose-built failed-evaluation
follow-up operation. It accepts only a failed evaluation in the current project and derives the
task title and exact evidence links on the server. Concurrent calls, including calls served by
different API replicas, serialize on the project and return the same task; the creator receives
`idempotent_replay: false` and callers that converge on an existing linked task receive `true`.
Task creation, the evaluation-origin audit event, ordinary create side effects, and the webhook
outbox are one transaction. A pass, warning, missing, foreign, or unknown evaluation creates
nothing and returns the documented error envelope.

The same contract applies to `POST .../milestones`; its body may include up to 200 unique
same-project `taskIds`. Concurrent identical requests are serialized in PostgreSQL, so this
guarantee also holds across API replicas.

## Collaborate on configurable records

Record comments are available through `GET/POST .../object-types/{objectTypeId}/records/{recordId}/comments`
and `PATCH .../comments/{commentId}`. Reads require `record.read`. Mutations require the
`record.comment` permission and a write-capable token with the `data` capability. Comment bodies are
limited to 10,000 characters. Lists are newest-first, accept `limit` from 1–100 plus `offset`, and
return exact `pageInfo` metadata.

Creation accepts `mentionedUserIds` containing at most 50 unique active organization-member UUIDs.
Responses include both `mentionedUserIds` and display-ready `mentionedUsers`. An edit may omit
`mentionedUserIds` to preserve the current set, or provide the complete replacement set. Newly
added mentions create actor-scoped `record.mentioned` notifications; existing mentions are not
notified again by a later edit. The personal `notifyMentioned` preference applies to task and record
mentions consistently.

Only the author can edit a comment. Send the last-read positive `rowVersion`; stale writes return
`409 RECORD_COMMENT_VERSION_CONFLICT`. Comment edits do not change the parent record's row version,
but they append `record.comment_edited` to that record's audit history with the previous body and
mention set.
Archived records keep their comment history readable and reject new or edited comments.

## Inspect webhook delivery history

Use `GET .../webhooks/{endpointId}/deliveries` to diagnose an external integration without losing
older failures. Results are newest-first and accept `status=all|queued|sending|succeeded|failed`, a
`limit` from 1–100 (default 50), and a zero-based `offset`. `pageInfo.total` is the exact count for
the selected status and `hasNext` tells clients when to continue. `summary` always reports exact
queued, sending, succeeded, and failed counts for the complete endpoint history, independent of the
selected status or current page.

Only terminal failed deliveries can be submitted to
`POST .../webhooks/{endpointId}/deliveries/{deliveryId}/retry`. A successful retry returns `202`,
resets the attempt cycle, and appends an audit event; refresh the history because a status-filtered
failed result no longer belongs in that view.

## Search organization audit history

Organization owners and administrators can use `GET /api/v1/audit-events` from an authenticated
browser session. The endpoint accepts a literal, case-insensitive `query` across action, actor name
and email, target type and ID, and request ID. `limit` accepts 1–200 (default 100), `offset` is
zero-based, and `pageInfo` reports the exact matching total and `hasNext`. Results are deterministic
newest-first. API tokens cannot read organization audit history because it contains cross-project
administrative and identity activity.

After concurrent mutations, refresh from offset zero before continuing: newly inserted events can
shift offset positions. Use the immutable event ID and request ID to correlate a selected row with
application logs rather than treating a page offset as a durable reference.

## Discover tables and fields

Use `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types` for interactive table
catalogs. `query` performs a literal, case-insensitive search across the singular name, plural name,
stable key, and description; `%` and `_` are ordinary characters rather than SQL wildcards.
`limit` accepts 1–100 and defaults to 50, while `offset` is zero-based. The response includes exact
`pageInfo.total` and `hasNext`. Resolve a bookmarked selection directly with
`GET .../object-types/{objectTypeId}` instead of scanning catalog pages. Both UUIDs and stable table
public IDs are accepted.

Call `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/schema` before generating an
integration or synchronizing configurable records. Each response contains the resolved workspace
and project UUIDs plus a bounded page of tables with their stable `publicId`, key, names, and
complete ordered field metadata. `query` performs the same literal table search as the object-type
catalog, `limit` accepts 1–100 and defaults to 50, and `offset` is zero-based. Follow
`pageInfo.hasNext` until every matching table has been read. Only fields belonging to the returned
table page are queried. Read-only workspace-scoped tokens can use this endpoint.

```bash
curl --fail-with-body \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/schema?limit=50&offset=0"
```

Use the table `publicId` in record URLs and field `key` values in record payloads. This avoids
hard-coding display names, which users can change.

The same OpenAPI contract describes table, field, and saved-view creation and updates, including
field-type enums, view layout constraints, optimistic `rowVersion` values, record history, undo,
lifecycle operations, and CSV import results. Download `/api/docs-json` to generate a client rather
than duplicating these validation rules in an integration. Every programmable-data operation has a
typed success response, including the `text/csv` export.

Schema mutations require a read-and-write token. Create and update requests reject unknown keys so
misspelled settings fail visibly instead of being silently ignored. Field ordering is a complete
replacement operation: send every active field ID exactly once. Saved-view updates and archival use
the last-read `rowVersion`; reload after a `409 VERSION_CONFLICT` before retrying.

## Select fields when querying records

`POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/query`
accepts `fields`, a unique list of 1–200 field keys. When present, Engrove reads and returns only
those configurable values, relations, file or dataset references, and measurements. Stable record
identity, version, lifecycle, and timestamps remain in every item. Filters, sorting, and grouping
can still reference fields omitted from the response, and selected formula, lookup, or rollup fields
resolve their dependencies without exposing the dependency fields.

Prefer field selection for tables containing spectra, tabular series, or other large values:

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"fields":["serial-number","status"],"page":1,"pageSize":50}' \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/object-types/t…/records/query"
```

Relation fields return both stable IDs in `relations` and page-hydrated display metadata in
`relationLabels`; clients should render `displayName` while retaining the ID as the mutation value.
To build a relation picker, call
`GET .../object-types/{targetObjectTypeId}/record-references?query=...&limit=20`. Search results are
bounded and exclude archived records. Pass up to 100 comma-separated `ids` instead of `query` to
resolve existing links; this mode includes archived targets so historical relationships remain
legible. Do not preload a target table or issue one record request per relation cell.

## Group records into a hierarchy

Grid queries accept up to three unique `groupings`. Each level identifies a groupable scalar field,
an `asc` or `desc` direction, and an `enabled` flag. Text, integer, decimal, boolean, date, datetime,
and single-select fields are groupable. Multi-value, relation, user, engineering-series, and
calculated fields are rejected with `400 FIELD_GROUPING_UNSUPPORTED` because one record could
otherwise appear in several paths or depend on an unstable derived value.

Active group levels become the leading record sort keys. The response's `groupHierarchy` contains
one entry for every group and subgroup in the complete filtered scope, not only the current page.
Each entry contains a one-based `level`, its `fieldId`, the complete field/value `path`, and `count`.
When the request also contains `summaries`, every hierarchy entry includes the same ordered
`summaries` array calculated over all filtered records in that exact path. Values remain
decimal-safe strings, and quantity or latest-current-measurement results retain their canonical
unit. This lets clients render accurate collapsible headers and per-group analysis while continuing
to page the record items.

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"groupings":[{"fieldId":"019…","direction":"asc","enabled":true},{"fieldId":"019…","direction":"desc","enabled":true}],"summaries":[{"fieldId":"019…","operation":"average"}],"page":1,"pageSize":25}' \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/object-types/t…/records/query"
```

Named Grid views persist all configured levels, including disabled ones, so temporarily disabling a
subgroup does not erase its field or direction. A direct query normally sends enabled levels only.
Legacy Kanban clients may continue using `groupByFieldId` and the flat `groups` response; the new
`groupings` and `groupHierarchy` fields are additive.

The browser uses the Grid footer's summary selections for both the global footer and every visible
group header. It does not maintain a second, potentially contradictory group-summary configuration.
Group counts and summaries are computed by PostgreSQL over one materialized filtered-record scope;
the browser never derives them from the visible page.

## Compute filtered field summaries

The record query body accepts up to 50 unique `summaries`, each containing a `fieldId` and one
operation: `count`, `sum`, `average`, `min`, or `max`. The response returns decimal-safe string
values and an optional canonical engineering `unit`. A summary always covers every record matching
the request's search, filters, project context, and archive state; `page` and `pageSize` affect only
the returned record items. This prevents a 25-row browser page from presenting a misleading partial
total.

`count` is available for indexed scalar, select, user, relation, quantity, and measurement fields.
`sum` and `average` require integer, decimal, quantity, or measurement fields. `min` and `max` also
support dates and datetimes. Measurement operations use only the latest non-superseded observation
per record and report the field's canonical unit. One operation may be selected per field in a
request or saved Grid view.

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"filters":[],"summaries":[{"fieldId":"019…","operation":"average"}],"page":1,"pageSize":25}' \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/object-types/t…/records/query"
```

The browser exposes these operations in the sticky Grid footer and persists them in named-view
configuration. Changing pagination does not change the value; changing the active filter or search
does.

## Page engineering histories

Engineering histories are append-heavy and never return an unbounded collection. Measurement,
specification, and specification-evaluation list endpoints accept a `limit` from 1–100 (default
50), a zero-based `offset`, and a literal, case-insensitive `query`. Every response contains
`items` plus exact `pageInfo.total` and `pageInfo.hasNext` values.

`GET .../records/{recordId}/measurement-results` optionally filters by `fieldId` and
`currentState=all|current|superseded`. Each returned result includes its latest specification
evaluation, when one exists, so clients do not need an evaluation request for every measurement.
The current Engrove editor requests all measurement fields in one record page and loads older
results explicitly. Current results on the loaded pages remain available as correction choices.

`GET .../specifications` accepts `archiveState=active|archived|all`. Its response includes each
selected specification's ordered revision history without one query per specification. The legacy
`includeArchived=true` parameter remains an alias for `archiveState=all` for existing integrations.

`GET .../specification-evaluations` optionally filters by `recordId` and
`status=all|pass|warning|fail|missing`. Refresh offset zero before continuing after writes because
new measurements and specification revisions can insert newer evaluations ahead of an offset page.

The same OpenAPI group fully describes measurement creation and correction, specification creation
and revision, lifecycle changes, and exact evaluation retries. Decimal quantities remain strings;
the contract publishes the 34-digit precision ceiling, unit and timestamp bounds, optional equipment
and dataset evidence, and the rule that a correction supplies both `supersedesResultId` and
`correctionReason`. Every mutation returns the created measurement, specification, lifecycle state,
or evaluation rather than an undocumented acknowledgment. `GET /api/v1/units` publishes the exact
versioned unit registry shape and digest used to interpret those quantities.

## Create and update records in batches

Use `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/bulk`
to create 1–100 records in one atomic transaction. Send the same record shape used by the single
create endpoint inside `items`, and include a caller-generated `Idempotency-Key` header containing
8–200 characters. If any record, relation, reference, required field, or unique constraint fails,
Engrove rolls back the complete batch. Retrying an identical request with the same key returns the
original record IDs with `idempotentReplay: true`; reusing the key with different content returns
`409 IDEMPOTENCY_KEY_REUSED`.

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: sync-run-2026-08-09-001" \
  --data '{"items":[{"displayName":"Sample A","values":{"serial":"SN-A"}},{"displayName":"Sample B","values":{"serial":"SN-B"}}]}' \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/object-types/t…/records/bulk"
```

Use `PATCH` on the same endpoint to replace the editable state of 1–100 existing records. Every
item includes its stable `id` and last-read `rowVersion`. The API locks records in stable ID order;
if any item is missing, duplicated, or stale, the complete update rolls back with a `404` or `409`.
Successful responses return each ID and its new row version. This preserves Engrove's audit,
webhook, derived-index, and engineering-evaluation behavior for every record in the batch.

When an integration intends to change only selected fields, prefer `PATCH` on
`/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/bulk/fields`.
Send 1–100 `{ "id", "rowVersion" }` record references and 1–20 unique field operations. A `set`
operation includes `value`; a `clear` operation removes the value. Unmentioned fields—including
fields hidden from the current view—remain unchanged. Calculated and append-only fields are
rejected, relation/file/dataset values use bounded UUID arrays, and any invalid or stale record
rolls back the complete request.

```bash
curl --fail-with-body \
  --request PATCH \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"records":[{"id":"record-uuid","rowVersion":3}],"changes":[{"fieldKey":"status","operation":"set","value":"approved"},{"fieldKey":"review_note","operation":"clear"}]}' \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/object-types/t…/records/bulk/fields"
```

## Archive and restore records in batches

Use `POST` on
`/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/bulk/archive`
or the corresponding `/bulk/restore` endpoint to change the lifecycle state of 1–100 records in one
atomic transaction. Send `{ "ids": ["record-uuid", "…"] }`; archive requests also require a
human-readable `reason`. Duplicate IDs, missing records, or records already in the target state
reject the request and roll back every state change. Successful responses preserve caller order and
return each stable ID with its new `rowVersion`.

Archived records keep their audit, webhook, relation, resource-reference, and engineering evidence
history, but are read-only until restored. To retrieve them, send `archiveState: "archived"` to the
record query endpoint. `archiveState` accepts `active` (default), `archived`, or `all`; it supersedes
the legacy `includeArchived` boolean.

## Page through tasks

`GET /api/v1/workspaces/{workspaceId}/overview` returns the workspace header, a bounded page of
visible non-system projects, exact active task and blocker counts, exact overdue key-date totals,
each returned project's next future date, and a bounded chronological date list. The server reads
the complete summary from one repeatable-read database snapshot, so clients do not need to issue
task and milestone requests per project or derive totals from paginated task pages.

Pass the viewer's local `today` in `YYYY-MM-DD` form so date-only milestones are classified without
a browser/server timezone mismatch. `dateLimit` accepts 1–50 and defaults to 6; it bounds only the
returned date details, not summary totals or the separately resolved next upcoming date. Archived
projects remain present for lifecycle administration but contribute zero active work and dates.
Read-scoped workspace API tokens can use this endpoint.

`projectQuery` performs a literal, case-insensitive search over project name, key, and description;
percent, underscore, and backslash characters are treated as text rather than SQL wildcards.
`projectLimit` accepts 1–50 and defaults to 20, while `projectOffset` is zero-based.
`projectPageInfo.total` is the exact matching project count. Search never changes the workspace-wide
summary totals or upcoming-date list, so the overview remains a stable operational snapshot while a
client narrows the embedded project directory.

```bash
curl --fail-with-body --get \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --data-urlencode "today=2026-08-09" \
  --data-urlencode "dateLimit=6" \
  --data-urlencode "projectQuery=qualification" \
  --data-urlencode "projectLimit=20" \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/overview"
```

Project schedule clients use
`GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/milestones`. Every key date returns
`linked_tasks`, `task_count`, and `completed_task_count`; the count is derived from the linked tasks'
workflow categories rather than a manually entered percentage. Create requests may include up to
200 unique `taskIds`. Updates may replace that set and must include the last-read `rowVersion`.
Linked task IDs must be active and belong to the same project; a stale key date returns
`409 MILESTONE_VERSION_CONFLICT` without partially changing its links.

The key-date catalog is bounded and chronological. `query` performs a literal, case-insensitive
search over title, description, status, and target date; `archiveState=active|archived|all`, `limit`
from 1–100, and a zero-based `offset` control the page. The legacy `includeArchived=true` parameter
remains an alias for `archiveState=all`. `pageInfo` exposes the exact matching total, while `summary`
contains exact active status counts and the archived count across the complete filtered result—not
only the current page. `nextMilestoneId` identifies the next matching future, incomplete date. Use
`GET .../milestones/{milestoneId}` for durable links rather than paging until the selected date
appears.

`GET .../tasks/{taskId}` exposes the reverse association as `linked_key_dates`, including stable key
date ID, title, status, target date, and archived timestamp. Clients can therefore present delivery
context without loading every project milestone or reconstructing the join locally.

The same task-detail response embeds the newest 50 combined activity entries and returns
`activity_page_info`. Continue through older entries with
`GET .../tasks/{taskId}/activity?limit=50&offset=50`; `limit` accepts 1–100 and every page reports
`limit`, `offset`, exact `total`, and `hasNext`. The four typed arrays (`status_history`, `comments`,
`change_history`, and `link_history`) together make up that page, so advance the offset by their
combined item count. Page selection is deterministic newest-first; merge the typed arrays and sort
their timestamps for a single chronological presentation. Because an insert or edited-comment
timestamp can shift offset positions, refresh task detail after concurrent activity mutations
before requesting the next page.

Comments expose `revision_count` but do not embed prior bodies in task activity. Fetch them only
when needed with
`GET .../tasks/{taskId}/comments/{commentId}/revisions?limit=20&offset=0`. Revision pages accept
1–100 items and preserve every superseded body, mention set, editor, and edit time from immutable
audit events. This separation prevents a frequently edited comment from making the task-detail
payload unbounded.

### Track task estimates and authored work

Task create and update bodies accept nullable `originalEstimateMinutes` and
`remainingEstimateMinutes` values in minutes. When a create request supplies an original estimate
but omits the remaining estimate, remaining time starts at the original estimate. `time_spent_minutes`
is read-only and is always derived from active work entries; clients must not maintain a second
editable progress value.

`GET .../tasks/{taskId}` embeds the newest 20 work entries and `worklog_page_info`. Continue with
`GET .../tasks/{taskId}/worklogs?limit=20&offset=20`; the page is stable newest-started-first and
reports its exact active total. Create an entry with `POST .../worklogs`, edit it with `PATCH
.../worklogs/{worklogId}`, and soft-delete it with `DELETE .../worklogs/{worklogId}`. Durations are
integer minutes in the API, while `startedAt` is an offset timestamp. Notes are optional and limited
to 2,000 characters.

Every mutation requires the last-read `taskRowVersion`; edit and delete also require the entry's
`worklogRowVersion`. A stale task returns `409 TASK_VERSION_CONFLICT`, while a stale or already
deleted entry returns `409 TASK_WORKLOG_VERSION_CONFLICT`. `remainingEstimateMode` is `auto` by
default: create subtracts the logged duration, edit applies only the duration difference, and delete
adds the removed duration back. Use `unchanged` to preserve remaining time or `set` together with
`remainingEstimateMinutes` to replace it explicitly. If remaining time is null, automatic mode
leaves it null.

Contributors, Engineers, Owners, and Administrators may create work entries. Only the entry author,
an Owner, or an Administrator may edit or delete one; `can_edit` in each response lets clients hide
invalid actions without treating it as authorization. Work-entry deletion is retained as a
tombstone, and every create, edit, and delete records audit and task webhook effects in the same
transaction as the estimate and task row-version change.

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"durationMinutes":45,"startedAt":"2026-08-11T14:00:00Z","note":"Reviewed release evidence","remainingEstimateMode":"auto","taskRowVersion":7}' \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/tasks/FORCE-42/worklogs"
```

```bash
curl --fail-with-body \
  --request PATCH \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"title":"Production release","description":"","status":"active","targetDate":"2026-10-01","taskIds":["task-uuid"],"rowVersion":3}' \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/milestones/milestone-uuid"
```

The workspace command palette and integration clients can discover active navigation targets with
`GET /api/v1/workspaces/{workspaceId}/search`. A trimmed `query` of 2–120 characters searches active
project names, keys, and descriptions; task keys, titles, and descriptions; key-date titles,
descriptions, status, and target dates; and table names, keys, public IDs, and descriptions. Exact
keys and dates rank before prefixes and general matches. Results identify their `projectPublicId`
and whether a table is workspace-shared, so clients can construct canonical deep links without
exposing internal project IDs.

The endpoint defaults to 20 results and accepts `limit` from 1–50. `pageInfo.total` and
`pageInfo.hasMore` make truncation explicit. Every search branch applies organization, workspace,
parent lifecycle, and entity lifecycle scope independently; archived navigation targets never leak
into the active command palette. Scoped personal API tokens may use the endpoint when they include
at least one relevant capability. The response executes and returns only the matching branches:
**Projects** exposes projects, **Tasks** exposes tasks, **Key dates** exposes key dates, and **Data &
engineering** exposes tables. A token cannot discover metadata from a capability area it lacks.

```bash
curl --fail-with-body --get \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --data-urlencode "query=MOTOR-42" \
  --data-urlencode "limit=20" \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/search"
```

`GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/dashboard-metrics` returns aggregate
project health and inventory counts in one bounded response. Alongside sample, dataset, evaluation,
and task health fields, `chart_count`, `dashboard_count`, and `object_type_count` report active
visualization and table inventory. `recent_datasets` is independently capped at five items.

Use this endpoint for project cards and overview screens instead of downloading chart, dashboard,
table, or task collections merely to count them. Resource list endpoints remain appropriate when the
caller needs the resources themselves.

Chart and canvas catalogs are themselves bounded. `GET .../charts` and `GET .../dashboards`
accept a literal 120-character `query`, `archiveState=active|archived|all`, `limit` from 1–100, and a
zero-based `offset`. Each response retains the `items` array and adds exact `pageInfo` with `total`
and `hasNext`; the legacy `includeArchived=true` parameter remains available as an alias for
`archiveState=all`. Restart at offset zero after creating or revising a resource because recency
ordering may move it to the first page.

The dashboard saved-chart picker uses the same server-side chart search. A chart selected outside
the initially rendered catalog pins its exact `current_revision_id`; it is never replaced with a
newer revision implicitly.

Charts and canvases use reversible lifecycle operations instead of destructive deletion. Archive a
chart with `PATCH .../charts/{chartId}/archive` or a canvas with
`PATCH .../dashboards/{dashboardId}/archive`, passing a required JSON `reason` of at most 2,000
characters. Restore them with `POST .../charts/{chartId}/restore` and
`POST .../dashboards/{dashboardId}/restore`. Archived resources remain discoverable through
`archiveState=archived|all`; their source links, cards, and published revisions are preserved. The
web app presents archived canvases as read-only until they are restored.

Dataset catalogs use the same bounded pattern. `GET .../datasets` accepts a literal, case-insensitive
`query` across dataset name, type, and status; `includeArchived=true`; `limit` from 1–100; and a
zero-based `offset`. The default page contains 50 datasets, and `pageInfo` reports the exact `total`
and `hasNext`. Use `GET .../datasets/{datasetId}` when an already selected source must be resolved
directly instead of paging until it appears. Clients should keep selected dataset IDs independently
from the current search page so filtering does not silently discard an in-progress chart setup.

File evidence catalogs are also bounded. `GET .../files` accepts `archiveState=active|archived|all`,
an optional file `status`, a literal case-insensitive `query` across series name, original filename,
content type, status, failure code, and checksum, plus `limit` from 1–100 and a zero-based `offset`.
The legacy `includeArchived=true` parameter remains an alias for `archiveState=all`. Results are
newest-first and include exact `pageInfo`; use the direct download or preview endpoint after choosing
an item rather than retaining a signed URL from a catalog response.

File upload and dataset processing are also generated-client contracts. An upload-session request
publishes its 100 MiB ceiling, SHA-256 checksum format, content metadata, and optional existing
series ID; the response documents the short-lived direct PUT URL, required headers, stable file ID,
and expiry. Completion, signed download, supported-image preview, archive, and restore responses are
typed separately so integrations do not need to infer file state from browser traffic. Dataset
creation documents the mutually exclusive file or dataset source identifiers, transformation type,
safe parameter object, idempotent replay flag, and optional background-job ID. Direct dataset,
preview, lifecycle, retry, and administrator-only storage-cleanup responses likewise publish their
exact shapes and practical examples without exposing credentials.

`GET .../background-jobs` no longer returns an ever-growing project history. It accepts
`status=all|queued|running|succeeded|failed`, a literal case-insensitive `query` across job type,
entity type or ID, status, and error code, and the same bounded `limit` and `offset`. Attempts are
included only for jobs in the selected page. Refresh from offset zero while jobs are active because
new jobs and state changes can move entries in newest-first ordering.

`GET /api/v1/workspaces/{workspaceId}/my-work` returns the authenticated member's incomplete,
assigned work across every active project in the workspace. It is suitable for a personal work
queue as well as integrations acting for a service account. `urgency` accepts `all`, `overdue`,
`today`, `week`, `blocked`, or `no_due`; `priority` and case-insensitive `query` narrow the result.
`sort` accepts `attention`, `dueDate`, `priority`, or `updated`. Attention order puts overdue work,
open blockers, nearby dates, priority, and recent changes into a deterministic triage order. Results
are capped at 200 per request and expose `limit`, `offset`, `total`, and `hasMore`. The accompanying
summary always describes the member's complete active workspace queue, independent of the current
result filter.

Session-authenticated clients can page the member inbox with `GET /api/v1/notifications`. Use
`limit` from 1–100, a zero-based `offset`, and optional `unreadOnly=true`. `pageInfo.total` is the
exact total for that filter and `hasNext` indicates continuation; `unreadCount` remains the exact
unread total across the whole inbox even when the current page includes read notifications.

Record change history is also explicitly bounded. `GET
/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/{recordId}/history`
accepts `limit` from 1–100 and a zero-based `offset`; omitting `limit` preserves the legacy 100-item
page. Results are newest-first with deterministic event-ID ordering, and `pageInfo.total` plus
`pageInfo.hasNext` expose older changes instead of silently truncating them. The browser requests 50
events at a time. To restore a snapshot, post the current record `rowVersion` to the selected event's
`.../history/{eventId}/undo` endpoint. Restart from offset zero after an undo or any concurrent record
change because those operations add or reorder history entries.

```bash
curl --fail-with-body --get \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --data-urlencode "urgency=week" \
  --data-urlencode "sort=attention" \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/my-work"
```

`GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks` is bounded. It returns at most 100
items and accepts `limit` from 1 to 100 plus a zero-based `offset`. The response includes
`pageInfo.limit`, `pageInfo.offset`, `pageInfo.total`, and `pageInfo.hasNext`; integrations must not
assume the first response contains every task.

Use `GET .../task-assignees` instead of downloading the organization member directory into an
assignment control. `query` searches active members by display name, email, or an exact UUID;
`limit` accepts 1–100,
and `offset` is zero based. `pageInfo.total` is the exact filtered count, while `overallTotal` is the
complete active-member count. This endpoint requires task-read access rather than member-management
access so contributors can assign work without receiving administrative membership capabilities.

The same endpoint applies search and board filters before pagination. `query` searches task key,
title, description, parent key and title, assignee name, and labels case-insensitively. `assignee` accepts `mine`,
`unassigned`, or an organization member UUID; `priority` accepts `low`, `medium`, `high`, or
`critical`; repeated `status` parameters include tasks matching any selected custom workflow status,
while repeated `label` parameters require every normalized label. The browser's **Hide completed
work** preset resolves the project's current non-done workflow categories into explicit status
parameters rather than assuming fixed status names. `entityType` and `entityId` can independently or
jointly restrict tasks to linked engineering evidence.
Set `hasDueDate=true` to return only scheduled tasks; this is the contract used by the task calendar,
so its total and continuation pages never include undated backlog work.
`archiveState` accepts `active` (default), `archived`, or `all`; it supersedes the legacy
`includeArchived=true` flag. Ordering is deterministic within a request, but offset-based clients
should restart from offset 0 after mutating the filtered task set.

Record detail uses this same contract for linked work, requesting 50 tasks at a time with
`entityId={recordId}` and `archiveState=all`. Continue from the returned `pageInfo` instead of
raising the page size; this keeps task joins and record-detail rendering bounded for large projects.

`sort` accepts `rank` (default), `title`, `status`, `priority`, `assignee`, or `dueDate`, and
`direction` accepts `asc` or `desc`. Null assignees and due dates remain last. A child task stays
immediately after its parent even when its own status, priority, or date differs, so paged and UI
clients do not have to reconstruct the one-level hierarchy. Browser saved filters retain the list
view's sort, direction, hierarchy-preserving grouping, and ordered visible columns alongside its
search and filter criteria. The title column is always first and cannot be hidden, preserving a
stable task identity and detail-entry target in every shared or personal view.

Rank order is the same persistent workflow-status and project rank used by the board. To move a task, `POST` to
`/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/move` with `status`, the
last-read `rowVersion`, and optionally `beforeTaskId`. Omitting `beforeTaskId` places the task at the
bottom of the destination status; supplying it places the task immediately before that active task.
Use `placement: "top"` or `placement: "bottom"` instead when the task must move to an absolute
status edge regardless of filters or pagination; `placement` and a non-null `beforeTaskId` are
mutually exclusive. The endpoint validates workflow transitions and rejects stale moves atomically
with `TASK_VERSION_CONFLICT`. Personal API tokens require the `task.update` scope.

Browser sessions can manage reusable board criteria through `/task-filters`. A filter has
`visibility: "personal"` or `"project"`; publishing or updating a project-shared definition requires
`project.update`, while only its owner can replace or delete it. `POST
/task-filters/{filterId}/favorite` stores per-member favorite state for any visible filter. These
endpoints deliberately reject personal API tokens because saved filters are interactive user
preferences rather than integration resources.

`GET /task-filters` returns a bounded page instead of the complete project catalog. `query` performs
a literal, case-insensitive search over filter name and owner display name; `limit` defaults to 50
and accepts 1–100, while `offset` is zero-based. `pageInfo.total` is exact for the current search and
`pageInfo.hasNext` signals continuation. Favorites remain first within each deterministic result
set. `GET /task-filters/{filterId}` restores one personal or project-shared filter by stable ID and
returns `TASK_FILTER_NOT_FOUND` when it is missing or not visible to the current member. After
creating, renaming, sharing, favoriting, or deleting a filter, restart offset pagination at zero.
The browser stores an applied filter as `?filter={filterId}` and may combine it with `?task={taskId}`;
on reload it uses the single-filter endpoint rather than assuming the filter is present in the first
catalog page. Manual changes remove only the `filter` parameter and preserve any open task detail.

`GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-flow-insights` returns bounded,
project-wide flow analysis from immutable task status history. `windowDays` accepts 7–365 and
defaults to 30; it controls the completed-throughput and cycle-time sample. `staleAfterDays` accepts
1–90 and defaults to 7; it controls the current-work stale signal. The response contains:

- `summary`: active and in-progress counts, stale count, completed throughput, and average, median,
  and 85th-percentile cycle time in decimal hours;
- `statuses`: every active workflow status in board order with current count, WIP limit, average and
  oldest current age, and stale count;
- `aging_tasks`: the five oldest active tasks for direct investigation;
- `completed_tasks`: at most 50 recent completed tasks with completion time and cycle time;
- `flow_statuses`: ordered metadata for current and archived workflow statuses needed to interpret
  history without relabeling old states;
- `flow_series`: one point per calendar day in the requested window, containing end-of-day counts
  for every status. Dates are UTC calendar dates.
- `throughput_series`: one UTC bucket per day with task `created_count` and `completed_count`.
  Creation includes later-archived work; completion uses the most recent done transition only for
  tasks that remain in a `done` workflow category at report time.

Cycle time sums only intervals in statuses categorized as `in_progress`, including later intervals
after a task is reopened. A task contributes to the completion sample only when its current category
is still `done`, so a reopened task does not appear as completed prematurely. Current age and WIP
statistics are intentionally independent of browser filters; consumers should label them as
project-wide. Daily flow reconstruction respects task archive and restore audit events, excluding
archived intervals while retaining earlier and later active intervals. Internally, interval starts
and ends become daily deltas and a bounded window sum, so extending the report window scales with
days and workflow-status count rather than multiplying days by every task-history interval. The
endpoint requires `task.read` and is fully described in `/api/docs-json`.

The sum of `throughput_series.completed_count` equals `summary.completed_count`. Created minus
completed indicates whether intake exceeded current completions in the selected window, but it is
not an exact active-backlog delta because archive, restore, and reopen events are separate lifecycle
changes.

`GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-labels` returns the active project's
label catalog as `{ value, count }` entries, ordered by usage then value. `query` performs a bounded
case-insensitive catalog search and `limit` accepts 1–200. Task create and update payloads accept a
`labels` array with at most 12 values. Labels are normalized by the repository, included in task
search, protected by the task row version, and recorded in field-change activity.

Task create payloads accept an optional `parentTaskId`; task updates accept a UUID to assign a parent
or `null` to promote the task back to standard work. The parent must be an active standard task in
the same project. Attempts to create deeper nesting, assign a task that already has active children,
archive a parent before its children, or restore a child under an archived parent return a stable
409 error rather than silently reshaping the hierarchy. Detail responses include resolved parent
metadata, `children`, `child_count`, and `child_done_count`; list responses include the parent and
count summaries needed for compact cards.

Task lifecycle changes use the same optimistic-concurrency boundary as task edits and board moves.
Send `PATCH .../tasks/{taskId}/archive` with `reason` and the last-read `rowVersion`; send `POST
.../tasks/{taskId}/restore` with the archived task's last-read `rowVersion`. Both return the complete
task with its incremented `row_version`. A stale version or mismatched lifecycle state returns
`TASK_VERSION_CONFLICT` (HTTP 409), so clients must refresh rather than archive or restore a task
whose intervening edits they have not reviewed. Audit events preserve the archive reason and exact
from/to row versions. Successful restore is a mutation of an existing task and returns HTTP 200.
The Engrove browser distinguishes these conflict codes from ordinary failures. Board moves, bulk
changes, archive, and restore refresh their affected list automatically. A conflicting detail-form
save keeps the local field draft visible, fetches the latest task into a separate conflict notice,
and requires the user to confirm before replacing that draft. Integrations should provide an
equivalent review boundary rather than retrying the rejected body with a newer version implicitly.

Task list and detail representations expose `created_by`, `created_by_name`, `created_at`, and
`updated_at` for ordinary provenance review. `created_by` is the stable user identifier;
`created_by_name` is a presentation label and may change when a member updates their profile. Use
the stable task ID, task key, creator ID, timestamps, and audit events when building durable
integration history.

Use `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-candidates` for parent and
relationship pickers instead of downloading the project for client-side matching. `query` searches
the stable task key and title with literal wildcard handling; `topLevelOnly=true` restricts results
to valid parent candidates. The endpoint returns stable IDs, task keys, titles, `parent_task_id`, and
`child_count` plus exact `pageInfo`. `limit` defaults to 20, accepts at most 100, and works with a
zero-based `offset`. Archived tasks are excluded. The browser waits for two search characters before
calling it and asks for a narrower query when more matches exist. Key-date task linking uses the same
server search, keeps already-linked tasks visible while the query changes, and never relies on an
initial slice of the project backlog. Parent progress remains derived from child statuses and has no
writable percentage field.

```bash
curl --fail-with-body --get \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --data-urlencode "query=release evidence" \
  --data-urlencode "priority=high" \
  --data-urlencode "label=safety" \
  --data-urlencode "sort=dueDate" \
  --data-urlencode "direction=asc" \
  --data-urlencode "limit=100" \
  --data-urlencode "offset=0" \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/tasks"
```

## Edit a task comment safely

Create comments with `POST
/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/comments`. The response is the
created comment, including `row_version` and its initially empty `revisions` array. To edit your own
comment, send `PATCH .../tasks/{taskId}/comments/{commentId}` with the replacement `body`, the full
current `mentionedUserIds` set, and the last-read `rowVersion`:

```bash
curl --request PATCH \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"body":"Release approved with monitoring.","mentionedUserIds":[],"rowVersion":1}' \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/tasks/019…/comments/019…"
```

Only the original author can edit a comment; administrators cannot rewrite another member's text.
A stale `rowVersion` returns `TASK_COMMENT_VERSION_CONFLICT` (HTTP 409), unchanged content returns
`TASK_COMMENT_NO_CHANGES` (HTTP 400), and an archived or out-of-scope task/comment is not exposed.
Successful responses include the incremented version, `edited_at`, current mentions, and immutable
prior revisions. Personal API tokens require the `task.comment` scope.

## Page the review inbox

`GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/reviews/inbox` returns only discussions
that involve the authenticated member as reviewer, creator, or mentioned participant. The endpoint
preserves its legacy 200-item default, accepts `limit` from 1–200 and a zero-based `offset`, and reports the exact
matching `pageInfo.total` and `pageInfo.hasNext`. `query` is a literal, case-insensitive search across
the subject, record, table, reviewer, and latest message. Set `includeResolved=true` when historical
decisions should be included.

The response summary is intentionally independent of paging, search, and the resolved-history
toggle. The browser requests 50 items at a time. `summary.waitingForMe` is the exact number of open review requests assigned to the caller,
and `summary.openInvolved` is the exact number of open discussions involving the caller. Restart at
offset zero after a reply, decision, resolution, or reassignment because activity can reorder the
inbox. Personal API tokens require the `review.read` scope.

```bash
curl --fail-with-body --get \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --data-urlencode "query=calibration certificate" \
  --data-urlencode "limit=50" \
  --data-urlencode "offset=0" \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/reviews/inbox"
```

Create and attach an external traceability source to an existing task atomically with `POST
/tasks/{taskId}/external-links`. Only `title` and an HTTP(S) `url` are required; `provider` defaults
to the hostname, `observedOn` defaults to the current UTC date, and `externalId`, `version`, and
`notes` are optional. The task detail response exposes the resolved source metadata in `links` and
the immutable add/remove trail in `link_history`. Detach with `DELETE
/tasks/{taskId}/links/{linkId}`. Detaching never deletes the project source.

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"title":"Supplier qualification report","url":"https://supplier.example/reports/42","version":"Rev 4"}' \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/tasks/019…/external-links"
```

## Page through external materials

`GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/sources` returns external traceability
links in bounded pages. The default page size is 50 and `limit` accepts 1–200. Use the zero-based
`offset` and continue while `pageInfo.hasNext` is true. `pageInfo.total` is the exact number of
matching links, and `summary.providerCount` is the exact number of distinct source services in that
filtered lifecycle set.

`query` searches title, service, URL, external ID, version, and notes case-insensitively. `provider`
restricts results to one exact service name. `archiveState` accepts `active` (default), `archived`, or
`all`; it supersedes the legacy `includeArchived=true` flag. Results are ordered by most recently
updated and then stable ID. Restart at offset 0 after creating, editing, archiving, or restoring a
matching link.

```bash
curl --fail-with-body --get \
  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \
  --data-urlencode "query=qualification Rev 4" \
  --data-urlencode "provider=SharePoint" \
  --data-urlencode "limit=50" \
  --data-urlencode "offset=0" \
  "$ENGROVE_API_URL/api/v1/workspaces/w…/projects/p…/sources"
```

Create a source with `POST .../sources`, update it with `PATCH .../sources/{sourceId}`, and retain
the returned `row_version`. Updates require the last-read `rowVersion`; a concurrent edit or an
archived source returns HTTP 409 instead of overwriting newer metadata. The source contract accepts
HTTP(S) URLs only and keeps provider, external ID, version, observation date, and notes alongside
the link. Archive requests require a reason. Restore is intentionally bodyless because it only
changes lifecycle state. Every successful source mutation returns the complete current source.

## Publish charts and dashboards

Chart create and revision requests use one of four explicit version-1 configurations: `line`,
`scatter`, `histogram`, or `box_plot`. Each request pins one to eight ready dataset sources by stable
dataset ID and source key. Cartesian series, axes, filters, missing-data policy, histogram bins, and
box-plot grouping are described in the OpenAPI request union rather than accepted as an untyped
configuration object. Revisions are immutable; a successful create or revision returns the current
chart together with pinned sources and revision history.

Dashboard create and revision requests publish an immutable layout of at most 40 cards. OpenAPI
documents the chart, engineering KPI, task, and record-backed card variants, their versioned
configuration, and the 12-column layout coordinates. Cards cannot overlap or extend beyond the
grid. Archive and restore retain all published revisions. Integrations should use the returned
revision IDs when they need reproducible reporting rather than assuming the latest chart or layout.

## Create and decide record reviews

Create a record-scoped discussion or review request with `POST
.../object-types/{objectTypeId}/records/{recordId}/reviews`. `subject` and `body` are required; an
optional active `reviewerId` changes the thread from discussion to requested review, and up to 50
unique active members may be mentioned. Replies use `POST .../reviews/{threadId}/replies`.
Assigned reviewers record `approved` or `changes_requested` with a required rationale at `POST
.../reviews/{threadId}/decision`; resolving a completed discussion is a bodyless `PATCH
.../reviews/{threadId}/resolve`.

All review mutations return the complete current thread with participant display names, status,
decision state, timestamps, the newest bounded message page, and exact paging metadata. Clients can
therefore converge after a mutation without reconstructing Jira-style review state from local
optimistic assumptions. The generated request schemas are strict and include practical examples in
`/api/docs`.

## Operate notifications, workflows, and automations

Task responses include `visibility` as `project` or `restricted`. Create sensitive work with
`visibility: "restricted"` in the original `POST .../tasks` request so its content never enters the
project webhook outbox. Owners, administrators, and engineers can inspect or replace the policy at
`GET|PATCH .../tasks/{taskId}/visibility`. PATCH requires the last-read `rowVersion`, a complete
`userIds` array, and a complete `groupIds` array; selected IDs must resolve to active organization
subjects. `GET .../task-visibility-groups` provides the bounded active-group picker directory to
task clients without granting general member administration.

Restricted access applies equally to browser sessions and personal API tokens. An unauthorized
caller receives the same 404 contract as a missing task, and the task is omitted from collections,
search, counts, relationships, key-date progress, notifications, and flow reports. Integrations
must not cache a previously project-visible task after receiving a later 404.

Notification preferences are a complete replacement document at `PATCH
/api/v1/notifications/preferences`. The response echoes the stored policy, including the due-date
reminder interval. Mark-one and mark-all operations are bodyless and return `{ read: true }` or the
exact `{ updated }` count. This makes notification synchronization deterministic without requiring
clients to infer mutation results from an empty response.

Task automation create and update operations expose the full trigger, condition, and action schema
with practical examples. Successful writes return the current rule and its execution-health fields;
archive is bodyless and returns `{ archived: true }`. Workflow status archive, transition deletion,
saved-filter deletion, and key-date restore follow the same explicit acknowledgement pattern. Key
date create, update, and archive requests publish strict schemas, examples, idempotency, and row
version constraints.

Pilot onboarding and feedback APIs also publish stable contracts. Demo status and installation now
use one camel-case representation for both first installation and idempotent replay, avoiding a
retry-dependent response shape. `/health/live` and `/health/ready` expose JSON health models,
`/metrics` explicitly exposes Prometheus `text/plain`, and OIDC start/callback operations document
302 redirects and their `Location` headers instead of fictitious empty 200 responses.

## Rotate or revoke

Create a replacement token, update the external service, verify one successful request, and then
press the revoke icon twice on the old token. Revocation is immediate. Token creation and
revocation are audit events, and the token list records last use with a five-minute write throttle.
Password reset and fresh-install restore revoke every active personal API token.

Keep integrations purpose-specific, prefer read-only and a single workspace, use the shortest
practical expiry, and never put a token in source control, URLs, browser storage, or logs.
