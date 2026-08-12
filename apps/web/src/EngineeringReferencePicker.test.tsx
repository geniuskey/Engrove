import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineeringReferencePicker } from './EngineeringReferencePicker.js';
import { I18nProvider } from './i18n.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('EngineeringReferencePicker', () => {
  it('resolves an existing file id and searches active available files by human-readable text', async () => {
    const existingId = '019fbcf9-e020-71da-935a-6a6a728b3711';
    const candidateId = '019fbcf9-e020-71da-935a-6a6a728b3712';
    const existing = {
      id: existingId,
      series_name: 'Legacy evidence',
      version_number: 2,
      original_name: 'legacy.pdf',
      status: 'available',
      archived_at: '2026-08-10T10:00:00.000Z',
    };
    const candidate = {
      id: candidateId,
      series_name: 'Qualification evidence',
      version_number: 3,
      original_name: 'report.pdf',
      status: 'available',
      archived_at: null,
    };
    const requestedUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      return json({
        items: url.includes(existingId) ? [existing] : [candidate],
        pageInfo: { hasNext: false },
      });
    });

    render(
      <I18nProvider>
        <form aria-label="Record form">
          <EngineeringReferencePicker
            ariaLabel="Raw file"
            base="/workspaces/w1234567890abcd/projects/p1234567890abcd"
            defaultValue={existingId}
            fieldType="file"
            name="reference:file"
          />
        </form>
      </I18nProvider>,
    );

    const picker = screen.getByRole('combobox', { name: 'Raw file' });
    await waitFor(() => expect(picker).toHaveValue('Legacy evidence · v2 · legacy.pdf'));
    expect(requestedUrls[0]).toContain('archiveState=all');
    expect(requestedUrls[0]).toContain('status=all');

    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'Qualification' } });
    await waitFor(() =>
      expect(requestedUrls.some((url) => url.includes('query=Qualification'))).toBe(true),
    );
    const option = within(await screen.findByRole('listbox')).getByRole('option', {
      name: /Qualification evidence/,
    });
    fireEvent.click(option);

    expect(picker).toHaveValue('Qualification evidence · v3 · report.pdf');
    expect(
      new FormData(screen.getByRole('form', { name: 'Record form' }) as HTMLFormElement).get(
        'reference:file',
      ),
    ).toBe(candidateId);
    expect(requestedUrls.find((url) => url.includes('query=Qualification'))).toContain(
      'archiveState=active',
    );
  });

  it('shows only ready datasets as selectable references', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        items: [
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3713',
            name: 'Thermal sweep',
            dataset_type: 'xy',
            status: 'ready',
            archived_at: null,
          },
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3714',
            name: 'Still processing',
            dataset_type: 'tabular',
            status: 'processing',
            archived_at: null,
          },
        ],
        pageInfo: { hasNext: false },
      }),
    );

    render(
      <I18nProvider>
        <EngineeringReferencePicker
          ariaLabel="Dataset"
          base="/workspaces/w1234567890abcd/projects/p1234567890abcd"
          fieldType="dataset"
        />
      </I18nProvider>,
    );

    fireEvent.focus(screen.getByRole('combobox', { name: 'Dataset' }));
    expect(
      await within(await screen.findByRole('listbox')).findByRole('option', {
        name: /Thermal sweep/,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Still processing')).not.toBeInTheDocument();
  });
});
