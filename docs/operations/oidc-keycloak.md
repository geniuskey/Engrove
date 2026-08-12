# OIDC and Keycloak

Engrove uses Authorization Code flow with PKCE S256, state, nonce, issuer discovery, client authentication, and an HttpOnly short-lived signed state cookie. Successful OIDC authentication creates the same opaque PostgreSQL-backed Engrove session as local sign-in; provider tokens are not placed in browser storage. Every login requires the provider's standard `email_verified` claim to be the boolean `true`. The first verified login links the member by email, after which the immutable issuer and subject pair is used so an email-address change cannot silently relink the account.

When a browser session expires inside a protected page, Engrove returns the user to sign-in and
restores the exact internal path, query, and fragment after either local or OIDC authentication.
The return path is sealed into the short-lived OIDC state cookie, is limited to 2,048 characters,
and accepts only Engrove protected routes; absolute URLs, protocol-relative values, backslashes,
and authentication routes fall back to `/workspaces` to prevent open redirects and login loops.

Configuration supports issuer, client ID/secret, redirect URI, scopes, email/name claim mapping, allowed email domains, auto-provisioning, and the default provisioned role. Settings are all-or-none. Production requires HTTPS, and `OIDC_AUTO_PROVISION=false` is the recommended initial policy.

The development reference starts Keycloak 26.6.3 with a disposable realm, client, and engineer account:

```bash
docker compose -f deploy/compose/compose.yaml -f deploy/compose/keycloak.yaml \
  up --detach --build --wait
```

Complete Engrove Owner setup, then use “Continue with OIDC.” The reference login is `engineer` with the explicitly development-only password in `deploy/keycloak/realm-engrove.json`. The `keycloak.localhost` hostname lets both a local browser and the API container use one issuer. The API permits its HTTP issuer only outside production.

Do not deploy the reference realm or credentials in production. Create a confidential client in the operator-managed Keycloak, require Authorization Code and PKCE S256, disable direct access grants, set the exact HTTPS callback `/api/v1/auth/oidc/callback`, rotate the client secret independently, and restrict domains or pre-provision members before enabling OIDC. Validate issuer discovery and one full sign-in after rotations.
