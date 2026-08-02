import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const base = process.env.ENGROVE_TEST_API_URL ?? 'http://localhost:3000/api/v1';
const composeProject = process.env.ENGROVE_TEST_COMPOSE_PROJECT;
assert.ok(composeProject);

function cookies(jar) {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function storeCookies(response, jar) {
  for (const value of response.headers.getSetCookie?.() ?? [
    response.headers.get('set-cookie') ?? '',
  ]) {
    for (const name of ['engrove_session', 'engrove_csrf']) {
      const match = value.match(new RegExp(`(?:^|[, ]+)${name}=([^;]*)`));
      if (match?.[1]) jar[name] = match[1];
    }
  }
}

async function request(path, { jar = {}, method = 'GET', body, headers = {}, expected } = {}) {
  const requestHeaders = { ...headers };
  if (Object.keys(jar).length) requestHeaders.cookie = cookies(jar);
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method) && jar.engrove_csrf) {
    requestHeaders['x-csrf-token'] = decodeURIComponent(jar.engrove_csrf);
  }
  const response = await fetch(`${base}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  storeCookies(response, jar);
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (expected === undefined) {
    assert.equal(
      response.ok,
      true,
      `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`,
    );
  } else assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload;
}

function composeExec(service, ...command) {
  return execFileSync(
    'docker',
    [
      'compose',
      '-p',
      composeProject,
      '-f',
      'deploy/compose/compose.yaml',
      'exec',
      '-T',
      service,
      ...command,
    ],
    { encoding: 'utf8' },
  );
}

await request('/setup', {
  method: 'POST',
  body: {
    token: 'engrove_setup_dev_only_token_32_chars',
    email: 'owner@example.com',
    displayName: 'Owner',
    password: 'Correct horse battery staple 1!',
  },
});
const owner = {};
await request('/auth/sign-in', {
  jar: owner,
  method: 'POST',
  body: { email: 'owner@example.com', password: 'Correct horse battery staple 1!' },
});

const workspaceA = await request('/workspaces', {
  jar: owner,
  method: 'POST',
  body: { name: 'Primary', slug: 'primary' },
});
const projectA = await request(`/workspaces/${workspaceA.id}/projects`, {
  jar: owner,
  method: 'POST',
  body: { name: 'Alpha', key: 'ALPHA' },
});
const workspaceB = await request('/workspaces', {
  jar: owner,
  method: 'POST',
  body: { name: 'Isolation', slug: 'isolation' },
});
const projectB = await request(`/workspaces/${workspaceB.id}/projects`, {
  jar: owner,
  method: 'POST',
  body: { name: 'Beta', key: 'BETA' },
});
const prefixA = `/workspaces/${workspaceA.id}/projects/${projectA.id}`;
const prefixB = `/workspaces/${workspaceB.id}/projects/${projectB.id}`;

const sample = await request(`${prefixA}/object-types`, {
  jar: owner,
  method: 'POST',
  body: { name: 'Sample', pluralName: 'Samples', key: 'custom-sample', icon: 'flask' },
});
const label = await request(`${prefixA}/object-types/${sample.id}/fields`, {
  jar: owner,
  method: 'POST',
  body: { name: 'Label', key: 'label', fieldType: 'text', required: true },
});
const serial = await request(`${prefixA}/object-types/${sample.id}/fields`, {
  jar: owner,
  method: 'POST',
  body: { name: 'Serial', key: 'serial', fieldType: 'decimal', unique: true },
});
const received = await request(`${prefixA}/object-types/${sample.id}/fields`, {
  jar: owner,
  method: 'POST',
  body: { name: 'Received', key: 'received', fieldType: 'date' },
});

const reviewViewConfig = {
  visibleFieldIds: [label.id, serial.id],
  fieldWidths: { [label.id]: 224, [serial.id]: 160 },
  filters: [{ fieldId: serial.id, operator: 'gte', value: '10' }],
  sorts: [{ fieldId: serial.id, direction: 'desc' }],
  rowDensity: 'compact',
  pageSize: 25,
};
const reviewView = await request(`${prefixA}/object-types/${sample.id}/views`, {
  jar: owner,
  method: 'POST',
  body: { name: 'Review queue', config: reviewViewConfig },
});
assert.equal(reviewView.rowVersion, 1);
assert.deepEqual(
  (await request(`${prefixA}/object-types/${sample.id}/views`, { jar: owner })).items.map(
    (view) => view.id,
  ),
  [reviewView.id],
);
await request(`${prefixA}/object-types/${sample.id}/views`, {
  jar: owner,
  method: 'POST',
  expected: 409,
  body: { name: 'review QUEUE', config: reviewViewConfig },
});
const updatedReviewView = await request(
  `${prefixA}/object-types/${sample.id}/views/${reviewView.id}`,
  {
    jar: owner,
    method: 'PATCH',
    body: {
      name: 'Priority review',
      config: { ...reviewViewConfig, rowDensity: 'comfortable', pageSize: 50 },
      rowVersion: reviewView.rowVersion,
    },
  },
);
assert.equal(updatedReviewView.rowVersion, 2);
assert.equal(updatedReviewView.config.rowDensity, 'comfortable');
await request(`${prefixA}/object-types/${sample.id}/views/${reviewView.id}`, {
  jar: owner,
  method: 'PATCH',
  expected: 409,
  body: { name: 'Stale update', config: reviewViewConfig, rowVersion: reviewView.rowVersion },
});
await request(`${prefixB}/object-types/${sample.id}/views`, { jar: owner, expected: 404 });

const container = await request(`${prefixA}/object-types`, {
  jar: owner,
  method: 'POST',
  body: { name: 'Container', pluralName: 'Containers', key: 'container', icon: 'box' },
});
const sampleRelation = await request(`${prefixA}/object-types/${container.id}/fields`, {
  jar: owner,
  method: 'POST',
  body: {
    name: 'Sample',
    key: 'sample',
    fieldType: 'relation',
    config: { targetObjectTypeId: sample.id, multiple: false },
  },
});

const record10 = await request(`${prefixA}/object-types/${sample.id}/records`, {
  jar: owner,
  method: 'POST',
  body: { displayName: 'Ten', values: { label: 'Zulu', serial: '10.0', received: '2026-02-10' } },
});
const record2 = await request(`${prefixA}/object-types/${sample.id}/records`, {
  jar: owner,
  method: 'POST',
  body: { displayName: 'Two', values: { label: 'Alpha', serial: '2', received: '2025-01-01' } },
});
const record100 = await request(`${prefixA}/object-types/${sample.id}/records`, {
  jar: owner,
  method: 'POST',
  body: {
    displayName: 'Hundred',
    values: { label: 'Mike', serial: '100', received: '2027-01-01' },
  },
});
await request(`${prefixA}/object-types/${sample.id}/records`, {
  jar: owner,
  method: 'POST',
  expected: 409,
  body: { displayName: 'Duplicate', values: { label: 'Duplicate', serial: '2.00' } },
});

const numericOrder = await request(`${prefixA}/object-types/${sample.id}/records/query`, {
  jar: owner,
  method: 'POST',
  body: { sorts: [{ fieldId: serial.id, direction: 'asc' }], page: 1, pageSize: 2 },
});
assert.deepEqual(
  numericOrder.items.map((record) => record.displayName),
  ['Two', 'Ten'],
);
assert.equal(numericOrder.total, 3);
const numericPage2 = await request(`${prefixA}/object-types/${sample.id}/records/query`, {
  jar: owner,
  method: 'POST',
  body: { sorts: [{ fieldId: serial.id, direction: 'asc' }], page: 2, pageSize: 2 },
});
assert.deepEqual(
  numericPage2.items.map((record) => record.displayName),
  ['Hundred'],
);
const numericFilter = await request(`${prefixA}/object-types/${sample.id}/records/query`, {
  jar: owner,
  method: 'POST',
  body: {
    filters: [{ fieldId: serial.id, operator: 'gt', value: '9' }],
    sorts: [{ fieldId: received.id, direction: 'asc' }],
  },
});
assert.deepEqual(
  numericFilter.items.map((record) => record.displayName),
  ['Ten', 'Hundred'],
);
const textOrder = await request(`${prefixA}/object-types/${sample.id}/records/query`, {
  jar: owner,
  method: 'POST',
  body: { sorts: [{ fieldId: label.id, direction: 'asc' }] },
});
assert.deepEqual(
  textOrder.items.map((record) => record.displayName),
  ['Two', 'Hundred', 'Ten'],
);
const grouped = await request(`${prefixA}/object-types/${sample.id}/records/query`, {
  jar: owner,
  method: 'POST',
  body: { groupByFieldId: label.id },
});
assert.ok(grouped.groups.some((group) => group.value === 'Alpha' && group.count === 1));

await request(`${prefixA}/object-types/${sample.id}/views/${reviewView.id}/archive`, {
  jar: owner,
  method: 'POST',
  body: { rowVersion: updatedReviewView.rowVersion, reason: 'View lifecycle test' },
});
assert.equal(
  (await request(`${prefixA}/object-types/${sample.id}/views`, { jar: owner })).items.length,
  0,
);

const linked = await request(`${prefixA}/object-types/${container.id}/records`, {
  jar: owner,
  method: 'POST',
  body: {
    displayName: 'Tray A',
    values: {},
    relations: { [sampleRelation.id]: [record2.id] },
  },
});
await request(`${prefixA}/object-types/${sample.id}/records/${record2.id}/archive`, {
  jar: owner,
  method: 'POST',
  body: { reason: 'Lifecycle test' },
});
await request(`${prefixA}/object-types/${sample.id}/records/${record2.id}/restore`, {
  jar: owner,
  method: 'POST',
  body: {},
});
assert.deepEqual(
  (await request(`${prefixA}/object-types/${container.id}/records/${linked.id}`, { jar: owner }))
    .relations[sampleRelation.id],
  [record2.id],
);

await request(`${prefixB}/object-types/${sample.id}/fields`, { jar: owner, expected: 404 });
await request(`${prefixB}/object-types/${sample.id}/records/${record10.id}`, {
  jar: owner,
  expected: 404,
});
await request(`${prefixB}/object-types/${sample.id}/records`, {
  jar: owner,
  method: 'POST',
  expected: 404,
  body: { displayName: 'Foreign create', values: {} },
});

const firstInstall = await request(`${prefixA}/templates/test-characterization/install`, {
  jar: owner,
  method: 'POST',
  body: {},
});
assert.equal(firstInstall.changed, true);
assert.equal(firstInstall.objectTypes.length, 8);
const secondInstall = await request(`${prefixA}/templates/test-characterization/install`, {
  jar: owner,
  method: 'POST',
  body: {},
});
assert.equal(secondInstall.changed, false);
assert.equal(secondInstall.objectTypes.length, 8);

const csv =
  'displayName,label,serial,received\r\nCSV Good,Beta,21.00,2026-04-01\r\nCSV Bad,Gamma,2.0,not-a-date\r\n';
const imported = await request(`${prefixA}/object-types/${sample.id}/records/import-csv`, {
  jar: owner,
  method: 'POST',
  headers: { 'idempotency-key': 'phase2-import-001' },
  body: { csv },
});
assert.equal(imported.imported, 1);
assert.equal(imported.failed, 1);
assert.equal(imported.errors[0].row, 3);
const replayed = await request(`${prefixA}/object-types/${sample.id}/records/import-csv`, {
  jar: owner,
  method: 'POST',
  headers: { 'idempotency-key': 'phase2-import-001' },
  body: { csv },
});
assert.equal(replayed.idempotentReplay, true);
await request(`${prefixA}/object-types/${sample.id}/records/import-csv`, {
  jar: owner,
  method: 'POST',
  expected: 409,
  headers: { 'idempotency-key': 'phase2-import-001' },
  body: { csv: `${csv}Different,Delta,88,2026-05-01\r\n` },
});
const exported = await request(`${prefixA}/object-types/${sample.id}/export.csv`, { jar: owner });
assert.match(exported, /CSV Good/);
assert.doesNotMatch(exported, /CSV Bad/);

const beforeRebuild = await request(`${prefixA}/object-types/${sample.id}/records/${record10.id}`, {
  jar: owner,
});
composeExec(
  'postgres',
  'psql',
  '-U',
  'engrove',
  '-d',
  'engrove',
  '-v',
  'ON_ERROR_STOP=1',
  '-c',
  `update field_definitions set projection_status = 'rebuilding' where id = '${serial.id}'`,
);
await request(`${prefixA}/object-types/${sample.id}/records/query`, {
  jar: owner,
  method: 'POST',
  expected: 409,
  body: { filters: [{ fieldId: serial.id, operator: 'eq', value: '10' }] },
});
await request(`${prefixA}/object-types/${sample.id}/export.csv`, { jar: owner, expected: 409 });
await request(`${prefixA}/object-types/${sample.id}/records`, {
  jar: owner,
  method: 'POST',
  expected: 409,
  body: { displayName: 'Blocked during rebuild', values: { label: 'Blocked', serial: '77' } },
});
const rebuildOutput = composeExec(
  'api',
  'node',
  'apps/api/dist/rebuild-projections.js',
  '--project-id',
  projectA.id,
  '--field-id',
  serial.id,
);
assert.match(rebuildOutput, /"projectionCount":4/);
const afterRebuild = await request(`${prefixA}/object-types/${sample.id}/records/${record10.id}`, {
  jar: owner,
});
assert.deepEqual(afterRebuild.values, beforeRebuild.values);

const updated = await request(`${prefixA}/object-types/${sample.id}/records/${record100.id}`, {
  jar: owner,
  method: 'PATCH',
  body: {
    displayName: 'One Hundred',
    values: { label: 'Mike', serial: '101', received: '2027-01-01' },
    relations: {},
    rowVersion: record100.rowVersion,
  },
});
assert.equal(updated.displayName, 'One Hundred');
const projectionUpdated = await request(`${prefixA}/object-types/${sample.id}/records/query`, {
  jar: owner,
  method: 'POST',
  body: { filters: [{ fieldId: serial.id, operator: 'eq', value: '101' }] },
});
assert.deepEqual(
  projectionUpdated.items.map((record) => record.id),
  [record100.id],
);

const audits = await request('/audit-events?limit=200', { jar: owner });
for (const action of [
  'schema.object_type_created',
  'schema.field_created',
  'record_view.created',
  'record_view.updated',
  'record_view.archived',
  'template.installed',
  'record.created',
  'record.updated',
  'record.archived',
  'record.restored',
  'record.csv_imported',
  'record.csv_exported',
  'record_projection.rebuilt',
]) {
  assert.ok(
    audits.items.some((event) => event.action === action),
    `missing audit action ${action}`,
  );
}

console.log('Phase 2 API smoke test passed.');
if (process.env.ENGROVE_TEST_PHASE3 === '1') {
  const { runPhase3Smoke } = await import('./phase-3-api-smoke-extra.mjs');
  await runPhase3Smoke({
    request,
    composeExec,
    owner,
    prefixA,
    projectA,
    workspaceA,
    sample,
    record10,
  });
}
let phase4Context;
if (process.env.ENGROVE_TEST_PHASE4 === '1') {
  const { runPhase4Smoke } = await import('./phase-4-api-smoke-extra.mjs');
  phase4Context = await runPhase4Smoke({ request, composeExec, owner, prefixA, sample, record10 });
}
if (process.env.ENGROVE_TEST_PHASE5 === '1') {
  assert.ok(phase4Context, 'Phase 5 smoke requires Phase 4 context.');
  const { runPhase5Smoke } = await import('./phase-5-api-smoke-extra.mjs');
  await runPhase5Smoke({
    request,
    composeExec,
    owner,
    prefixA,
    projectA,
    workspaceA,
    ...phase4Context,
  });
}
if (process.env.ENGROVE_TEST_PHASE6 === '1') {
  assert.ok(phase4Context, 'Phase 6 smoke requires Phase 4 context.');
  const { runPhase6Smoke } = await import('./phase-6-api-smoke-extra.mjs');
  await runPhase6Smoke({
    request,
    composeExec,
    owner,
    prefixA,
    sample,
    record10,
    ...phase4Context,
  });
}
if (process.env.ENGROVE_TEST_PHASE7 === '1') {
  const { runPhase7Smoke } = await import('./phase-7-api-smoke-extra.mjs');
  await runPhase7Smoke({ request, composeExec, owner });
}
if (process.env.ENGROVE_TEST_PHASE8 === '1') {
  const { runPhase8Smoke } = await import('./phase-8-api-smoke-extra.mjs');
  await runPhase8Smoke({ request, composeExec, owner, prefixA, projectA });
}
