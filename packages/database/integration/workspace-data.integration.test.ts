import type { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import {
  archiveMemberGroup,
  createMemberGroup,
  createProject,
  createWorkspace,
  ensureWorkspaceDataProject,
  listProjects,
  listMemberGroups,
  replaceMemberGroupMembers,
  resolveRecordViewIdentifier,
  RepositoryError,
  ScopedEngineeringRepository,
  ScopedFileDatasetRepository,
  ScopedProjectRepository,
  ScopedTaskRepository,
  ScopedVisualizationRepository,
  updateMemberGroup,
  updateMemberRoles,
  updateWorkspace,
  createPool,
  type ActorSession,
} from '../src/index.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error('DATABASE_TEST_URL is required for integration tests.');

const organizationId = '019fbcf9-e020-71da-935a-6a6a728b3701';
const actorId = '019fbcf9-e020-71da-935a-6a6a728b3702';
const actor: ActorSession = {
  sessionId: 'integration-session',
  actorId,
  organizationId,
  role: 'owner',
  email: 'integration@example.com',
  displayName: 'Integration Owner',
  csrfTokenHash: '',
};

let pool: Pool;

async function seedActor(): Promise<void> {
  await pool.query(
    `insert into organizations (id, name, slug, singleton)
     values ($1, 'Integration organization', 'integration', true)`,
    [organizationId],
  );
  await pool.query(
    `insert into users (id, email, display_name, password_hash)
     values ($1, 'integration@example.com', 'Integration Owner', 'not-used')`,
    [actorId],
  );
  await pool.query(
    `insert into memberships (id, organization_id, user_id, role, created_by)
     values ('019fbcf9-e020-71da-935a-6a6a728b3703', $1, $2, 'owner', $2)`,
    [organizationId, actorId],
  );
}

beforeAll(() => {
  pool = createPool(databaseUrl, { max: 8 });
});

beforeEach(async () => {
  await pool.query('truncate organizations, users restart identity cascade');
  await seedActor();
});

afterAll(async () => {
  await pool.end();
});

describe.sequential('workspace data with PostgreSQL', () => {
  it('updates workspace and table names and keys without changing public IDs', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Original workspace',
      slug: 'original-workspace',
      requestId: 'workspace-create',
    });
    const updatedWorkspace = await updateWorkspace(pool, actor, {
      workspaceId: workspace.id,
      name: 'Materials workspace',
      slug: 'materials-workspace',
      description: 'Updated purpose',
      requestId: 'workspace-update',
    });
    expect(updatedWorkspace).toMatchObject({
      id: workspace.id,
      publicId: workspace.publicId,
      name: 'Materials workspace',
      slug: 'materials-workspace',
      description: 'Updated purpose',
    });

    const systemProject = await ensureWorkspaceDataProject(
      pool,
      actor,
      workspace.id,
      'data-context',
    );
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, systemProject.id);
    const table = await data.createObjectType({
      name: 'Sample',
      pluralName: 'Samples',
      key: 'sample',
      requestId: 'table-create',
    });
    const updatedTable = await data.updateObjectType({
      objectTypeId: table.id,
      name: 'Specimen',
      pluralName: 'Specimens',
      key: 'specimen',
      description: 'Prepared specimens',
      requestId: 'table-update',
    });
    expect(updatedTable).toMatchObject({
      id: table.id,
      publicId: table.publicId,
      name: 'Specimen',
      pluralName: 'Specimens',
      key: 'specimen',
      description: 'Prepared specimens',
    });
  });

  it('creates saved views with canonical public IDs while retaining UUID lookup', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'View workspace',
      slug: 'view-workspace',
      requestId: 'workspace-create',
    });
    const systemProject = await ensureWorkspaceDataProject(
      pool,
      actor,
      workspace.id,
      'data-context',
    );
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, systemProject.id);
    const objectType = await data.createObjectType({
      name: 'Run',
      pluralName: 'Runs',
      key: 'run',
      requestId: 'object-create',
    });
    const view = await data.createRecordView({
      objectTypeId: objectType.id,
      name: 'Review queue',
      viewType: 'grid',
      config: {
        visibleFieldIds: [],
        fieldWidths: {},
        filters: [],
        sorts: [],
        rowDensity: 'compact',
        pageSize: 25,
      },
      requestId: 'view-create',
    });

    expect(view.publicId).toMatch(/^v[0-9a-z]{14}$/);
    await expect(resolveRecordViewIdentifier(pool, view.publicId)).resolves.toBe(view.id);
    await expect(resolveRecordViewIdentifier(pool, view.id)).resolves.toBe(view.id);
    await expect(data.listRecordViews(objectType.id)).resolves.toMatchObject([
      { id: view.id, publicId: view.publicId },
    ]);
  });

  it('creates one hidden system scope and rejects it in project resource repositories', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Workspace',
      slug: 'workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Ordinary project',
      key: 'ORDINARY',
      requestId: 'project-create',
    });

    const scopes = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        ensureWorkspaceDataProject(pool, actor, workspace.id, `data-context-${index}`),
      ),
    );
    expect(new Set(scopes.map((scope) => scope.id))).toHaveLength(1);
    expect((await listProjects(pool, actor, workspace.id)).map((item) => item.id)).toEqual([
      project.id,
    ]);
    await expect(
      pool.query('select count(*)::int count from projects where workspace_id=$1 and system=true', [
        workspace.id,
      ]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });

    const systemProjectId = scopes[0]!.id;
    for (const open of [
      ScopedFileDatasetRepository.open,
      ScopedTaskRepository.open,
      ScopedVisualizationRepository.open,
      ScopedEngineeringRepository.open,
    ]) {
      await expect(open(pool, actor, workspace.id, systemProjectId)).rejects.toMatchObject({
        code: 'PROJECT_NOT_FOUND',
      });
    }
  });

  it('filters workspace records by optional project context using real projections', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Workspace',
      slug: 'workspace',
      requestId: 'workspace-create',
    });
    const firstProject = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Alpha',
      key: 'ALPHA',
      requestId: 'project-alpha',
    });
    const secondProject = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Beta',
      key: 'BETA',
      requestId: 'project-beta',
    });
    const systemProject = await ensureWorkspaceDataProject(
      pool,
      actor,
      workspace.id,
      'data-context',
    );
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, systemProject.id);
    const objectType = await data.createObjectType({
      name: 'Experiment',
      pluralName: 'Experiments',
      key: 'experiment',
      requestId: 'object-create',
    });
    const status = await data.createField({
      objectTypeId: objectType.id,
      name: 'Status',
      key: 'status',
      fieldType: 'single_select',
      required: true,
      config: { options: [{ key: 'ready', label: 'Ready' }] },
      requestId: 'field-create',
    });
    await data.createRecord({
      objectTypeId: objectType.id,
      contextProjectId: firstProject.id,
      displayName: 'Alpha run',
      values: { status: 'ready' },
      requestId: 'record-alpha',
    });
    await data.createRecord({
      objectTypeId: objectType.id,
      contextProjectId: secondProject.id,
      displayName: 'Beta run',
      values: { status: 'ready' },
      requestId: 'record-beta',
    });
    await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Unassigned run',
      values: { status: 'ready' },
      requestId: 'record-none',
    });

    const alpha = await data.queryRecords(objectType.id, {
      contextProjectId: firstProject.id,
      groupByFieldId: status.id,
    });
    expect(alpha.items.map((item) => item.displayName)).toEqual(['Alpha run']);
    expect(alpha.groups).toEqual([{ value: 'ready', count: 1 }]);
    const unassigned = await data.queryRecords(objectType.id, { contextProjectId: null });
    expect(unassigned.items.map((item) => item.displayName)).toEqual(['Unassigned run']);
  });

  it('reorders every schema field atomically', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Schema workspace',
      slug: 'schema-workspace',
      requestId: 'workspace-create',
    });
    const project = await ensureWorkspaceDataProject(pool, actor, workspace.id, 'data-context');
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const objectType = await data.createObjectType({
      name: 'Sample',
      pluralName: 'Samples',
      key: 'sample',
      requestId: 'object-create',
    });
    const first = await data.createField({
      objectTypeId: objectType.id,
      name: 'First',
      key: 'first',
      fieldType: 'text',
      requestId: 'first-field',
    });
    const second = await data.createField({
      objectTypeId: objectType.id,
      name: 'Second',
      key: 'second',
      fieldType: 'text',
      requestId: 'second-field',
    });
    const third = await data.createField({
      objectTypeId: objectType.id,
      name: 'Third',
      key: 'third',
      fieldType: 'text',
      requestId: 'third-field',
    });

    await expect(
      data.reorderFields({
        objectTypeId: objectType.id,
        fieldIds: [third.id, first.id],
        requestId: 'invalid-order',
      }),
    ).rejects.toMatchObject({ code: 'FIELD_ORDER_INVALID' });
    const reordered = await data.reorderFields({
      objectTypeId: objectType.id,
      fieldIds: [third.id, first.id, second.id],
      requestId: 'valid-order',
    });

    expect(reordered.map((field) => [field.name, field.position])).toEqual([
      ['Third', 0],
      ['First', 1],
      ['Second', 2],
    ]);
    expect((await data.listFields(objectType.id)).map((field) => field.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
  });

  it('rolls back invalid forms, empty defaults, and cross-workspace saved filters', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Workspace',
      slug: 'workspace',
      requestId: 'workspace-create',
    });
    const outsideWorkspace = await createWorkspace(pool, actor, {
      name: 'Outside',
      slug: 'outside',
      requestId: 'outside-workspace',
    });
    const outsideProject = await createProject(pool, actor, {
      workspaceId: outsideWorkspace.id,
      name: 'Outside project',
      key: 'OUTSIDE',
      requestId: 'outside-project',
    });
    const systemProject = await ensureWorkspaceDataProject(
      pool,
      actor,
      workspace.id,
      'data-context',
    );
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, systemProject.id);
    const objectType = await data.createObjectType({
      name: 'Experiment',
      pluralName: 'Experiments',
      key: 'experiment',
      requestId: 'object-create',
    });
    await data.createField({
      objectTypeId: objectType.id,
      name: 'Serial number',
      key: 'serial-number',
      fieldType: 'text',
      required: true,
      requestId: 'field-create',
    });

    await expect(
      data.createRecordView({
        objectTypeId: objectType.id,
        name: 'Invalid form',
        viewType: 'form',
        config: {
          visibleFieldIds: [],
          fieldWidths: {},
          filters: [],
          sorts: [],
          rowDensity: 'compact',
          pageSize: 25,
        },
        requestId: 'invalid-form',
      }),
    ).rejects.toBeInstanceOf(RepositoryError);
    await expect(
      data.createField({
        objectTypeId: objectType.id,
        name: 'Empty default',
        key: 'empty-default',
        fieldType: 'text',
        required: true,
        defaultValue: null,
        requestId: 'empty-default',
      }),
    ).rejects.toMatchObject({ code: 'FIELD_DEFAULT_INVALID' });
    await expect(
      data.createRecordView({
        objectTypeId: objectType.id,
        name: 'Outside filter',
        viewType: 'grid',
        config: {
          visibleFieldIds: [],
          fieldWidths: {},
          filters: [],
          sorts: [],
          rowDensity: 'compact',
          pageSize: 25,
          viewOptions: { contextProjectId: outsideProject.id },
        },
        requestId: 'outside-filter',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });

    const stored = await pool.query<{ count: number }>(
      'select count(*)::int count from record_views where object_type_id=$1',
      [objectType.id],
    );
    expect(stored.rows[0]?.count).toBe(0);
  });

  it('stores validated spectral series and Excel-like tables as structured JSON', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Laboratory',
      slug: 'laboratory',
      requestId: 'workspace-create',
    });
    const systemProject = await ensureWorkspaceDataProject(
      pool,
      actor,
      workspace.id,
      'data-context',
    );
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, systemProject.id);
    const objectType = await data.createObjectType({
      name: 'Scan',
      pluralName: 'Scans',
      key: 'scan',
      requestId: 'object-create',
    });
    await data.createField({
      objectTypeId: objectType.id,
      name: 'UV-Vis spectrum',
      key: 'uv-vis-spectrum',
      fieldType: 'spectral_data',
      config: { xLabel: 'Wavelength', xUnit: 'nm', yLabel: 'Absorbance', yUnit: 'a.u.' },
      requestId: 'spectrum-field',
    });
    await data.createField({
      objectTypeId: objectType.id,
      name: 'Conditions',
      key: 'conditions',
      fieldType: 'tabular_data',
      config: { firstRowHeader: true },
      requestId: 'table-field',
    });
    await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Scan 001',
      values: {
        'uv-vis-spectrum': {
          x: [400, 401],
          series: [{ name: 'Sample A', values: [0.12, 0.18] }],
        },
        conditions: {
          columns: ['Time', 'Temperature'],
          rows: [
            [0, 20],
            [1, 21.5],
          ],
        },
      },
      requestId: 'record-create',
    });

    const result = await data.queryRecords(objectType.id, {});
    expect(result.items[0]?.values).toMatchObject({
      'uv-vis-spectrum': {
        x: [400, 401],
        series: [{ name: 'Sample A', values: [0.12, 0.18] }],
      },
      conditions: {
        columns: ['Time', 'Temperature'],
        rows: [
          [0, 20],
          [1, 21.5],
        ],
      },
    });

    await expect(
      data.createRecord({
        objectTypeId: objectType.id,
        displayName: 'Invalid scan',
        values: {
          'uv-vis-spectrum': {
            x: [400, 401],
            series: [{ name: 'Broken', values: [0.12] }],
          },
        },
        requestId: 'invalid-record',
      }),
    ).rejects.toMatchObject({ code: 'FIELD_VALIDATION_FAILED' });
  });

  it('creates, assigns, updates, and archives organization member groups', async () => {
    const secondUserId = '019fbcf9-e020-71da-935a-6a6a728b3710';
    await pool.query(
      `insert into users (id, email, display_name, password_hash)
       values ($1, 'engineer@example.com', 'Engineer', 'not-used')`,
      [secondUserId],
    );
    await pool.query(
      `insert into memberships (id, organization_id, user_id, role, created_by)
       values ('019fbcf9-e020-71da-935a-6a6a728b3711', $1, $2, 'engineer', $3)`,
      [organizationId, secondUserId, actorId],
    );
    const group = await createMemberGroup(pool, actor, {
      name: 'Materials lab',
      description: 'Materials testing team',
      color: 'emerald',
      requestId: 'group-create',
    });
    await replaceMemberGroupMembers(pool, actor, {
      groupId: group.id,
      memberIds: [actorId, secondUserId],
      requestId: 'group-members',
    });
    expect(await listMemberGroups(pool, actor)).toMatchObject([
      {
        id: group.id,
        name: 'Materials lab',
        color: 'emerald',
        memberIds: [actorId, secondUserId],
      },
    ]);

    await updateMemberGroup(pool, actor, {
      groupId: group.id,
      name: 'Materials & Spectroscopy',
      description: 'Shared instruments and materials testing',
      color: 'violet',
      requestId: 'group-update',
    });
    expect((await listMemberGroups(pool, actor))[0]).toMatchObject({
      name: 'Materials & Spectroscopy',
      color: 'violet',
      memberIds: [actorId, secondUserId],
    });

    await archiveMemberGroup(pool, actor, group.id, 'group-archive');
    expect(await listMemberGroups(pool, actor)).toEqual([]);
  });

  it('changes multiple member roles atomically and preserves the last owner', async () => {
    const memberIds = [
      '019fbcf9-e020-71da-935a-6a6a728b3720',
      '019fbcf9-e020-71da-935a-6a6a728b3721',
    ];
    await pool.query(
      `insert into users (id, email, display_name, password_hash) values
       ($1, 'first@example.com', 'First member', 'not-used'),
       ($2, 'second@example.com', 'Second member', 'not-used')`,
      memberIds,
    );
    await pool.query(
      `insert into memberships (id, organization_id, user_id, role, created_by) values
       ('019fbcf9-e020-71da-935a-6a6a728b3722', $1, $2, 'contributor', $4),
       ('019fbcf9-e020-71da-935a-6a6a728b3723', $1, $3, 'viewer', $4)`,
      [organizationId, memberIds[0], memberIds[1], actorId],
    );

    await expect(
      updateMemberRoles(pool, actor, memberIds, 'engineer', 'bulk-role-change'),
    ).resolves.toBe(2);
    await expect(
      pool.query<{ role: string }>(
        'select role from memberships where user_id = any($1::uuid[]) order by user_id',
        [memberIds],
      ),
    ).resolves.toMatchObject({ rows: [{ role: 'engineer' }, { role: 'engineer' }] });
    await expect(
      updateMemberRoles(pool, actor, [actorId], 'admin', 'last-owner-change'),
    ).rejects.toMatchObject({ code: 'LAST_OWNER_REQUIRED' });
  });
});
