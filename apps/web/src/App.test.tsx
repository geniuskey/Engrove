import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiStatus, App } from './App.js';

afterEach(() => vi.restoreAllMocks());

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
    expect(await screen.findByText(/API ready/)).toBeInTheDocument();
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
    expect(projectNav).toHaveTextContent('Overview');
    expect(projectNav).toHaveTextContent('Data');
    expect(projectNav).toHaveTextContent('Files & datasets');
    expect(projectNav).toHaveTextContent('Visualizations');
    expect(projectNav).toHaveTextContent('Tasks');
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
