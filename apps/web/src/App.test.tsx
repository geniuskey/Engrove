import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
              name: 'Alpha workspace',
              slug: 'alpha',
              description: '',
              archivedAt: null,
            },
          ],
        });
      }
      if (url.endsWith('/workspaces/workspace-id/projects')) {
        return json({
          items: [
            {
              id: 'project-id',
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
      if (url.endsWith('/workspaces/workspace-id/projects/project-id/demo')) {
        return json({ installed: true });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/workspaces/workspace-id/projects/project-id']}>
        <App />
      </MemoryRouter>,
    );

    const projectNav = await screen.findByRole('navigation', { name: 'Project navigation' });
    expect(screen.getByLabelText('Service sidebar')).toHaveClass('service-sidebar');
    expect(screen.getByRole('link', { name: 'Engrove home' }).querySelector('img')).toHaveAttribute(
      'src',
      '/engrove-mark.png',
    );
    expect(projectNav).toHaveTextContent('Overview');
    expect(projectNav).toHaveTextContent('Engineering records');
    expect(projectNav).toHaveTextContent('Files & datasets');
    expect(projectNav).toHaveTextContent('Visualizations');
    expect(projectNav).toHaveTextContent('Tasks');
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Engineering records/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Workspace selector' })).toHaveValue(
        'workspace-id',
      ),
    );
    expect(screen.getByRole('link', { name: 'Data' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse service sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand service sidebar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand service sidebar' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('engrove-theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Open user menu' }));
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveClass(
      'sidebar-utility-action',
    );
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toHaveClass(
      'sidebar-utility-action',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveClass('sidebar-utility-action');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('engrove-theme')).toBe('dark');
    expect(window.localStorage.getItem('engrove-theme-explicit')).toBe('true');

    expect(document.documentElement).toHaveAttribute('lang', 'en');
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'ko' },
    });
    expect(await screen.findByRole('link', { name: '데이터' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '프로젝트' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'ko');
    expect(window.localStorage.getItem('engrove-locale')).toBe('ko');
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

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
