import assert from 'node:assert/strict';

const apiOrigin = 'http://localhost:3000';
const apiCookies = new Map();
const keycloakCookies = new Map();

function storeCookies(response, jar) {
  for (const value of response.headers.getSetCookie?.() ?? [
    response.headers.get('set-cookie') ?? '',
  ]) {
    const match = value.match(/^([^=;,]+)=([^;]*)/);
    if (!match) continue;
    if (value.toLowerCase().includes('max-age=0') || match[2] === '') jar.delete(match[1]);
    else jar.set(match[1], match[2]);
  }
}

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function manual(url, options = {}) {
  const target = new URL(url);
  const jar = target.origin === apiOrigin ? apiCookies : keycloakCookies;
  const headers = new Headers(options.headers);
  if (jar.size) headers.set('cookie', cookieHeader(jar));
  const response = await fetch(target, { ...options, headers, redirect: 'manual' });
  storeCookies(response, jar);
  return response;
}

for (let attempt = 0; attempt < 90; attempt += 1) {
  try {
    const response = await fetch(
      'http://keycloak.localhost:8080/realms/engrove/.well-known/openid-configuration',
    );
    if (response.ok) break;
  } catch {
    // Keycloak's first development start may take several seconds.
  }
  if (attempt === 89) throw new Error('Keycloak did not become ready.');
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

const setup = await fetch(`${apiOrigin}/api/v1/setup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    token: 'engrove_setup_dev_only_token_32_chars',
    email: 'owner@example.com',
    displayName: 'Owner',
    password: 'Correct horse battery staple 1!',
  }),
});
assert.equal(setup.ok, true, await setup.text());

const status = await (await fetch(`${apiOrigin}/api/v1/auth/oidc/status`)).json();
assert.deepEqual(status, { enabled: true });

const start = await manual(`${apiOrigin}/api/v1/auth/oidc/start`);
assert.equal(start.status, 302);
let location = start.headers.get('location');
assert.ok(location?.includes('/realms/engrove/'));

let loginPage;
for (let redirects = 0; redirects < 10; redirects += 1) {
  const response = await manual(location);
  if (response.status < 300 || response.status >= 400) {
    loginPage = response;
    break;
  }
  location = new URL(response.headers.get('location'), location).href;
}
assert.ok(loginPage);
const html = await loginPage.text();
const action = html.match(/action="([^"]*login-actions\/authenticate[^"]*)"/)?.[1];
assert.ok(action, 'Keycloak login action was not found.');
const loginAction = action.replaceAll('&amp;', '&');
let response = await manual(loginAction, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    username: 'engineer',
    password: 'engrove-keycloak-development-only',
    credentialId: '',
  }),
});

for (
  let redirects = 0;
  redirects < 10 && response.status >= 300 && response.status < 400;
  redirects += 1
) {
  const next = new URL(response.headers.get('location'), response.url || loginAction);
  if (next.origin === 'http://localhost:4173') break;
  response = await manual(next);
}
assert.ok(apiCookies.has('engrove_session'), 'Engrove session cookie was not issued.');

const me = await manual(`${apiOrigin}/api/v1/auth/me`);
const meBody = await me.text();
assert.equal(me.ok, true, meBody);
const identity = JSON.parse(meBody);
assert.equal(identity.user.email, 'engineer@example.com');
assert.equal(identity.user.role, 'engineer');
console.log('Phase 7 Keycloak Authorization Code + PKCE sign-in passed.');
