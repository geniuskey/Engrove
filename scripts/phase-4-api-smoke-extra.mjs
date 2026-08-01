import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const checksum = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function runPhase4Smoke({ request, composeExec, owner, prefixA, sample, record10 }) {
  async function upload(
    content,
    { seriesId, seriesName = 'Force series', name = 'force.csv' } = {},
  ) {
    const bytes = Buffer.from(content);
    const issued = await request(`${prefixA}/file-upload-sessions`, {
      jar: owner,
      method: 'POST',
      body: {
        seriesId,
        seriesName,
        originalName: name,
        contentType: 'text/csv',
        sizeBytes: bytes.byteLength,
        checksum: checksum(bytes),
      },
    });
    assert.match(new URL(issued.uploadUrl).pathname, /staging/);
    assert.doesNotMatch(new URL(issued.uploadUrl).pathname, /committed/);
    const uploaded = await fetch(issued.uploadUrl, {
      method: 'PUT',
      headers: issued.headers,
      body: bytes,
    });
    assert.equal(uploaded.ok, true, await uploaded.text());
    const file = await request(`${prefixA}/file-upload-sessions/${issued.uploadId}/complete`, {
      jar: owner,
      method: 'POST',
    });
    const replay = await request(`${prefixA}/file-upload-sessions/${issued.uploadId}/complete`, {
      jar: owner,
      method: 'POST',
    });
    assert.equal(replay.id, file.id);
    return file;
  }
  async function waitDataset(id, expected = 'ready') {
    for (let attempt = 0; attempt < 60; attempt++) {
      const dataset = await request(`${prefixA}/datasets/${id}`, { jar: owner });
      if (dataset.status === expected) return dataset;
      if (dataset.status === 'failed' && expected !== 'failed')
        assert.fail(`dataset failed: ${dataset.failure_code}`);
      await sleep(500);
    }
    assert.fail(`dataset did not become ${expected}`);
  }

  const csv = 'time,force\n0,10\n1,12\n2,11\n';
  const first = await upload(csv);
  assert.equal(first.status, 'available');
  assert.ok(first.storage_version_id);
  const download = await request(`${prefixA}/files/${first.id}/download`, { jar: owner });
  const downloaded = await fetch(download.url);
  assert.equal(await downloaded.text(), csv);
  const second = await upload('time,force\n0,20\n1,22\n', { seriesId: first.file_series_id });
  assert.equal(second.version_number, 2);
  assert.equal(second.previous_file_id, first.id);
  assert.notEqual(second.final_object_key, first.final_object_key);
  assert.notEqual(second.checksum, first.checksum);
  const files = await request(`${prefixA}/files`, { jar: owner });
  assert.equal(
    files.items.filter((file) => file.file_series_id === first.file_series_id).length,
    2,
  );

  const created = await request(`${prefixA}/datasets`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Force table',
      sourceFileId: first.id,
      datasetType: 'tabular',
      parameters: { delimiter: ',' },
    },
  });
  const replay = await request(`${prefixA}/datasets`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Ignored display rename',
      sourceFileId: first.id,
      datasetType: 'tabular',
      parameters: { delimiter: ',' },
    },
  });
  assert.equal(replay.dataset.id, created.dataset.id);
  assert.equal(replay.idempotent, true);
  composeExec('redis', 'redis-cli', 'FLUSHALL');
  const tabular = await waitDataset(created.dataset.id);
  assert.equal(tabular.row_count, 3);
  assert.deepEqual(tabular.artifacts.map((artifact) => artifact.artifact_kind).sort(), [
    'parquet',
    'preview',
  ]);
  const preview = await request(`${prefixA}/datasets/${tabular.id}/preview`, { jar: owner });
  assert.equal(preview.items.length, 3);
  assert.equal(preview.items[1].force, 12);
  const [x, y] = tabular.schema.columns;
  const xyCreated = await request(`${prefixA}/datasets`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Force curve',
      sourceDatasetId: tabular.id,
      datasetType: 'xy',
      parameters: {
        xColumnId: x.id,
        yColumnId: y.id,
        xDimension: 'time',
        xUnit: 's',
        yDimension: 'force',
        yUnit: 'N',
      },
    },
  });
  const xy = await waitDataset(xyCreated.dataset.id);
  assert.equal(xy.source_dataset_id, tabular.id);
  assert.equal(xy.dataset_type, 'xy');
  assert.equal(xy.schema.columns[0].unit, 's');
  assert.equal(xy.schema.columns[1].unit, 'N');
  const xyReplay = await request(`${prefixA}/datasets`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Same curve',
      sourceDatasetId: tabular.id,
      datasetType: 'xy',
      parameters: {
        xColumnId: x.id,
        yColumnId: y.id,
        xDimension: 'time',
        xUnit: 's',
        yDimension: 'force',
        yUnit: 'N',
      },
    },
  });
  assert.equal(xyReplay.dataset.id, xy.id);

  const objectTypes = await request(`${prefixA}/object-types`, { jar: owner });
  const testRun = objectTypes.items.find((object) => object.key === 'test-run');
  const testRunFields = await request(`${prefixA}/object-types/${testRun.id}/fields`, {
    jar: owner,
  });
  const rawFileField = testRunFields.items.find((field) => field.key === 'raw-file');
  const datasetField = testRunFields.items.find((field) => field.key === 'dataset');
  assert.equal(rawFileField.fieldType, 'file');
  assert.equal(datasetField.fieldType, 'dataset');
  const evidenceRun = await request(`${prefixA}/object-types/${testRun.id}/records`, {
    jar: owner,
    method: 'POST',
    body: {
      displayName: 'Resource evidence run',
      values: { 'run-id': 'RESOURCE-1' },
      fileReferences: { [rawFileField.id]: [first.id] },
      datasetReferences: { [datasetField.id]: [xy.id] },
    },
  });
  assert.deepEqual(evidenceRun.fileReferences[rawFileField.id], [first.id]);
  assert.deepEqual(evidenceRun.datasetReferences[datasetField.id], [xy.id]);

  const fields = await request(`${prefixA}/object-types/${sample.id}/fields`, { jar: owner });
  const measurement = fields.items.find((field) => field.key === 'measured-length');
  const linked = await request(`${prefixA}/measurement-results`, {
    jar: owner,
    method: 'POST',
    body: {
      recordId: record10.id,
      fieldId: measurement.id,
      value: '1.5',
      unit: 'mm',
      measuredAt: '2026-08-01T14:00:00.000Z',
      datasetId: xy.id,
    },
  });
  assert.equal(linked.dataset_id, xy.id);
  const measurementCount = composeExec(
    'postgres',
    'psql',
    '-U',
    'engrove',
    '-d',
    'engrove',
    '-At',
    '-c',
    `select count(*) from measurement_results where dataset_id='${tabular.id}'`,
  ).trim();
  assert.equal(measurementCount, '0');

  await request(`${prefixA}/datasets/${xy.id}/archive`, {
    jar: owner,
    method: 'PATCH',
    body: { reason: 'Lifecycle test' },
  });
  await request(`${prefixA}/datasets/${xy.id}/restore`, { jar: owner, method: 'POST' });
  await request(`${prefixA}/files/${first.id}/archive`, {
    jar: owner,
    method: 'PATCH',
    body: { reason: 'Lifecycle test' },
  });
  await request(`${prefixA}/files/${first.id}/restore`, { jar: owner, method: 'POST' });
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
      `update file_objects set checksum='${'0'.repeat(64)}' where id='${first.id}'`,
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
      `update datasets set row_count=999 where id='${tabular.id}'`,
    ),
  );

  const badFile = await upload('a,b\n1,2,3\n', {
    seriesName: 'Bad CSV',
    name: 'bad.csv',
  });
  const badDataset = await request(`${prefixA}/datasets`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Bad parse',
      sourceFileId: badFile.id,
      datasetType: 'tabular',
      parameters: { delimiter: ',' },
    },
  });
  const failed = await waitDataset(badDataset.dataset.id, 'failed');
  assert.equal(failed.failure_code, 'DATASET_PARSE_FAILED');

  const jobs = await request(`${prefixA}/background-jobs`, { jar: owner });
  assert.ok(jobs.items.some((job) => job.entity_id === tabular.id && job.status === 'succeeded'));
  assert.ok(jobs.items.some((job) => job.entity_id === failed.id && job.status === 'failed'));
  assert.ok(jobs.items.every((job) => Array.isArray(job.attempts)));

  const activeBytes = Buffer.from('active,upload\n1,2\n');
  const activeUpload = await request(`${prefixA}/file-upload-sessions`, {
    jar: owner,
    method: 'POST',
    body: {
      seriesName: 'Active upload',
      originalName: 'active.csv',
      contentType: 'text/csv',
      sizeBytes: activeBytes.byteLength,
      checksum: checksum(activeBytes),
    },
  });
  const cleanupDryRun = await request(`${prefixA}/storage-cleanup?graceSeconds=0`, {
    jar: owner,
  });
  assert.ok(cleanupDryRun.candidates.some((candidate) => candidate.reason === 'eligible-staging'));
  assert.ok(
    cleanupDryRun.candidates.every((candidate) => candidate.key !== activeUpload.stagingObjectKey),
  );
  for (const protectedKey of [
    first.final_object_key,
    ...tabular.artifacts.map((artifact) => artifact.object_key),
  ])
    assert.ok(cleanupDryRun.candidates.every((candidate) => candidate.key !== protectedKey));
  const cleanupExecuted = await request(`${prefixA}/storage-cleanup`, {
    jar: owner,
    method: 'POST',
    body: { confirmation: 'DELETE_UNREFERENCED_OBJECTS', graceSeconds: 0 },
  });
  assert.equal(cleanupExecuted.deleted, cleanupExecuted.candidates.length);
  const protectedDownload = await request(`${prefixA}/files/${first.id}/download`, { jar: owner });
  assert.equal(await (await fetch(protectedDownload.url)).text(), csv);
  assert.equal(
    (await request(`${prefixA}/datasets/${tabular.id}/preview`, { jar: owner })).items.length,
    3,
  );

  const audits = await request('/audit-events?limit=200', { jar: owner });
  for (const action of [
    'file.finalized',
    'file.archived',
    'file.restored',
    'dataset.parse_requested',
    'dataset.parsed',
    'dataset.parse_failed',
    'dataset.archived',
    'dataset.restored',
    'storage.cleanup',
  ])
    assert.ok(
      audits.items.some((event) => event.action === action),
      `missing audit action ${action}`,
    );
  console.log('Phase 4 API smoke test passed.');
  return { first, second, tabular, xy, failed, evidenceRun, upload, waitDataset };
}
