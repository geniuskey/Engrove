import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { MyWorkPage } from './MyWorkPage.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MyWorkPage', () => {
  it('shows assigned work across projects and keeps filters in the URL-backed API request', async () => {
    const request = vi.fn(async <T,>(path: string) => {
      const overdueOnly = path.includes('urgency=overdue');
      return {
        summary: { total: 3, overdue: 1, dueSoon: 1, blocked: 1, noDueDate: 1 },
        items: [
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            taskKey: 'BRAKE-7',
            title: 'Approve brake report',
            status: { key: 'blocked', name: 'Blocked', category: 'in_progress', color: '#fb7185' },
            priority: 'critical',
            dueDate: '2026-08-08',
            updatedAt: '2026-08-09T12:00:00.000Z',
            openBlockerCount: 1,
            parentTaskKey: null,
            project: {
              id: '019fbcf9-e020-71da-935a-6a6a728b3791',
              publicId: 'p1234567890abcd',
              name: 'Brake validation',
            },
          },
        ],
        pageInfo: { limit: 50, offset: 0, total: overdueOnly ? 1 : 3, hasMore: false },
      } as T;
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={['/workspaces/w1234567890abcd/my-work']}>
          <Routes>
            <Route
              element={<MyWorkPage request={request as never} />}
              path="/workspaces/:workspaceId/my-work"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'My work' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'My work summary' });
    expect(within(summary).getByRole('button', { name: /Open/ })).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: /BRAKE-7.*Approve brake report/ })).toHaveAttribute(
      'href',
      '/workspaces/w1234567890abcd/projects/p1234567890abcd/tasks?task=BRAKE-7',
    );

    fireEvent.click(within(summary).getByRole('button', { name: /Overdue/ }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(expect.stringContaining('urgency=overdue')),
    );
    expect(screen.getByRole('button', { name: /Overdue/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
