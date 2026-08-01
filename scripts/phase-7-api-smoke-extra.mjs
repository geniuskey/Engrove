import assert from 'node:assert/strict';

export async function runPhase7Smoke({ request, composeExec, owner }) {
  assert.deepEqual(await request('/auth/oidc/status'), { enabled: false });

  const readiness = await (await fetch('http://localhost:3000/health/ready')).json();
  assert.equal(readiness.status, 'ok');
  assert.equal(readiness.dependencies.nodeWorker.status, 'ok');
  assert.equal(readiness.dependencies.pythonWorker.status, 'ok');

  const metricsResponse = await fetch('http://localhost:3000/metrics');
  assert.equal(metricsResponse.ok, true);
  const metrics = await metricsResponse.text();
  for (const name of [
    'engrove_http_requests_total',
    'engrove_active_jobs',
    'engrove_outbox_undispatched',
    'engrove_dataset_parse_duration_seconds_count',
    'engrove_uploaded_bytes_total',
    'engrove_database_connections',
  ])
    assert.match(metrics, new RegExp(`^${name}(?:\\{| )`, 'm'), `missing metric ${name}`);

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
    "insert into maintenance_state(singleton,mode,lease_owner,lease_expires_at) values(true,'backup','phase7-smoke',now()+interval '1 minute') on conflict(singleton) do update set lease_owner='phase7-smoke',lease_expires_at=excluded.lease_expires_at",
  );
  await request('/workspaces', {
    jar: owner,
    method: 'POST',
    expected: 503,
    body: { name: 'Blocked', slug: 'blocked-during-maintenance' },
  });
  assert.ok((await request('/workspaces', { jar: owner })).items.length >= 2);
  composeExec(
    'postgres',
    'psql',
    '-U',
    'engrove',
    '-d',
    'engrove',
    '-c',
    "delete from maintenance_state where lease_owner='phase7-smoke'",
  );

  const me = await request('/auth/me', { jar: owner });
  const reset = await request('/auth/password-reset-tokens', {
    jar: owner,
    method: 'POST',
    body: { userId: me.user.id },
  });
  assert.ok(reset.tokenId);
  console.log('Phase 7 API readiness, metrics, maintenance, and reset-token fixture passed.');
}
