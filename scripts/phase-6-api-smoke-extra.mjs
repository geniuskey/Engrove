import assert from 'node:assert/strict';

export async function runPhase6Smoke({
  request,
  composeExec,
  owner,
  prefixA,
  record10,
  evidenceRun,
  xy,
}) {
  const objectTypes = (await request(`${prefixA}/object-types`, { jar: owner })).items;
  const sampleType = objectTypes.find((item) => item.key === 'sample');
  const issueType = objectTypes.find((item) => item.key === 'issue');
  assert.ok(sampleType && issueType);
  const templateSample = await request(`${prefixA}/object-types/${sampleType.id}/records`, {
    jar: owner,
    method: 'POST',
    body: { displayName: 'Template Sample 1', values: { 'sample-id': 'TASK-SAMPLE-1' } },
  });
  const issue = await request(`${prefixA}/object-types/${issueType.id}/records`, {
    jar: owner,
    method: 'POST',
    body: { displayName: 'Force excursion', values: { title: 'Force excursion' } },
  });

  const evaluations = (
    await request(`${prefixA}/specification-evaluations?recordId=${record10.id}`, { jar: owner })
  ).items;
  const failed = evaluations.find(
    (evaluation) => evaluation.status === 'fail' && evaluation.measurement_result_id,
  );
  assert.ok(failed);
  const fromEvaluation = await request(`${prefixA}/specification-evaluations/${failed.id}/task`, {
    jar: owner,
    method: 'POST',
  });
  assert.equal(fromEvaluation.priority, 'high');
  assert.ok(fromEvaluation.links.some((link) => link.entity_type === 'record'));
  assert.ok(fromEvaluation.links.some((link) => link.entity_type === 'specification_evaluation'));
  assert.ok(fromEvaluation.links.some((link) => link.entity_type === 'measurement_result'));
  const evaluationReplay = await request(`${prefixA}/specification-evaluations/${failed.id}/task`, {
    jar: owner,
    method: 'POST',
  });
  assert.equal(evaluationReplay.id, fromEvaluation.id);

  const linked = await request(`${prefixA}/tasks`, {
    jar: owner,
    method: 'POST',
    body: {
      title: 'Resolve force excursion',
      description: 'All exact evidence links',
      status: 'todo',
      priority: 'critical',
      dueDate: '2020-01-02',
      links: [
        { entityType: 'sample', entityId: templateSample.id },
        { entityType: 'issue', entityId: issue.id },
        { entityType: 'test_run', entityId: evidenceRun.id },
        { entityType: 'measurement_result', entityId: failed.measurement_result_id },
        { entityType: 'specification_evaluation', entityId: failed.id },
        { entityType: 'dataset', entityId: xy.id },
      ],
    },
  });
  assert.equal(linked.status_history.length, 1);
  assert.deepEqual(
    new Set(linked.links.map((link) => link.entity_type)),
    new Set([
      'sample',
      'issue',
      'test_run',
      'measurement_result',
      'specification_evaluation',
      'dataset',
    ]),
  );
  const issueTasks = await request(`${prefixA}/tasks?entityId=${issue.id}`, { jar: owner });
  assert.ok(issueTasks.items.some((task) => task.id === linked.id));
  const recordTasks = await request(`${prefixA}/tasks?entityId=${record10.id}`, { jar: owner });
  assert.ok(recordTasks.items.some((task) => task.id === fromEvaluation.id));

  const inProgress = await request(`${prefixA}/tasks/${linked.id}`, {
    jar: owner,
    method: 'PATCH',
    body: {
      title: linked.title,
      description: linked.description,
      status: 'in_progress',
      priority: linked.priority,
      dueDate: linked.due_date,
      rowVersion: linked.row_version,
    },
  });
  assert.equal(inProgress.status, 'in_progress');
  assert.equal(inProgress.status_history.length, 2);
  assert.equal(inProgress.status_history[1].from_status, 'todo');
  await request(`${prefixA}/tasks/${linked.id}`, {
    jar: owner,
    method: 'PATCH',
    expected: 409,
    body: {
      title: linked.title,
      description: linked.description,
      status: 'done',
      priority: linked.priority,
      dueDate: linked.due_date,
      rowVersion: linked.row_version,
    },
  });
  assert.throws(() =>
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
      `delete from task_links where task_id='${linked.id}'`,
    ),
  );
  assert.throws(() =>
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
      `update task_status_history set to_status='done' where task_id='${linked.id}'`,
    ),
  );

  const archived = await request(`${prefixA}/tasks/${linked.id}/archive`, {
    jar: owner,
    method: 'PATCH',
    body: { reason: 'Lifecycle verification' },
  });
  assert.ok(archived.archived_at);
  const restored = await request(`${prefixA}/tasks/${linked.id}/restore`, {
    jar: owner,
    method: 'POST',
  });
  assert.equal(restored.archived_at, null);
  assert.equal(restored.status, 'in_progress');
  assert.equal(restored.links.length, linked.links.length);
  assert.equal(restored.status_history.length, 2);

  const invitation = await request('/invitations', {
    jar: owner,
    method: 'POST',
    body: { email: 'phase6-viewer@example.com', role: 'viewer' },
  });
  const token = new URL(invitation.invitationUrl).searchParams.get('token');
  await request('/invitations/accept', {
    method: 'POST',
    body: {
      token,
      displayName: 'Phase 6 Viewer',
      password: 'Viewer correct battery staple 6!',
    },
  });
  const viewer = {};
  await request('/auth/sign-in', {
    jar: viewer,
    method: 'POST',
    body: {
      email: 'phase6-viewer@example.com',
      password: 'Viewer correct battery staple 6!',
    },
  });
  assert.ok((await request(`${prefixA}/tasks`, { jar: viewer })).items.length >= 2);
  await request(`${prefixA}/tasks`, {
    jar: viewer,
    method: 'POST',
    expected: 403,
    body: {
      title: 'Forbidden viewer task',
      description: '',
      status: 'todo',
      priority: 'low',
      links: [],
    },
  });
  await request(`${prefixA}/tasks/${restored.id}`, {
    jar: viewer,
    method: 'PATCH',
    expected: 403,
    body: {
      title: restored.title,
      description: restored.description,
      status: 'done',
      priority: restored.priority,
      dueDate: restored.due_date,
      rowVersion: restored.row_version,
    },
  });

  const metrics = await request(`${prefixA}/dashboard-metrics`, { jar: owner });
  assert.ok(metrics.overdue_tasks >= 1);
  const template = await request(`${prefixA}/templates/test-characterization/install`, {
    jar: owner,
    method: 'POST',
    body: {},
  });
  assert.equal(template.version, 6);
  assert.equal(template.changed, false);
  assert.equal(
    objectTypes.filter((item) => item.key === 'task').length,
    0,
    'template must not create a configurable Task object type',
  );

  const audits = await request('/audit-events?limit=200', { jar: owner });
  for (const action of [
    'task.created',
    'task.created_from_evaluation',
    'task.updated',
    'task.status_changed',
    'task.archived',
    'task.restored',
  ])
    assert.ok(
      audits.items.some((event) => event.action === action),
      `missing ${action}`,
    );
  console.log('Phase 6 API smoke test passed.');
}
