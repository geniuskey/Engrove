import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiStatus, App } from './App.js';

afterEach(() => {
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
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
