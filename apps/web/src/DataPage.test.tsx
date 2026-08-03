import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ComponentProps, useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataPage } from './DataPage.js';
import { ServiceSidebarPortalContext } from './ServiceSidebar.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

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

function DataPageHarness({
  workspaceData,
}: {
  workspaceData?: ComponentProps<typeof DataPage>['workspaceData'];
}) {
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  return (
    <ServiceSidebarPortalContext.Provider value={portal}>
      <aside aria-label="Service sidebar">
        <div ref={setPortal} />
      </aside>
      <DataPage user={user} {...(workspaceData ? { workspaceData } : {})} />
    </ServiceSidebarPortalContext.Provider>
  );
}

describe('DataPage', () => {
  it('renders an object-type grid with typed values and pagination state', async () => {
    let patchBody: Record<string, unknown> | undefined;
    let createViewBody: Record<string, unknown> | undefined;
    let updateViewBody: Record<string, unknown> | undefined;
    let inlineCreateBody: Record<string, unknown> | undefined;
    let createdViewCount = 0;
    const recordQueryBodies: Array<Record<string, unknown>> = [];
    const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);
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
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3798',
              objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
              name: 'State',
              key: 'state',
              description: '',
              fieldType: 'single_select',
              required: true,
              unique: false,
              position: 1,
              config: { options: [{ key: 'ready', label: 'Ready' }] },
              defaultValue: 'ready',
              projectionStatus: 'ready',
            },
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3799',
              objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
              name: 'Related sample',
              key: 'related-sample',
              description: '',
              fieldType: 'relation',
              required: false,
              unique: false,
              position: 2,
              config: {
                targetObjectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
                multiple: false,
              },
              projectionStatus: 'ready',
            },
          ],
        });
      }
      if (url.endsWith('/views')) {
        if (init?.method === 'POST') {
          createViewBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          createdViewCount += 1;
          return json({
            id:
              createdViewCount === 1
                ? '019fbcf9-e020-71da-935a-6a6a728b3796'
                : '019fbcf9-e020-71da-935a-6a6a728b379a',
            objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
            name: createViewBody.name,
            viewType: createViewBody.viewType,
            config: createViewBody.config,
            rowVersion: 1,
            archivedAt: null,
            updatedAt: '2026-08-01T00:00:00.000Z',
          });
        }
        return json({ items: [] });
      }
      if (url.endsWith('/views/019fbcf9-e020-71da-935a-6a6a728b3796')) {
        updateViewBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3796',
          objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
          name: updateViewBody.name,
          viewType: 'grid',
          config: updateViewBody.config,
          rowVersion: 2,
          archivedAt: null,
          updatedAt: '2026-08-01T01:00:00.000Z',
        });
      }
      if (url.endsWith('/records/query')) {
        const queryBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        recordQueryBodies.push(queryBody);
        return json({
          items: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3795',
              objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
              displayName: 'Sample Two',
              values: { serial: '2', state: 'ready' },
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
          ...(queryBody.groupByFieldId ? { groups: [{ value: 'ready', count: 7 }] } : {}),
        });
      }
      if (url.endsWith('/records') && init?.method === 'POST') {
        inlineCreateBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3797',
          objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
          displayName: inlineCreateBody.displayName,
          values: inlineCreateBody.values,
          relations: inlineCreateBody.relations,
          fileReferences: inlineCreateBody.fileReferences,
          datasetReferences: inlineCreateBody.datasetReferences,
          rowVersion: 1,
          archivedAt: null,
          createdAt: '2026-08-01T02:00:00.000Z',
          updatedAt: '2026-08-01T02:00:00.000Z',
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
            element={<DataPageHarness />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Samples' })).toBeInTheDocument();
    expect(
      screen.getByRole('region', {
        name: 'Samples table. Scroll horizontally to view more columns.',
      }),
    ).toHaveClass('w-full', 'min-w-0', 'max-w-full', 'overflow-x-auto');
    expect(
      await screen.findByRole('button', { name: 'Quick view Sample Two' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 records · page 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New record' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Data navigation' })).toBeInTheDocument();
    const sampleRow = screen.getByRole('button', { name: 'Quick view Sample Two' }).closest('tr');
    expect(sampleRow).not.toBeNull();
    fireEvent.contextMenu(sampleRow!, { clientX: 120, clientY: 140 });
    expect(screen.getByRole('menu', { name: 'Sample Two' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select row' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    const quickViewButton = screen.getByRole('button', { name: 'Quick view Sample Two' });
    fireEvent.keyDown(quickViewButton, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu', { name: 'Sample Two' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Open quick view' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('menu', { name: 'Sample Two' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Serial' }));
    await waitFor(() =>
      expect(
        recordQueryBodies.some(
          (body) =>
            JSON.stringify(body.sorts) ===
            JSON.stringify([
              {
                fieldId: '019fbcf9-e020-71da-935a-6a6a728b3794',
                direction: 'asc',
              },
            ]),
        ),
      ).toBe(true),
    );
    await screen.findByRole('button', { name: 'Quick view Sample Two' });
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Serial' }));
    await waitFor(() =>
      expect(
        recordQueryBodies.some(
          (body) =>
            JSON.stringify(body.sorts) ===
            JSON.stringify([
              {
                fieldId: '019fbcf9-e020-71da-935a-6a6a728b3794',
                direction: 'desc',
              },
            ]),
        ),
      ).toBe(true),
    );
    await screen.findByRole('button', { name: 'Quick view Sample Two' });
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Serial' }));
    await waitFor(() =>
      expect(recordQueryBodies.some((body) => JSON.stringify(body.sorts) === '[]')).toBe(true),
    );
    await screen.findByRole('button', { name: 'Quick view Sample Two' });
    fireEvent.click(screen.getByRole('button', { name: 'Column options for Serial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Filter Serial' }));
    expect(screen.getByRole('combobox', { name: 'Field' })).toHaveValue(
      '019fbcf9-e020-71da-935a-6a6a728b3794',
    );
    await screen.findByRole('button', { name: 'Quick view Sample Two' });
    fireEvent.click(screen.getByRole('button', { name: 'Column options for Serial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide Serial column' }));
    expect(screen.queryByRole('columnheader', { name: /Serial/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show all columns' }));
    expect(screen.getByRole('columnheader', { name: /Serial/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/records\/query$/),
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Quick search records' }), {
      target: { value: 'Sample Two' },
    });
    await waitFor(() =>
      expect(recordQueryBodies.some((body) => body.search === 'Sample Two')).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear record search' }));

    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    const serialVisibility = screen.getByRole('checkbox', { name: 'Serial' });
    fireEvent.click(serialVisibility);
    expect(screen.queryByRole('columnheader', { name: /Serial/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '+ Add record' }));
    expect(screen.getByRole('dialog', { name: 'New record' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close new record panel' })[0]!);
    fireEvent.click(serialVisibility);
    expect(screen.getByRole('columnheader', { name: /Serial/ })).toBeInTheDocument();

    const serialOrderHandle = screen.getByRole('button', {
      name: 'Reorder Serial column',
    });
    fireEvent.keyDown(serialOrderHandle, { key: 'ArrowRight' });
    let customHeaderNames = screen
      .getAllByRole('columnheader')
      .map((header) => header.getAttribute('aria-label'));
    expect(customHeaderNames.indexOf('State')).toBeLessThan(customHeaderNames.indexOf('Serial'));
    expect(screen.getByText('Serial moved next to State')).toHaveClass('sr-only');
    fireEvent.keyDown(serialOrderHandle, { key: 'ArrowLeft' });
    customHeaderNames = screen
      .getAllByRole('columnheader')
      .map((header) => header.getAttribute('aria-label'));
    expect(customHeaderNames.indexOf('Serial')).toBeLessThan(customHeaderNames.indexOf('State'));

    const serialResizeHandle = screen.getByRole('separator', {
      name: 'Resize Serial column',
    });
    fireEvent.pointerDown(serialResizeHandle, { button: 0, clientX: 200, pointerId: 1 });
    expect(document.body).toHaveStyle({ cursor: 'col-resize', userSelect: 'none' });
    fireEvent.pointerMove(serialResizeHandle, { clientX: 264, pointerId: 1 });
    fireEvent.pointerUp(serialResizeHandle, { clientX: 264, pointerId: 1 });
    expect(document.body.style.cursor).toBe('');
    expect(serialResizeHandle).toHaveAttribute('aria-valuenow', '240');
    expect(screen.getByText('Serial width: 240 pixels')).toHaveClass('sr-only');
    expect(
      document.querySelector('col[data-column-id="019fbcf9-e020-71da-935a-6a6a728b3794"]'),
    ).toHaveStyle({ width: '240px' });

    fireEvent.keyDown(serialResizeHandle, { key: 'ArrowRight' });
    expect(serialResizeHandle).toHaveAttribute('aria-valuenow', '248');
    fireEvent.doubleClick(serialResizeHandle);
    expect(serialResizeHandle).toHaveAttribute('aria-valuenow', '176');
    fireEvent.change(screen.getByRole('slider', { name: 'Serial column width' }), {
      target: { value: '240' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Reset widths/ }));
    expect(serialResizeHandle).toHaveAttribute('aria-valuenow', '176');
    fireEvent.change(screen.getByRole('slider', { name: 'Serial column width' }), {
      target: { value: '240' },
    });
    await waitFor(() =>
      expect(
        JSON.parse(
          window.localStorage.getItem(
            'engrove:table-layout:019fbcf9-e020-71da-935a-6a6a728b3700:019fbcf9-e020-71da-935a-6a6a728b3701:019fbcf9-e020-71da-935a-6a6a728b3792',
          ) ?? '{}',
        ),
      ).toMatchObject({
        fieldWidths: { '019fbcf9-e020-71da-935a-6a6a728b3794': 240 },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create view' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
      target: { value: 'Review queue' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save new view' }));
    await waitFor(() =>
      expect(createViewBody).toMatchObject({
        name: 'Review queue',
        config: {
          visibleFieldIds: [
            '019fbcf9-e020-71da-935a-6a6a728b3794',
            '019fbcf9-e020-71da-935a-6a6a728b3798',
            '019fbcf9-e020-71da-935a-6a6a728b3799',
          ],
          fieldWidths: { '019fbcf9-e020-71da-935a-6a6a728b3794': 240 },
          rowDensity: 'compact',
          pageSize: 25,
        },
      }),
    );
    expect(await screen.findByRole('button', { name: 'Review queue' })).toBeInTheDocument();

    const densitySelect = screen.getByRole('combobox', { name: 'Row density' });
    fireEvent.change(densitySelect, {
      target: { value: 'comfortable' },
    });
    expect(screen.getByRole('combobox', { name: 'Row density' })).toHaveValue('comfortable');
    expect(await screen.findByText('Unsaved')).toBeInTheDocument();
    confirmMock.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'All records' }));
    expect(window.confirm).toHaveBeenCalledWith(
      'Discard unsaved changes to this shared view? This cannot be undone.',
    );
    expect(screen.getByRole('button', { name: 'Review queue' })).toHaveClass('text-sky-200');
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    await waitFor(() =>
      expect(updateViewBody).toMatchObject({
        name: 'Review queue',
        rowVersion: 1,
        config: { rowDensity: 'comfortable' },
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: '+ Add record' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'New record name' }), {
      target: { value: 'Sample Three' },
    });
    const inlineSerial = screen.getByRole('textbox', { name: 'New record Serial' });
    fireEvent.change(inlineSerial, { target: { value: '3' } });
    fireEvent.keyDown(inlineSerial, { key: 'Enter' });
    await waitFor(() =>
      expect(inlineCreateBody).toEqual({
        displayName: 'Sample Three',
        values: { serial: '3', state: 'ready' },
        relations: {},
        fileReferences: {},
        datasetReferences: {},
      }),
    );
    expect(
      await screen.findByText('Sample Three created. The next blank row is ready.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'New record name' })).toHaveValue('');

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
    fireEvent.click(screen.getAllByRole('button', { name: 'Close quick record view' })[0]!);

    fireEvent.click(screen.getByRole('button', { name: 'Create view' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
      target: { value: 'Workflow board' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'View type' }), {
      target: { value: 'kanban' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Kanban grouping field' }), {
      target: { value: '019fbcf9-e020-71da-935a-6a6a728b3798' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save new view' }));
    expect(await screen.findByRole('heading', { name: 'Ready' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Ready' }).parentElement).toHaveTextContent('7'),
    );
    expect(screen.getByRole('combobox', { name: 'Move Sample Two' })).toHaveValue('ready');
    expect(createViewBody).toMatchObject({
      name: 'Workflow board',
      viewType: 'kanban',
      config: {
        viewOptions: { groupFieldId: '019fbcf9-e020-71da-935a-6a6a728b3798' },
      },
    });
  });

  it('edits project context alongside rows in a workspace-shared table', async () => {
    const backingProjectId = '019fbcf9-e020-71da-935a-6a6a728b3710';
    const objectTypeId = '019fbcf9-e020-71da-935a-6a6a728b3711';
    const recordId = '019fbcf9-e020-71da-935a-6a6a728b3712';
    const linkedProjectId = '019fbcf9-e020-71da-935a-6a6a728b3713';
    let patchBody: Record<string, unknown> | undefined;
    const recordQueryBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/object-types')) {
        return json({
          items: [
            {
              id: objectTypeId,
              projectId: backingProjectId,
              name: 'Project item',
              pluralName: 'Project items',
              key: 'project-item',
              icon: 'table',
              description: '',
              system: false,
            },
          ],
        });
      }
      if (url.endsWith('/fields') || url.endsWith('/views')) return json({ items: [] });
      if (url.endsWith('/records/query')) {
        recordQueryBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return json({
          items: [
            {
              id: recordId,
              objectTypeId,
              contextProjectId: null,
              displayName: 'Motor redesign',
              values: {},
              relations: {},
              fileReferences: {},
              datasetReferences: {},
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
      if (url.endsWith(`/records/${recordId}`) && init?.method === 'PATCH') {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          id: recordId,
          objectTypeId,
          contextProjectId: linkedProjectId,
          displayName: 'Motor redesign',
          values: {},
          relations: {},
          fileReferences: {},
          datasetReferences: {},
          rowVersion: 2,
          archivedAt: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T01:00:00.000Z',
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/workspaces/workspace-id/data']}>
        <DataPageHarness
          workspaceData={{
            workspaceId: '019fbcf9-e020-71da-935a-6a6a728b3700',
            backingProjectId,
            projects: [
              {
                id: linkedProjectId,
                name: 'Motor program',
                key: 'MOTOR',
                archivedAt: null,
              },
            ],
          }}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Workspace data' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Quick view Motor redesign' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Project filter' }), {
      target: { value: linkedProjectId },
    });
    await waitFor(() =>
      expect(recordQueryBodies.some((body) => body.contextProjectId === linkedProjectId)).toBe(
        true,
      ),
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Project for Motor redesign' }), {
      target: { value: linkedProjectId },
    });
    await waitFor(() =>
      expect(patchBody).toMatchObject({
        displayName: 'Motor redesign',
        contextProjectId: linkedProjectId,
        rowVersion: 1,
      }),
    );
  });
});
