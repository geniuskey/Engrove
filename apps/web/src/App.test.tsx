import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiStatus, App, MembersPage } from './App.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.lang = 'en';
});

describe('App', () => {
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
      if (url.endsWith('/workspaces')) {
        return json({
          items: [
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
          ],
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
    expect(screen.getByRole('heading', { name: 'Primary materials' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Alpha lab' })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2 workspaces')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'not-a-workspace' } });
    expect(screen.getByRole('heading', { name: 'No matching workspaces' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all workspaces' }));
    expect(screen.getByRole('heading', { name: 'Alpha lab' })).toBeInTheDocument();

    const createButton = screen.getAllByRole('button', { name: 'Create a workspace' })[0]!;
    createButton.focus();
    fireEvent.click(createButton);
    const dialog = screen.getByRole('dialog', { name: 'Create a workspace' });
    expect(within(dialog).getByRole('textbox', { name: 'Workspace name' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Create a workspace' })).not.toBeInTheDocument();
    await waitFor(() => expect(createButton).toHaveFocus());
  });

  it('keeps project areas available in contextual navigation', async () => {
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
      if (url.endsWith('/projects/p1234567890abcd/demo')) {
        return json({ installed: true });
      }
      if (url.includes('/projects/') && url.endsWith('/dashboard-metrics')) {
        return json({
          total_samples: 128,
          dataset_count: 3,
          failed_evaluations: 2,
          pass_rate: '96.4',
          overdue_tasks: 1,
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
    expect(projectNav).toHaveTextContent('Engineering records');
    expect(projectNav).toHaveTextContent('Files & datasets');
    expect(projectNav).toHaveTextContent('Visualizations');
    expect(projectNav).toHaveTextContent('Milestones');
    expect(projectNav).toHaveTextContent('Tasks');
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('Project command center · ALPHA')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Open data/ })).toHaveAttribute(
        'href',
        '/workspaces/workspace-id/projects/p1234567890abcd/data',
      ),
    );
    expect(await screen.findByText('Force sweep · revision 4')).toBeInTheDocument();
    const dashboardLinks = screen.getByRole('navigation', { name: 'Project quick links' });
    expect(
      within(dashboardLinks).getByRole('link', { name: /Engineering records/ }),
    ).toHaveTextContent('2 tables · 128 samples');
    expect(screen.getByText('1 of 3 completed')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
        'href',
        '/workspaces/w1234567890abcd/projects/p1234567890abcd',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Engineering records/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open command palette' })).toHaveFocus(),
    );

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Workspace selector' })).toHaveValue(
        'w1234567890abcd',
      ),
    );
    expect(screen.getByRole('link', { name: 'Data' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
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
    expect(await screen.findByRole('link', { name: '데이터' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '프로젝트' })).toBeInTheDocument();
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
      if (url.endsWith(`/workspaces/${alphaWorkspaceId}/data-context`)) {
        return json({ projectId: 'alpha-project', legacyProjectIds: [] });
      }
      if (url.endsWith(`/workspaces/${primaryWorkspaceId}/data-context`)) {
        return primaryContext;
      }
      if (url.endsWith(`/workspaces/${alphaWorkspaceId}/projects`)) {
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
      if (url.endsWith(`/workspaces/${primaryWorkspaceId}/projects`)) {
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
      if (url.endsWith('/object-types/alpha-type-id/views')) return json({ items: [] });
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace selector' }), {
      target: { value: primaryWorkspaceId },
    });

    await waitFor(() =>
      expect(screen.getByTestId('current-location')).toHaveTextContent(
        `/workspaces/${primaryWorkspaceId}/data`,
      ),
    );
    expect(screen.getByLabelText('Opening workspace data')).toBeInTheDocument();

    resolvePrimaryContext(json({ projectId: 'primary-project', legacyProjectIds: [] }));
    expect(await screen.findByRole('heading', { name: 'Workspace data' })).toBeInTheDocument();
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
      if (url.endsWith('/members')) {
        return json({ items: members });
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
      if (url.endsWith('/member-groups')) return json({ items: groups });
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

function LocationProbe() {
  return <output data-testid="current-location">{useLocation().pathname}</output>;
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
