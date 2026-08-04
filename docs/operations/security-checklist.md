# Production security checklist

Before launch:

- [ ] Public UI, API, OIDC issuer/callback, and browser-facing object storage use HTTPS; infrastructure ports and `/metrics` are private.
- [ ] `ENGROVE_TRUST_PROXY` contains only the edge proxy IP/network, the edge replaces untrusted forwarded-address headers, and no catch-all network is trusted.
- [ ] Every example credential is replaced with an independently generated secret; `.env` is mode `0600`, excluded from backups, and stored outside the repository.
- [ ] Migration, API runtime, Node worker, and backup database roles are separate and non-superuser; the Python worker has no database URL.
- [ ] MinIO root credentials are operator-only; services use the scoped `engrove-app` user and bucket versioning is enabled.
- [ ] Runtime images are built from the reviewed lockfiles, run non-root/read-only with dropped capabilities, and contain no secret build arguments or copied `.env` files.
- [ ] First-run setup is completed once and the setup token is removed or rotated; local Owner credentials and recovery procedures are tested.
- [ ] OIDC uses a confidential client, exact redirect URI, PKCE S256, a boolean `email_verified=true` claim, restricted domains or pre-provisioned users, least-privilege default role, and a tested secret-rotation procedure.
- [ ] Session cookies are Secure/HttpOnly/SameSite as designed; the edge preserves request IDs and does not log cookies, authorization headers, reset URLs, or upload query signatures.
- [ ] Upload size/type rules, committed-prefix isolation, exact-version checksum verification, and storage cleanup dry-run are exercised with the deployment's object store.
- [ ] An age identity is offline and separate from the recipient/config; encrypted backup, independent verify, fresh-install restore, and post-restore re-login have been tested.
- [ ] Readiness, metrics, structured logs, audit retention, backup age, failed jobs, outbox lag, and maintenance duration have alerts and owners.
- [ ] PostgreSQL, Redis, MinIO, Keycloak, base images, and Engrove releases have a documented patch cadence; upgrades begin with a verified backup.
- [ ] The AGPL license, privacy/retention policy, vulnerability reporting path, and administrator access review are documented for users.
