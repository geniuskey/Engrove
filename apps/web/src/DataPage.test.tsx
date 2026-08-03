import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ComponentProps, useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

describe('DataPage', () => {
  it('renders an object-type grid with typed values and pagination state', async () => {
    let patchBody: Record<string, unknown> | undefined;
    const patchBodies: Array<Record<string, unknown>> = [];
    let createViewBody: Record<string, unknown> | undefined;
    let updateViewBody: Record<string, unknown> | undefined;
    let schemaUpdateBody: Record<string, unknown> | undefined;
    let schemaOrderBody: Record<string, unknown> | undefined;
    let objectTypeUpdateBody: Record<string, unknown> | undefined;
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
              publicId: 't1234567890abcd',
              projectId: '019fbcf9-e020-71da-935a-6a6a728b3793',
              name: 'Sample',
              pluralName: 'Samples',
              key: 'sample',
              icon: 'flask',
              description: '',
              system: false,
            },
          ],
        });
      }
      if (url.endsWith('/object-types/t1234567890abcd') && init?.method === 'PATCH') {
        objectTypeUpdateBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3792',
          publicId: 't1234567890abcd',
          projectId: '019fbcf9-e020-71da-935a-6a6a728b3793',
          name: objectTypeUpdateBody.name,
          pluralName: objectTypeUpdateBody.pluralName,
          key: objectTypeUpdateBody.key,
          icon: 'flask',
          description: objectTypeUpdateBody.description,
          system: false,
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
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b379b',
              objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
              name: 'Spectrum',
              key: 'spectrum',
              description: 'UV-Vis spectrum',
              fieldType: 'spectral_data',
              required: false,
              unique: false,
              position: 3,
              config: {
                xLabel: 'Wavelength',
                xUnit: 'nm',
                yLabel: 'Absorbance',
                yUnit: 'a.u.',
              },
              projectionStatus: 'ready',
            },
          ],
        });
      }
      if (url.endsWith('/fields-order')) {
        schemaOrderBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({
          items: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3798',
              objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
              name: 'State',
              key: 'state',
              description: '',
              fieldType: 'single_select',
              required: true,
              unique: false,
              position: 0,
              config: { options: [{ key: 'ready', label: 'Ready' }] },
              defaultValue: 'ready',
              projectionStatus: 'ready',
            },
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3794',
              objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
              name: 'Serial',
              key: 'serial',
              description: 'A durable sample identifier.',
              fieldType: 'decimal',
              required: true,
              unique: true,
              position: 1,
              config: {},
              projectionStatus: 'ready',
            },
          ],
        });
      }
      if (url.endsWith('/fields/019fbcf9-e020-71da-935a-6a6a728b3794')) {
        schemaUpdateBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3794',
          objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
          name: schemaUpdateBody.name,
          key: 'serial',
          description: schemaUpdateBody.description,
          fieldType: 'decimal',
          required: schemaUpdateBody.required,
          unique: schemaUpdateBody.unique,
          position: schemaUpdateBody.position,
          config: schemaUpdateBody.config,
          projectionStatus: 'ready',
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
            publicId: createdViewCount === 1 ? 'v1234567890abcd' : 'v1234567890abce',
            objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
            name: createViewBody.name,
            viewType: createViewBody.viewType,
            config: Object.fromEntries(
              Object.entries(createViewBody.config as Record<string, unknown>).reverse(),
            ),
            rowVersion: 1,
            archivedAt: null,
            updatedAt: '2026-08-01T00:00:00.000Z',
          });
        }
        return json({ items: [] });
      }
      if (url.endsWith('/views/v1234567890abcd')) {
        updateViewBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3796',
          publicId: 'v1234567890abcd',
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
              values: {
                serial: '2',
                state: 'ready',
                spectrum: {
                  x: [400, 401],
                  series: [{ name: 'Sample A', values: [0.12, 0.18] }],
                },
              },
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
        patchBodies.push(patchBody);
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3795',
          objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
          displayName: patchBody.displayName,
          contextProjectId: patchBody.contextProjectId,
          values: patchBody.values,
          relations: patchBody.relations,
          fileReferences: patchBody.fileReferences,
          datasetReferences: patchBody.datasetReferences,
          rowVersion: Number(patchBody.rowVersion) + 1,
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
            element={
              <>
                <LocationProbe />
                <DataPageHarness />
              </>
            }
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
    expect(screen.getByRole('button', { name: 'Schema' })).toHaveClass('engrove-button');
    expect(screen.getByRole('button', { name: 'Export CSV' })).toHaveClass('engrove-button');
    expect(screen.getByRole('button', { name: 'New record' })).toHaveClass('engrove-button');
    expect(screen.getByRole('navigation', { name: 'Data navigation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Schema' }));
    expect(screen.getByRole('heading', { name: 'Schema editor' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit Serial' })).toBeInTheDocument();
    expect(screen.getByText('Index ready')).toBeInTheDocument();
    expect(screen.getByLabelText('Field definitions')).toHaveClass('overflow-y-auto');
    expect(screen.getByLabelText('Field definitions')).toHaveAttribute(
      'style',
      'max-height: 16rem;',
    );
    expect(screen.getByRole('listitem', { name: 'Field Serial' })).toHaveClass('py-1.5');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search fields' }), {
      target: { value: 'state' },
    });
    expect(screen.queryByRole('button', { name: 'Edit field Serial' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit field State' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search fields' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(screen.getByRole('heading', { name: 'Add a field' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Field name' }), {
      target: { value: 'Inspection status' },
    });
    expect(screen.getByRole('textbox', { name: 'Stable field key' })).toHaveValue(
      'inspection-status',
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Field type' }), {
      target: { value: 'spectral_data' },
    });
    expect(screen.getByRole('textbox', { name: 'X-axis label' })).toHaveValue('Wavelength');
    expect(screen.getByRole('textbox', { name: 'Signal unit' })).toHaveValue('a.u.');
    fireEvent.change(screen.getByRole('combobox', { name: 'Field type' }), {
      target: { value: 'tabular_data' },
    });
    expect(
      screen.getByRole('checkbox', {
        name: 'Treat the first pasted row as column headers',
      }),
    ).toBeChecked();
    fireEvent.change(screen.getByRole('combobox', { name: 'Field type' }), {
      target: { value: 'formula' },
    });
    expect(screen.getByRole('textbox', { name: 'Formula expression' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Field type' }), {
      target: { value: 'single_select' },
    });
    expect(screen.getByRole('textbox', { name: 'Select options' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit field Serial' }));
    expect(screen.getByRole('heading', { name: 'Edit Serial' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Field description' }), {
      target: { value: 'A durable sample identifier.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(schemaUpdateBody).toEqual({
        name: 'Serial',
        description: 'A durable sample identifier.',
        required: true,
        unique: true,
        position: 0,
        config: {},
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close schema editor' }));
    expect(screen.queryByRole('heading', { name: 'Schema editor' })).not.toBeInTheDocument();
    const moreTableActions = screen.getByText('⋯').closest('details');
    expect(moreTableActions).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('⋯'));
    expect(moreTableActions).toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: 'Import CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import records' })).toBeInTheDocument();
    const nameCell = screen.getByRole('button', { name: 'Edit Name for Sample Two' }).closest('td');
    const serialCell = screen
      .getByRole('button', { name: 'Edit Serial for Sample Two' })
      .closest('td');
    expect(nameCell).not.toBeNull();
    expect(serialCell).not.toBeNull();
    fireEvent.pointerDown(nameCell!, { button: 0, buttons: 1 });
    fireEvent.pointerEnter(serialCell!, { buttons: 1 });
    fireEvent.pointerUp(window);
    expect(screen.getByText('2 cells selected')).toBeInTheDocument();
    const clipboardSetData = vi.fn();
    fireEvent.copy(screen.getByRole('grid'), {
      clipboardData: { setData: clipboardSetData },
    });
    expect(clipboardSetData).toHaveBeenCalledWith('text/plain', 'Sample Two\t2');
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: { getData: () => 'Sample Two\t7' },
    });
    await waitFor(() =>
      expect(patchBodies.slice(0, 2)).toEqual([
        expect.objectContaining({ displayName: 'Sample Two', rowVersion: 1 }),
        expect.objectContaining({
          displayName: 'Sample Two',
          values: expect.objectContaining({ serial: '7' }),
          rowVersion: 2,
        }),
      ]),
    );
    expect((await screen.findAllByText('2 cells pasted.')).length).toBeGreaterThan(0);
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
            '019fbcf9-e020-71da-935a-6a6a728b379b',
          ],
          fieldWidths: { '019fbcf9-e020-71da-935a-6a6a728b3794': 240 },
          rowDensity: 'compact',
          pageSize: 25,
        },
      }),
    );
    expect(await screen.findByRole('button', { name: 'Review queue' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '?type=t1234567890abcd&view=v1234567890abcd',
      ),
    );

    confirmMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'All records' }));
    expect(confirmMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review queue' }));

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
    const cellEditor = editor.closest('[data-grid-cell-editor]');
    expect(cellEditor).toHaveClass('w-full', 'min-w-0', 'max-w-full', 'overflow-hidden');
    expect(screen.getByRole('button', { name: 'Cancel editing Serial' }).closest('td')).toBe(
      editor.closest('td'),
    );
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

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Spectrum for Sample Two' }));
    const spectrumEditor = screen.getByRole('textbox', { name: 'Spectrum value' });
    expect(spectrumEditor).toHaveValue('Wavelength\tSample A\n400\t0.12\n401\t0.18');
    fireEvent.change(spectrumEditor, {
      target: { value: 'Wavelength\tSample A\n500\t0.25\n501\t0.31' },
    });
    fireEvent.keyDown(spectrumEditor, { key: 'Enter', ctrlKey: true });
    await waitFor(() =>
      expect(patchBody).toMatchObject({
        values: {
          spectrum: {
            x: [500, 501],
            series: [{ name: 'Sample A', values: [0.25, 0.31] }],
          },
        },
      }),
    );
    expect(await screen.findByText('2 points · 1 series')).toBeInTheDocument();

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

    fireEvent.click(screen.getByRole('button', { name: 'Schema' }));
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: () => '',
      setData: vi.fn(),
    };
    fireEvent.dragStart(screen.getByRole('button', { name: 'Reorder field Serial' }), {
      dataTransfer,
    });
    const stateField = screen.getByRole('listitem', { name: 'Field State' });
    fireEvent.dragOver(stateField, { clientY: 1, dataTransfer });
    fireEvent.drop(stateField, { clientY: 1, dataTransfer });
    await waitFor(() =>
      expect(schemaOrderBody).toEqual({
        fieldIds: [
          '019fbcf9-e020-71da-935a-6a6a728b3798',
          '019fbcf9-e020-71da-935a-6a6a728b3794',
          '019fbcf9-e020-71da-935a-6a6a728b3799',
          '019fbcf9-e020-71da-935a-6a6a728b379b',
        ],
      }),
    );
    expect(
      [...screen.getByLabelText('Field definitions').querySelectorAll('[role="listitem"]')].map(
        (item) => item.getAttribute('aria-label'),
      ),
    ).toEqual(['Field State', 'Field Serial']);
    fireEvent.click(screen.getByRole('button', { name: 'Close schema editor' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Edit table' }));
    const settings = screen.getByRole('button', { name: 'Save table' }).closest('form');
    expect(settings).not.toBeNull();
    const settingsForm = within(settings!);
    fireEvent.change(settingsForm.getByRole('textbox', { name: 'Type name' }), {
      target: { value: 'Specimen' },
    });
    fireEvent.change(settingsForm.getByRole('textbox', { name: 'Table label' }), {
      target: { value: 'Specimens' },
    });
    fireEvent.change(settingsForm.getByRole('textbox', { name: 'Stable key' }), {
      target: { value: 'specimen' },
    });
    fireEvent.change(settingsForm.getByRole('textbox', { name: 'Table description' }), {
      target: { value: 'Prepared materials specimens' },
    });
    fireEvent.click(settingsForm.getByRole('button', { name: 'Save table' }));
    await waitFor(() =>
      expect(objectTypeUpdateBody).toEqual({
        name: 'Specimen',
        pluralName: 'Specimens',
        key: 'specimen',
        description: 'Prepared materials specimens',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Specimens' })).toBeInTheDocument();
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
              publicId: 't1234567890abce',
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

    const workspaceId = 'w1234567890abcd';
    const workspaceData = {
      workspaceId,
      backingProjectId,
      projects: [
        {
          id: linkedProjectId,
          name: 'Motor program',
          key: 'MOTOR',
          archivedAt: null,
        },
      ],
      legacyProjects: [{ id: 'legacy-project', name: 'force' }],
    };
    const workspaceDataPage = (
      <>
        <LocationProbe />
        <DataPageHarness workspaceData={workspaceData} />
      </>
    );

    render(
      <MemoryRouter initialEntries={[`/workspaces/${workspaceId}/data?type=t1234567890abce`]}>
        <Routes>
          <Route path="/workspaces/:workspaceId/data" element={workspaceDataPage} />
          <Route path="/workspaces/:workspaceId/:objectTypeId" element={workspaceDataPage} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Workspace data' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        `/workspaces/${workspaceId}/t1234567890abce`,
      ),
    );
    const legacyHelp = screen.getByLabelText('Legacy engineering tables');
    expect(legacyHelp.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(legacyHelp);
    expect(legacyHelp.closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('link', { name: 'force' })).toHaveAttribute(
      'href',
      `/workspaces/${workspaceId}/projects/legacy-project/data`,
    );
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
