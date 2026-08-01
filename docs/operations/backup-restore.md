# Backup and restore

Engrove backup is a coordinated maintenance operation. It pauses business mutations and new job/outbox claims, drains running jobs and file finalization, dumps PostgreSQL, copies every exact committed object version, verifies size and SHA-256, and encrypts the manifest bundle with age. Redis is intentionally excluded because durable job and outbox state lives in PostgreSQL.

## Key preparation

Generate the identity on an operator-controlled host and keep it outside the application configuration:

```bash
docker compose --env-file /etc/engrove/production.env \
  -f deploy/compose/compose.yaml -f deploy/compose/compose.production.yaml \
  run --rm --no-deps --entrypoint age-keygen admin \
  -o /backups/identities/engrove-backup.txt
```

Move the identity to the read-only `BACKUP_IDENTITY_DIR`, record the public recipient printed by `age-keygen` as `BACKUP_RECIPIENT`, and store an offline recovery copy. Never place the identity in `.env`, an API request, an image, or the backup itself.

## Create and verify

```bash
docker compose --env-file /etc/engrove/production.env \
  -f deploy/compose/compose.yaml -f deploy/compose/compose.production.yaml \
  run --rm admin create /backups/engrove-$(date -u +%Y%m%dT%H%M%SZ).tar.age

docker compose --env-file /etc/engrove/production.env \
  -f deploy/compose/compose.yaml -f deploy/compose/compose.production.yaml \
  run --rm -e BACKUP_IDENTITY=/identities/engrove-backup.txt \
  admin verify /backups/engrove-YYYYMMDDTHHMMSSZ.tar.age
```

Creation writes an outer `.sha256`, a JSON operation report, and `engrove-admin.prom` under `/backups/reports`. A success report includes application, migration and format versions, database checksum, object count, bytes, and duration. Production rejects `--development-plaintext`; that switch exists only for explicit local testing.

Copy both the encrypted bundle and checksum off site. Test `verify` regularly and alert on non-zero command exit, a failed drain, or a failure report.

## Restore

Restore only into a fresh supported installation with no users, workspaces, or projects. The command refuses a populated target.

```bash
# Start only fresh durable dependencies and create the versioned bucket.
docker compose --env-file /etc/engrove/production.env \
  -f deploy/compose/compose.yaml -f deploy/compose/compose.production.yaml \
  up --detach postgres minio storage-init

docker compose --env-file /etc/engrove/production.env \
  -f deploy/compose/compose.yaml -f deploy/compose/compose.production.yaml \
  run --rm -e BACKUP_IDENTITY=/identities/engrove-backup.txt \
  admin restore /backups/engrove-YYYYMMDDTHHMMSSZ.tar.age

docker compose --env-file /etc/engrove/production.env \
  -f deploy/compose/compose.yaml -f deploy/compose/compose.production.yaml \
  up --detach --wait migrate redis worker-python worker-node api web
```

Restore validates the outer checksum, age envelope, manifest, PostgreSQL custom dump, supported application/PostgreSQL versions, and every bundled object before changing the target. It uploads each object to its exact application key, captures the destination version ID, re-reads that version, verifies size and SHA-256, and remaps only matching restored metadata while maintenance triggers are disabled in a transaction.

All restored browser sessions, unused invitations and password reset tokens, and the setup token are revoked. Interrupted running attempts are failed; their jobs are queued with a new outbox event so the Node reconciler can deliver them again. A successful report records revoked session/token counts and reconciled jobs. If a failure occurs after database modification begins, restore leaves a leased `restore` maintenance row in place. Inspect the failure report and target before clearing it; do not expose a partially restored installation.

After restore, use newly supplied application, database, object-storage, internal, and OIDC secrets. Confirm readiness, sign in again, inspect the restore report, and exercise raw-file download, dataset preview, and chart source traceability.
