import assert from 'node:assert/strict';

function axis(label, dimension, displayUnit) {
  return { label, dimension, displayUnit, scale: 'linear' };
}

function xyConfig(name, datasets, filter = null) {
  return {
    title: name,
    legend: true,
    axes: { x: axis('Time', 'time', 's'), y: axis('Force', 'force', 'N') },
    series: datasets.map(({ key, dataset }) => ({
      sourceKey: key,
      name: dataset.name,
      xColumnId: dataset.schema.columns.find((column) => column.role === 'x').id,
      yColumnId: dataset.schema.columns.find((column) => column.role === 'y').id,
    })),
    filter,
    missingData: 'indicate',
  };
}

function sources(datasets) {
  return datasets.map(({ key, dataset }, index) => ({
    sourceKey: key,
    datasetId: dataset.id,
    sourceRole: 'series',
    seriesOrder: index,
  }));
}

export async function runPhase5Smoke({
  request,
  composeExec,
  owner,
  prefixA,
  second,
  tabular,
  xy,
  waitDataset,
}) {
  const secondTableRequest = await request(`${prefixA}/datasets`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Force table B',
      sourceFileId: second.id,
      datasetType: 'tabular',
      parameters: { delimiter: ',' },
    },
  });
  const secondTable = await waitDataset(secondTableRequest.dataset.id);
  const [secondX, secondY] = secondTable.schema.columns;
  const secondXyRequest = await request(`${prefixA}/datasets`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Force curve B',
      sourceDatasetId: secondTable.id,
      datasetType: 'xy',
      parameters: {
        xColumnId: secondX.id,
        yColumnId: secondY.id,
        xDimension: 'time',
        xUnit: 's',
        yDimension: 'force',
        yUnit: 'N',
      },
    },
  });
  const secondXy = await waitDataset(secondXyRequest.dataset.id);
  const pinned = [
    { key: 'run-a', dataset: xy },
    { key: 'run-b', dataset: secondXy },
  ];

  const chart = await request(`${prefixA}/charts`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Force overlay',
      description: 'Two exact XY dataset revisions',
      chartType: 'line',
      configVersion: 1,
      config: xyConfig('Force overlay', pinned),
      sources: sources(pinned),
      changeNote: 'Initial overlay',
    },
  });
  assert.equal(chart.revision_number, 1);
  assert.equal(chart.sources.length, 2);
  assert.deepEqual(
    chart.sources.map((source) => source.dataset_id).sort(),
    [xy.id, secondXy.id].sort(),
  );
  const revision1 = chart.current_revision_id;

  const yId = xy.schema.columns.find((column) => column.role === 'y').id;
  const savedFilter = {
    type: 'and',
    children: [
      {
        type: 'range',
        sourceKey: 'run-a',
        columnId: yId,
        lower: 10,
        upper: 100,
      },
    ],
  };
  const revised = await request(`${prefixA}/charts/${chart.id}/revisions`, {
    jar: owner,
    method: 'POST',
    body: {
      name: chart.name,
      description: chart.description,
      chartType: 'line',
      configVersion: 1,
      config: xyConfig('Force overlay filtered', pinned, savedFilter),
      sources: sources(pinned),
      changeNote: 'Persist engineering range filter',
    },
  });
  assert.equal(revised.revision_number, 2);
  assert.deepEqual(revised.config.filter, savedFilter);
  const revision2 = revised.current_revision_id;
  const exactRevision1 = await request(`${prefixA}/chart-revisions/${revision1}`, { jar: owner });
  assert.equal(exactRevision1.revision_number, 1);
  assert.equal(exactRevision1.config.filter, null);
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
      `update chart_revisions set change_note='tampered' where id='${revision1}'`,
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
      `update chart_dataset_sources set source_role='tampered' where chart_revision_id='${revision1}'`,
    ),
  );

  const unsupported = await request(`${prefixA}/charts`, {
    jar: owner,
    method: 'POST',
    expected: 400,
    body: {
      name: 'Unsupported',
      description: '',
      chartType: 'line',
      configVersion: 999,
      config: xyConfig('Unsupported', [pinned[0]]),
      sources: sources([pinned[0]]),
      changeNote: 'Reject',
    },
  });
  assert.equal(unsupported.error.code, 'CHART_CONFIG_VERSION_UNSUPPORTED');
  await request(`${prefixA}/charts`, {
    jar: owner,
    method: 'POST',
    expected: 400,
    body: {
      name: 'javascript:alert(1)',
      description: '',
      chartType: 'line',
      configVersion: 1,
      config: xyConfig('Unsafe', [pinned[0]]),
      sources: sources([pinned[0]]),
      changeNote: 'Reject',
    },
  });
  const tooDeep = {
    type: 'comparison',
    sourceKey: 'run-a',
    columnId: yId,
    operator: 'gt',
    value: 1,
  };
  let nested = tooDeep;
  for (let index = 0; index < 6; index++) nested = { type: 'and', children: [nested] };
  await request(`${prefixA}/charts`, {
    jar: owner,
    method: 'POST',
    expected: 400,
    body: {
      name: 'Deep filter',
      description: '',
      chartType: 'line',
      configVersion: 1,
      config: xyConfig('Deep filter', [pinned[0]], nested),
      sources: sources([pinned[0]]),
      changeNote: 'Reject',
    },
  });

  const incompatibleRequest = await request(`${prefixA}/datasets`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Dimension-conflicting curve',
      sourceDatasetId: secondTable.id,
      datasetType: 'xy',
      parameters: {
        xColumnId: secondX.id,
        yColumnId: secondY.id,
        xDimension: 'time',
        xUnit: 's',
        yDimension: 'length',
        yUnit: 'm',
      },
    },
  });
  const incompatible = await waitDataset(incompatibleRequest.dataset.id);
  const conflictPinned = [pinned[0], { key: 'length-b', dataset: incompatible }];
  const conflict = await request(`${prefixA}/charts`, {
    jar: owner,
    method: 'POST',
    expected: 400,
    body: {
      name: 'Conflicting overlay',
      description: '',
      chartType: 'line',
      configVersion: 1,
      config: {
        ...xyConfig('Conflicting overlay', conflictPinned),
        axes: { x: axis('Time', 'time', 's'), y: { label: 'Value', scale: 'linear' } },
      },
      sources: sources(conflictPinned),
      changeNote: 'Reject',
    },
  });
  assert.equal(conflict.error.code, 'CHART_AXIS_DIMENSION_CONFLICT');

  const [tableX, tableY] = tabular.schema.columns;
  const singleSource = [
    { sourceKey: 'values', datasetId: tabular.id, sourceRole: 'values', seriesOrder: 0 },
  ];
  for (const [chartType, config] of [
    [
      'histogram',
      {
        title: 'Force distribution',
        legend: false,
        axes: { x: axis('Force', undefined, undefined), y: axis('Count', undefined, undefined) },
        sourceKey: 'values',
        columnId: tableY.id,
        binStrategy: 'fixed',
        binCount: 5,
        filter: null,
        missingData: 'indicate',
      },
    ],
    [
      'box_plot',
      {
        title: 'Force box plot',
        legend: false,
        axes: { x: axis('Series', undefined, undefined), y: axis('Force', undefined, undefined) },
        sourceKey: 'values',
        valueColumnId: tableY.id,
        groupColumnId: tableX.id,
        filter: null,
        missingData: 'indicate',
      },
    ],
  ]) {
    const created = await request(`${prefixA}/charts`, {
      jar: owner,
      method: 'POST',
      body: {
        name: config.title,
        description: '',
        chartType,
        configVersion: 1,
        config,
        sources: singleSource,
        changeNote: 'Initial statistical chart',
      },
    });
    assert.equal(created.chart_type, chartType);
  }

  const dashboard = await request(`${prefixA}/dashboards`, {
    jar: owner,
    method: 'POST',
    body: {
      name: 'Pinned engineering dashboard',
      description: 'Revision pin verification',
      changeNote: 'Initial layout',
      cards: [
        {
          cardType: 'chart',
          chartRevisionId: revision2,
          configVersion: 1,
          config: { title: 'Force overlay' },
          x: 0,
          y: 0,
          width: 8,
          height: 5,
          position: 0,
        },
        {
          cardType: 'kpi',
          configVersion: 1,
          config: { title: 'Datasets', metric: 'dataset_count' },
          x: 8,
          y: 0,
          width: 4,
          height: 2,
          position: 1,
        },
      ],
    },
  });
  assert.equal(dashboard.revision_number, 1);
  assert.equal(dashboard.cards[0].chart_revision_id, revision2);
  const dashboardRevision1 = dashboard.current_revision_id;

  const revision3 = await request(`${prefixA}/charts/${chart.id}/revisions`, {
    jar: owner,
    method: 'POST',
    body: {
      name: chart.name,
      description: chart.description,
      chartType: 'scatter',
      configVersion: 1,
      config: xyConfig('Force scatter', pinned),
      sources: sources(pinned),
      changeNote: 'Scatter presentation',
    },
  });
  assert.equal(revision3.revision_number, 3);
  const stillPinned = await request(`${prefixA}/dashboards/${dashboard.id}`, { jar: owner });
  assert.equal(stillPinned.cards[0].chart_revision_id, revision2);

  const dashboard2 = await request(`${prefixA}/dashboards/${dashboard.id}/revisions`, {
    jar: owner,
    method: 'POST',
    body: {
      name: dashboard.name,
      description: dashboard.description,
      changeNote: 'Pin scatter revision and move card',
      cards: [
        {
          cardType: 'chart',
          chartRevisionId: revision3.current_revision_id,
          configVersion: 1,
          config: { title: 'Force scatter' },
          x: 0,
          y: 0,
          width: 12,
          height: 5,
          position: 0,
        },
      ],
    },
  });
  assert.equal(dashboard2.revision_number, 2);
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
      `update dashboard_cards set width=1 where dashboard_revision_id='${dashboardRevision1}'`,
    ),
  );

  await request(`${prefixA}/charts/${chart.id}/archive`, {
    jar: owner,
    method: 'PATCH',
    body: { reason: 'Lifecycle verification' },
  });
  await request(`${prefixA}/charts/${chart.id}/restore`, { jar: owner, method: 'POST' });
  await request(`${prefixA}/dashboards/${dashboard.id}/archive`, {
    jar: owner,
    method: 'PATCH',
    body: { reason: 'Lifecycle verification' },
  });
  await request(`${prefixA}/dashboards/${dashboard.id}/restore`, { jar: owner, method: 'POST' });

  const templateCharts = (
    await request(`${prefixA}/charts?includeArchived=true`, { jar: owner })
  ).items.filter((item) => item.system);
  const templateDashboards = (
    await request(`${prefixA}/dashboards?includeArchived=true`, { jar: owner })
  ).items.filter((item) => item.system);
  assert.equal(templateCharts.length, 2);
  assert.equal(templateDashboards.length, 1);
  assert.ok(templateCharts.every((item) => item.sources.length === 0));
  assert.equal(templateDashboards[0].cards.length, 7);
  const templateReplay = await request(`${prefixA}/templates/test-characterization/install`, {
    jar: owner,
    method: 'POST',
    body: {},
  });
  assert.equal(templateReplay.changed, false);
  assert.equal(templateReplay.version, 6);

  const metrics = await request(`${prefixA}/dashboard-metrics`, { jar: owner });
  assert.ok(metrics.dataset_count >= 5);
  assert.equal(typeof metrics.failed_evaluations, 'number');
  const audits = await request('/audit-events?limit=200', { jar: owner });
  for (const action of [
    'chart.created',
    'chart.revised',
    'chart.archived',
    'chart.restored',
    'dashboard.created',
    'dashboard.revised',
    'dashboard.archived',
    'dashboard.restored',
  ])
    assert.ok(
      audits.items.some((event) => event.action === action),
      `missing ${action}`,
    );
  console.log('Phase 5 API smoke test passed.');
}
