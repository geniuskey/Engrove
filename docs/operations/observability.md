# Observability

The API emits structured request logs with request IDs and redacts authorization, cookie, internal capability, database, object-storage, OIDC, and setup secrets. Forward container stdout to the operator's log system and retain audit events according to policy.

Endpoints:

- `/health/live` checks only the API process.
- `/health/ready` checks PostgreSQL, applied migrations, Redis, versioned object storage, a live Node worker heartbeat, and compatible Python CSV/XY parser capabilities. Dependency failures use stable codes without connection strings.
- `/metrics` exposes Prometheus text for HTTP count/latency/errors, authenticated browser render failures, durable jobs and leases, outbox count/lag, webhook pending/failure/lag, unread task-notification count/age, cleanup and staging expiry, maintenance duration, dataset parse duration, projection rebuilds, uploaded bytes, Community pilot feedback/repeat-user signals, and database pool usage.
- `/backups/reports/engrove-admin.prom` is a textfile metric output for backup, verify, and restore operations.

Keep readiness and metrics reachable by the orchestrator and monitoring network but not the public internet. Alert at minimum on readiness failure, a sustained increase in `engrove_client_render_errors_total`, an expired job lease, undispatched outbox growth/lag, terminal webhook delivery failures or lag, failed jobs, sustained unread-notification growth, maintenance exceeding its expected window, admin operation failure, and backup verification age. Dashboard labels deliberately normalize UUID paths to avoid unbounded metric cardinality.

An authenticated browser that reaches the application error boundary sends `POST
/api/v1/client-errors`. The server logs one structured `client_render_error` event with the error
reference shown to the user, stable error kind and name, internal pathname, React component stack,
actor, organization, and server request ID. The contract deliberately excludes error messages,
query strings, fragments, user-entered values, full URLs, and JavaScript error stacks. Delivery is
best effort and must never prevent the local recovery screen from rendering.
