import assert from 'node:assert/strict';

const api = 'http://localhost:3000/api/v1';
const jar = {};

function cookieHeader() {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function storeCookies(response) {
  for (const value of response.headers.getSetCookie?.() ?? [
    response.headers.get('set-cookie') ?? '',
  ]) {
    for (const name of ['engrove_session', 'engrove_csrf']) {
      const match = value.match(new RegExp(`(?:^|[, ]+)${name}=([^;]*)`));
      if (match?.[1]) jar[name] = match[1];
    }
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (Object.keys(jar).length) headers.cookie = cookieHeader();
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  storeCookies(response);
  const payload = await response.json();
  assert.equal(response.ok, true, `${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

await request('/auth/sign-in', {
  method: 'POST',
  body: { email: 'owner@example.com', password: 'Correct horse battery staple 1!' },
});
const workspaces = await request('/workspaces');
assert.ok(workspaces.items.length >= 2);
const primary = workspaces.items.find((workspace) => workspace.slug === 'primary');
assert.ok(primary);
const projects = await request(`/workspaces/${primary.id}/projects`);
assert.ok(projects.items.some((project) => project.key === 'ALPHA'));
console.log('Phase 7 restored golden-flow read passed.');
