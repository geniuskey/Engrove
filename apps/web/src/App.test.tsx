import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiStatus,
  App,
  ApplicationErrorBoundary,
  api,
  authenticationRequiredEvent,
  LegacyFilesDatasetsRedirect,
  MembersPage,
  ProjectSettingsPage,
  WorkspaceProjectsRedirect,
} from './App.js';
import { I18nProvider } from './i18n.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.lang = 'en';
  window.history.replaceState({}, '', '/');
});

describe('App', () => {
  it('contains a render failure, reports bounded diagnostics, and retries in place', async () => {
    window.history.replaceState({}, '', '/workspaces/w1/projects/p1/tasks?query=private-value');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 202 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldFail = true;
    function RecoverableView() {
      if (shouldFail) throw new TypeError('Sensitive record value must never be reported');
      return <p>Recovered view</p>;
    }

    render(
      <ApplicationErrorBoundary
        labels={{
          body: 'Data was not changed.',
          chunkBody: 'A required update could not be loaded.',
          heading: 'This view could not be displayed',
          home: 'Return to workspaces',
          reference: 'Error reference',
          reload: 'Reload Engrove',
          retry: 'Try this view again',
        }}
      >
        <RecoverableView />
      </ApplicationErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading')).toHaveTextContent(
      'This view could not be displayed',
    );
    expect(alert).not.toHaveTextContent('Sensitive record value');
    expect(within(alert).getByRole('link', { name: 'Return to workspaces' })).toHaveAttribute(
      'href',
      '/workspaces',
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const report = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(report).toMatchObject({
      kind: 'render_error',
      route: '/workspaces/w1/projects/p1/tasks',
      errorName: 'TypeError',
    });
    expect(report).not.toHaveProperty('message');
    expect(JSON.stringify(report)).not.toContain('private-value');
    expect(JSON.stringify(report)).not.toContain('Sensitive record value');

    shouldFail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try this view again' }));
    expect(screen.getByText('Recovered view')).toBeInTheDocument();
  });

  it('emits a global recovery signal only for an expired authenticated session', async () => {
    const expired = vi.fn();
    window.addEventListener(authenticationRequiredEvent, expired);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required.' },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(api('/workspaces')).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(authenticationRequiredEvent, expired);
  });

  it('recovers an expired session and returns to the same protected location', async () => {
    const user = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3790',
      email: 'owner@example.com',
      displayName: 'Owner',
      organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
      role: 'owner',
    };
    window.history.replaceState({}, '', '/get-started?source=task#progress');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/setup/status')) return json({ available: false });
      if (url.endsWith('/auth/me')) return json({ user });
      if (url.endsWith('/auth/oidc/status')) return json({ enabled: false });
      if (url.endsWith('/auth/sign-in') && init?.method === 'POST') return json({ user });
      if (url.endsWith('/me/member-groups')) return json({ items: [] });
      if (url.endsWith('/workspaces')) return json({ items: [], pageInfo: { hasNext: false } });
      if (url.endsWith('/onboarding')) return json({ completed_steps: [] });
      if (url.includes('/notifications')) {
        return json({
          items: [],
          unreadCount: 0,
          pageInfo: { limit: 20, offset: 0, total: 0, hasNext: false },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/get-started?source=task#progress']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Get started' })).toBeInTheDocument();
    act(() => window.dispatchEvent(new CustomEvent(authenticationRequiredEvent)));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your session expired. Sign in again to continue from the same place.',
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument();
  });

  it('renders an actionable unavailable state and recovers', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            service: 'api',
            status: 'ok',
            version: '0.1.0',
            timestamp: '',
            requestId: 'r1',
          }),
          { status: 200 },
        ),
      );

    render(<ApiStatus />);
    expect(await screen.findByText('API unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/All systems ready/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('turns the signed-in home into a searchable workspace command center', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/setup/status')) return json({ available: false });
      if (url.endsWith('/auth/me')) {
        return json({
          user: {
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          },
        });
      }
      if (url.endsWith('/me/member-groups')) return json({ items: [] });
      const workspaces = [
        {
          id: 'alpha-id',
          publicId: 'w11111111111111',
          name: 'Alpha lab',
          slug: 'alpha-lab',
          description: 'Optical validation program',
          archivedAt: null,
        },
        {
          id: 'primary-id',
          publicId: 'w22222222222222',
          name: 'Primary materials',
          slug: 'primary-materials',
          description: 'Supplier qualification evidence',
          archivedAt: null,
        },
      ];
      if (url.endsWith('/workspaces')) return json({ items: workspaces });
      if (url.includes('/workspaces?')) {
        const query = new URL(url).searchParams.get('query')?.toLowerCase() ?? '';
        const items = workspaces.filter((workspace) =>
          [workspace.name, workspace.slug, workspace.description].some((value) =>
            value.toLowerCase().includes(query),
          ),
        );
        return json({
          items,
          pageInfo: {
            limit: 24,
            offset: 0,
            total: items.length,
            overallTotal: workspaces.length,
            hasNext: false,
          },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Welcome back, Owner' })).toBeInTheDocument();
    expect(screen.getByLabelText('A connected evidence chain')).toBeInTheDocument();
    const search = screen.getByRole('searchbox', { name: 'Search workspaces' });
    fireEvent.change(search, { target: { value: 'supplier' } });
    expect(await screen.findByRole('heading', { name: 'Primary materials' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Alpha lab' })).not.toBeInTheDocument(),
    );
    expect(screen.getByText('1 of 2 workspaces match')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'not-a-workspace' } });
    expect(
      await screen.findByRole('heading', { name: 'No matching workspaces' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all workspaces' }));
    expect(await screen.findByRole('heading', { name: 'Alpha lab' })).toBeInTheDocument();

    const createButton = screen.getAllByRole('button', { name: 'Create a workspace' })[0]!;
    createButton.focus();
    fireEvent.click(createButton);
    const dialog = screen.getByRole('dialog', { name: 'Create a workspace' });
    expect(within(dialog).getByRole('textbox', { name: 'Workspace name' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Create a workspace' })).not.toBeInTheDocument();
    await waitFor(() => expect(createButton).toHaveFocus());
  });

  it('explains restricted administration routes without requesting protected data', async () => {
    const requestedUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith('/setup/status')) return json({ available: false });
      if (url.endsWith('/auth/me')) {
        return json({
          user: {
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'viewer@example.com',
            displayName: 'Viewer',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'viewer',
          },
        });
      }
      if (url.endsWith('/workspaces')) return json({ items: [] });
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/members']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this area.' }),
    ).toBeInTheDocument();
    expect(requestedUrls.some((url) => url.endsWith('/members'))).toBe(false);
    expect(screen.getByRole('link', { name: 'Back to workspaces' })).toHaveAttribute(
      'href',
      '/workspaces',
    );
  });

  it('renders audit events with actor and target context', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/setup/status')) return json({ available: false });
      if (url.endsWith('/auth/me')) {
        return json({
          user: {
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          },
        });
      }
      if (url.endsWith('/workspaces')) return json({ items: [] });
      if (url.endsWith('/audit-events?query=&limit=50&offset=0')) {
        return json({
          items: [
            {
              id: 'event-1',
              actorName: 'Quality Lead',
              actorEmail: 'quality@example.com',
              action: 'project.updated',
              targetType: 'project',
              targetId: 'project-1',
              requestId: 'request-1',
              payload: {},
              createdAt: '2026-08-07T12:00:00.000Z',
            },
          ],
          pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/audit']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('project.updated')).toBeInTheDocument();
    expect(screen.getByText('Quality Lead')).toBeInTheDocument();
    expect(screen.getByText('quality@example.com')).toBeInTheDocument();
    expect(screen.getByText('project-1')).toBeInTheDocument();
  });

  it('keeps project areas available in contextual navigation', async () => {
    const requestedUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith('/setup/status')) return json({ available: false });
      if (url.endsWith('/auth/me')) {
        return json({
          user: {
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          },
        });
      }
      if (url.endsWith('/me/member-groups')) return json({ items: [] });
      if (url.endsWith('/workspaces')) {
        return json({
          items: [
            {
              id: 'workspace-id',
              publicId: 'w1234567890abcd',
              name: 'Alpha workspace',
              slug: 'alpha',
              description: '',
              archivedAt: null,
            },
          ],
        });
      }
      if (
        url.endsWith('/workspaces/workspace-id/projects') ||
        url.endsWith('/workspaces/w1234567890abcd/projects')
      ) {
        return json({
          items: [
            {
              id: 'project-id',
              publicId: 'p1234567890abcd',
              workspaceId: 'workspace-id',
              name: 'Alpha',
              key: 'ALPHA',
              description: 'Traceable force testing',
              status: 'active',
              rowVersion: 1,
              archivedAt: null,
            },
          ],
        });
      }
      if (
        url.includes('/workspaces/workspace-id/project-options?') ||
        url.includes('/workspaces/w1234567890abcd/project-options?')
      ) {
        return json({
          items: [
            {
              id: 'project-id',
              publicId: 'p1234567890abcd',
              workspaceId: 'workspace-id',
              name: 'Alpha',
              key: 'ALPHA',
              description: 'Traceable force testing',
              status: 'active',
              rowVersion: 1,
              archivedAt: null,
            },
          ],
          pageInfo: { limit: 20, total: 1, hasMore: false },
        });
      }
      if (
        url.endsWith('/workspaces/workspace-id/projects/project-id') ||
        url.endsWith('/workspaces/w1234567890abcd/projects/p1234567890abcd')
      ) {
        return json({
          id: 'project-id',
          publicId: 'p1234567890abcd',
          workspaceId: 'workspace-id',
          name: 'Alpha',
          key: 'ALPHA',
          description: 'Traceable force testing',
          status: 'active',
          rowVersion: 1,
          archivedAt: null,
        });
      }
      if (url.endsWith('/projects/p1234567890abcd/demo')) {
        return json({ installed: true });
      }
      if (url.includes('/projects/') && url.endsWith('/dashboard-metrics')) {
        return json({
          total_samples: 128,
          dataset_count: 3,
          chart_count: 1,
          dashboard_count: 1,
          object_type_count: 2,
          failed_evaluations: 2,
          pass_rate: '96.4',
          overdue_tasks: 1,
          active_task_count: 3,
          completed_task_count: 1,
          blocked_task_count: 1,
          recent_datasets: [
            {
              id: 'dataset-1',
              name: 'Force sweep · revision 4',
              status: 'ready',
              row_count: 240,
              created_at: '2026-08-01T12:00:00.000Z',
            },
          ],
        });
      }
      if (url.includes('/projects/') && url.endsWith('/tasks?includeArchived=true')) {
        return json({
          items: [
            { id: 'task-1', status: 'done', archived_at: null },
            { id: 'task-2', status: 'blocked', archived_at: null },
            { id: 'task-3', status: 'in_progress', archived_at: null },
          ],
        });
      }
      if (url.includes('/projects/') && url.endsWith('/files?includeArchived=true')) {
        return json({ items: [{ archived_at: null }, { archived_at: null }] });
      }
      if (url.includes('/projects/') && url.endsWith('/datasets?includeArchived=true')) {
        return json({
          items: [{ id: 'dataset-1', name: 'Force sweep', status: 'ready', archived_at: null }],
        });
      }
      if (
        url.includes('/projects/') &&
        url.endsWith('/sources?archiveState=active&limit=4&offset=0')
      ) {
        return json({
          items: [
            {
              id: 'source-1',
              title: 'Supplier qualification report',
              provider: 'SharePoint',
              url: 'https://sharepoint.example/reports/qualification',
              version: 'Rev 4',
              observed_on: '2026-08-01',
              archived_at: null,
            },
          ],
          pageInfo: { limit: 4, offset: 0, total: 1, hasNext: false },
          summary: { providerCount: 1 },
        });
      }
      if (url.includes('/projects/') && url.endsWith('/charts?includeArchived=true')) {
        return json({ items: [{ archived_at: null }] });
      }
      if (url.includes('/projects/') && url.endsWith('/dashboards?includeArchived=true')) {
        return json({ items: [{ archived_at: null }] });
      }
      if (url.includes('/projects/') && url.endsWith('/object-types')) {
        return json({ items: [{ id: 'type-1' }, { id: 'type-2' }] });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/workspaces/workspace-id/projects/project-id']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );

    const projectNav = await screen.findByRole('navigation', { name: 'Project navigation' });
    expect(screen.getByLabelText('Service sidebar')).toHaveClass('service-sidebar');
    const brandImages = screen.getByRole('link', { name: 'Engrove home' }).querySelectorAll('img');
    expect([...brandImages].map((image) => image.getAttribute('src'))).toEqual([
      '/engrove-mark-light.png',
      '/engrove-mark-dark.png',
    ]);
    expect(
      screen.getByRole('link', { name: 'Engrove home' }).querySelector('.engrove-brand-mark'),
    ).toHaveClass('engrove-brand-mark--auto');
    expect(projectNav).toHaveTextContent('Overview');
    expect(projectNav).toHaveTextContent('Key dates');
    expect(projectNav).toHaveTextContent('Tasks');
    expect(projectNav).toHaveTextContent('Records');
    expect(projectNav).toHaveTextContent('External materials');
    expect(projectNav).not.toHaveTextContent('Files & datasets');
    expect(projectNav).toHaveTextContent('Dashboards');
    expect(projectNav).toHaveTextContent('Project settings');
    expect(within(projectNav).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByText('Project command center · ALPHA')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to workspace overview' })).toHaveAttribute(
      'href',
      '/workspaces/workspace-id',
    );
    expect(screen.getAllByText('Pass rate')).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Open key dates/ })).toHaveAttribute(
        'href',
        '/workspaces/workspace-id/projects/p1234567890abcd/milestones',
      ),
    );
    await waitFor(() =>
      expect(screen.getByText('Supplier qualification report')).toBeInTheDocument(),
    );
    await waitFor(() => {
      const dashboardLinks = screen.getByRole('navigation', { name: 'Project quick links' });
      expect(within(dashboardLinks).getByRole('link', { name: /Records/ })).toHaveTextContent(
        '2 tables · 128 samples',
      );
      expect(
        within(dashboardLinks).getByRole('link', { name: /External materials/ }),
      ).toHaveTextContent('Linked external materials · 1');
      expect(screen.getByText('1 of 3 completed')).toBeInTheDocument();
      expect(requestedUrls.some((url) => url.endsWith('/charts?includeArchived=true'))).toBe(false);
      expect(requestedUrls.some((url) => url.endsWith('/dashboards?includeArchived=true'))).toBe(
        false,
      );
      expect(requestedUrls.some((url) => url.endsWith('/object-types'))).toBe(false);
    });
    expect(screen.getByRole('link', { name: 'Inspect raw source →' })).toHaveAttribute(
      'href',
      '/workspaces/w1234567890abcd/projects/p1234567890abcd/sources',
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('navigation', { name: 'Project navigation' })).getByRole('link', {
          name: 'Overview',
        }),
      ).toHaveAttribute('href', '/workspaces/w1234567890abcd/projects/p1234567890abcd'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Records/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open command palette' })).toHaveFocus(),
    );

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Workspace selector' })).toHaveValue(
        'Alpha workspace',
      ),
    );
    expect(screen.getByRole('link', { name: 'Data library' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Project list' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse service sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand service sidebar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand service sidebar' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('engrove-theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const settingsDialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(within(settingsDialog).getByRole('combobox', { name: 'Language' })).toBeInTheDocument();
    expect(within(settingsDialog).getByRole('button', { name: 'dark' })).toBeInTheDocument();
    expect(within(settingsDialog).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    fireEvent.click(within(settingsDialog).getByRole('button', { name: 'dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('engrove-theme')).toBe('dark');
    expect(window.localStorage.getItem('engrove-theme-explicit')).toBe('true');

    expect(document.documentElement).toHaveAttribute('lang', 'en');
    fireEvent.change(within(settingsDialog).getByRole('combobox', { name: 'Language' }), {
      target: { value: 'ko' },
    });
    expect(await screen.findByRole('link', { name: '데이터 라이브러리' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '프로젝트 목록' })).not.toBeInTheDocument();
    expect(screen.getByText('프로젝트 운영 현황 · ALPHA')).toBeInTheDocument();
    expect(screen.getByText('작업 이어가기')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '설정' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '명령 팔레트 열기' }));
    expect(screen.getByRole('dialog', { name: '명령 팔레트' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '명령 검색' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.documentElement).toHaveAttribute('lang', 'ko');
    expect(window.localStorage.getItem('engrove-locale')).toBe('ko');
    fireEvent.click(screen.getByRole('link', { name: 'Engrove 홈' }));
    await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent(/^\/$/));
  });

  it('switches workspaces without reusing the previous table context', async () => {
    const alphaWorkspaceId = 'w11111111111111';
    const primaryWorkspaceId = 'w22222222222222';
    const requestedUrls: string[] = [];
    let resolvePrimaryContext!: (response: Response) => void;
    const primaryContext = new Promise<Response>((resolve) => {
      resolvePrimaryContext = resolve;
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith('/setup/status')) return json({ available: false });
      if (url.endsWith('/auth/me')) {
        return json({
          user: {
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          },
        });
      }
      if (url.endsWith('/workspaces')) {
        return json({
          items: [
            { id: 'alpha-id', publicId: alphaWorkspaceId, name: 'Alpha' },
            { id: 'primary-id', publicId: primaryWorkspaceId, name: 'Primary' },
          ],
        });
      }
      if (url.includes('/workspaces?')) {
        return json({
          items: [{ id: 'primary-id', publicId: primaryWorkspaceId, name: 'Primary' }],
          pageInfo: {
            limit: 20,
            offset: 0,
            total: 1,
            overallTotal: 2,
            hasNext: false,
          },
        });
      }
      if (url.endsWith(`/workspaces/${alphaWorkspaceId}/data-context`)) {
        return json({ projectId: 'alpha-project', legacyProjectIds: [] });
      }
      if (url.endsWith(`/workspaces/${primaryWorkspaceId}/data-context`)) {
        return primaryContext;
      }
      if (url.endsWith(`/workspaces/${alphaWorkspaceId}/project-options?limit=20`)) {
        return json({
          items: [
            {
              id: 'alpha-project',
              name: 'Alpha project',
              key: 'ALPHA',
              archivedAt: null,
            },
          ],
        });
      }
      if (url.endsWith(`/workspaces/${primaryWorkspaceId}/project-options?limit=20`)) {
        return json({ items: [] });
      }
      if (url.endsWith(`/workspaces/${alphaWorkspaceId}/projects/alpha-project/object-types`)) {
        return json({
          items: [
            {
              id: 'alpha-type-id',
              publicId: 't11111111111111',
              projectId: 'alpha-project',
              name: 'Sample',
              pluralName: 'Samples',
              key: 'sample',
              icon: 'table',
              description: '',
              system: false,
            },
          ],
        });
      }
      if (url.endsWith(`/workspaces/${primaryWorkspaceId}/projects/primary-project/object-types`)) {
        return json({ items: [] });
      }
      if (url.endsWith('/object-types/alpha-type-id/fields')) return json({ items: [] });
      if (new URL(url).pathname.endsWith('/object-types/alpha-type-id/views'))
        return json({ items: [] });
      if (url.endsWith('/object-types/alpha-type-id/records/query')) {
        return json({ items: [], page: 1, pageSize: 25, total: 0 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter initialEntries={[`/workspaces/${alphaWorkspaceId}/data`]}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Samples' })).toBeInTheDocument();
    const workspacePicker = screen.getByRole('combobox', { name: 'Workspace selector' });
    fireEvent.focus(workspacePicker);
    fireEvent.change(workspacePicker, { target: { value: 'Primary' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Primary' }));

    await waitFor(() =>
      expect(screen.getByTestId('current-location')).toHaveTextContent(
        `/workspaces/${primaryWorkspaceId}/data`,
      ),
    );
    expect(screen.getByLabelText('Opening workspace data')).toBeInTheDocument();

    resolvePrimaryContext(json({ projectId: 'primary-project', legacyProjectIds: [] }));
    expect(await screen.findByRole('heading', { name: 'Data library' })).toBeInTheDocument();
    expect(screen.getByTestId('current-location')).toHaveTextContent(
      `/workspaces/${primaryWorkspaceId}/data`,
    );
    expect(screen.queryByText('Object type was not found.')).not.toBeInTheDocument();
    expect(
      requestedUrls.some((url) =>
        url.includes(
          `/workspaces/${primaryWorkspaceId}/projects/primary-project/object-types/alpha-type-id/`,
        ),
      ),
    ).toBe(false);
  });

  it('edits a workspace name and key without changing its public route', async () => {
    let workspace = {
      id: 'workspace-id',
      publicId: 'w1234567890abcd',
      name: 'Alpha workspace',
      slug: 'alpha',
      description: 'Initial purpose',
      archivedAt: null,
    };
    let updateBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/setup/status')) return json({ available: false });
      if (url.endsWith('/auth/me')) {
        return json({
          user: {
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          },
        });
      }
      if (url.endsWith('/workspaces/w1234567890abcd') && init?.method === 'PATCH') {
        updateBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        workspace = {
          ...workspace,
          name: String(updateBody.name),
          slug: String(updateBody.key),
          description: String(updateBody.description),
        };
        return json(workspace);
      }
      if (url.endsWith('/workspaces')) return json({ items: [workspace] });
      if (url.includes('/workspaces?')) {
        return json({
          items: [workspace],
          pageInfo: {
            limit: 24,
            offset: 0,
            total: 1,
            overallTotal: 1,
            hasNext: false,
          },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit workspace Alpha workspace' }));
    const editor = screen.getByRole('heading', { name: 'Edit workspace' }).closest('form');
    expect(editor).not.toBeNull();
    const form = within(editor!);
    fireEvent.change(form.getByRole('textbox', { name: 'Workspace name' }), {
      target: { value: 'Materials workspace' },
    });
    fireEvent.change(form.getByRole('textbox', { name: 'Workspace key' }), {
      target: { value: 'materials-lab' },
    });
    fireEvent.change(form.getByRole('textbox', { name: /Purpose/ }), {
      target: { value: 'Materials engineering records' },
    });
    fireEvent.click(form.getByRole('button', { name: 'Save workspace' }));

    await waitFor(() =>
      expect(updateBody).toEqual({
        name: 'Materials workspace',
        key: 'materials-lab',
        description: 'Materials engineering records',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Materials workspace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Materials workspace/ })).toHaveAttribute(
      'href',
      '/workspaces/w1234567890abcd',
    );
  });

  it('pages the member directory instead of preloading the organization', async () => {
    const first = {
      userId: '019fbcf9-e020-71da-935a-6a6a728b3702',
      email: 'owner@example.com',
      displayName: 'Owner',
      role: 'owner',
    };
    const second = {
      userId: '019fbcf9-e020-71da-935a-6a6a728b3704',
      email: 'engineer@example.com',
      displayName: 'Engineer',
      role: 'engineer',
    };
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/member-groups?'))
        return json({
          items: [],
          pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
          overallTotal: 0,
        });
      if (url.includes('/members?')) {
        const older = new URL(url).searchParams.get('offset') === '1';
        return json({
          items: [older ? second : first],
          pageInfo: { limit: 50, offset: older ? 1 : 0, total: 2, hasNext: !older },
          overallTotal: 2,
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Load more (1 of 2)' }));
    expect(await screen.findByText('Engineer')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/members?limit=50&offset=0'),
        expect.stringContaining('/members?limit=50&offset=1'),
      ]),
    );
  });

  it('bulk changes roles and drags selected members into a group', async () => {
    let members = [
      {
        userId: '019fbcf9-e020-71da-935a-6a6a728b3702',
        email: 'owner@example.com',
        displayName: 'Owner',
        role: 'owner',
      },
      {
        userId: '019fbcf9-e020-71da-935a-6a6a728b3704',
        email: 'engineer@example.com',
        displayName: 'Engineer',
        role: 'engineer',
      },
      {
        userId: '019fbcf9-e020-71da-935a-6a6a728b3707',
        email: 'analyst@example.com',
        displayName: 'Analyst',
        role: 'viewer',
      },
    ];
    let groups = [
      {
        id: '019fbcf9-e020-71da-935a-6a6a728b3705',
        name: 'Materials lab',
        description: 'Materials testing team',
        color: 'emerald',
        memberIds: ['019fbcf9-e020-71da-935a-6a6a728b3702'],
        updatedAt: '2026-08-03T00:00:00.000Z',
      },
    ];
    let groupUpdate: Record<string, unknown> | undefined;
    let groupMembers: Record<string, unknown> | undefined;
    let bulkRoleUpdate: Record<string, unknown> | undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/member-groups/019fbcf9-e020-71da-935a-6a6a728b3705/members')) {
        groupMembers = JSON.parse(String(init?.body)) as Record<string, unknown>;
        groups = groups.map((group) =>
          group.id === '019fbcf9-e020-71da-935a-6a6a728b3705'
            ? { ...group, memberIds: groupMembers?.memberIds as string[] }
            : group,
        );
        return json({ updated: true });
      }
      if (url.endsWith('/members/roles')) {
        bulkRoleUpdate = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const selected = new Set(bulkRoleUpdate.memberIds as string[]);
        members = members.map((member) =>
          selected.has(member.userId) ? { ...member, role: String(bulkRoleUpdate?.role) } : member,
        );
        return json({ updated: selected.size });
      }
      if (url.includes('/members?')) {
        const query = new URL(url).searchParams.get('query')?.toLowerCase() ?? '';
        const items = members.filter(
          (member) =>
            !query ||
            member.displayName.toLowerCase().includes(query) ||
            member.email.toLowerCase().includes(query) ||
            member.role.toLowerCase().includes(query),
        );
        return json({
          items,
          pageInfo: { limit: 50, offset: 0, total: items.length, hasNext: false },
          overallTotal: members.length,
        });
      }
      if (url.endsWith('/member-groups') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const created = {
          id: '019fbcf9-e020-71da-935a-6a6a728b3706',
          name: String(body.name),
          description: String(body.description),
          color: String(body.color),
          memberIds: [],
          updatedAt: '2026-08-03T01:00:00.000Z',
        };
        groups = [...groups, created];
        return json(created);
      }
      if (url.includes('/member-groups?')) {
        const query = new URL(url).searchParams.get('query')?.toLowerCase() ?? '';
        const items = groups.filter(
          (group) =>
            !query ||
            group.name.toLowerCase().includes(query) ||
            group.description.toLowerCase().includes(query),
        );
        return json({
          items,
          pageInfo: { limit: 50, offset: 0, total: items.length, hasNext: false },
          overallTotal: groups.length,
        });
      }
      if (url.endsWith('/member-groups/019fbcf9-e020-71da-935a-6a6a728b3705')) {
        groupUpdate = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({ updated: true });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Members & groups' })).toBeInTheDocument();
    expect(
      (await screen.findAllByRole('button', { name: 'Materials lab' })).length,
    ).toBeGreaterThan(0);
    const ownerMembership = await screen.findByRole('checkbox', {
      name: 'Add Owner to Materials lab',
    });
    await waitFor(() => expect(ownerMembership).toBeChecked());

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search members' }), {
      target: { value: 'Engineer' },
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) => new URL(String(input)).searchParams.get('query') === 'Engineer',
        ),
      ).toBe(true),
    );
    expect(screen.getByText('3 members')).toBeInTheDocument();
    expect(await screen.findByText('1 members shown')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search members' }), {
      target: { value: '' },
    });
    await screen.findByRole('checkbox', { name: 'Select Analyst' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Engineer' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Analyst' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Role for selected members' }), {
      target: { value: 'contributor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply role' }));
    await waitFor(() =>
      expect(bulkRoleUpdate).toEqual({
        memberIds: ['019fbcf9-e020-71da-935a-6a6a728b3704', '019fbcf9-e020-71da-935a-6a6a728b3707'],
        role: 'contributor',
      }),
    );

    const transferred = new Map<string, string>();
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: (type: string) => transferred.get(type) ?? '',
      setData: (type: string, value: string) => transferred.set(type, value),
    };
    fireEvent.dragStart(screen.getByRole('button', { name: 'Drag Engineer' }), { dataTransfer });
    const groupDropTarget = screen.getByRole('button', {
      name: 'Materials lab, 1 member. Drop members here',
    });
    fireEvent.dragOver(groupDropTarget, { dataTransfer });
    fireEvent.drop(groupDropTarget, { dataTransfer });
    await waitFor(() =>
      expect(groupMembers).toEqual({
        memberIds: [
          '019fbcf9-e020-71da-935a-6a6a728b3702',
          '019fbcf9-e020-71da-935a-6a6a728b3704',
          '019fbcf9-e020-71da-935a-6a6a728b3707',
        ],
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Add Analyst to Materials lab' })).toBeChecked(),
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Group name' }), {
      target: { value: 'Materials & Spectroscopy' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save group' }));
    await waitFor(() =>
      expect(groupUpdate).toMatchObject({
        name: 'Materials & Spectroscopy',
        description: 'Materials testing team',
        color: 'emerald',
      }),
    );
    await waitFor(() =>
      expect(groupMembers).toEqual({
        memberIds: [
          '019fbcf9-e020-71da-935a-6a6a728b3702',
          '019fbcf9-e020-71da-935a-6a6a728b3704',
          '019fbcf9-e020-71da-935a-6a6a728b3707',
        ],
      }),
    );
    expect(screen.getAllByText('contributor').length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: '+ New group' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New group name' }), {
      target: { value: 'Quality review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(
      await screen.findByRole('button', {
        name: 'Quality review, 0 members. Drop members here',
      }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/member-groups$/),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('ProjectSettingsPage', () => {
  it('narrows project access to selected members and groups with optimistic concurrency', async () => {
    const project = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3701',
      publicId: 'p1234567890abcd',
      workspaceId: '019fbcf9-e020-71da-935a-6a6a728b3702',
      name: 'Battery validation',
      key: 'BATT',
      description: 'Qualification evidence',
      status: 'active',
      rowVersion: 1,
      archivedAt: null,
    };
    const memberId = '019fbcf9-e020-71da-935a-6a6a728b3703';
    const groupId = '019fbcf9-e020-71da-935a-6a6a728b3704';
    let savedBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/projects/p1234567890abcd') && !init?.method) return json(project);
      if (url.endsWith('/projects/p1234567890abcd/access') && !init?.method)
        return json({ visibility: 'workspace', accessVersion: 1, members: [], groups: [] });
      if (url.includes('/members?'))
        return json({
          items: [{ userId: memberId, displayName: 'Ada Engineer', email: 'ada@example.com' }],
        });
      if (url.includes('/member-groups?'))
        return json({ items: [{ id: groupId, name: 'Reliability', color: 'violet' }] });
      if (url.endsWith('/projects/p1234567890abcd/access') && init?.method === 'PATCH') {
        savedBody = JSON.parse(String(init.body));
        return json({
          visibility: 'restricted',
          accessVersion: 2,
          members: [{ id: memberId, displayName: 'Ada Engineer', email: 'ada@example.com' }],
          groups: [{ id: groupId, name: 'Reliability', color: 'violet' }],
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <I18nProvider>
        <MemoryRouter
          initialEntries={['/workspaces/w1234567890abcd/projects/p1234567890abcd/settings']}
        >
          <Routes>
            <Route
              element={
                <ProjectSettingsPage
                  user={{
                    id: 'owner-id',
                    email: 'owner@example.com',
                    displayName: 'Owner',
                    organizationId: 'organization-id',
                    role: 'owner',
                  }}
                />
              }
              path="/workspaces/:workspaceId/projects/:projectId/settings"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('radio', { name: /Restricted/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Ada Engineer/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Reliability/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }));
    await waitFor(() =>
      expect(savedBody).toEqual({
        visibility: 'restricted',
        userIds: [memberId],
        groupIds: [groupId],
        accessVersion: 1,
      }),
    );
    expect(await screen.findByText('Access settings saved.')).toBeInTheDocument();
  });

  it('confirms archive actions and prevents duplicate destructive requests', async () => {
    const project = {
      id: 'project-uuid',
      publicId: 'p1234567890abcd',
      workspaceId: 'workspace-uuid',
      name: 'Battery validation',
      key: 'BATT',
      description: 'Qualification evidence',
      status: 'active',
      rowVersion: 1,
      archivedAt: null,
    };
    let resolveArchive!: (response: Response) => void;
    const archiveResponse = new Promise<Response>((resolve) => {
      resolveArchive = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/workspaces/w1234567890abcd/projects') && !init?.method) {
        return json({ items: [project] });
      }
      if (url.endsWith('/workspaces/w1234567890abcd/projects/p1234567890abcd') && !init?.method) {
        return json(project);
      }
      if (url.endsWith('/projects/p1234567890abcd/archive') && init?.method === 'POST') {
        return archiveResponse;
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    render(
      <I18nProvider>
        <MemoryRouter
          initialEntries={['/workspaces/w1234567890abcd/projects/p1234567890abcd/settings']}
        >
          <Routes>
            <Route
              element={
                <ProjectSettingsPage
                  user={{
                    id: 'owner-id',
                    email: 'owner@example.com',
                    displayName: 'Owner',
                    organizationId: 'organization-id',
                    role: 'owner',
                  }}
                />
              }
              path="/workspaces/:workspaceId/projects/:projectId/settings"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    const archiveButton = await screen.findByRole('button', { name: 'Archive project' });
    fireEvent.click(archiveButton);
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);

    fireEvent.click(archiveButton);
    await waitFor(() => expect(archiveButton).toBeDisabled());
    fireEvent.click(archiveButton);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    resolveArchive(json({}));
  });
});

describe('legacy project routes', () => {
  it('redirects the retired project directory to the workspace overview', () => {
    render(
      <MemoryRouter initialEntries={['/workspaces/w1234567890abcd/projects']}>
        <Routes>
          <Route element={<WorkspaceProjectsRedirect />} path="/workspaces/:workspaceId/projects" />
          <Route element={<LocationProbe />} path="*" />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('current-location')).toHaveTextContent(
      /^\/workspaces\/w1234567890abcd$/,
    );
  });

  it('redirects the retired files and datasets page to external materials', () => {
    render(
      <MemoryRouter
        initialEntries={['/workspaces/w1234567890abcd/projects/p1234567890abcd/files-datasets']}
      >
        <Routes>
          <Route
            element={<LegacyFilesDatasetsRedirect />}
            path="/workspaces/:workspaceId/projects/:projectId/files-datasets"
          />
          <Route element={<LocationProbe />} path="*" />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('current-location')).toHaveTextContent(
      '/workspaces/w1234567890abcd/projects/p1234567890abcd/sources',
    );
  });
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname + location.hash}</output>;
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
