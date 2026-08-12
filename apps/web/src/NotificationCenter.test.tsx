import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NavigateFunction } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { NotificationCenter } from './NotificationCenter.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('NotificationCenter', () => {
  it('shows unread activity, marks it read, and opens the exact task', async () => {
    const navigate = vi.fn();
    const request = vi.fn(async <T,>(path: string, init?: RequestInit) => {
      if (path === '/notifications?limit=30&offset=0')
        return {
          unreadCount: 1,
          pageInfo: { limit: 30, offset: 0, total: 1, hasNext: false },
          items: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3790',
              type: 'task.mentioned',
              actorName: 'Ada Engineer',
              workspaceId: 'w1234567890abcd',
              projectId: 'p1234567890abcd',
              taskId: '019fbcf9-e020-71da-935a-6a6a728b3791',
              taskKey: 'FORCE-6',
              taskTitle: 'Review force evidence',
              objectTypeId: null,
              recordId: null,
              recordTitle: null,
              payload: {},
              readAt: null,
              createdAt: '2026-08-08T12:00:00.000Z',
            },
          ],
        } as T;
      if (path.endsWith('/read') && init?.method === 'POST') return { read: true } as T;
      throw new Error(`Unexpected request ${path}`);
    });

    render(
      <I18nProvider>
        <NotificationCenter
          expanded
          navigate={navigate as unknown as NavigateFunction}
          request={request as never}
        />
      </I18nProvider>,
    );

    const trigger = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    fireEvent.click(trigger);
    expect(await screen.findByText('Review force evidence')).toBeInTheDocument();
    expect(screen.getByText('Ada Engineer mentioned you in a comment.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ada Engineer mentioned you/ }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/notifications/019fbcf9-e020-71da-935a-6a6a728b3790/read',
        { method: 'POST' },
      ),
    );
    expect(navigate).toHaveBeenCalledWith(
      '/workspaces/w1234567890abcd/projects/p1234567890abcd/tasks?task=FORCE-6',
    );
  });

  it('opens a mentioned record directly from the notification center', async () => {
    const navigate = vi.fn();
    const request = vi.fn(async <T,>(path: string, init?: RequestInit) => {
      if (path === '/notifications?limit=30&offset=0')
        return {
          unreadCount: 1,
          pageInfo: { limit: 30, offset: 0, total: 1, hasNext: false },
          items: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3788',
              type: 'record.mentioned',
              actorName: 'Ada Engineer',
              workspaceId: 'w1234567890abcd',
              projectId: 'p1234567890abcd',
              taskId: null,
              taskKey: null,
              taskTitle: null,
              objectTypeId: 't1234567890abcd',
              recordId: '019fbcf9-e020-71da-935a-6a6a728b3789',
              recordTitle: 'Supplier certificate',
              payload: { commentId: '019fbcf9-e020-71da-935a-6a6a728b3787' },
              readAt: null,
              createdAt: '2026-08-11T12:00:00.000Z',
            },
          ],
        } as T;
      if (path.endsWith('/read') && init?.method === 'POST') return { read: true } as T;
      throw new Error(`Unexpected request ${path}`);
    });

    render(
      <I18nProvider>
        <NotificationCenter
          expanded
          navigate={navigate as unknown as NavigateFunction}
          request={request as never}
        />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    expect(await screen.findByText('Supplier certificate')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /mentioned you in a record comment/ }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        '/workspaces/w1234567890abcd/projects/p1234567890abcd/data/t1234567890abcd/records/019fbcf9-e020-71da-935a-6a6a728b3789?comment=019fbcf9-e020-71da-935a-6a6a728b3787',
      ),
    );
  });

  it('loads older notifications from the next bounded page without losing recent items', async () => {
    const recent = notification(
      '019fbcf9-e020-71da-935a-6a6a728b3780',
      'Review recent evidence',
      '2026-08-09T12:00:00.000Z',
    );
    const older = notification(
      '019fbcf9-e020-71da-935a-6a6a728b3781',
      'Review older evidence',
      '2026-08-01T12:00:00.000Z',
    );
    const request = vi.fn(async <T,>(path: string) => {
      if (path === '/notifications?limit=30&offset=0')
        return {
          items: [recent],
          unreadCount: 0,
          pageInfo: { limit: 30, offset: 0, total: 2, hasNext: true },
        } as T;
      if (path === '/notifications?limit=30&offset=1')
        return {
          items: [older],
          unreadCount: 0,
          pageInfo: { limit: 30, offset: 1, total: 2, hasNext: false },
        } as T;
      throw new Error(`Unexpected request ${path}`);
    });

    render(
      <I18nProvider>
        <NotificationCenter
          expanded
          navigate={vi.fn() as unknown as NavigateFunction}
          request={request as never}
        />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 0 unread' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Load more notifications (1 of 2)' }),
    );
    expect(await screen.findByText('Review older evidence')).toBeInTheDocument();
    expect(screen.getByText('Review recent evidence')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Load more notifications/ }),
    ).not.toBeInTheDocument();
  });
});

function notification(id: string, taskTitle: string, createdAt: string) {
  return {
    id,
    type: 'task.updated' as const,
    actorName: 'Ada Engineer',
    workspaceId: 'w1234567890abcd',
    projectId: 'p1234567890abcd',
    taskId: '019fbcf9-e020-71da-935a-6a6a728b3791',
    taskKey: 'FORCE-6',
    taskTitle,
    objectTypeId: null,
    recordId: null,
    recordTitle: null,
    payload: {},
    readAt: createdAt,
    createdAt,
  };
}
