import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowed, api } from './App.js';
import { I18nProvider } from './i18n.js';
import { WorkspaceOverviewPage } from './WorkspaceOverviewPage.js';

const workspaceId = 'w1234567890abcd';
const projectId = 'p1234567890abcd';
const user = {
  id: '019fbcf9-e020-71da-935a-6a6a728b3790',
  email: 'owner@example.com',
  displayName: 'Owner',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'owner' as const,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('WorkspaceOverviewPage', () => {
  it('summarizes project work and key dates across the workspace', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(`/workspaces/${workspaceId}/overview?`)) {
        return json({
          workspace: {
            id: '019fbcf9-e020-71da-935a-6a6a728b3700',
            publicId: workspaceId,
            name: 'Vehicle launch',
            description: 'Shared program workspace',
          },
          summary: {
            activeProjects: 1,
            openTasks: 2,
            blockedTasks: 1,
            overdueDates: 1,
            nextUpcomingDate: {
              id: '019fbcf9-e020-71da-935a-6a6a728b3702',
              title: 'Design freeze',
              status: 'active',
              targetDate: '2099-09-15',
              project: {
                id: '019fbcf9-e020-71da-935a-6a6a728b3701',
                publicId: projectId,
                name: 'Battery validation',
              },
            },
          },
          projects: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3701',
              publicId: projectId,
              name: 'Battery validation',
              key: 'BATT',
              status: 'active',
              archivedAt: null,
              openTaskCount: 2,
              blockedTaskCount: 1,
              overdueDateCount: 1,
              nextDate: {
                id: '019fbcf9-e020-71da-935a-6a6a728b3702',
                title: 'Design freeze',
                status: 'active',
                targetDate: '2099-09-15',
              },
            },
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3704',
              publicId: 'p1234567890abce',
              name: 'Archived supplier study',
              key: 'SUPPLIER',
              status: 'completed',
              archivedAt: '2026-08-01T00:00:00.000Z',
              openTaskCount: 0,
              blockedTaskCount: 0,
              overdueDateCount: 0,
              nextDate: null,
            },
          ],
          projectPageInfo: { limit: 20, offset: 0, total: 2, hasNext: false },
          dates: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3702',
              title: 'Design freeze',
              status: 'active',
              targetDate: '2099-09-15',
              project: {
                id: '019fbcf9-e020-71da-935a-6a6a728b3701',
                publicId: projectId,
                name: 'Battery validation',
              },
            },
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3703',
              title: 'Prototype release',
              status: 'at_risk',
              targetDate: '2000-01-01',
              project: {
                id: '019fbcf9-e020-71da-935a-6a6a728b3701',
                publicId: projectId,
                name: 'Battery validation',
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workspaces/${workspaceId}`]}>
          <Routes>
            <Route
              element={<WorkspaceOverviewPage canAccess={allowed} request={api} user={user} />}
              path="/workspaces/:workspaceId"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Vehicle launch' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Workspace status summary' });
    expect(within(summary).getByText('Active projects').parentElement).toHaveTextContent('1');
    expect(within(summary).getByText('Open tasks').parentElement).toHaveTextContent('2');
    expect(within(summary).getByText('Blocked tasks').parentElement).toHaveTextContent('1');
    expect(within(summary).getByText('Overdue key dates').parentElement).toHaveTextContent('1');
    expect(
      screen
        .getAllByRole('link')
        .find(
          (link) =>
            link.getAttribute('href') === `/workspaces/${workspaceId}/projects/${projectId}`,
        ),
    ).toHaveAttribute('href', `/workspaces/${workspaceId}/projects/${projectId}`);
    expect(screen.getByRole('link', { name: /Design freeze/ })).toHaveAttribute(
      'href',
      `/workspaces/${workspaceId}/projects/${projectId}/milestones`,
    );
    fireEvent.click(screen.getByText('Archived projects (1)'));
    expect(screen.getByRole('link', { name: /Archived supplier study/ })).toHaveAttribute(
      'href',
      `/workspaces/${workspaceId}/projects/p1234567890abce/settings`,
    );
    expect(screen.queryByText('BATT')).not.toBeInTheDocument();
  });

  it('creates a project from the workspace overview with required and optional fields', async () => {
    const requests: Array<{ method: string; body?: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes(`/workspaces/${workspaceId}/overview?`)) {
        return json({
          workspace: {
            id: '019fbcf9-e020-71da-935a-6a6a728b3700',
            publicId: workspaceId,
            name: 'Vehicle launch',
            description: '',
          },
          summary: {
            activeProjects: 0,
            openTasks: 0,
            blockedTasks: 0,
            overdueDates: 0,
            nextUpcomingDate: null,
          },
          projects: [],
          projectPageInfo: { limit: 20, offset: 0, total: 0, hasNext: false },
          dates: [],
        });
      }
      if (url.endsWith(`/workspaces/${workspaceId}/projects`) && init?.method === 'POST') {
        requests.push({ method: init.method, body: String(init.body) });
        return json({ id: 'new-project', name: 'New validation' });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workspaces/${workspaceId}`]}>
          <Routes>
            <Route
              element={<WorkspaceOverviewPage canAccess={allowed} request={api} user={user} />}
              path="/workspaces/:workspaceId"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Create a project' }));
    const form = screen.getByRole('form', { name: 'Create a project' });
    const name = within(form).getByRole('textbox', { name: /Project name/ });
    const key = within(form).getByRole('textbox', { name: /Project key/ });
    const description = within(form).getByRole('textbox', { name: /Description/ });
    expect(name).toBeRequired();
    expect(key).toBeRequired();
    expect(description).not.toBeRequired();
    fireEvent.change(name, { target: { value: 'New validation' } });
    fireEvent.change(key, { target: { value: 'NEW' } });
    fireEvent.change(description, { target: { value: 'Integrated creation flow' } });
    fireEvent.submit(form);

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(screen.queryByRole('form', { name: 'Create a project' })).not.toBeInTheDocument();
    expect(JSON.parse(requests[0]!.body ?? '{}')).toEqual({
      name: 'New validation',
      key: 'NEW',
      description: 'Integrated creation flow',
      visibility: 'workspace',
    });
  });

  it('loads additional project pages without replacing the workspace-wide summary', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (!url.includes(`/workspaces/${workspaceId}/overview?`))
        throw new Error(`Unexpected fetch ${url}`);
      const secondPage = url.includes('projectOffset=1');
      const projectNumber = secondPage ? 2 : 1;
      return json({
        workspace: {
          id: '019fbcf9-e020-71da-935a-6a6a728b3700',
          publicId: workspaceId,
          name: 'Paged workspace',
          description: '',
        },
        summary: {
          activeProjects: 2,
          openTasks: 7,
          blockedTasks: 0,
          overdueDates: 0,
          nextUpcomingDate: null,
        },
        projects: [
          {
            id: `019fbcf9-e020-71da-935a-6a6a728b370${projectNumber}`,
            publicId: `p1234567890abc${projectNumber}`,
            name: `Project ${projectNumber}`,
            key: `P${projectNumber}`,
            status: 'active',
            archivedAt: null,
            openTaskCount: projectNumber === 1 ? 3 : 4,
            blockedTaskCount: 0,
            overdueDateCount: 0,
            nextDate: null,
          },
        ],
        projectPageInfo: {
          limit: 20,
          offset: secondPage ? 1 : 0,
          total: 2,
          hasNext: !secondPage,
        },
        dates: [],
      });
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workspaces/${workspaceId}`]}>
          <Routes>
            <Route
              element={<WorkspaceOverviewPage canAccess={allowed} request={api} user={user} />}
              path="/workspaces/:workspaceId"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByRole('link', { name: /Project 1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more (1 of 2)' }));
    expect(await screen.findByRole('link', { name: /Project 2/ })).toBeInTheDocument();
    expect(screen.getByText('Open tasks').parentElement).toHaveTextContent('7');
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument();
  });

  it('searches the complete project catalog from the workspace overview', async () => {
    const requestedQueries: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('projectQuery') ?? '';
      requestedQueries.push(query);
      const matching = query === 'Battery';
      const projects = matching
        ? [overviewProject('Battery validation', projectId)]
        : [
            overviewProject('Battery validation', projectId),
            overviewProject('Thermal qualification', 'p1234567890abce'),
          ];
      return json({
        workspace: {
          id: '019fbcf9-e020-71da-935a-6a6a728b3700',
          publicId: workspaceId,
          name: 'Searchable workspace',
          description: '',
        },
        summary: {
          activeProjects: 2,
          openTasks: 7,
          blockedTasks: 1,
          overdueDates: 0,
          nextUpcomingDate: null,
        },
        projects,
        projectPageInfo: {
          limit: 20,
          offset: 0,
          total: projects.length,
          hasNext: false,
        },
        dates: [],
      });
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workspaces/${workspaceId}`]}>
          <Routes>
            <Route
              element={<WorkspaceOverviewPage canAccess={allowed} request={api} user={user} />}
              path="/workspaces/:workspaceId"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByRole('region', { name: 'Project pulse' });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search projects' }), {
      target: { value: 'Battery' },
    });
    await waitFor(() => expect(requestedQueries).toContain('Battery'));
    expect(await screen.findByRole('link', { name: /Battery validation/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Thermal qualification/ })).not.toBeInTheDocument();
    expect(screen.getByText('1 of 1 projects')).toBeInTheDocument();
    expect(screen.getByText('Open tasks').parentElement).toHaveTextContent('7');

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Thermal qualification/ })).toBeInTheDocument(),
    );
  });

  it('distinguishes a load failure from an empty workspace and recovers on retry', async () => {
    let overviewAttempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(`/workspaces/${workspaceId}/overview?`)) {
        overviewAttempts += 1;
        if (overviewAttempts === 1) {
          return new Response(
            JSON.stringify({ error: { message: 'Workspace service is temporarily unavailable.' } }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          );
        }
        return json({
          workspace: {
            id: '019fbcf9-e020-71da-935a-6a6a728b3700',
            publicId: workspaceId,
            name: 'Recovered workspace',
            description: '',
          },
          summary: {
            activeProjects: 0,
            openTasks: 0,
            blockedTasks: 0,
            overdueDates: 0,
            nextUpcomingDate: null,
          },
          projects: [],
          projectPageInfo: { limit: 20, offset: 0, total: 0, hasNext: false },
          dates: [],
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workspaces/${workspaceId}`]}>
          <Routes>
            <Route
              element={<WorkspaceOverviewPage canAccess={allowed} request={api} user={user} />}
              path="/workspaces/:workspaceId"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(
      await screen.findByText('Workspace service is temporarily unavailable.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No active projects yet.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Recovered workspace' })).toBeInTheDocument();
    expect(screen.getByText('No active projects yet.')).toBeInTheDocument();
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function overviewProject(name: string, publicId: string) {
  return {
    id:
      publicId === projectId
        ? '019fbcf9-e020-71da-935a-6a6a728b3701'
        : '019fbcf9-e020-71da-935a-6a6a728b3702',
    publicId,
    name,
    key: name.startsWith('Battery') ? 'BATT' : 'THERM',
    status: 'active',
    archivedAt: null,
    openTaskCount: name.startsWith('Battery') ? 3 : 4,
    blockedTaskCount: name.startsWith('Battery') ? 1 : 0,
    overdueDateCount: 0,
    nextDate: null,
  };
}
