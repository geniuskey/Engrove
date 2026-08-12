import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceShell, useServiceSidebarPortal } from './ServiceSidebar.js';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  });
  window.localStorage.clear();
});

describe('ServiceShell mobile navigation', () => {
  it('searches workspaces on the server and preserves the workspace-level section', async () => {
    const alphaWorkspaceId = 'w1234567890abcd';
    const betaWorkspaceId = 'w1234567890abce';
    const requestedPaths: string[] = [];
    render(
      <MemoryRouter initialEntries={[`/workspaces/${alphaWorkspaceId}/data`]}>
        <ServiceShell
          can={() => true}
          onSignedOut={() => undefined}
          onToggleTheme={() => undefined}
          request={async <T,>(path: string) => {
            requestedPaths.push(path);
            const alpha = {
              id: 'alpha-workspace-uuid',
              publicId: alphaWorkspaceId,
              name: 'Alpha laboratory',
            };
            const beta = {
              id: 'beta-workspace-uuid',
              publicId: betaWorkspaceId,
              name: 'Beta laboratory',
            };
            if (path === '/workspaces') {
              return {
                items: [alpha],
                pageInfo: { hasNext: true },
              } as T;
            }
            if (path.includes('/workspaces?') && path.includes('query=Beta')) {
              return {
                items: [beta],
                pageInfo: { hasNext: false },
              } as T;
            }
            if (path.startsWith('/workspaces?')) {
              return {
                items: [alpha, beta],
                pageInfo: { hasNext: false },
              } as T;
            }
            throw new Error(`Unexpected request ${path}`);
          }}
          theme="dark"
          user={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          }}
        >
          <LocationProbe />
        </ServiceShell>
      </MemoryRouter>,
    );

    const picker = screen.getByRole('combobox', { name: 'Workspace selector' });
    await waitFor(() => expect(picker).toHaveValue('Alpha laboratory'));
    fireEvent.focus(picker);
    expect(screen.getByRole('option', { name: 'Workspace list' })).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'Beta' } });
    await waitFor(
      () => expect(requestedPaths).toContain('/workspaces?limit=20&offset=0&query=Beta'),
      { timeout: 3_000 },
    );
    fireEvent.click(await screen.findByRole('option', { name: 'Beta laboratory' }));
    expect(screen.getByTestId('sidebar-location')).toHaveTextContent(
      `/workspaces/${betaWorkspaceId}/data`,
    );
  });

  it('nests project table navigation after the project areas', async () => {
    const workspaceId = 'w1234567890abcd';
    const projectId = 'p1234567890abcd';
    render(
      <MemoryRouter initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/data`]}>
        <ServiceShell
          can={() => true}
          onSignedOut={() => undefined}
          onToggleTheme={() => undefined}
          request={async <T,>(path: string) => {
            if (path === '/workspaces') {
              return {
                items: [{ id: 'workspace-uuid', publicId: workspaceId, name: 'Vehicle program' }],
              } as T;
            }
            if (path === `/workspaces/${workspaceId}/projects/${projectId}`) {
              return {
                id: 'project-uuid',
                publicId: projectId,
                name: 'Force validation',
                key: 'FORCE',
                archivedAt: null,
              } as T;
            }
            if (path.startsWith(`/workspaces/${workspaceId}/project-options?`)) {
              return {
                items: [
                  {
                    id: 'project-uuid',
                    publicId: projectId,
                    name: 'Force validation',
                    key: 'FORCE',
                    archivedAt: null,
                  },
                ],
                pageInfo: { limit: 20, total: 1, hasMore: false },
              } as T;
            }
            throw new Error(`Unexpected request ${path}`);
          }}
          theme="dark"
          user={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          }}
        >
          <TableNavigationProbe />
        </ServiceShell>
      </MemoryRouter>,
    );

    const projectNavigation = await screen.findByRole('navigation', {
      name: 'Project navigation',
    });
    const tableNavigation = await screen.findByRole('navigation', { name: 'Data navigation' });
    expect(
      projectNavigation.compareDocumentPosition(tableNavigation) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(tableNavigation.parentElement).toHaveClass('ml-6', 'border-l');
    expect(within(projectNavigation).getByRole('link', { name: 'Records' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('switches searchable projects while preserving the current project section', async () => {
    const workspaceId = 'w1234567890abcd';
    const alphaProjectId = 'p1234567890abcd';
    const betaProjectId = 'p1234567890abce';
    const requestedPaths: string[] = [];
    render(
      <MemoryRouter
        initialEntries={[`/workspaces/${workspaceId}/projects/${alphaProjectId}/tasks`]}
      >
        <ServiceShell
          can={() => true}
          onSignedOut={() => undefined}
          onToggleTheme={() => undefined}
          request={async <T,>(path: string) => {
            requestedPaths.push(path);
            if (path === '/workspaces') {
              return {
                items: [{ id: 'workspace-uuid', publicId: workspaceId, name: 'Vehicle program' }],
              } as T;
            }
            if (path === `/workspaces/${workspaceId}/projects/${alphaProjectId}`) {
              return {
                id: 'alpha-uuid',
                publicId: alphaProjectId,
                name: 'Alpha validation',
                key: 'ALPHA',
                archivedAt: null,
              } as T;
            }
            if (path === `/workspaces/${workspaceId}/projects/${betaProjectId}`) {
              return {
                id: 'beta-uuid',
                publicId: betaProjectId,
                name: 'Beta validation',
                key: 'BETA',
                archivedAt: null,
              } as T;
            }
            if (path.startsWith(`/workspaces/${workspaceId}/project-options?`)) {
              return {
                items: [
                  {
                    id: 'alpha-uuid',
                    publicId: alphaProjectId,
                    name: 'Alpha validation',
                    key: 'ALPHA',
                    archivedAt: null,
                  },
                  {
                    id: 'beta-uuid',
                    publicId: betaProjectId,
                    name: 'Beta validation',
                    key: 'BETA',
                    archivedAt: null,
                  },
                ],
                pageInfo: { limit: 20, total: 2, hasMore: false },
              } as T;
            }
            throw new Error(`Unexpected request ${path}`);
          }}
          theme="dark"
          user={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          }}
        >
          <LocationProbe />
        </ServiceShell>
      </MemoryRouter>,
    );

    const picker = screen.getByRole('combobox', { name: 'Select project' });
    await waitFor(() => expect(requestedPaths.length).toBeGreaterThanOrEqual(3));
    expect(requestedPaths).toContain(`/workspaces/${workspaceId}/projects/${alphaProjectId}`);
    expect(requestedPaths).toContain(`/workspaces/${workspaceId}/project-options?limit=20`);
    expect(picker).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(picker).toHaveValue('Alpha validation'));
    const serviceNavigation = screen.getByRole('navigation', { name: 'Service navigation' });
    const projectNavigation = screen.getByRole('navigation', { name: 'Project navigation' });
    expect(
      within(serviceNavigation).queryByRole('link', { name: /Project/ }),
    ).not.toBeInTheDocument();
    expect(
      serviceNavigation.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      picker.compareDocumentPosition(projectNavigation) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(projectNavigation).queryByText('Alpha validation')).not.toBeInTheDocument();
    fireEvent.focus(picker);
    expect(screen.getByRole('option', { name: /Workspace overview/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Archived project/ })).not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'Beta' } });
    await waitFor(
      () =>
        expect(requestedPaths).toContain(
          `/workspaces/${workspaceId}/project-options?limit=20&query=Beta`,
        ),
      { timeout: 3_000 },
    );
    expect(screen.queryByRole('option', { name: 'Alpha validation' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('option', { name: /Beta validation/ }));

    await waitFor(() =>
      expect(screen.getByTestId('sidebar-location')).toHaveTextContent(
        `/workspaces/${workspaceId}/projects/${betaProjectId}/tasks`,
      ),
    );
    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem(`engrove-recent-projects:${workspaceId}`) ?? '[]'),
      ).toContain(betaProjectId),
    );

    fireEvent.focus(picker);
    expect(screen.getByRole('group', { name: 'Recent projects' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Workspace overview/ }));
    expect(screen.getByTestId('sidebar-location')).toHaveTextContent(`/workspaces/${workspaceId}`);
  }, 15_000);

  it('reports a failed project list and recovers without hiding the cause', async () => {
    const workspaceId = 'w1234567890abcd';
    let attempts = 0;
    render(
      <MemoryRouter initialEntries={[`/workspaces/${workspaceId}/projects/p1234567890abcd/tasks`]}>
        <ServiceShell
          can={() => true}
          onSignedOut={() => undefined}
          onToggleTheme={() => undefined}
          request={async <T,>(path: string) => {
            if (path === '/workspaces') {
              return {
                items: [{ id: 'workspace-uuid', publicId: workspaceId, name: 'Vehicle program' }],
              } as T;
            }
            if (path === `/workspaces/${workspaceId}/projects/p1234567890abcd`) {
              attempts += 1;
              if (attempts === 1) throw new Error('offline');
              return {
                id: 'project-uuid',
                publicId: 'p1234567890abcd',
                name: 'Recovered project',
                key: 'RECOVERED',
                archivedAt: null,
              } as T;
            }
            if (path.startsWith(`/workspaces/${workspaceId}/project-options?`)) {
              return {
                items: [
                  {
                    id: 'project-uuid',
                    publicId: 'p1234567890abcd',
                    name: 'Recovered project',
                    key: 'RECOVERED',
                    archivedAt: null,
                  },
                ],
                pageInfo: { limit: 20, total: 1, hasMore: false },
              } as T;
            }
            throw new Error(`Unexpected request ${path}`);
          }}
          theme="dark"
          user={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          }}
        >
          <p>Page content</p>
        </ServiceShell>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Projects unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(attempts).toBe(2));
    fireEvent.focus(screen.getByRole('combobox', { name: 'Select project' }));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Recovered project/ })).toBeInTheDocument(),
    );
    expect(screen.queryByText('Projects unavailable')).not.toBeInTheDocument();
  });

  it('keeps language, theme, and account actions in a non-blocking settings popover', async () => {
    const onToggleTheme = vi.fn();
    const requestedPaths: string[] = [];
    let savedPreferences: Record<string, unknown> | undefined;
    const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
      requestedPaths.push(path);
      if (path === '/notifications/preferences' && init?.method === 'PATCH') {
        savedPreferences = JSON.parse(String(init.body)) as Record<string, unknown>;
        return savedPreferences as T;
      }
      if (path === '/notifications/preferences') {
        return {
          autoWatchCreated: true,
          autoWatchCommented: true,
          notifyAssigned: true,
          notifyMentioned: true,
          notifyTaskActivity: true,
          notifyDueDates: true,
          dueReminderDays: 1,
        } as T;
      }
      if (path === '/me/member-groups') {
        return {
          items: [
            {
              id: 'group-1',
              name: 'Materials laboratory',
              description: 'Material validation team',
              color: 'emerald',
            },
          ],
        } as T;
      }
      return { items: [] } as T;
    };
    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <ServiceShell
          can={() => false}
          onSignedOut={() => undefined}
          onToggleTheme={onToggleTheme}
          request={request}
          theme="dark"
          user={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          }}
        >
          <p>Page content</p>
        </ServiceShell>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Open user menu' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' });
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveFocus();
    expect(within(dialog).getByText('owner@example.com')).toBeInTheDocument();
    expect(await within(dialog).findByText('Materials laboratory')).toHaveAttribute(
      'title',
      'Material validation team',
    );
    expect(within(dialog).getByText('Role: Owner')).toBeInTheDocument();
    expect(requestedPaths).toContain('/me/member-groups');
    const watchCreated = within(dialog).getByRole('checkbox', { name: 'Watch tasks I create' });
    expect(watchCreated).toBeChecked();
    fireEvent.click(watchCreated);
    await waitFor(() => expect(savedPreferences?.autoWatchCreated).toBe(false));
    expect(await within(dialog).findByText('Saved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'light' }));
    expect(onToggleTheme).toHaveBeenCalledOnce();

    fireEvent.pointerDown(screen.getByText('Page content'));
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('creates, copies, and revokes scoped API tokens from settings', async () => {
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const workspaceId = '019fbcf9-e020-71da-935a-6a6a728b3792';
    const existingTokenId = '019fbcf9-e020-71da-935a-6a6a728b3793';
    const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
      requests.push({ path, ...(init ? { init } : {}) });
      if (path === '/workspaces') {
        return { items: [{ id: workspaceId, publicId: 'w1234567890abcd', name: 'Vehicle' }] } as T;
      }
      if (path === '/me/member-groups') return { items: [] } as T;
      if (path === '/api-tokens' && !init) {
        return {
          items: [
            {
              id: existingTokenId,
              name: 'Existing integration',
              tokenPrefix: 'eng_pat_existing',
              accessLevel: 'read',
              scopes: ['workspace', 'project', 'data', 'tasks', 'schedule', 'reviews'],
              workspaceId: null,
              workspaceName: null,
              expiresAt: '2026-11-01T00:00:00.000Z',
              lastUsedAt: null,
              createdAt: '2026-08-01T00:00:00.000Z',
            },
          ],
        } as T;
      }
      if (path === '/api-tokens' && init?.method === 'POST') {
        return {
          id: '019fbcf9-e020-71da-935a-6a6a728b3794',
          name: 'Lab dashboard',
          token: `eng_pat_${'a'.repeat(43)}`,
          tokenPrefix: 'eng_pat_aaaaaaaa',
          accessLevel: 'read',
          scopes: ['data'],
          workspaceId,
          workspaceName: 'Vehicle',
          expiresAt: '2026-11-06T00:00:00.000Z',
          lastUsedAt: null,
          createdAt: '2026-08-08T00:00:00.000Z',
        } as T;
      }
      if (path === `/api-tokens/${existingTokenId}/revoke`) return { revoked: true } as T;
      return { items: [] } as T;
    };

    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <ServiceShell
          can={() => false}
          onSignedOut={() => undefined}
          onToggleTheme={() => undefined}
          request={request}
          theme="dark"
          user={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          }}
        >
          <p>Page content</p>
        </ServiceShell>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'API tokens' }));
    expect(await screen.findByText('Existing integration')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'API docs ↗' })).toHaveAttribute(
      'href',
      'http://localhost:3000/api/docs',
    );

    const form = screen.getByRole('form', { name: 'Create API token' });
    fireEvent.change(within(form).getByRole('textbox', { name: 'Token name' }), {
      target: { value: 'Lab dashboard' },
    });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Workspace scope' }), {
      target: { value: workspaceId },
    });
    const createToken = within(form).getByRole('button', { name: 'Create API token' });
    expect(createToken).toBeDisabled();
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Data and engineering' }));
    expect(createToken).toBeEnabled();
    fireEvent.click(createToken);

    const secret = await screen.findByRole('textbox', { name: 'New API token secret' });
    expect(secret).toHaveValue(`eng_pat_${'a'.repeat(43)}`);
    const creation = requests.find(
      ({ path, init }) => path === '/api-tokens' && init?.method === 'POST',
    );
    expect(JSON.parse(String(creation?.init?.body))).toMatchObject({
      name: 'Lab dashboard',
      accessLevel: 'read',
      expiresInDays: 90,
      workspaceId,
      scopes: ['data'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Copy API token' }));
    expect(clipboardWrite).toHaveBeenCalledWith(`eng_pat_${'a'.repeat(43)}`);

    fireEvent.click(screen.getByRole('button', { name: 'Revoke Existing integration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke Existing integration' }));
    await waitFor(() =>
      expect(requests.some(({ path }) => path === `/api-tokens/${existingTokenId}/revoke`)).toBe(
        true,
      ),
    );
    expect(screen.queryByText('Existing integration')).not.toBeInTheDocument();
  });

  it('opens as a modal drawer and restores focus when dismissed', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: '(max-width: 767px)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <ServiceShell
          can={() => false}
          onSignedOut={() => undefined}
          onToggleTheme={() => undefined}
          request={async <T,>() => ({ items: [] }) as T}
          theme="dark"
          user={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          }}
        >
          <p>Page content</p>
        </ServiceShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Engrove home' })).toHaveAttribute('href', '/');
    const trigger = screen.getByRole('button', { name: 'Open navigation menu' });
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Service sidebar' })).toBeInTheDocument();
    expect(document.body).toHaveStyle({ overflow: 'hidden' });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Service sidebar' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' });
  });

  it('supports arrow-key selection in the command palette', async () => {
    const onToggleTheme = vi.fn();
    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <ServiceShell
          can={() => false}
          onSignedOut={() => undefined}
          onToggleTheme={onToggleTheme}
          request={async <T,>() => ({ items: [] }) as T}
          theme="dark"
          user={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          }}
        >
          <p>Page content</p>
        </ServiceShell>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    const search = screen.getByRole('searchbox', { name: 'Search commands' });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /Use light theme/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onToggleTheme).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('searches workspace tasks from the command palette and opens task detail', async () => {
    const workspaceId = 'w1234567890abcd';
    const projectId = 'p1234567890abcd';
    const taskId = '019fbcf9-e020-71da-935a-6a6a728b3799';
    const milestoneId = '019fbcf9-e020-71da-935a-6a6a728b3800';
    const requests: string[] = [];
    render(
      <MemoryRouter initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/data`]}>
        <ServiceShell
          can={() => true}
          onSignedOut={() => undefined}
          onToggleTheme={() => undefined}
          request={async <T,>(path: string) => {
            requests.push(path);
            if (path === '/workspaces') {
              return {
                items: [{ id: 'workspace-uuid', publicId: workspaceId, name: 'Vehicle program' }],
              } as T;
            }
            if (path === `/workspaces/${workspaceId}/projects`) {
              return {
                items: [
                  {
                    id: 'project-uuid',
                    publicId: projectId,
                    name: 'Motor validation',
                    key: 'MOTOR',
                    archivedAt: null,
                  },
                ],
              } as T;
            }
            if (path.startsWith(`/workspaces/${workspaceId}/search?`)) {
              return {
                items: [
                  {
                    type: 'task',
                    id: taskId,
                    publicId: null,
                    title: 'Review motor evidence',
                    key: 'MOTOR-42',
                    projectPublicId: projectId,
                    projectName: 'Motor validation',
                    workspaceShared: false,
                  },
                  {
                    type: 'milestone',
                    id: milestoneId,
                    publicId: null,
                    title: 'Production release',
                    key: '2026-10-01',
                    projectPublicId: projectId,
                    projectName: 'Motor validation',
                    workspaceShared: false,
                  },
                ],
                pageInfo: { limit: 12, total: 2, hasMore: false },
              } as T;
            }
            throw new Error(`Unexpected request ${path}`);
          }}
          theme="dark"
          user={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          }}
        >
          <LocationWithSearchProbe />
        </ServiceShell>
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const search = screen.getByRole('searchbox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'MOTOR-42' } });

    const task = await screen.findByRole('button', {
      name: /MOTOR-42 · Review motor evidence.*Task · Motor validation/,
    });
    expect(screen.getByText('2 workspace result(s)')).toBeInTheDocument();
    expect(requests).toContain(`/workspaces/${workspaceId}/search?query=MOTOR-42&limit=12`);
    fireEvent.click(task);

    expect(screen.getByTestId('sidebar-location')).toHaveTextContent(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks?task=MOTOR-42`,
    );
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const reopenedSearch = screen.getByRole('searchbox', { name: 'Search commands' });
    fireEvent.change(reopenedSearch, { target: { value: 'release' } });
    const milestone = await screen.findByRole('button', {
      name: /Production release.*Key date · 2026-10-01 · Motor validation/,
    });
    fireEvent.click(milestone);

    expect(screen.getByTestId('sidebar-location')).toHaveTextContent(
      `/workspaces/${workspaceId}/projects/${projectId}/milestones?milestone=${milestoneId}`,
    );
  });
});

function TableNavigationProbe() {
  const portal = useServiceSidebarPortal();
  return portal
    ? createPortal(
        <nav aria-label="Data navigation">
          <span>Engineering tables</span>
        </nav>,
        portal,
      )
    : null;
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="sidebar-location">{location.pathname}</span>;
}

function LocationWithSearchProbe() {
  const location = useLocation();
  return <span data-testid="sidebar-location">{location.pathname + location.search}</span>;
}
