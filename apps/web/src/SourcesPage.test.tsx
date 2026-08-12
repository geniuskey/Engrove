import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { SourcesPage } from './SourcesPage.js';

const workspaceId = '019fbcf9-e020-71da-935a-6a6a728b3790';
const projectId = '019fbcf9-e020-71da-935a-6a6a728b3791';
const user = {
  id: '019fbcf9-e020-71da-935a-6a6a728b3792',
  email: 'owner@example.com',
  displayName: 'Owner',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3793',
  role: 'owner' as const,
};

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('SourcesPage', () => {
  it('links an external source with stable trace metadata', async () => {
    const source = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3701',
      title: 'Supplier qualification report',
      provider: 'SharePoint',
      url: 'https://sharepoint.example/reports/qualification',
      external_id: 'DOC-1842',
      version: 'Rev 4',
      observed_on: '2026-08-06',
      notes: 'Approved supplier evidence.',
      row_version: 1,
      archived_at: null,
    } as const;
    let saved = false;
    let postBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (init?.method === 'POST') {
        saved = true;
        postBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json(source);
      }
      const url = String(input);
      const items = saved && url.includes('archiveState=active') ? [source] : [];
      return json({
        items,
        pageInfo: { limit: 50, offset: 0, total: items.length, hasNext: false },
        summary: { providerCount: items.length ? 1 : 0 },
      });
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/sources`]}>
          <Routes>
            <Route
              element={<SourcesPage user={user} />}
              path="/workspaces/:workspaceId/projects/:projectId/sources"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add external material' }));
    const dialog = screen.getByRole('dialog', { name: 'Add external material' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Source title' }), {
      target: { value: source.title },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Source service' }), {
      target: { value: source.provider },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Source URL' }), {
      target: { value: source.url },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'External resource ID' }), {
      target: { value: source.external_id },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Version or revision' }), {
      target: { value: source.version },
    });
    fireEvent.change(within(dialog).getByLabelText(/Verified on/), {
      target: { value: source.observed_on },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add external material' }));

    await waitFor(() =>
      expect(postBody).toMatchObject({
        title: source.title,
        provider: source.provider,
        url: source.url,
        externalId: source.external_id,
        version: source.version,
        observedOn: source.observed_on,
      }),
    );
    expect(await screen.findByText(source.title)).toBeInTheDocument();
    expect(screen.getByText(/DOC-1842 · Rev 4/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open source' })).toHaveAttribute(
      'title',
      'Open source',
    );
    expect(screen.getByRole('button', { name: 'Copy source ID' })).toHaveAttribute(
      'title',
      'Copy source ID',
    );
    expect(screen.getByRole('link', { name: /Open project records/ })).toHaveAttribute(
      'href',
      `/workspaces/${workspaceId}/projects/${projectId}/data`,
    );
    expect(screen.getByText('External material linked.')).toBeInTheDocument();
  });

  it('searches on the server and loads the next bounded source page', async () => {
    const first = sourceFixture('019fbcf9-e020-71da-935a-6a6a728b3701', 'Supplier report');
    const second = sourceFixture('019fbcf9-e020-71da-935a-6a6a728b3702', 'Test evidence');
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('archiveState=archived')) return json(sourcePage([], 0, false));
      if (url.includes('offset=50')) return json(sourcePage([second], 51, false, 50));
      return json(sourcePage([first], 51, true));
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/sources`]}>
          <Routes>
            <Route
              element={<SourcesPage user={user} />}
              path="/workspaces/:workspaceId/projects/:projectId/sources"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByText(first.title)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search external materials' }), {
      target: { value: 'Rev 4' },
    });
    await waitFor(() => expect(urls.some((url) => url.includes('query=Rev%204'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Load more (1 of 51)' }));
    expect(await screen.findByText(second.title)).toBeInTheDocument();
    expect(urls.some((url) => url.includes('offset=50'))).toBe(true);
  });
});

function sourceFixture(id: string, title: string) {
  return {
    id,
    title,
    provider: 'SharePoint',
    url: `https://sharepoint.example/${id}`,
    external_id: '',
    version: 'Rev 4',
    observed_on: '2026-08-06',
    notes: '',
    row_version: 1,
    archived_at: null,
  };
}

function sourcePage(
  items: ReturnType<typeof sourceFixture>[],
  total: number,
  hasNext: boolean,
  offset = 0,
) {
  return {
    items,
    pageInfo: { limit: 50, offset, total, hasNext },
    summary: { providerCount: items.length ? 1 : 0 },
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
