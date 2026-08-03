import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VisualizationsPage } from './VisualizationsPage.js';

const workspaceId = '019fbcf9-e020-71da-935a-6a6a728b3790';
const projectId = '019fbcf9-e020-71da-935a-6a6a728b3791';
const dashboardId = '019fbcf9-e020-71da-935a-6a6a728b3792';
const objectTypeId = '019fbcf9-e020-71da-935a-6a6a728b3793';

afterEach(() => vi.restoreAllMocks());

describe('VisualizationsPage record dashboard cards', () => {
  it('renders a live record KPI and pins a new cross-table card into a revision', async () => {
    const revisionRequests: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/datasets')) return json({ items: [] });
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
      if (url.endsWith('/object-types'))
        return json({ items: [{ id: objectTypeId, name: 'Issue', pluralName: 'Issues' }] });
      if (url.endsWith(`/object-types/${objectTypeId}/fields`))
        return json({
          items: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3794',
              name: 'Status',
              key: 'status',
              fieldType: 'single_select',
              projectionStatus: 'ready',
              config: { options: [{ key: 'open', label: 'Open' }] },
            },
          ],
        });
      if (url.endsWith(`/object-types/${objectTypeId}/views`)) return json({ items: [] });
      if (url.endsWith(`/object-types/${objectTypeId}/records/query`))
        return json({ items: [], page: 1, pageSize: 1, total: 7 });
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
    const card = screen.getByText('Open issues').closest('article');
    expect(card).not.toBeNull();
    fireEvent.contextMenu(card!, { clientX: 80, clientY: 100 });
    expect(screen.getByRole('menu', { name: 'Open issues' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open source table' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Duplicate card' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Copy card title' }), {
      key: 'Escape',
    });
    fireEvent.change(screen.getByPlaceholderText('Card title'), {
      target: { value: 'All issues' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }));

    await waitFor(() => expect(revisionRequests).toHaveLength(1));
    const cards = revisionRequests[0]!.cards as Array<Record<string, unknown>>;
    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({
      cardType: 'record_kpi',
      configVersion: 2,
      width: 4,
      height: 3,
      config: {
        title: 'All issues',
        metric: 'count',
        source: { objectTypeId, tableName: 'Issues', filters: [] },
      },
    });
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

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
