import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from './i18n.js';
import { ReviewInboxPage } from './ReviewInboxPage.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('ReviewInboxPage', () => {
  it('shows exact queue totals and continues into older reviews', async () => {
    const requests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('offset=1')) {
        return json({
          items: [review('019fbcf9-e020-71da-935a-6a6a728b3781', 'Older review')],
          pageInfo: { limit: 50, offset: 1, total: 2, hasNext: false },
          summary: { waitingForMe: 7, openInvolved: 19 },
        });
      }
      return json({
        items: [review('019fbcf9-e020-71da-935a-6a6a728b3780', 'Recent review')],
        pageInfo: { limit: 50, offset: 0, total: 2, hasNext: true },
        summary: { waitingForMe: 7, openInvolved: 19 },
      });
    });

    render(
      <I18nProvider>
        <MemoryRouter
          initialEntries={['/workspaces/w1234567890abcd/projects/p1234567890abcd/reviews']}
        >
          <Routes>
            <Route
              element={<ReviewInboxPage />}
              path="/workspaces/:workspaceId/projects/:projectId/reviews"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByText('Recent review');
    expect(
      within(screen.getByText('Waiting for my decision').closest('article')!).getByText('7'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText('Open discussions involving me').closest('article')!).getByText('19'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more reviews (1 of 2)' }));
    await screen.findByText('Older review');
    await waitFor(() =>
      expect(requests.some((url) => url.includes('limit=50&offset=1'))).toBe(true),
    );
  });
});

function review(id: string, subject: string) {
  return {
    id,
    subject,
    status: 'open',
    reviewStatus: 'requested',
    reviewerId: '019fbcf9-e020-71da-935a-6a6a728b3790',
    reviewerName: 'Ada Engineer',
    recordId: '019fbcf9-e020-71da-935a-6a6a728b3791',
    recordName: 'Qualification sample',
    objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
    objectTypePublicId: 't1234567890abcd',
    objectTypeName: 'Sample',
    latestMessage: 'Please verify the certificate.',
    messageCount: 2,
    updatedAt: '2026-08-10T12:00:00.000Z',
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
