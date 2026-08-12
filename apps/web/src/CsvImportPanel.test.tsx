import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsvImportPanel } from './CsvImportPanel.js';
import { I18nProvider } from './i18n.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CsvImportPanel', () => {
  it('previews and maps columns before confirming an update import', async () => {
    let importBody: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/records/import-csv/preview'))
        return new Response(
          JSON.stringify({
            headers: ['Name', 'Serial', 'Note'],
            totalRows: 2,
            sampleRows: [
              { Name: 'Pump A', Serial: 'P-1', Note: 'Inspect' },
              { Name: 'Pump B', Serial: 'P-2', Note: 'Ready' },
            ],
            targetFields: [
              {
                key: 'displayName',
                name: 'Record name',
                fieldType: 'display_name',
                required: true,
                unique: false,
                supported: true,
              },
              {
                key: 'serial',
                name: 'Serial',
                fieldType: 'text',
                required: true,
                unique: true,
                supported: true,
              },
              {
                key: 'note',
                name: 'Note',
                fieldType: 'text',
                required: false,
                unique: false,
                supported: true,
              },
            ],
            suggestedMappings: [
              { sourceHeader: 'Name', targetFieldKey: 'displayName' },
              { sourceHeader: 'Serial', targetFieldKey: 'serial' },
              { sourceHeader: 'Note', targetFieldKey: 'note' },
            ],
          }),
          { status: 200 },
        );
      if (url.endsWith('/records/import-csv')) {
        importBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            imported: 2,
            created: 0,
            updated: 2,
            skipped: 0,
            failed: 0,
            createdIds: [],
            updatedIds: [crypto.randomUUID(), crypto.randomUUID()],
            errors: [],
            errorsTruncated: false,
            idempotentReplay: false,
          }),
          { status: 201 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onImported = vi.fn(async () => undefined);

    render(
      <I18nProvider>
        <CsvImportPanel
          base="/workspaces/workspace-1/projects/project-1"
          objectTypeId="table-1"
          onClose={vi.fn()}
          onImported={onImported}
        />
      </I18nProvider>,
    );

    const file = new File(['Name,Serial,Note\nPump A,P-1,Inspect\nPump B,P-2,Ready'], 'pumps.csv', {
      type: 'text/csv',
    });
    fireEvent.change(screen.getByLabelText(/CSV file/), { target: { files: [file] } });

    expect(await screen.findByText('Pump A')).toBeInTheDocument();
    expect(screen.getByText(/pumps.csv · 2 rows · 3 columns/)).toBeInTheDocument();
    const selects = screen.getAllByRole('combobox');
    expect(selects.slice(0, 3).map((select) => (select as HTMLSelectElement).value)).toEqual([
      'displayName',
      'serial',
      'note',
    ]);
    fireEvent.change(screen.getByLabelText(/Duplicate handling/), {
      target: { value: 'update' },
    });
    fireEvent.change(screen.getByLabelText(/Unique match field/), {
      target: { value: 'serial' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));

    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
    expect(importBody).toMatchObject({
      duplicateStrategy: 'update',
      uniqueFieldKey: 'serial',
      mappings: [
        { sourceHeader: 'Name', targetFieldKey: 'displayName' },
        { sourceHeader: 'Serial', targetFieldKey: 'serial' },
        { sourceHeader: 'Note', targetFieldKey: 'note' },
      ],
    });
    expect(screen.getByText('0 created · 2 updated · 0 skipped · 0 failed')).toBeInTheDocument();
  });
});
