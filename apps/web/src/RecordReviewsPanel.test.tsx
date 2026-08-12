import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordReviewsPanel } from './RecordReviewsPanel.js';

const user = {
  id: '019fbcf9-e020-71da-935a-6a6a728b3790',
  email: 'owner@example.com',
  displayName: 'Owner',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'owner' as const,
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RecordReviewsPanel', () => {
  it('starts a traceable review with an assigned reviewer', async () => {
    let created = false;
    let olderMessagesRequested = false;
    let posted: Record<string, unknown> | undefined;
    const participantRequests: string[] = [];
    const reviewerId = '019fbcf9-e020-71da-935a-6a6a728b3792';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/review-participants?')) {
        participantRequests.push(url);
        return json({
          items: [
            { id: user.id, displayName: 'Owner', email: user.email, role: 'owner' },
            {
              id: reviewerId,
              displayName: 'Quality reviewer',
              email: 'reviewer@example.com',
              role: 'engineer',
            },
          ],
        });
      }
      if (url.endsWith('/reviews') && init?.method === 'POST') {
        posted = JSON.parse(String(init.body)) as Record<string, unknown>;
        created = true;
        return json({ id: '019fbcf9-e020-71da-935a-6a6a728b3793' });
      }
      if (url.includes('/reviews/019fbcf9-e020-71da-935a-6a6a728b3793/messages?')) {
        olderMessagesRequested = true;
        return json({
          items: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3796',
              body: 'Earlier context from qualification.',
              authorId: user.id,
              authorName: user.displayName,
              mentionedUserIds: [],
              mentionedUsers: [],
              createdAt: '2026-08-06T12:00:00.000Z',
            },
          ],
          pageInfo: { limit: 20, offset: 1, total: 2, hasNext: false },
        });
      }
      if (url.includes('/reviews?')) {
        return json({
          items: created
            ? [
                {
                  id: '019fbcf9-e020-71da-935a-6a6a728b3793',
                  subject: 'Verify calibration evidence',
                  status: 'open',
                  reviewStatus: 'requested',
                  reviewerId,
                  reviewerName: 'Quality reviewer',
                  createdBy: user.id,
                  creatorName: user.displayName,
                  resolvedAt: null,
                  createdAt: '2026-08-07T12:00:00.000Z',
                  updatedAt: '2026-08-07T12:00:00.000Z',
                  messages: [
                    {
                      id: '019fbcf9-e020-71da-935a-6a6a728b3794',
                      body: 'Please compare the certificate revision.',
                      authorId: user.id,
                      authorName: user.displayName,
                      mentionedUserIds: [],
                      mentionedUsers: [],
                      createdAt: '2026-08-07T12:00:00.000Z',
                    },
                  ],
                  messagePageInfo: { limit: 20, offset: 0, total: 2, hasNext: true },
                },
              ]
            : [],
          pageInfo: {
            limit: 20,
            offset: 0,
            total: created ? 1 : 0,
            hasNext: false,
          },
          summary: { open: created ? 1 : 0, resolved: 0 },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <RecordReviewsPanel
        base="/workspaces/w123/projects/p123"
        objectTypeId="t123"
        recordId="019fbcf9-e020-71da-935a-6a6a728b3795"
        user={user}
      />,
    );

    await screen.findByText('No discussion on this record yet.');
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Verify calibration evidence' },
    });
    fireEvent.focus(screen.getByLabelText('Reviewer'));
    fireEvent.click(await screen.findByRole('option', { name: /Quality reviewer/ }));
    fireEvent.focus(screen.getByLabelText('Search people by name or email'));
    fireEvent.click(await screen.findByRole('option', { name: /Quality reviewer/ }));
    expect(screen.getByRole('button', { name: 'Remove Quality reviewer' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Please compare the certificate revision.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start discussion' }));

    await screen.findByText('Review requested');
    expect(screen.getByText(/Review requested from Quality reviewer/)).toBeInTheDocument();
    await waitFor(() =>
      expect(posted).toMatchObject({
        subject: 'Verify calibration evidence',
        reviewerId,
        body: 'Please compare the certificate revision.',
        mentionedUserIds: [reviewerId],
      }),
    );
    expect(participantRequests).toEqual(
      expect.arrayContaining([
        expect.stringContaining('review-participants?limit=20&reviewerOnly=true'),
        expect.stringContaining('review-participants?limit=20&reviewerOnly=false'),
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load older messages · 1 of 2' }));
    expect(await screen.findByText('Earlier context from qualification.')).toBeInTheDocument();
    expect(olderMessagesRequested).toBe(true);
  });

  it('reloads the bounded thread page when resolved discussions are shown', async () => {
    const reviewRequests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (!url.includes('/reviews?')) throw new Error(`Unexpected request: ${url}`);
      reviewRequests.push(url);
      const includeResolved = new URL(url).searchParams.get('includeResolved') === 'true';
      return json({
        items: includeResolved
          ? [
              {
                id: '019fbcf9-e020-71da-935a-6a6a728b3797',
                subject: 'Archived release decision',
                status: 'resolved',
                reviewStatus: 'approved',
                reviewerId: null,
                reviewerName: null,
                createdBy: user.id,
                creatorName: user.displayName,
                resolvedAt: '2026-08-07T13:00:00.000Z',
                createdAt: '2026-08-07T12:00:00.000Z',
                updatedAt: '2026-08-07T13:00:00.000Z',
                messages: [],
                messagePageInfo: { limit: 20, offset: 0, total: 0, hasNext: false },
              },
            ]
          : [],
        pageInfo: {
          limit: 20,
          offset: 0,
          total: includeResolved ? 1 : 0,
          hasNext: false,
        },
        summary: { open: 0, resolved: 1 },
      });
    });

    render(
      <RecordReviewsPanel
        base="/workspaces/w123/projects/p123"
        objectTypeId="t123"
        recordId="019fbcf9-e020-71da-935a-6a6a728b3795"
        user={user}
      />,
    );

    await screen.findByText('1 resolved');
    expect(screen.queryByText('Archived release decision')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show resolved' }));
    expect(await screen.findByText('Archived release decision')).toBeInTheDocument();
    expect(reviewRequests).toEqual([
      expect.stringContaining('includeResolved=false&limit=20&offset=0'),
      expect.stringContaining('includeResolved=true&limit=20&offset=0'),
    ]);
  });
});
