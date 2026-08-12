# Project webhooks

Engrove can deliver project record and task changes to an external HTTPS endpoint. Configure endpoints in **Project settings → Project webhooks**. Project-wide endpoints can subscribe to any combination of:

- `record.created`
- `record.updated`
- `record.archived`
- `record.restored`
- `task.created`
- `task.updated`
- `task.archived`
- `task.restored`

An endpoint can be restricted to one engineering table, but table-scoped endpoints accept record events only. Task events require the project-wide scope.

Webhook management requires the `webhook.manage` permission and is unavailable to personal API tokens. The signing secret is shown only when an endpoint is created or its secret is rotated.

`GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/webhooks` accepts a `limit` from 1–100
(default 50) and a zero-based `offset`. Its `pageInfo` reports the exact endpoint total and whether a
later page remains; Project settings loads those later pages only when requested.

## Delivery contract

Engrove sends a versioned JSON payload. Stable envelope fields include `version`, `id`, `type`, `occurredAt`, `workspaceId`, `projectId`, `actorId`, and `data`. Record events also include `objectTypeId` and `recordId`; task events include `taskId`, with the latest task snapshot in `data.task`. Consumers must ignore unknown fields so compatible fields can be added later.

Every request includes:

- `X-Engrove-Event`: event type
- `X-Engrove-Delivery`: stable delivery ID
- `X-Engrove-Retry`: zero-based retry count (`0` on the first attempt)
- `X-Engrove-Timestamp`: Unix timestamp in seconds
- `X-Engrove-Signature`: `sha256=<hex HMAC>`

Verify the signature over `<timestamp>.<raw request body>` with HMAC-SHA256 before parsing or acting on the payload. Reject stale timestamps (five minutes is a reasonable default), compare signatures in constant time, and deduplicate by `X-Engrove-Delivery` or payload `id`.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const expected = createHmac('sha256', signingSecret)
  .update(`${timestamp}.${rawBody}`)
  .digest('hex');
const received = signature.replace(/^sha256=/, '');
const valid =
  expected.length === received.length &&
  timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
```

## Delivery and retry behavior

Record and task mutations and their outbox events commit in the same PostgreSQL transaction. The Node worker expands each event into idempotent endpoint deliveries. A `2xx` response is successful. Network errors, timeouts, `408`, `409`, `425`, `429`, and `5xx` responses retry after approximately 1 minute, 5 minutes, 30 minutes, 2 hours, and 12 hours; the fifth failed attempt becomes terminal. Other `4xx` responses fail immediately because repeating the same request is not expected to fix an authentication, authorization, validation, or missing-resource error.

Project settings shows the latest 50 deliveries per endpoint, including attempt count, response status, a bounded response snippet, the last error, and the next scheduled attempt. Use **Send test event** to queue a signed `webhook.test` payload without mutating a record or task. A terminal failed delivery can be queued for a fresh retry cycle after the receiver has been repaired; every manual retry is audited.

Engrove uses a 10-second request timeout and does not follow redirects. Delivery targets must use HTTPS. DNS is resolved before each request, the request is pinned to the checked address, and loopback, link-local, private, carrier-grade NAT, multicast, and IPv4-mapped IPv6 addresses are rejected to reduce server-side request forgery risk.

## Operations

- Rotate a signing secret if it is exposed, then update the consumer immediately.
- Send a test event after creating or changing the receiver configuration.
- Inspect the response and error details before manually retrying a terminal failure.
- Pause an endpoint before planned consumer downtime when retries are not useful.
- Alert on terminal failures and sustained queued delivery growth.
- Treat response snippets and endpoint URLs as operationally sensitive; access is limited to project managers.
- Make consumers idempotent. Delivery is at least once and a worker crash can cause a retry.
