import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { RecordCommentsPanel } from './RecordCommentsPanel.js';

const user = {
  id: '019fbcf9-e020-71da-935a-6a6a728b3790',
  email: 'owner@example.com',
  displayName: 'Owner',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'owner' as const,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RecordCommentsPanel', () => {
  it('adds and safely edits authored record comments without leaving the record', async () => {
    const endpoint =
      '/workspaces/workspace-1/projects/project-1/object-types/table-1/records/record-1/comments';
    const requests: Array<{ method: string; body?: unknown }> = [];
    let currentBody = 'Verify the certificate revision.';
    let rowVersion = 1;
    const teammateId = '019fbcf9-e020-71da-935a-6a6a728b3794';
    const comment = () => ({
      id: '019fbcf9-e020-71da-935a-6a6a728b3792',
      authorId: user.id,
      authorName: user.displayName,
      body: currentBody,
      mentionedUserIds: [],
      mentionedUsers: [],
      rowVersion,
      editedAt: rowVersion > 1 ? '2026-08-11T12:00:00.000Z' : null,
      createdAt: '2026-08-10T12:00:00.000Z',
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/review-participants?'))
        return json({
          items: [
            {
              id: teammateId,
              displayName: 'Lin Reviewer',
              email: 'lin@example.com',
              role: 'reviewer',
            },
          ],
        });
      if (!url.includes(endpoint)) throw new Error(`Unexpected request: ${url}`);
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as {
          body: string;
          mentionedUserIds: string[];
        };
        requests.push({ method, body });
        return json({
          ...comment(),
          id: '019fbcf9-e020-71da-935a-6a6a728b3793',
          body: body.body,
          mentionedUserIds: body.mentionedUserIds,
          mentionedUsers: body.mentionedUserIds.map((id) => ({
            id,
            displayName: 'Lin Reviewer',
          })),
        });
      }
      if (method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as {
          body: string;
          mentionedUserIds: string[];
          rowVersion: number;
        };
        requests.push({ method, body });
        currentBody = body.body;
        rowVersion += 1;
        return json(comment());
      }
      return json({
        items: [comment()],
        pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
      });
    });

    render(
      <I18nProvider>
        <RecordCommentsPanel
          base="/workspaces/workspace-1/projects/project-1"
          objectTypeId="table-1"
          recordId="record-1"
          user={user}
        />
      </I18nProvider>,
    );

    expect(await screen.findByText(currentBody)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit comment' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit comment' }), {
      target: { value: 'Certificate revision verified.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(requests[0]).toEqual({
        method: 'PATCH',
        body: { body: 'Certificate revision verified.', mentionedUserIds: [], rowVersion: 1 },
      }),
    );
    expect(await screen.findByText('Certificate revision verified.')).toBeInTheDocument();
    expect(screen.getByText(/edited/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
      target: { value: 'Publish the signed evidence.' },
    });
    fireEvent.focus(screen.getByLabelText('Search people by name or email'));
    fireEvent.click(await screen.findByRole('option', { name: /Lin Reviewer/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(await screen.findByText('Publish the signed evidence.')).toBeInTheDocument();
    expect(screen.getByText('@Lin Reviewer')).toBeInTheDocument();
    await waitFor(() =>
      expect(requests).toEqual([
        {
          method: 'PATCH',
          body: { body: 'Certificate revision verified.', mentionedUserIds: [], rowVersion: 1 },
        },
        {
          method: 'POST',
          body: { body: 'Publish the signed evidence.', mentionedUserIds: [teammateId] },
        },
      ]),
    );
  });

  it('keeps archived record discussions readable without exposing mutation controls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        items: [],
        pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
      }),
    );
    render(
      <I18nProvider>
        <RecordCommentsPanel
          archived
          base="/workspaces/workspace-1/projects/project-1"
          objectTypeId="table-1"
          recordId="record-1"
          user={user}
        />
      </I18nProvider>,
    );
    expect(await screen.findByText('Archived record comments are read-only.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post comment' })).not.toBeInTheDocument();
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
