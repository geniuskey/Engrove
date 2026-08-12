import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VisualizationsPage } from './VisualizationsPage.js';

const workspaceId = '019fbcf9-e020-71da-935a-6a6a728b3790';
const projectId = '019fbcf9-e020-71da-935a-6a6a728b3791';
const dashboardId = '019fbcf9-e020-71da-935a-6a6a728b3792';
const objectTypeId = '019fbcf9-e020-71da-935a-6a6a728b3793';
const statusFieldId = '019fbcf9-e020-71da-935a-6a6a728b3794';
const recordViewId = '019fbcf9-e020-71da-935a-6a6a728b379a';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VisualizationsPage record dashboard cards', () => {
  it('explains an empty project and disables chart actions until compatible sources exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/datasets?'))
        return json({
          items: [],
          pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
        });
      if (url.includes('/charts?')) return json({ items: [] });
      if (url.includes('/dashboards?')) return json({ items: [] });
      if (url.includes('/object-types?')) return json({ items: [] });
      if (url.endsWith('/dashboard-metrics'))
        return json({
          total_samples: 0,
          dataset_count: 0,
          failed_evaluations: 0,
          pass_rate: null,
          overdue_tasks: 0,
          recent_datasets: [],
        });
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter
        initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/visualizations`]}
      >
        <Routes>
          <Route
            element={
              <VisualizationsPage
                user={{
                  id: '019fbcf9-e020-71da-935a-6a6a728b3795',
                  email: 'owner@example.com',
                  displayName: 'Owner',
                  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3796',
                  role: 'owner',
                }}
              />
            }
            path="/workspaces/:workspaceId/projects/:projectId/visualizations"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Add a data source to start visualizing' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a record table' })).toHaveAttribute(
      'href',
      `/workspaces/${workspaceId}/projects/${projectId}/data`,
    );
    expect(screen.getByRole('link', { name: 'Review external materials' })).toHaveAttribute(
      'href',
      `/workspaces/${workspaceId}/projects/${projectId}/sources`,
    );
    expect(screen.getByRole('heading', { name: 'Start with a blank canvas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save chart' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Create canvas' })[0]!);
    expect(screen.getByRole('textbox', { name: 'Dashboard name' })).toBeInTheDocument();
    expect(screen.getByText('No charts have been saved in this project yet.')).toBeInTheDocument();
  });

  it('renders a live record KPI and pins a new cross-table card into a revision', async () => {
    const revisionRequests: Array<Record<string, unknown>> = [];
    let recordQueryCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/datasets?'))
        return json({
          items: [],
          pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
        });
      if (url.includes('/charts?')) return json({ items: [] });
      if (url.includes('/dashboards?')) return json({ items: [dashboard()] });
      if (url.endsWith('/dashboard-metrics'))
        return json({
          total_samples: 0,
          dataset_count: 0,
          failed_evaluations: 0,
          pass_rate: null,
          overdue_tasks: 0,
          recent_datasets: [],
        });
      if (url.includes('/object-types?'))
        return json({ items: [{ id: objectTypeId, name: 'Issue', pluralName: 'Issues' }] });
      if (url.endsWith(`/object-types/${objectTypeId}/fields`))
        return json({
          items: [
            {
              id: statusFieldId,
              name: 'Status',
              key: 'status',
              fieldType: 'single_select',
              projectionStatus: 'ready',
              config: { options: [{ key: 'open', label: 'Open' }] },
            },
          ],
        });
      if (url.includes(`/object-types/${objectTypeId}/views?`) && url.includes('query=Critical'))
        return json({
          items: [
            {
              id: recordViewId,
              name: 'Critical queue',
              viewType: 'grid',
              config: {
                visibleFieldIds: [statusFieldId],
                filters: [{ fieldId: statusFieldId, operator: 'eq', value: 'open' }],
                sorts: [],
              },
            },
          ],
          pageInfo: { limit: 20, offset: 0, total: 1, hasNext: false },
        });
      if (url.includes(`/object-types/${objectTypeId}/views?`))
        return json({
          items: [],
          pageInfo: { limit: 20, offset: 0, total: 21, hasNext: true },
        });
      if (url.endsWith(`/object-types/${objectTypeId}/records/query`)) {
        recordQueryCount += 1;
        return json({ items: [], page: 1, pageSize: 1, total: 7 });
      }
      if (url.endsWith(`/dashboards/${dashboardId}/revisions`) && init?.method === 'POST') {
        revisionRequests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return json({});
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter
        initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/visualizations`]}
      >
        <Routes>
          <Route
            element={
              <VisualizationsPage
                user={{
                  id: '019fbcf9-e020-71da-935a-6a6a728b3795',
                  email: 'owner@example.com',
                  displayName: 'Owner',
                  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3796',
                  role: 'owner',
                }}
              />
            }
            path="/workspaces/:workspaceId/projects/:projectId/visualizations"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Open issues')).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument();
    const globalFilter = screen.getByRole('searchbox', {
      name: 'Search across dashboard record sources',
    });
    fireEvent.change(globalFilter, { target: { value: 'urgent' } });
    await waitFor(() => expect(recordQueryCount).toBeGreaterThan(1));
    const initialQueryCount = recordQueryCount;
    const refreshAction = screen.getByRole('button', { name: 'Refresh live data' });
    expect(refreshAction).toHaveTextContent('↻');
    expect(screen.getByRole('tooltip', { name: 'Refresh live data' })).toBeInTheDocument();
    fireEvent.click(refreshAction);
    await waitFor(() => expect(recordQueryCount).toBeGreaterThan(initialQueryCount));
    const card = screen.getByText('Open issues').closest('article');
    expect(card).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Move Open issues' })).toHaveTextContent('⠿');
    expect(screen.getByRole('tooltip', { name: 'Move Open issues' })).toBeInTheDocument();
    const removeAction = screen.getByRole('button', { name: 'Remove Open issues' });
    expect(removeAction.querySelector('[aria-hidden="true"]')).toHaveTextContent('×');
    expect(screen.getByRole('tooltip', { name: 'Remove Open issues' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resize Open issues' })).toHaveTextContent('◢');
    expect(screen.getByRole('tooltip', { name: 'Resize Open issues' })).toBeInTheDocument();
    fireEvent.contextMenu(card!, { clientX: 80, clientY: 100 });
    expect(screen.getByRole('menu', { name: 'Open issues' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open source table' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Duplicate card' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Copy card title' }), {
      key: 'Escape',
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add element' })[0]!);
    expect(screen.getByRole('heading', { name: 'Insert an element' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Record count/ }));
    expect(screen.getByRole('heading', { name: 'Choose a starting size' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Wide/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue →' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Element title' }), {
      target: { value: 'All issues' },
    });
    const viewPicker = screen.getByRole('combobox', { name: 'Search saved views' });
    await waitFor(() => expect(viewPicker).not.toBeDisabled());
    fireEvent.focus(viewPicker);
    fireEvent.change(viewPicker, { target: { value: 'Critical' } });
    fireEvent.click(await screen.findByRole('option', { name: /Critical queue/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert into canvas' }));

    await waitFor(() => expect(revisionRequests).toHaveLength(1));
    const cards = revisionRequests[0]!.cards as Array<Record<string, unknown>>;
    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({
      cardType: 'record_kpi',
      configVersion: 2,
      width: 8,
      height: 4,
      config: {
        title: 'All issues',
        metric: 'count',
        source: {
          objectTypeId,
          tableName: 'Issues',
          viewId: recordViewId,
          viewName: 'Critical queue',
          filters: [{ fieldId: statusFieldId, operator: 'eq', value: 'open' }],
          sorts: [],
        },
      },
    });
  });

  it('searches and pages datasets while preserving an XY source selection', async () => {
    const urls: string[] = [];
    const alpha = xyDataset('019fbcf9-e020-71da-935a-6a6a728b3780', 'Alpha sweep');
    const thermal = xyDataset('019fbcf9-e020-71da-935a-6a6a728b3781', 'Thermal sweep');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/datasets?') && url.includes('query=Thermal'))
        return json({
          items: [thermal],
          pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
        });
      if (url.includes('/datasets?') && url.includes('offset=1'))
        return json({
          items: [thermal],
          pageInfo: { limit: 50, offset: 1, total: 2, hasNext: false },
        });
      if (url.includes('/datasets?'))
        return json({
          items: [alpha],
          pageInfo: { limit: 50, offset: 0, total: 2, hasNext: true },
        });
      if (url.includes('/charts?'))
        return json({
          items: [],
          pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
        });
      if (url.includes('/dashboards?'))
        return json({
          items: [{ ...dashboard(), cards: [] }],
          pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
        });
      if (url.endsWith('/dashboard-metrics'))
        return json({
          total_samples: 0,
          dataset_count: 2,
          failed_evaluations: 0,
          pass_rate: null,
          overdue_tasks: 0,
          recent_datasets: [],
        });
      if (url.includes('/object-types?')) return json({ items: [] });
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter
        initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/visualizations`]}
      >
        <Routes>
          <Route
            element={
              <VisualizationsPage
                user={{
                  id: '019fbcf9-e020-71da-935a-6a6a728b3795',
                  email: 'owner@example.com',
                  displayName: 'Owner',
                  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3796',
                  role: 'owner',
                }}
              />
            }
            path="/workspaces/:workspaceId/projects/:projectId/visualizations"
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click((await screen.findAllByRole('button', { name: 'Add element' }))[0]!);
    const xyChartButton = screen.getByRole('button', { name: /XY chart/ });
    await waitFor(() => expect(xyChartButton).toBeEnabled());
    fireEvent.click(xyChartButton);
    fireEvent.click(screen.getByRole('button', { name: 'Continue →' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load more datasets (1 of 2)' }));
    expect(await screen.findByRole('checkbox', { name: 'Thermal sweep' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha sweep' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search datasets' }), {
      target: { value: 'Thermal' },
    });
    await waitFor(() => expect(urls.some((url) => url.includes('query=Thermal'))).toBe(true));
    expect(screen.getByRole('checkbox', { name: 'Alpha sweep' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Thermal sweep' })).toBeInTheDocument();
    expect(urls.some((url) => url.includes('/datasets?limit=50&offset=1'))).toBe(true);
  });

  it('finds and inserts a saved chart beyond the initially loaded catalog', async () => {
    const revisionRequests: Array<Record<string, unknown>> = [];
    const firstChart = savedChart('019fbcf9-e020-71da-935a-6a6a728b3782', 'Baseline chart');
    const remoteChart = savedChart('019fbcf9-e020-71da-935a-6a6a728b3783', 'Thermal envelope');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/datasets?'))
        return json({
          items: [],
          pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
        });
      if (url.includes('/charts?') && url.includes('query=Thermal'))
        return json({
          items: [remoteChart],
          pageInfo: { limit: 20, offset: 0, total: 1, hasNext: false },
        });
      if (url.includes('/charts?'))
        return json({
          items: [firstChart],
          pageInfo: { limit: 50, offset: 0, total: 51, hasNext: true },
        });
      if (url.includes('/dashboards?'))
        return json({
          items: [{ ...dashboard(), cards: [] }],
          pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
        });
      if (url.endsWith('/dashboard-metrics'))
        return json({
          total_samples: 0,
          dataset_count: 0,
          failed_evaluations: 0,
          pass_rate: null,
          overdue_tasks: 0,
          recent_datasets: [],
        });
      if (url.includes('/object-types?')) return json({ items: [] });
      if (url.endsWith(`/dashboards/${dashboardId}/revisions`) && init?.method === 'POST') {
        revisionRequests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return json({});
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter
        initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/visualizations`]}
      >
        <Routes>
          <Route
            element={
              <VisualizationsPage
                user={{
                  id: '019fbcf9-e020-71da-935a-6a6a728b3795',
                  email: 'owner@example.com',
                  displayName: 'Owner',
                  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3796',
                  role: 'owner',
                }}
              />
            }
            path="/workspaces/:workspaceId/projects/:projectId/visualizations"
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click((await screen.findAllByRole('button', { name: 'Add element' }))[0]!);
    fireEvent.click(screen.getByRole('button', { name: /Saved chart/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue →' }));
    const chartPicker = screen.getByRole('combobox', { name: 'Search saved charts' });
    fireEvent.focus(chartPicker);
    fireEvent.change(chartPicker, { target: { value: 'Thermal' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Thermal envelope' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert into canvas' }));

    await waitFor(() => expect(revisionRequests).toHaveLength(1));
    expect((revisionRequests[0]!.cards as Array<Record<string, unknown>>)[0]).toMatchObject({
      cardType: 'chart',
      chartRevisionId: remoteChart.current_revision_id,
    });
  });

  it('marks archived visualizations as read-only and restores them with icon actions', async () => {
    const lifecycleRequests: Array<{ method: string | undefined; url: string }> = [];
    const retiredChart = {
      ...savedChart('019fbcf9-e020-71da-935a-6a6a728b3784', 'Retired chart'),
      archived_at: '2026-08-11T00:00:00.000Z',
    };
    const retiredCanvas = {
      ...dashboard(),
      name: 'Retired canvas',
      cards: [],
      archived_at: '2026-08-11T00:00:00.000Z',
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (
        url.endsWith(`/charts/${retiredChart.id}/restore`) ||
        url.endsWith(`/dashboards/${retiredCanvas.id}/restore`)
      ) {
        lifecycleRequests.push({ method: init?.method, url });
        return json({});
      }
      if (url.includes('/datasets?'))
        return json({
          items: [],
          pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
        });
      if (url.includes('/charts?'))
        return json({
          items: [retiredChart],
          pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
        });
      if (url.includes('/dashboards?'))
        return json({
          items: [retiredCanvas],
          pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
        });
      if (url.endsWith('/dashboard-metrics'))
        return json({
          total_samples: 0,
          dataset_count: 0,
          failed_evaluations: 0,
          pass_rate: null,
          overdue_tasks: 0,
          recent_datasets: [],
        });
      if (url.includes('/object-types?')) return json({ items: [] });
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter
        initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/visualizations`]}
      >
        <Routes>
          <Route
            element={
              <VisualizationsPage
                user={{
                  id: '019fbcf9-e020-71da-935a-6a6a728b3795',
                  email: 'owner@example.com',
                  displayName: 'Owner',
                  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3796',
                  role: 'owner',
                }}
              />
            }
            path="/workspaces/:workspaceId/projects/:projectId/visualizations"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Retired canvas' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Retired canvas.*Archived/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add element' })).not.toBeInTheDocument();
    const restoreCanvas = screen.getByRole('button', { name: 'Restore Retired canvas' });
    expect(restoreCanvas).toHaveTextContent('↥');
    expect(screen.getByRole('tooltip', { name: 'Restore Retired canvas' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Saved charts'));
    expect(await screen.findByRole('heading', { name: 'Retired chart' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish revision' })).not.toBeInTheDocument();
    const restoreChart = screen.getByRole('button', { name: 'Restore Retired chart' });
    expect(restoreChart).toHaveTextContent('↥');
    expect(screen.getByRole('tooltip', { name: 'Restore Retired chart' })).toBeInTheDocument();

    fireEvent.click(restoreCanvas);
    await waitFor(() =>
      expect(lifecycleRequests).toContainEqual({
        method: 'POST',
        url: `http://localhost:3000/api/v1/workspaces/${workspaceId}/projects/${projectId}/dashboards/${retiredCanvas.id}/restore`,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restore Retired chart' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore Retired chart' }));
    await waitFor(() =>
      expect(lifecycleRequests).toContainEqual({
        method: 'POST',
        url: `http://localhost:3000/api/v1/workspaces/${workspaceId}/projects/${projectId}/charts/${retiredChart.id}/restore`,
      }),
    );
  });

  it('loads additional canvases from an explicit bounded page', async () => {
    const urls: string[] = [];
    const secondDashboard = {
      ...dashboard(),
      id: '019fbcf9-e020-71da-935a-6a6a728b3799',
      name: 'Quality review',
      cards: [],
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/datasets?'))
        return json({
          items: [],
          pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
        });
      if (url.includes('/charts?')) {
        return json({
          items: [],
          pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
        });
      }
      if (url.includes('/dashboards?') && url.includes('offset=1')) {
        return json({
          items: [secondDashboard],
          pageInfo: { limit: 50, offset: 1, total: 2, hasNext: false },
        });
      }
      if (url.includes('/dashboards?')) {
        return json({
          items: [{ ...dashboard(), cards: [] }],
          pageInfo: { limit: 50, offset: 0, total: 2, hasNext: true },
        });
      }
      if (url.endsWith('/dashboard-metrics')) {
        return json({
          total_samples: 0,
          dataset_count: 0,
          failed_evaluations: 0,
          pass_rate: null,
          overdue_tasks: 0,
          recent_datasets: [],
        });
      }
      if (url.includes('/object-types?')) return json({ items: [] });
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter
        initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/visualizations`]}
      >
        <Routes>
          <Route
            element={
              <VisualizationsPage
                user={{
                  id: '019fbcf9-e020-71da-935a-6a6a728b3795',
                  email: 'owner@example.com',
                  displayName: 'Owner',
                  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3796',
                  role: 'owner',
                }}
              />
            }
            path="/workspaces/:workspaceId/projects/:projectId/visualizations"
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Load more canvases (1 of 2)' }));
    expect(await screen.findByRole('option', { name: /Quality review/ })).toBeInTheDocument();
    expect(urls.some((url) => url.endsWith('/dashboards?archiveState=all&limit=50&offset=1'))).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: /Load more canvases/ })).not.toBeInTheDocument();
  });
});

function dashboard() {
  return {
    id: dashboardId,
    name: 'Operations',
    description: '',
    current_revision_id: '019fbcf9-e020-71da-935a-6a6a728b3797',
    revision_number: 1,
    archived_at: null,
    cards: [
      {
        id: '019fbcf9-e020-71da-935a-6a6a728b3798',
        card_type: 'record_kpi',
        chart_revision_id: null,
        config: {
          title: 'Open issues',
          metric: 'count',
          source: {
            objectTypeId,
            tableName: 'Issues',
            filters: [],
            sorts: [{ systemField: 'updatedAt', direction: 'desc' }],
          },
        },
        x: 0,
        y: 0,
        width: 4,
        height: 3,
        position: 0,
      },
    ],
  };
}

function xyDataset(id: string, name: string) {
  return {
    id,
    name,
    dataset_type: 'xy',
    status: 'ready',
    schema: {
      columns: [
        { id: `${id}-x`, name: 'Time', dataType: 'float', role: 'x' },
        { id: `${id}-y`, name: 'Force', dataType: 'float', role: 'y' },
      ],
    },
  };
}

function savedChart(id: string, name: string) {
  return {
    id,
    name,
    description: '',
    current_revision_id: `${id}-revision`,
    revision_number: 1,
    chart_type: 'line',
    config_version: 1,
    config: {},
    sources: [],
    archived_at: null,
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
