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
    let recordExportBody: Record<string, unknown> | undefined;
    let releaseRecordExportPoll!: () => void;
    const recordExportPollGate = new Promise<void>((resolve) => {
      releaseRecordExportPoll = resolve;
    });
    let bulkFieldUpdateBody: Record<string, unknown> | undefined;
    const bulkLifecycleBodies: Array<{
      path: string;
      body: Record<string, unknown>;
    }> = [];
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
      if (url.endsWith('/fields') && (init?.method ?? 'GET') === 'GET') {
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
      if (new URL(url).pathname.endsWith('/views')) {
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
        const offset = Number(new URL(url).searchParams.get('offset') ?? 0);
        return json({
          items: [
            {
              id: offset ? 'view-older' : 'view-current',
              publicId: offset ? 'v00000000000002' : 'v00000000000001',
              objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
              name: offset ? 'Older qualification view' : 'Current qualification view',
              viewType: 'grid',
              config: {
                visibleFieldIds: [],
                fieldWidths: {},
                filters: [],
                sorts: [],
                rowDensity: 'compact',
                pageSize: 25,
              },
              rowVersion: 1,
              archivedAt: null,
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
          ],
          pageInfo: { limit: 50, offset, total: 2, hasNext: offset === 0 },
        });
      }
      if (url.endsWith('/views/v1234567890abcd')) {
        updateViewBody =
          (init?.method ?? 'GET') === 'GET'
            ? createViewBody
            : (JSON.parse(String(init?.body)) as Record<string, unknown>);
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3796',
          publicId: 'v1234567890abcd',
          objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
          name: updateViewBody!.name,
          viewType: 'grid',
          config: updateViewBody!.config,
          rowVersion: 2,
          archivedAt: null,
          updatedAt: '2026-08-01T01:00:00.000Z',
        });
      }
      if (url.endsWith('/views/v1234567890abce') && (init?.method ?? 'GET') === 'GET') {
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b379a',
          publicId: 'v1234567890abce',
          objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
          name: createViewBody!.name,
          viewType: createViewBody!.viewType,
          config: createViewBody!.config,
          rowVersion: 1,
          archivedAt: null,
          updatedAt: '2026-08-01T01:00:00.000Z',
        });
      }
      if (url.endsWith('/records/export.csv') && init?.method === 'POST') {
        recordExportBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3710',
          objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
          status: 'queued',
          progress: 0,
          rowCount: null,
          fieldCount: null,
          sizeBytes: null,
          fileName: 'sample.csv',
          errorCode: null,
          retryable: true,
          createdAt: '2026-08-01T00:00:00.000Z',
          completedAt: null,
          expiresAt: null,
          downloadReady: false,
        });
      }
      if (url.endsWith('/records/exports') && init?.method === 'POST') {
        recordExportBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3710',
          objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
          status: 'queued',
          progress: 0,
          rowCount: null,
          fieldCount: null,
          sizeBytes: null,
          fileName: 'sample.csv',
          errorCode: null,
          retryable: true,
          createdAt: '2026-08-01T00:00:00.000Z',
          completedAt: null,
          expiresAt: null,
          downloadReady: false,
        });
      }
      if (url.endsWith('/records/exports/019fbcf9-e020-71da-935a-6a6a728b3710')) {
        await recordExportPollGate;
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3710',
          objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
          status: 'succeeded',
          progress: 100,
          rowCount: 1,
          fieldCount: 4,
          sizeBytes: 40,
          fileName: 'sample.csv',
          errorCode: null,
          retryable: true,
          createdAt: '2026-08-01T00:00:00.000Z',
          completedAt: '2026-08-01T00:00:01.000Z',
          expiresAt: '2026-08-01T06:00:01.000Z',
          downloadReady: true,
        });
      }
      if (url.endsWith('/records/exports/019fbcf9-e020-71da-935a-6a6a728b3710/download')) {
        return json({
          url: 'https://storage.example.test/sample.csv',
          expiresIn: 300,
          fileName: 'sample.csv',
        });
      }
      if (url.endsWith('/records/query')) {
        const queryBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        recordQueryBodies.push(queryBody);
        const archived = queryBody.archiveState === 'archived';
        const requestedGroupings = Array.isArray(queryBody.groupings)
          ? (queryBody.groupings as Array<{ fieldId: string }>)
          : [];
        const requestedSummaries = Array.isArray(queryBody.summaries)
          ? (queryBody.summaries as Array<Record<string, unknown>>)
          : [];
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
              archivedAt: archived ? '2026-08-01T02:00:00.000Z' : null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          ...(queryBody.groupByFieldId ? { groups: [{ value: 'ready', count: 7 }] } : {}),
          ...(requestedGroupings.length
            ? {
                groupHierarchy: requestedGroupings.map((grouping, index) => ({
                  level: index + 1,
                  fieldId: grouping.fieldId,
                  path: requestedGroupings.slice(0, index + 1).map((candidate) => ({
                    fieldId: candidate.fieldId,
                    value:
                      candidate.fieldId === '019fbcf9-e020-71da-935a-6a6a728b3798' ? 'ready' : '2',
                  })),
                  count: index === 0 ? 7 : 4,
                  ...(requestedSummaries.length
                    ? {
                        summaries: requestedSummaries.map((summary) => ({
                          ...summary,
                          value: index === 0 ? '5.5' : '2',
                          unit: null,
                        })),
                      }
                    : {}),
                })),
              }
            : {}),
          ...(requestedSummaries.length
            ? {
                summaries: requestedSummaries.map((summary) => ({
                  ...summary,
                  value: '2',
                  unit: null,
                })),
              }
            : {}),
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
      if (
        (url.endsWith('/records/bulk/archive') || url.endsWith('/records/bulk/restore')) &&
        init?.method === 'POST'
      ) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        bulkLifecycleBodies.push({ path: new URL(url).pathname, body });
        return json({
          updated: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3795',
              rowVersion: 2,
            },
          ],
          archived: url.endsWith('/archive'),
        });
      }
      if (url.endsWith('/records/bulk/fields') && init?.method === 'PATCH') {
        bulkFieldUpdateBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          updated: [{ id: '019fbcf9-e020-71da-935a-6a6a728b3795', rowVersion: 4 }],
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
    await screen.findByRole('button', { name: 'Current qualification view' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more (1 of 2)' }));
    expect(
      await screen.findByRole('button', { name: 'Older qualification view' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Current qualification view' })).toBeInTheDocument();
    expect(
      screen.getByRole('region', {
        name: 'Samples table. Scroll horizontally to view more columns.',
      }),
    ).toHaveClass('w-full', 'min-w-0', 'max-w-full', 'overflow-x-auto');
    expect(
      await screen.findByRole('button', { name: 'Quick view Sample Two' }),
    ).toBeInTheDocument();
    const serialHeader = screen.getByRole('columnheader', { name: 'Serial' });
    expect(within(serialHeader).getByRole('img', { name: 'Decimal' })).toHaveTextContent('.0');
    expect(within(serialHeader).queryByText('Decimal')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Serial column options' })).not.toBeInTheDocument();
    const serialSortButton = screen.getByRole('button', { name: 'Sort by Serial' });
    fireEvent.keyDown(serialSortButton, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu', { name: 'Serial' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Filter this column' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Filter this column' }), {
      key: 'Escape',
    });
    expect(screen.getByText('1 records · page 1 of 1')).toBeInTheDocument();
    expect(screen.getByText('1 filtered rows')).toBeInTheDocument();
    const serialSummary = screen.getByRole('combobox', { name: 'Summary for Serial' });
    fireEvent.change(serialSummary, { target: { value: 'average' } });
    await waitFor(() =>
      expect(recordQueryBodies.at(-1)).toMatchObject({
        summaries: [
          {
            fieldId: '019fbcf9-e020-71da-935a-6a6a728b3794',
            operation: 'average',
          },
        ],
      }),
    );
    expect(within(serialSummary.parentElement!).getByText('2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    fireEvent.click(screen.getByRole('button', { name: /Add group/ }));
    await waitFor(() =>
      expect(recordQueryBodies.at(-1)).toMatchObject({
        groupings: [
          {
            fieldId: '019fbcf9-e020-71da-935a-6a6a728b3794',
            direction: 'asc',
            enabled: true,
          },
        ],
      }),
    );
    const serialGroup = await screen.findByRole('button', { name: 'Collapse 2' });
    expect(serialGroup.parentElement).toHaveTextContent('7');
    expect(screen.getByLabelText('Serial Average: 5.5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add subgroup/ }));
    await waitFor(() =>
      expect(recordQueryBodies.at(-1)).toMatchObject({
        groupings: [
          expect.objectContaining({ fieldId: '019fbcf9-e020-71da-935a-6a6a728b3794' }),
          expect.objectContaining({ fieldId: '019fbcf9-e020-71da-935a-6a6a728b3798' }),
        ],
      }),
    );
    expect(await screen.findByRole('button', { name: 'Collapse Ready' })).toBeInTheDocument();
    fireEvent.click(serialGroup);
    expect(screen.queryByRole('button', { name: 'Quick view Sample Two' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand 2' }));
    expect(screen.getByRole('button', { name: 'Quick view Sample Two' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable group level 2' }));
    await waitFor(() =>
      expect(recordQueryBodies.at(-1)?.groupings).toEqual([
        {
          fieldId: '019fbcf9-e020-71da-935a-6a6a728b3794',
          direction: 'asc',
          enabled: true,
        },
      ]),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable group level 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear grouping' }));
    await waitFor(() => expect(recordQueryBodies.at(-1)?.groupings).toBeUndefined());
    expect(screen.getByRole('button', { name: 'New record' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schema' })).toHaveClass('size-9');
    const downloadClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const exportButton = screen.getByRole('button', { name: 'Export current view CSV' });
    expect(exportButton).toHaveClass('size-9');
    fireEvent.click(exportButton);
    await waitFor(() => expect(recordExportBody).toBeDefined());
    expect(recordExportBody).toEqual({
      fieldKeys: ['serial', 'state', 'related-sample', 'spectrum'],
      filters: [],
      sorts: [{ systemField: 'displayName', direction: 'asc' }],
      archiveState: 'active',
    });
    expect(screen.getByRole('button', { name: 'Preparing current view CSV' })).toBeDisabled();
    releaseRecordExportPoll();
    await waitFor(() => expect(downloadClick).toHaveBeenCalledOnce(), { timeout: 2_000 });
    expect(await screen.findByText('CSV ready · 1 records downloaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New record' })).toHaveClass('engrove-button');
    expect(screen.getByRole('navigation', { name: 'Data navigation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Table API' }));
    expect(screen.getByRole('heading', { name: 'Table API quickstart' })).toBeInTheDocument();
    expect(screen.getByText('t1234567890abcd')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close table API quickstart' }));
    expect(screen.queryByRole('heading', { name: 'Table API quickstart' })).not.toBeInTheDocument();
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Field type' }), {
      target: { value: 'image' },
    });
    expect(screen.getByText('셀 이미지 첨부')).toBeInTheDocument();
    expect(screen.getByText(/PNG, JPEG, WebP, GIF 또는 AVIF/)).toBeInTheDocument();
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
    expect(screen.queryByText('⋯')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    expect(screen.getByRole('heading', { name: 'Review CSV import' })).toBeInTheDocument();
    expect(screen.getByLabelText(/CSV file/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit selected records' }));
    const bulkEdit = screen.getByRole('region', { name: 'Edit 1 selected records' });
    fireEvent.change(within(bulkEdit).getByRole('combobox', { name: 'Field for action 1' }), {
      target: { value: '019fbcf9-e020-71da-935a-6a6a728b3798' },
    });
    fireEvent.change(within(bulkEdit).getByRole('combobox', { name: 'Value' }), {
      target: { value: 'ready' },
    });
    fireEvent.click(within(bulkEdit).getByRole('button', { name: 'Add field change' }));
    fireEvent.change(within(bulkEdit).getByRole('combobox', { name: 'Field for action 2' }), {
      target: { value: '019fbcf9-e020-71da-935a-6a6a728b3799' },
    });
    fireEvent.change(
      within(bulkEdit).getByRole('combobox', { name: 'Operation for Related sample' }),
      { target: { value: 'clear' } },
    );
    fireEvent.click(within(bulkEdit).getByRole('button', { name: 'Update 1 records' }));
    await waitFor(() =>
      expect(bulkFieldUpdateBody).toMatchObject({
        records: [
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3795',
            rowVersion: expect.any(Number),
          },
        ],
        changes: [
          { fieldKey: 'state', operation: 'set', value: 'ready' },
          { fieldKey: 'related-sample', operation: 'clear' },
        ],
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Edit 1 selected records' })).toBeNull(),
    );

    const quickViewButton = screen.getByRole('button', { name: 'Quick view Sample Two' });
    fireEvent.click(quickViewButton);
    const quickView = screen.getByRole('dialog', { name: 'Sample Two' });
    expect(within(quickView).getByRole('button', { name: 'Copy Record ID' })).toBeInTheDocument();
    expect(within(quickView).queryByText('019fbcf9-e020-71da-935a-6a6a728b3795')).toBeNull();
    expect(within(quickView).getByRole('img', { name: 'Decimal' })).toHaveTextContent('.0');
    expect(within(quickView).getByRole('img', { name: 'Single select' })).toHaveTextContent('▾');
    expect(within(quickView).queryByText('single_select')).toBeNull();
    fireEvent.click(
      within(quickView).getAllByRole('button', { name: 'Close quick record view' })[0]!,
    );
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
    fireEvent.contextMenu(screen.getByRole('columnheader', { name: 'Serial' }), {
      clientX: 160,
      clientY: 120,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Filter this column' }));
    expect(screen.getByRole('combobox', { name: 'Field' })).toHaveValue(
      '019fbcf9-e020-71da-935a-6a6a728b3794',
    );
    await screen.findByRole('button', { name: 'Quick view Sample Two' });
    fireEvent.contextMenu(screen.getByRole('columnheader', { name: 'Serial' }), {
      clientX: 160,
      clientY: 120,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide column' }));
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
    expect(await screen.findByRole('columnheader', { name: /Serial/ })).toBeInTheDocument();

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
        permissionType: 'collaborative',
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
    expect(
      await screen.findByRole('img', { name: 'Spectrum mini chart · 2 points · 1 series' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sample Two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() =>
      expect(bulkLifecycleBodies.at(-1)).toMatchObject({
        path: expect.stringMatching(/records\/bulk\/archive$/),
        body: {
          ids: ['019fbcf9-e020-71da-935a-6a6a728b3795'],
          reason: 'Archived from grid bulk action',
        },
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Quick view Sample Two' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Sample Two');
    expect(screen.getByRole('link', { name: 'Full record' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close quick record view' })[0]!);

    fireEvent.click(screen.getByRole('button', { name: 'Show archived records' }));
    await waitFor(() =>
      expect(recordQueryBodies.at(-1)).toMatchObject({ archiveState: 'archived' }),
    );
    expect(screen.queryByRole('button', { name: 'New record' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view Sample Two' }));
    expect(
      screen.getByText('Archived records are read-only. Restore this record to edit it.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save record' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close quick record view' })[0]!);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sample Two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(bulkLifecycleBodies.at(-1)).toMatchObject({
        path: expect.stringMatching(/records\/bulk\/restore$/),
        body: { ids: ['019fbcf9-e020-71da-935a-6a6a728b3795'] },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show active records' }));
    await waitFor(() => expect(recordQueryBodies.at(-1)).toMatchObject({ archiveState: 'active' }));

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

    expect(screen.queryByLabelText('More table actions')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Actions for view Workflow board')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Workflow board' }), {
      clientX: 140,
      clientY: 180,
    });
    expect(screen.getByRole('menu', { name: 'Workflow board' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Rename view' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Duplicate as personal view' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Lock view' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Rename view' }), { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Workflow board' })).not.toBeInTheDocument();

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
  }, 20_000);

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
      if (url.endsWith('/fields') || new URL(url).pathname.endsWith('/views'))
        return json({ items: [] });
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

    expect(await screen.findByRole('heading', { name: 'Data library' })).toBeInTheDocument();
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
    fireEvent.focus(screen.getByRole('combobox', { name: 'Project filter' }));
    fireEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', {
        name: 'Motor program',
      }),
    );
    await waitFor(() =>
      expect(recordQueryBodies.some((body) => body.contextProjectId === linkedProjectId)).toBe(
        true,
      ),
    );
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    fireEvent.focus(screen.getByRole('combobox', { name: 'Project for Motor redesign' }));
    fireEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', {
        name: 'Motor program',
      }),
    );
    await waitFor(() =>
      expect(patchBody).toMatchObject({
        displayName: 'Motor redesign',
        contextProjectId: linkedProjectId,
        rowVersion: 1,
      }),
    );
  });

  it('searches and pages the table catalog on the server', async () => {
    const table = (id: string, publicId: string, name: string) => ({
      id,
      publicId,
      projectId: '019fbcf9-e020-71da-935a-6a6a728b3701',
      name,
      pluralName: `${name}s`,
      key: name.toLowerCase(),
      icon: 'table',
      description: '',
      system: false,
    });
    const first = table('019fbcf9-e020-71da-935a-6a6a728b3702', 't1234567890abcd', 'Sample');
    const second = table('019fbcf9-e020-71da-935a-6a6a728b3703', 't1234567890abce', 'Equipment');
    const searched = table(
      '019fbcf9-e020-71da-935a-6a6a728b3704',
      't1234567890abcf',
      'Specification',
    );
    const requests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/object-types')) {
        return json({
          items: [first],
          pageInfo: { limit: 50, offset: 0, total: 2, hasNext: true },
        });
      }
      if (url.includes('/object-types?limit=50&offset=1')) {
        return json({
          items: [second],
          pageInfo: { limit: 50, offset: 1, total: 2, hasNext: false },
        });
      }
      if (url.includes('/object-types?limit=50&offset=0&query=spec')) {
        return json({
          items: [searched],
          pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
        });
      }
      if (url.endsWith('/fields') || new URL(url).pathname.endsWith('/views'))
        return json({ items: [] });
      if (url.endsWith('/records/query'))
        return json({ items: [], page: 1, pageSize: 25, total: 0 });
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

    fireEvent.click(await screen.findByRole('button', { name: 'Load more (1 of 2)' }));
    await waitFor(() =>
      expect(requests).toEqual(expect.arrayContaining([expect.stringContaining('offset=1')])),
    );
    expect(await screen.findByRole('button', { name: /Equipments/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tables' }), {
      target: { value: 'spec' },
    });
    expect(await screen.findByRole('button', { name: /Specifications/ })).toBeInTheDocument();
    expect(requests.some((url) => url.includes('offset=1'))).toBe(true);
    expect(requests.some((url) => url.includes('query=spec'))).toBe(true);
  });

  it('creates the first table from an accessible empty-state dialog', async () => {
    let created = false;
    let createBody: Record<string, unknown> | undefined;
    const objectType = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3702',
      publicId: 't1234567890abcd',
      projectId: '019fbcf9-e020-71da-935a-6a6a728b3701',
      name: 'Test sample',
      pluralName: 'Test samples',
      key: 'test-samples',
      icon: 'table',
      description: '',
      system: false,
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/object-types')) {
        if (init?.method === 'POST') {
          createBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          created = true;
          return json(objectType);
        }
        return json({ items: created ? [objectType] : [] });
      }
      if (url.endsWith('/fields') || new URL(url).pathname.endsWith('/views'))
        return json({ items: [] });
      if (url.endsWith('/records/query')) {
        return json({ items: [], page: 1, pageSize: 25, total: 0 });
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

    const emptyState = (
      await screen.findByRole('heading', {
        name: 'Build your first traceable table',
      })
    ).closest('div');
    expect(emptyState).not.toBeNull();
    const createButton = within(emptyState!).getByRole('button', {
      name: '+ Create new table',
    });
    fireEvent.click(createButton);
    const dialog = screen.getByRole('dialog', { name: '+ Create new table' });
    expect(dialog).toBeInTheDocument();
    expect(document.body).toHaveStyle({ overflow: 'hidden' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '+ Create new table' })).not.toBeInTheDocument();
    await waitFor(() => expect(createButton).toHaveFocus());

    fireEvent.click(createButton);
    const reopenedDialog = screen.getByRole('dialog', { name: '+ Create new table' });
    fireEvent.change(within(reopenedDialog).getByRole('textbox', { name: 'Type name' }), {
      target: { value: 'Test sample' },
    });
    fireEvent.change(within(reopenedDialog).getByRole('textbox', { name: 'Table label' }), {
      target: { value: 'Test samples' },
    });
    fireEvent.change(within(reopenedDialog).getByRole('textbox', { name: 'Stable key' }), {
      target: { value: 'test-samples' },
    });
    fireEvent.click(within(reopenedDialog).getByRole('button', { name: 'Add table' }));

    await waitFor(() =>
      expect(createBody).toEqual({
        name: 'Test sample',
        pluralName: 'Test samples',
        key: 'test-samples',
        icon: 'table',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Test samples' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '+ Create new table' })).not.toBeInTheDocument();
  });
});
