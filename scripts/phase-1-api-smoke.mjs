import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const base = process.env.ENGROVE_TEST_API_URL ?? 'http://localhost:3000/api/v1';
const setupToken = 'engrove_setup_dev_only_token_32_chars';
const composeProject = process.env.ENGROVE_TEST_COMPOSE_PROJECT;

function expireToken(tokenId) {
  assert.ok(composeProject, 'ENGROVE_TEST_COMPOSE_PROJECT is required for expiry testing');
  assert.match(tokenId, /^[0-9a-f-]{36}$/);
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      composeProject,
      '-f',
      'deploy/compose/compose.yaml',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'engrove',
      '-d',
      'engrove',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `update security_tokens set expires_at = now() - interval '1 second' where id = '${tokenId}'`,
    ],
    { stdio: 'ignore' },
  );
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function storeCookies(response, jar) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  for (const value of values) {
    for (const name of ['engrove_session', 'engrove_csrf']) {
      const match = value.match(new RegExp(`(?:^|[, ]+)${name}=([^;]*)`));
      if (match?.[1]) jar[name] = match[1];
    }
  }
}

async function request(path, { jar = {}, method = 'GET', body, expected } = {}) {
  const headers = {};
  if (Object.keys(jar).length) headers.cookie = cookieHeader(jar);
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method) && jar.engrove_csrf) {
    headers['x-csrf-token'] = decodeURIComponent(jar.engrove_csrf);
  }
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  storeCookies(response, jar);
  const payload = await response.json().catch(() => ({}));
  if (expected === undefined) {
    assert.equal(
      response.ok,
      true,
      `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`,
    );
  } else {
    assert.equal(
      response.status,
      expected,
      `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

assert.equal((await request('/setup/status')).available, true);
await request('/setup', {
  method: 'POST',
  expected: 401,
  body: {
    token: 'x'.repeat(32),
    email: 'owner@example.com',
    displayName: 'Owner',
    password: 'Correct horse battery staple 1!',
  },
});

const setupBody = {
  token: setupToken,
  email: 'owner@example.com',
  displayName: 'Owner',
  password: 'Correct horse battery staple 1!',
};
const concurrent = await Promise.all([
  fetch(`${base}/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(setupBody),
  }),
  fetch(`${base}/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(setupBody),
  }),
]);
assert.deepEqual(
  concurrent.map((response) => response.status).sort(),
  [201, 404],
  'concurrent setup must create exactly one Owner',
);
assert.equal((await request('/setup/status')).available, false);
await request('/setup', { method: 'POST', expected: 404, body: setupBody });

const owner = {};
const signedIn = await request('/auth/sign-in', {
  jar: owner,
  method: 'POST',
  body: { email: setupBody.email, password: setupBody.password },
});
assert.equal(signedIn.user.role, 'owner');
assert.ok(owner.engrove_session && owner.engrove_csrf);

const workspace = await request('/workspaces', {
  jar: owner,
  method: 'POST',
  body: { name: 'Engineering', slug: 'engineering', description: 'Primary workspace' },
});
const project = await request(`/workspaces/${workspace.id}/projects`, {
  jar: owner,
  method: 'POST',
  body: { name: 'Characterization', key: 'CHAR', description: 'Pilot project' },
});

const updatedProject = await request(`/workspaces/${workspace.id}/projects/${project.id}`, {
  jar: owner,
  method: 'PATCH',
  body: {
    name: 'Characterization Program',
    description: 'Updated pilot project',
    status: 'active',
    rowVersion: project.rowVersion,
  },
});
await request(`/workspaces/${workspace.id}/projects/${project.id}`, {
  jar: owner,
  method: 'PATCH',
  expected: 409,
  body: {
    name: 'Stale update',
    description: '',
    status: 'active',
    rowVersion: project.rowVersion,
  },
});

const revokedInvitation = await request('/invitations', {
  jar: owner,
  method: 'POST',
  body: { email: 'revoked@example.com', role: 'viewer' },
});
const revokedInvitationToken = new URL(revokedInvitation.invitationUrl).searchParams.get('token');
await request(`/security-tokens/${revokedInvitation.tokenId}/revoke`, {
  jar: owner,
  method: 'POST',
  body: { reason: 'Smoke-test revocation' },
});
await request('/invitations/accept', {
  method: 'POST',
  expected: 400,
  body: {
    token: revokedInvitationToken,
    displayName: 'Revoked',
    password: 'Another correct battery staple 2!',
  },
});

const expiredInvitation = await request('/invitations', {
  jar: owner,
  method: 'POST',
  body: { email: 'expired@example.com', role: 'viewer' },
});
const expiredInvitationToken = new URL(expiredInvitation.invitationUrl).searchParams.get('token');
expireToken(expiredInvitation.tokenId);
await request('/invitations/accept', {
  method: 'POST',
  expected: 400,
  body: {
    token: expiredInvitationToken,
    displayName: 'Expired',
    password: 'Another correct battery staple 2!',
  },
});

const invitation = await request('/invitations', {
  jar: owner,
  method: 'POST',
  body: { email: 'viewer@example.com', role: 'viewer' },
});
const invitationToken = new URL(invitation.invitationUrl).searchParams.get('token');
const invited = await request('/invitations/accept', {
  method: 'POST',
  body: {
    token: invitationToken,
    displayName: 'Viewer',
    password: 'Another correct battery staple 2!',
  },
});
await request('/invitations/accept', {
  method: 'POST',
  expected: 400,
  body: {
    token: invitationToken,
    displayName: 'Viewer Again',
    password: 'Another correct battery staple 2!',
  },
});

await request(`/members/${invited.userId}/role`, {
  jar: owner,
  method: 'PATCH',
  body: { role: 'contributor' },
});
await request(`/members/${invited.userId}/role`, {
  jar: owner,
  method: 'PATCH',
  body: { role: 'viewer' },
});

const viewer = {};
await request('/auth/sign-in', {
  jar: viewer,
  method: 'POST',
  body: { email: 'viewer@example.com', password: 'Another correct battery staple 2!' },
});
await request(`/workspaces/${workspace.id}/projects/${project.id}`, {
  jar: viewer,
  method: 'PATCH',
  expected: 403,
  body: {
    name: 'Forbidden update',
    description: '',
    status: 'active',
    rowVersion: updatedProject.rowVersion,
  },
});

await request(`/workspaces/${workspace.id}/projects/${project.id}/archive`, {
  jar: owner,
  method: 'POST',
  body: { reason: 'Smoke test' },
});
await request(`/workspaces/${workspace.id}/projects/${project.id}/restore`, {
  jar: owner,
  method: 'POST',
  body: {},
});

const reset = await request('/auth/password-reset-tokens', {
  jar: owner,
  method: 'POST',
  body: { userId: invited.userId },
});
const resetToken = new URL(reset.resetUrl).searchParams.get('token');
await request('/auth/password-reset', {
  method: 'POST',
  body: { token: resetToken, password: 'Reset correct battery staple 3!' },
});

await request('/auth/sign-in', {
  jar: viewer,
  method: 'POST',
  body: { email: 'viewer@example.com', password: 'Reset correct battery staple 3!' },
});
const administrativelyRevokedViewerCookie = { ...viewer };
await request(`/members/${invited.userId}/revoke-sessions`, {
  jar: owner,
  method: 'POST',
  body: { reason: 'Smoke-test administrator revocation' },
});
await request('/auth/me', { jar: administrativelyRevokedViewerCookie, expected: 401 });
await request('/auth/me', { jar: viewer, expected: 401 });
await request('/auth/password-reset', {
  method: 'POST',
  expected: 400,
  body: { token: resetToken, password: 'Reset correct battery staple 3!' },
});

const audits = await request('/audit-events?limit=100', { jar: owner });
for (const action of [
  'setup.completed',
  'setup.rejected',
  'workspace.created',
  'project.created',
  'project.updated',
  'project.archived',
  'project.restored',
  'invitation.token_expired',
  'invitation.token_revoked',
  'membership.role_changed',
  'password_reset.token_used',
  'session.administrator_revoked',
]) {
  assert.ok(
    audits.items.some((event) => event.action === action),
    `missing audit action ${action}`,
  );
}

const retainedOwnerCookie = { ...owner };
await request('/auth/sign-out', { jar: owner, method: 'POST', body: {} });
await request('/auth/me', { jar: retainedOwnerCookie, expected: 401 });
console.log('Phase 1 API smoke test passed.');
