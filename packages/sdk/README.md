# `@engrove/sdk`

Dependency-free TypeScript client for Engrove's versioned REST API on Node.js 24. It provides typed
configurable-table and project-task operations. Keep personal API tokens in server-side
integrations; do not embed them in browser bundles.

```ts
import { EngroveClient } from '@engrove/sdk';

const engrove = new EngroveClient({
  baseUrl: process.env.ENGROVE_API_URL!,
  token: process.env.ENGROVE_API_TOKEN!,
});

const assets = engrove.table<{ status: string; serialNumber: string }>({
  workspaceId: 'w…',
  projectId: 'p…',
  tableId: 't…',
});

for await (const record of assets.records({ pageSize: 100 })) {
  console.log(record.displayName, record.values.status);
}
```

Project tasks use the same client, accept either the internal UUID or stable key such as `FORCE-6`,
and preserve Engrove's optimistic row-version contract:

```ts
const work = engrove.tasks({ workspaceId: 'w…', projectId: 'p…' });

const created = await work.create({
  title: 'Review force curve',
  priority: 'high',
  labels: ['validation'],
});

await work.move(created.data.task_key, {
  status: 'in_progress',
  rowVersion: created.data.row_version,
  placement: 'top',
});

for await (const task of work.all({ statuses: ['in_progress'], limit: 50 })) {
  console.log(task.task_key, task.title);
}
```

Task responses retain their documented JSON field names such as `task_key` and `row_version`, which
makes SDK values directly interchangeable with OpenAPI responses, webhook payload references, and
stored integration fixtures. Creation always carries one idempotency key; pass your own when a
business operation needs a stable retry identity. Version-checked update, move, bulk-update,
archive, and restore operations are never retried automatically.

Responses include the API payload plus `requestId`, `etag`, and parsed rate-limit metadata. Failures
throw `EngroveApiError` with a stable `code`, HTTP `status`, validation `details`, and request ID.

Safe reads (including POST-based table queries and exports) and mutations carrying an idempotency
key retry temporary network, `429`, `502`, `503`, and `504` failures. Ordinary
create/update/archive calls and bulk field updates are never retried automatically. Bulk-create
generates one idempotency key per invocation and reuses it across retry attempts.

The client accepts only relative `/api/v1/` paths and validates its base URL so a bearer token cannot
be redirected to an arbitrary origin through a malformed request path.
