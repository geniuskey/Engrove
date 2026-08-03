import { expect, test, type Page, type Request } from '@playwright/test';

const workspaceId = '019fbcf9-e020-71da-935a-6a6a728b3700';
const backingProjectId = '019fbcf9-e020-71da-935a-6a6a728b3701';
const linkedProjectId = '019fbcf9-e020-71da-935a-6a6a728b3702';
const legacyProjectId = '019fbcf9-e020-71da-935a-6a6a728b3703';
const objectTypeId = '019fbcf9-e020-71da-935a-6a6a728b3704';
const stateFieldId = '019fbcf9-e020-71da-935a-6a6a728b3705';
const dateFieldId = '019fbcf9-e020-71da-935a-6a6a728b3706';
const recordId = '019fbcf9-e020-71da-935a-6a6a728b3707';
const kanbanViewId = '019fbcf9-e020-71da-935a-6a6a728b3708';
const calendarViewId = '019fbcf9-e020-71da-935a-6a6a728b3709';

interface ApiCapture {
  recordQueries: Array<Record<string, unknown>>;
  recordPatches: Array<Record<string, unknown>>;
}

function body(request: Request): Record<string, unknown> {
  return request.postDataJSON() as Record<string, unknown>;
}

async function mockWorkspaceApi(page: Page): Promise<ApiCapture> {
  const capture: ApiCapture = { recordQueries: [], recordPatches: [] };
  await page.route('http://localhost:3000/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const json = async (value: unknown) => route.fulfill({ json: value });

    if (pathname === '/health/ready') {
      await json({
        service: 'api',
        status: 'ok',
        version: '0.1.0',
        timestamp: '',
        requestId: 'e2e',
      });
      return;
    }
    if (pathname === '/api/v1/setup/status') {
      await json({ available: false });
      return;
    }
    if (pathname === '/api/v1/auth/me') {
      await json({
        user: {
          id: '019fbcf9-e020-71da-935a-6a6a728b3710',
          email: 'owner@example.com',
          displayName: 'Owner',
          organizationId: '019fbcf9-e020-71da-935a-6a6a728b3711',
          role: 'owner',
        },
      });
      return;
    }
    if (pathname === '/api/v1/workspaces') {
      await json({
        items: [
          {
            id: workspaceId,
            name: 'Engineering',
            slug: 'engineering',
            description: '',
            archivedAt: null,
          },
        ],
      });
      return;
    }
    if (pathname === `/api/v1/workspaces/${workspaceId}/projects`) {
      await json({
        items: [
          {
            id: linkedProjectId,
            workspaceId,
            name: 'Motor program',
            key: 'MOTOR',
            description: '',
            status: 'active',
            rowVersion: 1,
            archivedAt: null,
          },
          {
            id: legacyProjectId,
            workspaceId,
            name: 'Legacy evidence',
            key: 'LEGACY',
            description: '',
            status: 'active',
            rowVersion: 1,
            archivedAt: null,
          },
        ],
      });
      return;
    }
    if (pathname === `/api/v1/workspaces/${workspaceId}/data-context`) {
      await json({ projectId: backingProjectId, legacyProjectIds: [legacyProjectId] });
      return;
    }

    const base = `/api/v1/workspaces/${workspaceId}/projects/${backingProjectId}`;
    if (pathname === `${base}/object-types`) {
      await json({
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
      return;
    }
    if (pathname === `${base}/object-types/${objectTypeId}/fields`) {
      await json({
        items: [
          {
            id: stateFieldId,
            objectTypeId,
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
            id: dateFieldId,
            objectTypeId,
            name: 'Scheduled',
            key: 'scheduled',
            description: '',
            fieldType: 'date',
            required: true,
            unique: false,
            position: 1,
            config: {},
            projectionStatus: 'ready',
          },
        ],
      });
      return;
    }
    if (pathname === `${base}/object-types/${objectTypeId}/views`) {
      const common = {
        objectTypeId,
        fieldWidths: {},
        filters: [],
        sorts: [{ systemField: 'displayName', direction: 'asc' }],
        rowDensity: 'compact',
        pageSize: 25,
        rowVersion: 1,
        archivedAt: null,
        updatedAt: '2026-08-02T00:00:00.000Z',
      };
      await json({
        items: [
          {
            ...common,
            id: kanbanViewId,
            name: 'Workflow board',
            viewType: 'kanban',
            config: {
              visibleFieldIds: [stateFieldId, dateFieldId],
              fieldWidths: common.fieldWidths,
              filters: common.filters,
              sorts: common.sorts,
              rowDensity: common.rowDensity,
              pageSize: common.pageSize,
              viewOptions: { groupFieldId: stateFieldId },
            },
          },
          {
            ...common,
            id: calendarViewId,
            name: 'Schedule',
            viewType: 'calendar',
            config: {
              visibleFieldIds: [stateFieldId, dateFieldId],
              fieldWidths: common.fieldWidths,
              filters: common.filters,
              sorts: common.sorts,
              rowDensity: common.rowDensity,
              pageSize: common.pageSize,
              viewOptions: { dateFieldId },
            },
          },
        ],
      });
      return;
    }
    if (pathname === `${base}/object-types/${objectTypeId}/records/query`) {
      const query = body(request);
      capture.recordQueries.push(query);
      await json({
        items: [
          {
            id: recordId,
            objectTypeId,
            contextProjectId: null,
            displayName: 'Motor redesign',
            values: { state: 'ready', scheduled: '2026-08-15' },
            relations: {},
            fileReferences: {},
            datasetReferences: {},
            rowVersion: 1,
            archivedAt: null,
            createdAt: '2026-08-02T00:00:00.000Z',
            updatedAt: '2026-08-02T00:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: Number(query.pageSize ?? 25),
        total: 1,
        ...(query.groupByFieldId ? { groups: [{ value: 'ready', count: 7 }] } : {}),
      });
      return;
    }
    if (
      pathname === `${base}/object-types/${objectTypeId}/records/${recordId}` &&
      request.method() === 'PATCH'
    ) {
      const patch = body(request);
      capture.recordPatches.push(patch);
      await json({
        id: recordId,
        objectTypeId,
        contextProjectId: patch.contextProjectId,
        displayName: 'Motor redesign',
        values: { state: 'ready', scheduled: '2026-08-15' },
        relations: {},
        fileReferences: {},
        datasetReferences: {},
        rowVersion: 2,
        archivedAt: null,
        createdAt: '2026-08-02T00:00:00.000Z',
        updatedAt: '2026-08-02T01:00:00.000Z',
      });
      return;
    }

    await route.fulfill({
      status: 500,
      json: { error: { code: 'UNMOCKED_REQUEST', message: `${request.method()} ${pathname}` } },
    });
  });
  return capture;
}

test('filters and edits project context while preserving legacy engineering data links', async ({
  page,
}) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(`/workspaces/${workspaceId}/data`);

  await expect(page.getByRole('heading', { name: 'Workspace data' })).toBeVisible();
  expect(
    await page.getByRole('button', { name: 'New record' }).evaluate((element) => {
      return getComputedStyle(element).backgroundColor;
    }),
  ).not.toBe('rgba(0, 0, 0, 0)');
  const legacyHelp = page.getByLabel('Legacy engineering tables');
  await expect(legacyHelp).toBeVisible();
  await legacyHelp.click();
  await expect(page.getByRole('link', { name: 'Legacy evidence' })).toHaveAttribute(
    'href',
    `/workspaces/${workspaceId}/projects/${legacyProjectId}/data`,
  );
  await expect(page.getByRole('columnheader', { name: 'Project' })).toBeVisible();

  const stateResizeHandle = page.getByRole('separator', { name: 'Resize State column' });
  await expect(stateResizeHandle).toHaveAttribute('aria-valuenow', '176');
  const resizeBox = await stateResizeHandle.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    resizeBox!.x + resizeBox!.width / 2 + 64,
    resizeBox!.y + resizeBox!.height / 2,
  );
  await page.mouse.up();
  await expect(stateResizeHandle).toHaveAttribute('aria-valuenow', '240');

  const stateOrderHandle = page.getByRole('button', { name: 'Reorder State column' });
  const scheduledHeader = page.getByRole('columnheader', { name: 'Scheduled' });
  await stateOrderHandle.dragTo(scheduledHeader);
  const stateHeaderBox = await page.getByRole('columnheader', { name: 'State' }).boundingBox();
  const scheduledHeaderBox = await scheduledHeader.boundingBox();
  expect(stateHeaderBox).not.toBeNull();
  expect(scheduledHeaderBox).not.toBeNull();
  expect(scheduledHeaderBox!.x).toBeLessThan(stateHeaderBox!.x);

  await page.getByRole('combobox', { name: 'Project filter' }).selectOption(linkedProjectId);
  await expect
    .poll(() => capture.recordQueries.some((query) => query.contextProjectId === linkedProjectId))
    .toBe(true);

  await page
    .getByRole('combobox', { name: 'Project for Motor redesign' })
    .selectOption(linkedProjectId);
  await expect.poll(() => capture.recordPatches.at(-1)?.contextProjectId).toBe(linkedProjectId);
});

test('requests complete Kanban groups and the visible Calendar month', async ({ page }) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(`/workspaces/${workspaceId}/data?type=${objectTypeId}&view=${kanbanViewId}`);

  await expect(page.getByRole('heading', { name: 'Ready' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ready' }).locator('..')).toContainText('7');
  await expect
    .poll(() =>
      capture.recordQueries.some(
        (query) => query.groupByFieldId === stateFieldId && query.pageSize === 100,
      ),
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByRole('heading', { name: 'August 2026' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Motor redesign' })).toBeVisible();
  await expect
    .poll(() =>
      capture.recordQueries.some((query) => {
        const filters = query.filters as Array<Record<string, unknown>> | undefined;
        return (
          query.pageSize === 100 &&
          filters?.some(
            (filter) =>
              filter.fieldId === dateFieldId &&
              filter.operator === 'gte' &&
              filter.value === '2026-08-01',
          )
        );
      }),
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByRole('heading', { name: 'September 2026' })).toBeVisible();
  await expect
    .poll(() =>
      capture.recordQueries.some((query) => {
        const filters = query.filters as Array<Record<string, unknown>> | undefined;
        return filters?.some((filter) => filter.value === '2026-09-01') ?? false;
      }),
    )
    .toBe(true);
});
