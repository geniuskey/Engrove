# Self-hosting Engrove Community

## Development installation

Install the versions pinned in the repository, copy `.env.example` to `.env`, and run:

```bash
corepack enable
pnpm install --frozen-lockfile
uv sync --project apps/worker-python --locked
docker compose --env-file .env -f deploy/compose/compose.yaml up --detach --build --wait
```

Open `http://localhost:4173`, complete first-run Owner setup, and confirm `http://localhost:3000/health/ready` reports every dependency as `ok`. The default Compose file exposes database, Redis, and MinIO ports and uses development-only credentials; it is not a production configuration.

## Production installation

The production overlay is intended for a new installation. It creates separate migration, API runtime, Node worker, and backup PostgreSQL roles only while initializing a fresh PostgreSQL volume. Do not attach it to a volume initialized with the development Compose configuration.

1. Copy `deploy/compose/production.env.example` outside the repository to a mode `0600` file and fill every required blank with an independently generated secret. Use an age recipient whose private identity is stored separately.
2. Set `ENGROVE_PUBLIC_URL`, `VITE_API_BASE_URL`, and `S3_PUBLIC_ENDPOINT` to public HTTPS URLs. Set `ENGROVE_TRUST_PROXY` to the explicit IP address or CIDR of the reverse proxy network that connects to `api:3000`; multiple entries are comma-separated. Never use a public catch-all such as `0.0.0.0/0`. If OIDC is enabled, all four core OIDC settings must be present and its issuer and redirect URI must use HTTPS.
3. Create the backup and identity directories. The backup directory must be writable by the `postgres` user in the admin image; the identity directory is mounted read-only.
4. Run the production preflight before creating resources:

```bash
pnpm production:preflight -- --env-file /etc/engrove/production.env
```

The command reads the file without executing it, requires mode `0600`, rejects local/example HTTP
hosts, catch-all proxy trust, short, placeholder, or reused secrets, unsafe OIDC auto-provisioning,
and missing age backup encryption. It renders the base and production Compose files with the admin
profile and verifies private infrastructure ports, separate database roles, read-only application
containers, dropped capabilities, `no-new-privileges`, and the Python worker credential boundary.
It prints variable names and corrective guidance but never prints secret values.

`ENGROVE_SETUP_TOKEN` may remain empty so the API prints a generated one-time setup URL at first
startup. When an operator supplies the token, the preflight requires at least 32 characters and
prevents reuse of another service credential.

5. Start the installation:

```bash
docker compose --env-file /etc/engrove/production.env \
  -f deploy/compose/compose.yaml \
  -f deploy/compose/compose.production.yaml up --detach --build --wait
```

The overlay publishes no container ports. Join an operator-managed TLS reverse proxy to the Compose network and route the public UI to `web:4173`, API and health paths to `api:3000`, and the object-storage hostname to `minio:9000`. Configure the edge to replace, rather than append untrusted values to, `X-Forwarded-For`; Engrove only accepts forwarded addresses from `ENGROVE_TRUST_PROXY`. Keep PostgreSQL, Redis, the MinIO console, `/metrics`, and both workers private. If object storage is external, replace the MinIO services and preserve bucket versioning plus exact-version reads.

Preserve the origin servers' response headers at the edge. The web service sends a restrictive CSP,
frame denial, `nosniff`, referrer and permissions policies; the API sends the same non-CSP browser
defenses and production HSTS. Fingerprinted `/assets/*` files are immutable for one year while HTML
is revalidated. Missing asset paths return `404`, and only `GET` and `HEAD` are accepted. Versioned
API reads are private, use ETags, and require revalidation; mutations and diagnostics are `no-store`.
Expose `ETag` to the configured browser origin. Preserve or strengthen HSTS at the TLS edge after
confirming every public subdomain is HTTPS-only.

The first migration applies reviewed SQL and grants least-privilege access to the runtime roles. The Python worker receives no database or object-storage credentials: the Node worker supplies short-lived, exact-object download and upload URLs. Dataset input is limited to 100 MiB and is streamed through the disk-backed `worker-python-scratch` volume instead of being copied through memory as base64 JSON. Monitor that volume's free space; stale per-job directories are removed when the worker starts. Runtime containers are non-root, read-only, capability-free, and use `no-new-privileges` in the production overlay.

## Upgrades

Create and verify an encrypted backup first. Pull the reviewed release, inspect new migrations and
release notes, rerun `production:preflight` against the retained environment file, build images, run
the one-shot `migrate` service, then replace application services. Application startup never
performs schema push. Check readiness, `/metrics`, a sign-in, and an exact dataset/chart source read
after each upgrade.

Do not downgrade a database. Restore the pre-upgrade backup into a fresh supported installation when rollback is required.

See the [administrator guide](administrator-guide.md), [pilot guide](pilot-guide.md), [backup and restore](backup-restore.md), [OIDC and Keycloak](oidc-keycloak.md), [observability](observability.md), and the [production security checklist](security-checklist.md).
