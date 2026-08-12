import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { SharedViewPage } from './SharedViewPage.js';

const shareToken = `sv_${'a'.repeat(43)}`;
const statusFieldId = '019fbcf9-e020-71da-935a-6a6a728b3701';
const noteFieldId = '019fbcf9-e020-71da-935a-6a6a728b3702';
const view = {
  name: 'Release readiness',
  tableName: 'Requirements',
  viewType: 'grid' as const,
  rowDensity: 'compact' as const,
  fields: [
    {
      id: statusFieldId,
      name: 'Status',
      description: '',
      key: 'status',
      fieldType: 'single_select' as const,
      required: false,
      config: { options: [{ key: 'ready', label: 'Ready' }] },
    },
    {
      id: noteFieldId,
      name: 'Note',
      description: '',
      key: 'note',
      fieldType: 'text' as const,
      required: false,
      config: {},
    },
  ],
  fieldWidths: {},
  groupFieldId: null,
  dateFieldId: null,
  allowDownload: false,
  expiresAt: null,
};

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

function renderPage() {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[`/share/${shareToken}`]}>
        <Routes>
          <Route element={<SharedViewPage />} path="/share/:shareToken" />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('SharedViewPage', () => {
  it('renders only the public view contract and sends transient search and sort state', async () => {
    const queryBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        queryBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return json({
          items: [
            {
              id: 'r_public',
              displayName: 'REQ-42',
              values: { status: 'ready', note: 'Approved' },
              updatedAt: '2026-08-11T12:00:00.000Z',
            },
          ],
          page: 1,
          pageSize: 50,
          total: 1,
        });
      }
      return json({ requiresPassword: false, view });
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Release readiness' })).toBeInTheDocument();
    expect(await screen.findByText('REQ-42')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search visible data' }), {
      target: { value: 'Approved' },
    });
    await waitFor(() => expect(queryBodies.some((body) => body.search === 'Approved')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /^Note/ }));
    await waitFor(() =>
      expect(
        queryBodies.some(
          (body) =>
            JSON.stringify(body.sorts) ===
            JSON.stringify([{ fieldId: noteFieldId, direction: 'asc' }]),
        ),
      ).toBe(true),
    );
  });

  it('keeps protected metadata hidden until unlock and forwards the short-lived access token', async () => {
    const requests: Array<{ url: string; method: string; access: string | null }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const access = new Headers(init?.headers).get('x-engrove-share-access');
      requests.push({ url, method, access });
      if (url.endsWith('/unlock')) return json({ accessToken: `sa_${'b'.repeat(43)}` });
      if (url.endsWith('/query')) return json({ items: [], page: 1, pageSize: 50, total: 0 });
      return json(access ? { requiresPassword: true, view } : { requiresPassword: true });
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Password required' })).toBeInTheDocument();
    expect(screen.queryByText('Release readiness')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'strong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock view' }));

    expect(await screen.findByRole('heading', { name: 'Release readiness' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        requests.some(
          (request) => request.url.endsWith('/query') && request.access === `sa_${'b'.repeat(43)}`,
        ),
      ).toBe(true),
    );
  });

  it('renders a public form with required markers and safely retries with one idempotency key', async () => {
    const submissions: Array<{ body: Record<string, unknown>; idempotencyKey: string | null }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/submit')) {
        submissions.push({
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          idempotencyKey: new Headers(init?.headers).get('idempotency-key'),
        });
        return json(
          {
            recordId: statusFieldId,
            submittedAt: '2026-08-11T12:00:00.000Z',
            idempotentReplay: false,
          },
          201,
        );
      }
      return json({
        requiresPassword: false,
        view: {
          ...view,
          viewType: 'form',
          fields: [
            {
              id: noteFieldId,
              name: 'Request detail',
              description: 'Tell us what evidence you need.',
              key: 'request-detail',
              fieldType: 'long_text',
              required: true,
              config: {},
            },
          ],
        },
      });
    });

    renderPage();
    expect(await screen.findByRole('heading', { name: 'Release readiness' })).toBeInTheDocument();
    expect(screen.getAllByText('Required')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'External request' } });
    fireEvent.change(screen.getByLabelText(/^Request detail/), {
      target: { value: 'Qualification evidence needed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByRole('heading', { name: 'Submission received' })).toBeInTheDocument();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(submissions[0]?.body).toEqual({
      displayName: 'External request',
      values: { 'request-detail': 'Qualification evidence needed' },
      website: '',
    });
  });
});
