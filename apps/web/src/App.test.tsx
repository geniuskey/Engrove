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
    expect(projectNav).toHaveTextContent('Overview');
    expect(projectNav).toHaveTextContent('Engineering records');
    expect(projectNav).toHaveTextContent('Files & datasets');
    expect(projectNav).toHaveTextContent('Visualizations');
    expect(projectNav).toHaveTextContent('Tasks');
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');

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

  it('creates groups and assigns multiple members without changing their roles', async () => {
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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/member-groups/019fbcf9-e020-71da-935a-6a6a728b3705/members')) {
        groupMembers = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({ updated: true });
      }
      if (url.endsWith('/members')) {
        return json({
          items: [
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
          ],
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
    expect(screen.getByRole('combobox', { name: 'Role for Owner' })).toHaveValue('owner');
    const ownerMembership = await screen.findByRole('checkbox', {
      name: 'Add Owner to Materials lab',
    });
    await waitFor(() => expect(ownerMembership).toBeChecked());
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Add Engineer to Materials lab' }));
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
        memberIds: ['019fbcf9-e020-71da-935a-6a6a728b3702', '019fbcf9-e020-71da-935a-6a6a728b3704'],
      }),
    );
    expect(screen.getByRole('combobox', { name: 'Role for Engineer' })).toHaveValue('engineer');

    fireEvent.click(screen.getByRole('button', { name: '+ New group' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New group name' }), {
      target: { value: 'Quality review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(
      await screen.findByRole('button', { name: /^Quality review.*0 members$/ }),
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
