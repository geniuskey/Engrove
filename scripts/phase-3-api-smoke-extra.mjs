import assert from 'node:assert/strict';

export async function runPhase3Smoke({ request, composeExec, owner, prefixA, sample, record10 }) {
  const registry = await request('/units');
  assert.match(registry.digest, /^[a-f0-9]{64}$/);
  assert.equal(registry.version, '2026.1');

  const quantityObject = await request(`${prefixA}/object-types`, {
    jar: owner,
    method: 'POST',
    body: { name: 'Dimensioned Part', pluralName: 'Dimensioned Parts', key: 'dimensioned-part' },
  });
  const quantity = await request(`${prefixA}/object-types/${quantityObject.id}/fields`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Thickness',
      key: 'thickness',
      fieldType: 'quantity',
      unique: true,
      config: { dimension: 'length', canonicalUnit: 'm', allowedUnits: ['m', 'mm', 'um'] },
    },
  });
  const range = await request(`${prefixA}/object-types/${quantityObject.id}/fields`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Allowed Thickness',
      key: 'allowed-thickness',
      fieldType: 'range',
      config: { dimension: 'length', canonicalUnit: 'm', allowedUnits: ['m', 'mm', 'um'] },
    },
  });
  const part = await request(`${prefixA}/object-types/${quantityObject.id}/records`, {
    jar: owner,
    method: 'POST',
    body: {
      displayName: 'Part 1',
      values: {
        thickness: { value: '1', unit: 'mm' },
        'allowed-thickness': {
          lower: { value: '0.9', unit: 'mm' },
          upper: { value: '0.0011', unit: 'm' },
        },
      },
    },
  });
  assert.equal(part.values.thickness.value, '1');
  assert.equal(part.values.thickness.unit, 'mm');
  assert.equal(part.values.thickness.canonicalValue, '0.001');
  assert.equal(part.values['allowed-thickness'].lower.canonicalValue, '0.0009');
  await request(`${prefixA}/object-types/${quantityObject.id}/records`, {
    jar: owner,
    method: 'POST',
    expected: 409,
    body: { displayName: 'Equivalent', values: { thickness: { value: '1000', unit: 'um' } } },
  });
  await request(`${prefixA}/object-types/${quantityObject.id}/records`, {
    jar: owner,
    method: 'POST',
    expected: 400,
    body: { displayName: 'Wrong dimension', values: { thickness: { value: '1', unit: 's' } } },
  });

  const measurement = await request(`${prefixA}/object-types/${sample.id}/fields`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Measured Length',
      key: 'measured-length',
      fieldType: 'measurement',
      config: { dimension: 'length', canonicalUnit: 'm', allowedUnits: ['m', 'mm', 'um'] },
    },
  });
  const spec = await request(`${prefixA}/specifications`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Length window',
      measurementFieldId: measurement.id,
      limits: {
        lowerLimit: '0.001',
        warningLowerLimit: '0.0012',
        warningUpperLimit: '0.0018',
        upperLimit: '0.002',
      },
      changeNote: 'Initial limits',
    },
  });
  assert.equal(spec.revisions.length, 1);
  await request(`${prefixA}/specifications`, {
    jar: owner,
    method: 'POST',
    expected: 409,
    body: {
      name: 'Duplicate',
      measurementFieldId: measurement.id,
      limits: { lowerLimit: '0' },
      changeNote: 'Should fail',
    },
  });
  const initialEvaluations = await request(
    `${prefixA}/specification-evaluations?recordId=${record10.id}`,
    { jar: owner },
  );
  assert.equal(initialEvaluations.items[0].status, 'missing');

  const hardBoundary = await request(`${prefixA}/measurement-results`, {
    jar: owner,
    method: 'POST',
    body: {
      recordId: record10.id,
      fieldId: measurement.id,
      value: '1',
      unit: 'mm',
      measuredAt: '2026-08-01T11:00:00.000Z',
    },
  });
  assert.equal(hardBoundary.evaluation.status, 'warning');

  const first = await request(`${prefixA}/measurement-results`, {
    jar: owner,
    method: 'POST',
    body: {
      recordId: record10.id,
      fieldId: measurement.id,
      value: '1.2',
      unit: 'mm',
      measuredAt: '2026-08-01T12:00:00.000Z',
    },
  });
  assert.equal(first.canonical_value, '0.0012');
  assert.equal(first.original_value, '1.2');
  assert.equal(first.original_unit, 'mm');
  assert.equal(first.evaluation.status, 'pass');
  const repeated = await request(`${prefixA}/measurement-results`, {
    jar: owner,
    method: 'POST',
    body: {
      recordId: record10.id,
      fieldId: measurement.id,
      value: '1800',
      unit: 'um',
      uncertaintyValue: '10',
      uncertaintyUnit: 'um',
      measuredAt: '2026-08-01T13:00:00.000Z',
    },
  });
  assert.equal(repeated.evaluation.status, 'pass');
  const corrected = await request(`${prefixA}/measurement-results`, {
    jar: owner,
    method: 'POST',
    body: {
      recordId: record10.id,
      fieldId: measurement.id,
      value: '2.1',
      unit: 'mm',
      measuredAt: '2026-08-01T13:01:00.000Z',
      supersedesResultId: repeated.id,
      correctionReason: 'Transcription correction',
    },
  });
  assert.equal(corrected.evaluation.status, 'fail');
  const projectedRecord = await request(
    `${prefixA}/object-types/${sample.id}/records/${record10.id}`,
    { jar: owner },
  );
  assert.equal(projectedRecord.measurements[measurement.id].resultId, corrected.id);
  assert.equal(projectedRecord.measurements[measurement.id].status, 'fail');
  await request(`${prefixA}/measurement-results`, {
    jar: owner,
    method: 'POST',
    expected: 409,
    body: {
      recordId: record10.id,
      fieldId: measurement.id,
      value: '2.2',
      unit: 'mm',
      measuredAt: '2026-08-01T13:02:00.000Z',
      supersedesResultId: repeated.id,
      correctionReason: 'Second correction',
    },
  });
  const history = await request(
    `${prefixA}/records/${record10.id}/measurement-results?fieldId=${measurement.id}`,
    { jar: owner },
  );
  assert.equal(history.items.length, 4);
  assert.equal(history.items.filter((item) => item.current).length, 3);

  const revision2 = await request(`${prefixA}/specifications/${spec.id}/revisions`, {
    jar: owner,
    method: 'POST',
    body: {
      limits: { lowerLimit: '0.001', upperLimit: '0.003', warningUpperLimit: '0.0025' },
      changeNote: 'Widen upper limit',
    },
  });
  assert.equal(revision2.revisions.length, 2);
  const latestRevision = revision2.revisions[0];
  const retry1 = await request(`${prefixA}/specification-evaluations/retry`, {
    jar: owner,
    method: 'POST',
    body: {
      specificationRevisionId: latestRevision.id,
      recordId: record10.id,
      measurementResultId: corrected.id,
    },
  });
  const retry2 = await request(`${prefixA}/specification-evaluations/retry`, {
    jar: owner,
    method: 'POST',
    body: {
      specificationRevisionId: latestRevision.id,
      recordId: record10.id,
      measurementResultId: corrected.id,
    },
  });
  assert.equal(retry1.id, retry2.id);
  assert.equal(retry1.status, 'pass');
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
      `update measurement_results set original_value = 999 where id = '${first.id}'`,
    ),
  );

  const oneSided = await request(`${prefixA}/specifications/${spec.id}/revisions`, {
    jar: owner,
    method: 'POST',
    body: { limits: { upperLimit: '0.003' }, changeNote: 'One-sided upper limit' },
  });
  assert.equal(oneSided.revisions.length, 3);

  await request(`${prefixA}/specifications/${spec.id}/archive`, {
    jar: owner,
    method: 'PATCH',
    body: { reason: 'Temporary retirement' },
  });
  await request(`${prefixA}/specifications/${spec.id}/restore`, { jar: owner, method: 'POST' });
  const afterRestore = await request(`${prefixA}/specifications?includeArchived=true`, {
    jar: owner,
  });
  const restored = afterRestore.items.find((item) => item.id === spec.id);
  assert.equal(restored.status, 'active');
  assert.equal(restored.revisions.length, 3);

  const template = await request(`${prefixA}/templates/test-characterization/install`, {
    jar: owner,
    method: 'POST',
  });
  assert.equal(template.version, 6);
  assert.equal(template.changed, false);
  const testRun = template.objectTypes.find((object) => object.key === 'test-run');
  const testRunFields = await request(`${prefixA}/object-types/${testRun.id}/fields`, {
    jar: owner,
  });
  const temperature = testRunFields.items.find((field) => field.key === 'environment-temperature');
  assert.equal(temperature.fieldType, 'quantity');
  assert.equal(temperature.config.dimension, 'temperature');
  const testRunRecord = await request(`${prefixA}/object-types/${testRun.id}/records`, {
    jar: owner,
    method: 'POST',
    body: {
      displayName: 'Temperature check',
      values: { 'run-id': 'TEMP-1', 'environment-temperature': { value: '0', unit: 'degC' } },
    },
  });
  assert.equal(testRunRecord.values['environment-temperature'].canonicalValue, '273.15');
  assert.equal(
    template.objectTypes.some((object) => object.key === 'specification'),
    false,
  );

  const audits = await request('/audit-events?limit=200', { jar: owner });
  for (const action of [
    'measurement_result.created',
    'measurement_result.superseded',
    'specification.created',
    'specification.revised',
    'specification.evaluated',
    'specification.archived',
    'specification.restored',
  ])
    assert.ok(
      audits.items.some((event) => event.action === action),
      `missing audit action ${action}`,
    );

  console.log('Phase 3 API smoke test passed.');
}
