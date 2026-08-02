import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataPage } from './DataPage.js';

afterEach(() => vi.restoreAllMocks());

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

describe('DataPage', () => {
  it('renders an object-type grid with typed values and pagination state', async () => {
    let patchBody: Record<string, unknown> | undefined;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/object-types')) {
        return json({
          items: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3792',
              projectId: '019fbcf9-e020-71da-935a-6a6a728b3793',
              name: 'Sample',
              pluralName: 'Samples',
              key: 'sample',
              icon: 'flask',
              description: '',
              system: true,
            },
          ],
        });
      }
      if (url.endsWith('/fields')) {
        return json({
          items: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3794',
              objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
              name: 'Serial',
              key: 'serial',
              description: '',
              fieldType: 'decimal',
              required: true,
              unique: true,
              position: 0,
              config: {},
              projectionStatus: 'ready',
            },
          ],
        });
      }
      if (url.endsWith('/records/query')) {
        return json({
          items: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3795',
              objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
              displayName: 'Sample Two',
              values: { serial: '2' },
              relations: {},
              rowVersion: 1,
              archivedAt: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
        });
      }
      if (url.endsWith('/records/019fbcf9-e020-71da-935a-6a6a728b3795')) {
        patchBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3795',
          objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
          displayName: 'Sample Two',
          values: { serial: '3' },
          relations: {},
          fileReferences: {},
          datasetReferences: {},
          rowVersion: 2,
          archivedAt: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T01:00:00.000Z',
        });
      }
      if (url.endsWith('/records/019fbcf9-e020-71da-935a-6a6a728b3795/archive')) {
        return json({ archivedAt: '2026-08-01T02:00:00.000Z' });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter
        initialEntries={[
          '/workspaces/019fbcf9-e020-71da-935a-6a6a728b3700/projects/019fbcf9-e020-71da-935a-6a6a728b3701/data',
        ]}
      >
        <Routes>
          <Route
            path="/workspaces/:workspaceId/projects/:projectId/data"
            element={<DataPage user={user} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Samples' })).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Quick view Sample Two' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 records · page 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New record' })).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/records\/query$/),
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: /Fields/ }));
    const serialVisibility = screen.getByRole('checkbox', { name: 'Serial' });
    fireEvent.click(serialVisibility);
    expect(screen.queryByRole('columnheader', { name: /Serial/ })).not.toBeInTheDocument();
    fireEvent.click(serialVisibility);
    expect(screen.getByRole('columnheader', { name: /Serial/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sample Two' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Serial for Sample Two' }));
    const editor = screen.getByRole('textbox', { name: 'Serial value' });
    fireEvent.change(editor, { target: { value: '3' } });
    fireEvent.keyDown(editor, { key: 'Enter' });

    await waitFor(() =>
      expect(patchBody).toMatchObject({
        displayName: 'Sample Two',
        values: { serial: '3' },
        relations: {},
        fileReferences: {},
        datasetReferences: {},
        rowVersion: 1,
      }),
    );
    expect(await screen.findByText('3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sample Two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/records\/019fbcf9-e020-71da-935a-6a6a728b3795\/archive$/),
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Quick view Sample Two' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Sample Two');
    expect(screen.getByRole('link', { name: 'Full record' })).toBeInTheDocument();
  });
});
