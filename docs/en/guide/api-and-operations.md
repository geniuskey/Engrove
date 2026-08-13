---
description: An overview of the Engrove REST API, TypeScript SDK, webhooks, and self-hosting boundaries.
title: API and operations
---

# API and operations

Engrove's browser application uses the same REST API, permissions, and integrity rules as integrations. Stable
identifiers and explicit version contracts are available outside the UI.

## API surface

- Versioned routes below `/api/v1`
- OpenAPI documentation with executable request and response schemas
- Personal API tokens with scoped capabilities and expiration
- Bounded list APIs with search and pagination metadata
- Idempotency keys for safe creation retries
- Row versions that prevent update conflicts
- Request IDs, ETags, and quota headers

Choose only the required capabilities when creating a token. Browser session cookies and API tokens have different
purposes and security boundaries.

## TypeScript SDK

`@engrove/sdk` is a typed client with no runtime dependencies. It can page through records and project work and
supports create, update, batch changes, archive, restore, comments, and ranking.

```ts
import { EngroveClient } from '@engrove/sdk';

const engrove = new EngroveClient({
  baseUrl: 'https://engrove.example.com',
  token: process.env.ENGROVE_TOKEN!,
});

const tasks = engrove.tasks({ projectId, workspaceId });
for await (const task of tasks.all({ status: 'in_progress' })) {
  console.log(task.task_key, task.title);
}
```

The SDK automatically retries only creations that retain the same idempotency key. A stale update must read the
latest state, be reviewed, and be submitted again explicitly.

## Webhooks

Project webhooks send record and work changes to external systems. A secret is shown only when created or rotated,
and every request contains an HMAC signature. Delivery history exposes failure causes and retry state.

## Self-hosted topology

| Component             | Responsibility                                                |
| --------------------- | ------------------------------------------------------------- |
| Web                   | React static application and security headers                 |
| API                   | Authentication, permissions, domain transactions, and OpenAPI |
| Node worker           | Webhooks, exports, notifications, and durable jobs            |
| Python worker         | Dataset parsing and scientific computation                    |
| PostgreSQL            | Source data, history, work state, and outbox                  |
| Redis                 | Job queues and runtime coordination                           |
| S3-compatible storage | File versions and derived artifacts                           |

The production model assumes non-root read-only containers, separated database roles, scoped storage credentials,
private internal ports, and a TLS reverse proxy.

## Operational baseline

- Validate environment and Compose configuration without printing secrets.
- Provide liveness, readiness, Prometheus metrics, and structured logs.
- Use checksummed fresh-install backup and restore archives encrypted with age.
- Support OIDC Authorization Code with PKCE while optionally retaining local authentication for recovery.
- Run formatting, typing, tests, accessibility, vulnerability, and bundle-budget gates before release.

Local API documentation is served at `http://localhost:3000/api/docs`. See the repository's operations documents
for detailed deployment, security, backup, OIDC, observability, and webhook contracts.
