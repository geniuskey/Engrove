import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { RecordViewSharePanel } from './RecordViewSharePanel.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('RecordViewSharePanel', () => {
  it('enables a bounded public link and exposes its full URL only in the create response', async () => {
    const requests: Array<{ method: string; body?: Record<string, unknown> }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const method = init?.method ?? 'GET';
      requests.push({
        method,
        ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
      });
      if (method === 'GET') return json({ share: null });
      return json(
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3701',
          recordViewId: '019fbcf9-e020-71da-935a-6a6a728b3702',
          tokenPrefix: 'sv_publicpref',
          passwordProtected: true,
          allowDownload: true,
          expiresAt: null,
          rowVersion: 1,
          accessCount: 0,
          lastAccessedAt: null,
          createdAt: '2026-08-11T12:00:00.000Z',
          updatedAt: '2026-08-11T12:00:00.000Z',
          url: 'http://localhost:4173/share/sv_secret',
        },
        201,
      );
    });

    render(
      <I18nProvider>
        <RecordViewSharePanel
          base="/workspaces/w123/projects/p123"
          objectTypeId="019fbcf9-e020-71da-935a-6a6a728b3703"
          onClose={vi.fn()}
          viewId="019fbcf9-e020-71da-935a-6a6a728b3702"
          viewName="Release readiness"
        />
      </I18nProvider>,
    );

    await screen.findByRole('button', { name: 'Enable public link' });
    const password = screen.getByLabelText(/^Password/);
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    fireEvent.change(password, {
      target: { value: 'strong-password' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow CSV download' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enable public link' }));

    expect(await screen.findByDisplayValue('http://localhost:4173/share/sv_secret')).toBeVisible();
    expect(requests.at(-1)).toEqual({
      method: 'POST',
      body: {
        password: 'strong-password',
        allowDownload: true,
        expiresAt: null,
      },
    });
    expect(screen.getByText('Public link enabled. Copy it now.')).toBeInTheDocument();
  });

  it('revokes an existing link with its optimistic row version', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    let revokeBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if ((init?.method ?? 'GET') === 'POST') {
        revokeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({ revoked: true });
      }
      return json({
        share: {
          id: '019fbcf9-e020-71da-935a-6a6a728b3701',
          recordViewId: '019fbcf9-e020-71da-935a-6a6a728b3702',
          tokenPrefix: 'sv_publicpref',
          passwordProtected: false,
          allowDownload: false,
          expiresAt: null,
          rowVersion: 7,
          accessCount: 2,
          lastAccessedAt: null,
          createdAt: '2026-08-11T12:00:00.000Z',
          updatedAt: '2026-08-11T12:00:00.000Z',
        },
      });
    });

    render(
      <I18nProvider>
        <RecordViewSharePanel
          base="/workspaces/w123/projects/p123"
          objectTypeId="019fbcf9-e020-71da-935a-6a6a728b3703"
          onClose={vi.fn()}
          viewId="019fbcf9-e020-71da-935a-6a6a728b3702"
          viewName="Release readiness"
        />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke link' }));
    await waitFor(() => expect(revokeBody).toEqual({ rowVersion: 7 }));
    expect(confirm).toHaveBeenCalledWith('Revoke this public link immediately?');
    expect(await screen.findByRole('button', { name: 'Enable public link' })).toBeInTheDocument();
  });
});
