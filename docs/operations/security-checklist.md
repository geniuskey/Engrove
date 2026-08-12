# Production security checklist

Run the automated subset before every installation or upgrade:

```bash
pnpm production:preflight -- --env-file /etc/engrove/production.env
```

It verifies environment-file permissions, public HTTPS endpoints, explicit proxy trust, credential
strength and separation, OIDC provisioning boundaries, age backup configuration, rendered Compose
ports, runtime hardening, database-role separation, and Python-worker isolation. A passing result is
necessary but does not replace the deployment-specific ownership, alerting, recovery, privacy, and
access-review items below.

Before launch:

- [ ] Public UI, API, OIDC issuer/callback, and browser-facing object storage use HTTPS; infrastructure ports and `/metrics` are private.
- [ ] The edge preserves Engrove's CSP, HSTS, `nosniff`, frame-denial, referrer, permissions, private API revalidation, mutation/diagnostic `no-store`, and immutable fingerprinted-asset cache headers; missing `/assets/*` paths remain `404` rather than falling back to HTML.
- [ ] `ENGROVE_TRUST_PROXY` contains only the edge proxy IP/network, the edge replaces untrusted forwarded-address headers, and no catch-all network is trusted.
- [ ] Every example credential is replaced with an independently generated secret; `.env` is mode `0600`, excluded from backups, and stored outside the repository.
- [ ] Migration, API runtime, Node worker, and backup database roles are separate and non-superuser; the Python worker has no database URL.
- [ ] MinIO root credentials are operator-only; services use the scoped `engrove-app` user and bucket versioning is enabled.
- [ ] Runtime images are built from the reviewed lockfiles, run non-root/read-only with dropped capabilities, and contain no secret build arguments or copied `.env` files.
- [ ] First-run setup is completed once; a supplied setup token is unique and at least 32 characters, or the generated one-time setup URL is captured securely; the token is removed or rotated afterward, and local Owner credentials and recovery procedures are tested.
- [ ] OIDC uses a confidential client, exact redirect URI, PKCE S256, a boolean `email_verified=true` claim, restricted domains or pre-provisioned users, least-privilege default role, and a tested secret-rotation procedure.
- [ ] Session cookies are Secure/HttpOnly/SameSite as designed; the edge preserves request IDs and does not log cookies, authorization headers, reset URLs, or upload query signatures.
- [ ] Personal API tokens are purpose-named, workspace-scoped where possible, short-lived, stored in a secret manager, reviewed by last-use date, and rotated before revocation; no token appears in source, URLs, browser storage, or logs.
- [ ] Public view links have an owner and review date, expose only intended visible columns and saved filters, use passwords or expiry for sensitive scopes, keep CSV disabled unless required, and are rotated or revoked after their purpose ends; edge and analytics logs never record `/share/` tokens or `x-engrove-share-access`.
- [ ] Webhook endpoints, signing-secret rotation, terminal delivery failures, and outbound destination policy have owners and alerts.
- [ ] Upload size/type rules, committed-prefix isolation, exact-version checksum verification, and storage cleanup dry-run are exercised with the deployment's object store.
- [ ] An age identity is offline and separate from the recipient/config; encrypted backup, independent verify, fresh-install restore, and post-restore re-login have been tested.
- [ ] Readiness, metrics, structured logs, audit retention, backup age, failed jobs, outbox lag, and maintenance duration have alerts and owners.
- [ ] PostgreSQL, Redis, MinIO, Keycloak, base images, and Engrove releases have a documented patch cadence; upgrades begin with a verified backup.
- [ ] The AGPL license, privacy/retention policy, vulnerability reporting path, and administrator access review are documented for users.
