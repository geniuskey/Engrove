# Observability

The API emits structured request logs with request IDs and redacts authorization, cookie, internal capability, database, object-storage, OIDC, and setup secrets. Forward container stdout to the operator's log system and retain audit events according to policy.

Endpoints:

- `/health/live` checks only the API process.
- `/health/ready` checks PostgreSQL, applied migrations, Redis, versioned object storage, a live Node worker heartbeat, and compatible Python CSV/XY parser capabilities. Dependency failures use stable codes without connection strings.
- `/metrics` exposes Prometheus text for HTTP count/latency/errors, durable jobs and leases, outbox count/lag, cleanup and staging expiry, maintenance duration, dataset parse duration, projection rebuilds, uploaded bytes, Community pilot feedback/repeat-user signals, and database pool usage.
- `/backups/reports/engrove-admin.prom` is a textfile metric output for backup, verify, and restore operations.

Keep readiness and metrics reachable by the orchestrator and monitoring network but not the public internet. Alert at minimum on readiness failure, an expired job lease, undispatched outbox growth/lag, failed jobs, maintenance exceeding its expected window, admin operation failure, and backup verification age. Dashboard labels deliberately normalize UUID paths to avoid unbounded metric cardinality.
