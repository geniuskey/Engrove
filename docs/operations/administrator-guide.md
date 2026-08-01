# Community administrator guide

This guide covers the routine duties of an Engrove Community Owner or Admin. Complete the production security checklist and keep a tested encrypted backup before every upgrade.

## First installation

1. Deploy the reviewed release and run the one-shot migration service.
2. Open the one-time setup URL and create the first Owner. Remove any configured setup token afterward.
3. Create a workspace and project. Open the project and use **Install template & demo** to verify storage, workers, immutable dataset processing, chart provenance, and task links.
4. Archive the clearly labelled synthetic demo records when the evaluation is complete.
5. Configure OIDC if required, then invite users with the least role needed.

The Test & Characterization template has the stable key `test-characterization`. Version 6 is the completed Community pilot schema. Installation and upgrades are transactional and idempotent; user-modified display names are preserved, user values are never replaced, and incompatible key/type conflicts stop with `TEMPLATE_SCHEMA_CONFLICT`.

## Roles and users

- Owner and Admin manage members, audit data, schemas, and pilot reporting.
- Engineer manages project schemas, engineering definitions, data lifecycle, dashboards, and tasks.
- Contributor enters records, uploads evidence, creates datasets and tasks, but cannot change schemas.
- Viewer has read-only engineering access. Every signed-in role can save personal onboarding progress and submit pilot feedback.

Invitation and password-reset URLs contain single-use secrets. Deliver them through an approved private channel, revoke unused invitations, disable departing users promptly, and review `auth.*`, membership, archive, and restore events in Audit.

## Daily and weekly checks

- Keep `/health/ready` green and alert on worker heartbeat, database, Redis, object-storage, and parser compatibility failures.
- Scrape the private `/metrics` endpoint and watch failed jobs, outbox lag, expired staging uploads, reconciliation, database pool pressure, and dataset duration.
- Review **Pilot** for submitted feedback and adoption signals. Counts are operational evidence, not proof that the field-pilot success criteria have been met.
- Confirm recent raw-file downloads and chart-to-dataset provenance links still resolve exact immutable versions.
- Investigate failed jobs before retrying; do not edit ready datasets, available file metadata, revision history, or append-only engineering results in PostgreSQL.

## Backup, restore, and upgrades

Create an age-encrypted backup on a schedule and copy its identity to a separate protected system. Regularly run `verify`; periodically restore into fresh PostgreSQL and object-storage volumes and complete a golden-flow read. A successful command produces a JSON operation report and textfile metrics.

Before an upgrade, verify a backup, inspect the new SQL migration, apply it through `migrate`, replace services, and check readiness, sign-in, dataset processing, exact source download, chart provenance, and a task link. Never downgrade a database in place.

Detailed procedures: [self-hosting](self-hosting.md), [backup and restore](backup-restore.md), [observability](observability.md), [OIDC and Keycloak](oidc-keycloak.md), and [security checklist](security-checklist.md).
