import assert from 'node:assert/strict';

export async function runPhase8Smoke({ request, composeExec, owner, prefixA, projectA }) {
  const initialProgress = await request('/onboarding', { jar: owner });
  assert.deepEqual(initialProgress.completed_steps, []);
  const partialProgress = await request('/onboarding', {
    jar: owner,
    method: 'PATCH',
    body: { completedSteps: ['create-project'], dismissed: false },
  });
  assert.deepEqual(partialProgress.completed_steps, ['create-project']);

  const feedback = await request('/pilot-feedback', {
    jar: owner,
    method: 'POST',
    body: {
      projectId: projectA.id,
      category: 'workflow',
      rating: 4,
      message: 'The traceability path is clear; keep the raw-source link visible.',
      context: { flow: 'phase-8-golden' },
    },
  });
  assert.equal(feedback.status, 'new');
  await request('/pilot-feedback', {
    jar: owner,
    method: 'POST',
    expected: 400,
    body: { category: 'bug', rating: 6, message: 'too short', context: {} },
  });

  const installed = await request(`${prefixA}/demo/install`, {
    jar: owner,
    method: 'POST',
    body: {},
  });
  assert.equal(installed.installed, true);
  assert.equal(installed.idempotent, false);
  assert.equal(installed.templateVersion, 6);
  const replay = await request(`${prefixA}/demo/install`, {
    jar: owner,
    method: 'POST',
    body: {},
  });
  assert.equal(replay.idempotent, true);

  const status = await request(`${prefixA}/demo`, { jar: owner });
  assert.equal(status.installed, true);
  assert.equal(status.installation.dataset_status, 'ready');
  assert.ok(Number(status.installation.row_count) >= 6);

  const files = (await request(`${prefixA}/files`, { jar: owner })).items;
  const source = files.find((file) => file.id === installed.fileId);
  assert.equal(source.original_name, 'engrove-demo-results.csv');
  const download = await request(`${prefixA}/files/${source.id}/download`, { jar: owner });
  const raw = await (await fetch(download.url)).text();
  assert.match(raw, /^elapsed_s,force_N,displacement_mm/m);
  assert.match(raw, /5,78\.4,0\.63/);

  const dataset = await request(`${prefixA}/datasets/${installed.datasetId}`, { jar: owner });
  assert.equal(dataset.status, 'ready');
  assert.equal(dataset.source_file_id, source.id);
  assert.ok(dataset.artifacts.length >= 2);

  const chart = await request(`${prefixA}/charts/${installed.chartId}`, { jar: owner });
  assert.equal(chart.chart_type, 'histogram');
  assert.equal(chart.sources[0].dataset_id, dataset.id);
  const taskList = await request(`${prefixA}/tasks?entityId=${dataset.id}`, { jar: owner });
  const followUp = taskList.items.find((task) => task.title === 'Review the Engrove demo result');
  assert.ok(followUp);
  assert.ok(followUp.links.some((link) => link.entity_type === 'test_run'));
  assert.ok(followUp.links.some((link) => link.entity_type === 'dataset'));

  const testRunTypes = (await request(`${prefixA}/object-types`, { jar: owner })).items.filter(
    (objectType) => objectType.key === 'test-run',
  );
  assert.equal(testRunTypes.length, 1);
  const demoRun = await request(
    `${prefixA}/object-types/${testRunTypes[0].id}/records/${installed.testRunRecordId}`,
    { jar: owner },
  );
  assert.deepEqual(Object.values(demoRun.datasetReferences).flat(), [dataset.id]);
  assert.deepEqual(Object.values(demoRun.fileReferences).flat(), [source.id]);

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
    `update template_installations set version=2 where project_id='${projectA.id}';
     update object_types set name='Pilot Run' where project_id='${projectA.id}' and key='test-run';`,
  );
  const upgraded = await request(`${prefixA}/templates/test-characterization/install`, {
    jar: owner,
    method: 'POST',
    body: {},
  });
  assert.equal(upgraded.changed, true);
  assert.equal(upgraded.version, 6);
  assert.equal(upgraded.objectTypes.find((item) => item.key === 'test-run').name, 'Pilot Run');
  assert.equal(upgraded.objectTypes.filter((item) => item.key === 'test-run').length, 1);
  assert.equal(
    (await request(`${prefixA}/datasets/${dataset.id}`, { jar: owner })).status,
    'ready',
  );

  const allSteps = [
    'create-project',
    'install-template',
    'load-demo',
    'trace-results',
    'create-task',
  ];
  const completed = await request('/onboarding', {
    jar: owner,
    method: 'PATCH',
    body: { completedSteps: allSteps, dismissed: false },
  });
  assert.ok(completed.completed_at);

  const summary = await request('/pilot/summary', { jar: owner });
  assert.ok(summary.records >= 10);
  assert.ok(summary.datasets >= 3);
  assert.ok(summary.chart_dataset_links >= 1);
  assert.ok(summary.task_links >= 1);
  assert.ok(summary.feedback_items >= 1);
  assert.ok(summary.demo_projects >= 1);
  const capturedFeedback = await request('/pilot/feedback', { jar: owner });
  assert.ok(capturedFeedback.items.some((item) => item.id === feedback.id));

  const invitation = await request('/invitations', {
    jar: owner,
    method: 'POST',
    body: { email: 'phase8-viewer@example.com', role: 'viewer' },
  });
  const invitationToken = new URL(invitation.invitationUrl).searchParams.get('token');
  await request('/invitations/accept', {
    method: 'POST',
    body: {
      token: invitationToken,
      displayName: 'Phase 8 Viewer',
      password: 'Viewer correct battery staple 8!',
    },
  });
  const viewer = {};
  await request('/auth/sign-in', {
    jar: viewer,
    method: 'POST',
    body: {
      email: 'phase8-viewer@example.com',
      password: 'Viewer correct battery staple 8!',
    },
  });
  assert.deepEqual((await request('/onboarding', { jar: viewer })).completed_steps, []);
  await request('/pilot-feedback', {
    jar: viewer,
    method: 'POST',
    body: {
      category: 'usability',
      rating: 5,
      message: 'Read-only provenance exploration worked for this viewer.',
      context: {},
    },
  });
  await request('/pilot/summary', { jar: viewer, expected: 403 });
  await request('/pilot/feedback', { jar: viewer, expected: 403 });
  await request(`${prefixA}/demo/install`, {
    jar: viewer,
    method: 'POST',
    expected: 403,
    body: {},
  });

  const audits = await request('/audit-events?limit=200', { jar: owner });
  for (const action of ['onboarding.updated', 'pilot.feedback_submitted', 'pilot.demo_installed'])
    assert.ok(
      audits.items.some((event) => event.action === action),
      `missing ${action}`,
    );
  console.log('Phase 8 onboarding, demo, feedback, migration, and golden-flow smoke passed.');
}
