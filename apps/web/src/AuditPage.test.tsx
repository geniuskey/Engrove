import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditPage } from './AuditPage.js';
import { I18nProvider } from './i18n.js';

afterEach(cleanup);

describe('AuditPage', () => {
  it('searches the complete server history and continues into older events', async () => {
    const event = (id: string, action: string) => ({
      id,
      actorName: 'Quality Lead',
      actorEmail: 'quality@example.com',
      action,
      targetType: 'project',
      targetId: 'project-1',
      createdAt: '2026-08-07T12:00:00.000Z',
    });
    const request = vi.fn(async (path: string) => {
      const parameters = new URL(`http://engrove.test${path}`).searchParams;
      const query = parameters.get('query') ?? '';
      const offset = Number(parameters.get('offset') ?? 0);
      if (query === 'security')
        return {
          items: [event('event-2', 'security.sessions_revoked')],
          pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
        };
      return {
        items: [
          offset === 0
            ? event('event-1', 'project.updated')
            : event('event-2', 'security.sessions_revoked'),
        ],
        pageInfo: { limit: 50, offset, total: 2, hasNext: offset === 0 },
      };
    });

    render(
      <I18nProvider>
        <AuditPage request={request as never} />
      </I18nProvider>,
    );

    expect(await screen.findByText('project.updated')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2 matching events')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more events (1 of 2)' }));
    expect(await screen.findByText('security.sessions_revoked')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search audit events' }), {
      target: { value: 'security' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search audit events' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/audit-events?query=security&limit=50&offset=0'),
    );
    expect(screen.queryByText('project.updated')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 1 matching events')).toBeInTheDocument();
  });
});
