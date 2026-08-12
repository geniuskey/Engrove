import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FieldDefinition } from './DataPageTypes.js';
import { I18nProvider } from './i18n.js';
import { RecordRelationPicker } from './RecordRelationPicker.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const field: FieldDefinition = {
  id: '019fbcf9-e020-71da-935a-6a6a728b3711',
  objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3712',
  name: 'Samples',
  key: 'samples',
  description: '',
  fieldType: 'relation',
  required: false,
  unique: false,
  position: 0,
  config: {
    targetObjectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3713',
    multiple: true,
  },
  projectionStatus: 'ready',
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('RecordRelationPicker', () => {
  it('shows display-name chips, searches remotely, and submits one hidden value per link', async () => {
    const existing = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3714',
      displayName: 'Sample Alpha',
      archivedAt: null,
    };
    const candidate = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3715',
      displayName: 'Sample Beta',
      archivedAt: null,
    };
    const requestedUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      requestedUrls.push(String(input));
      return json({ items: [candidate], pageInfo: { hasNext: false } });
    });

    render(
      <I18nProvider>
        <form aria-label="Record form">
          <RecordRelationPicker
            base="/workspaces/w1234567890abcd/projects/p1234567890abcd"
            field={field}
            initialIds={[existing.id]}
            initialReferences={[existing]}
            name={`relation:${field.id}`}
          />
        </form>
      </I18nProvider>,
    );

    expect(screen.getByText('Sample Alpha')).toBeInTheDocument();
    const picker = screen.getByRole('combobox', { name: 'Search records to link…' });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'Beta' } });

    await waitFor(() =>
      expect(requestedUrls).toContain(
        `http://localhost:3000/api/v1/workspaces/w1234567890abcd/projects/p1234567890abcd/object-types/${field.config.targetObjectTypeId}/record-references?query=Beta&limit=20`,
      ),
    );
    fireEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: 'Sample Beta' }),
    );

    expect(screen.getByText('Sample Beta')).toBeInTheDocument();
    expect(
      new FormData(screen.getByRole('form', { name: 'Record form' }) as HTMLFormElement).getAll(
        `relation:${field.id}`,
      ),
    ).toEqual([existing.id, candidate.id]);

    fireEvent.click(screen.getByRole('button', { name: 'Unlink Sample Alpha' }));
    expect(
      new FormData(screen.getByRole('form', { name: 'Record form' }) as HTMLFormElement).getAll(
        `relation:${field.id}`,
      ),
    ).toEqual([candidate.id]);
  });

  it('keeps an archived existing link visible but excludes it from candidate options', async () => {
    const archived = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3716',
      displayName: 'Retired sample',
      archivedAt: '2026-08-11T12:00:00.000Z',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ items: [archived], pageInfo: { hasNext: false } }),
    );
    render(
      <I18nProvider>
        <RecordRelationPicker
          base="/workspaces/w1234567890abcd/projects/p1234567890abcd"
          field={field}
          initialIds={[archived.id]}
          initialReferences={[archived]}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('Retired sample')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    fireEvent.focus(screen.getByRole('combobox', { name: 'Search records to link…' }));
    expect(within(await screen.findByRole('listbox')).queryByText('Retired sample')).toBeNull();
  });

  it('replaces a single relation directly without requiring an unlink first', async () => {
    const existing = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3717',
      displayName: 'Sample Alpha',
      archivedAt: null,
    };
    const replacement = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3718',
      displayName: 'Sample Gamma',
      archivedAt: null,
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ items: [replacement], pageInfo: { hasNext: false } }),
    );
    render(
      <I18nProvider>
        <form aria-label="Single relation form">
          <RecordRelationPicker
            base="/workspaces/w1234567890abcd/projects/p1234567890abcd"
            field={{ ...field, config: { ...field.config, multiple: false } }}
            initialIds={[existing.id]}
            initialReferences={[existing]}
            name={`relation:${field.id}`}
          />
        </form>
      </I18nProvider>,
    );

    const picker = screen.getByRole('combobox', { name: 'Search records to link…' });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'Gamma' } });
    fireEvent.click(
      await within(await screen.findByRole('listbox')).findByRole('option', {
        name: 'Sample Gamma',
      }),
    );

    expect(screen.queryByText('Sample Alpha')).toBeNull();
    expect(screen.getByText('Sample Gamma')).toBeInTheDocument();
    expect(
      new FormData(
        screen.getByRole('form', { name: 'Single relation form' }) as HTMLFormElement,
      ).getAll(`relation:${field.id}`),
    ).toEqual([replacement.id]);
  });
});
