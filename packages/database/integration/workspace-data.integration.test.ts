import type { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import {
  archiveMemberGroup,
  assertProjectVisible,
  assertWorkspaceVisible,
  claimRecordExportJob,
  cleanupExpiredProjectIdempotencyRequests,
  createMemberGroup,
  createProject,
  createTaskDueDateNotifications,
  createRecordViewShare,
  createWorkspace,
  completeRecordExportJob,
  ensureWorkspaceDataProject,
  getProject,
  getProjectAccess,
  getWorkspace,
  getWorkspaceAccess,
  getWorkspaceOverview,
  getWorkspaceMyWork,
  listAuditEventPage,
  listProjectPage,
  listProjectOptions,
  listProjectReferences,
  listMemberGroupPage,
  listNotifications,
  listWorkspacePage,
  replaceMemberGroupMembers,
  resolveRecordViewIdentifier,
  resolvePublicRecordViewShare,
  getPublicSharedViewMetadata,
  queryPublicSharedViewRecords,
  submitPublicForm,
  revokeRecordViewShare,
  searchWorkspace,
  setProjectAccess,
  setWorkspaceAccess,
  RecordReviewRepository,
  RepositoryError,
  ScopedEngineeringRepository,
  ScopedFileDatasetRepository,
  ScopedMilestoneRepository,
  ScopedProjectRepository,
  ScopedSourceRepository,
  ScopedTaskRepository,
  ScopedTaskAutomationRepository,
  ScopedTaskWorkflowRepository,
  ScopedVisualizationRepository,
  ScopedWebhookRepository,
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
  it('searches and pages workspaces while preserving actor and API-token scope', async () => {
    await pool.query(
      `insert into workspaces
       (id, public_id, organization_id, name, slug, description, created_by)
       select gen_random_uuid(), 'w'||lpad(sequence::text,14,'0'), $1,
              'Lab '||lpad(sequence::text,3,'0'), 'lab-'||sequence,
              'Qualification workspace '||sequence, $2
       from generate_series(1,30) sequence`,
      [organizationId, actorId],
    );

    const page = await listWorkspacePage(pool, actor, 'Lab', 10, 10);
    expect(page.pageInfo).toEqual({
      limit: 10,
      offset: 10,
      total: 30,
      overallTotal: 30,
      hasNext: true,
    });
    expect(page.items).toHaveLength(10);
    expect(page.items[0]?.name).toBe('Lab 011');

    const exact = await getWorkspace(pool, actor, page.items[0]!.publicId);
    expect(exact.id).toBe(page.items[0]!.id);

    const scopedActor: ActorSession = {
      ...actor,
      authenticationType: 'api_token',
      apiTokenWorkspaceId: exact.id,
    };
    const scopedPage = await listWorkspacePage(pool, scopedActor, '', 10, 0);
    expect(scopedPage.items.map((workspace) => workspace.id)).toEqual([exact.id]);
    expect(scopedPage.pageInfo).toMatchObject({ total: 1, overallTotal: 1, hasNext: false });
    await expect(getWorkspace(pool, scopedActor, page.items[1]!.publicId)).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_FOUND',
    });
  });

  it('enforces inherited workspace and project access for direct members and groups', async () => {
    const viewerId = '019fbcf9-e020-71da-935a-6a6a728b3710';
    const groupId = '019fbcf9-e020-71da-935a-6a6a728b3711';
    await pool.query(
      `insert into users (id,email,display_name,password_hash)
       values ($1,'resource-viewer@example.com','Resource Viewer','not-used')`,
      [viewerId],
    );
    await pool.query(
      `insert into memberships (id,organization_id,user_id,role,created_by)
       values (gen_random_uuid(),$1,$2,'viewer',$3)`,
      [organizationId, viewerId, actorId],
    );
    const viewer: ActorSession = {
      ...actor,
      actorId: viewerId,
      role: 'viewer',
      email: 'resource-viewer@example.com',
      displayName: 'Resource Viewer',
    };
    const workspace = await createWorkspace(pool, actor, {
      name: 'Access boundary',
      slug: 'access-boundary',
      requestId: 'access-workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Classified test program',
      key: 'CLASSIFIED',
      requestId: 'access-project-create',
    });

    await expect(assertWorkspaceVisible(pool, viewer, workspace.id)).resolves.toBeUndefined();
    await expect(
      assertProjectVisible(pool, viewer, workspace.id, project.id),
    ).resolves.toBeUndefined();

    const workspacePolicy = await getWorkspaceAccess(pool, actor, workspace.id);
    const restrictedWorkspace = await setWorkspaceAccess(pool, actor, {
      workspaceId: workspace.id,
      visibility: 'restricted',
      userIds: [],
      groupIds: [],
      accessVersion: workspacePolicy.accessVersion,
      requestId: 'restrict-workspace',
    });
    expect(restrictedWorkspace).toMatchObject({ visibility: 'restricted', accessVersion: 2 });
    await expect(assertWorkspaceVisible(pool, viewer, workspace.id)).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_FOUND',
      status: 404,
    });
    expect((await listWorkspacePage(pool, viewer)).items).toEqual([]);

    await setWorkspaceAccess(pool, actor, {
      workspaceId: workspace.id,
      visibility: 'restricted',
      userIds: [viewerId],
      groupIds: [],
      accessVersion: restrictedWorkspace.accessVersion,
      requestId: 'grant-workspace-member',
    });
    await expect(getWorkspace(pool, viewer, workspace.publicId)).resolves.toMatchObject({
      id: workspace.id,
    });

    const projectPolicy = await getProjectAccess(pool, actor, workspace.id, project.id);
    const restrictedProject = await setProjectAccess(pool, actor, {
      workspaceId: workspace.id,
      projectId: project.id,
      visibility: 'restricted',
      userIds: [],
      groupIds: [],
      accessVersion: projectPolicy.accessVersion,
      requestId: 'restrict-project',
    });
    await expect(
      assertProjectVisible(pool, viewer, workspace.id, project.id),
    ).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
      status: 404,
    });
    await expect(
      ScopedTaskRepository.open(pool, viewer, workspace.id, project.id),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND', status: 404 });
    await expect(
      ScopedProjectRepository.open(pool, viewer, workspace.id, project.id),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND', status: 404 });
    expect((await listProjectPage(pool, viewer, workspace.id)).items).toEqual([]);

    await pool.query(
      `insert into member_groups (id,organization_id,name,description,color,created_by)
       values ($1,$2,'Resource reviewers','','violet',$3)`,
      [groupId, organizationId, actorId],
    );
    await pool.query(
      `insert into member_group_memberships
       (id,organization_id,group_id,user_id,assigned_by)
       values (gen_random_uuid(),$1,$2,$3,$4)`,
      [organizationId, groupId, viewerId, actorId],
    );
    const grantedProject = await setProjectAccess(pool, actor, {
      workspaceId: workspace.id,
      projectId: project.id,
      visibility: 'restricted',
      userIds: [],
      groupIds: [groupId],
      accessVersion: restrictedProject.accessVersion,
      requestId: 'grant-project-group',
    });
    expect(grantedProject.groups).toEqual([
      expect.objectContaining({ id: groupId, name: 'Resource reviewers' }),
    ]);
    await expect(getProject(pool, viewer, workspace.id, project.publicId)).resolves.toMatchObject({
      id: project.id,
    });
    await expect(
      ScopedTaskRepository.open(pool, viewer, workspace.id, project.id),
    ).resolves.toBeInstanceOf(ScopedTaskRepository);
    await expect(searchWorkspace(pool, viewer, workspace.id, 'Classified')).resolves.toMatchObject({
      items: [expect.objectContaining({ type: 'project', id: project.id })],
    });
  });

  it('resolves requested project references in caller order without leaking another workspace', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Reference workspace',
      slug: 'reference-workspace',
      requestId: 'reference-workspace-create',
    });
    const otherWorkspace = await createWorkspace(pool, actor, {
      name: 'Other reference workspace',
      slug: 'other-reference-workspace',
      requestId: 'other-reference-workspace-create',
    });
    const first = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Motor controls',
      key: 'MOTOR',
      requestId: 'reference-project-first',
    });
    const archived = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Archived platform',
      key: 'ARCH',
      requestId: 'reference-project-archived',
    });
    const foreign = await createProject(pool, actor, {
      workspaceId: otherWorkspace.id,
      name: 'Foreign project',
      key: 'FOREIGN',
      requestId: 'reference-project-foreign',
    });
    await pool.query('update projects set archived_at=now() where id=$1', [archived.id]);

    const references = await listProjectReferences(pool, actor, workspace.id, [
      archived.id,
      foreign.id,
      first.id,
      archived.id,
    ]);

    expect(references.map((project) => project.id)).toEqual([archived.id, first.id]);
    expect(references[0]).toMatchObject({
      publicId: archived.publicId,
      name: 'Archived platform',
      key: 'ARCH',
    });
    expect(references[0]?.archivedAt).not.toBeNull();
  });

  it('searches and pages a project table catalog with stable exact lookup', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Catalog workspace',
      slug: 'catalog-workspace',
      requestId: 'catalog-workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Catalog project',
      key: 'CAT',
      requestId: 'catalog-project-create',
    });
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    for (const [index, name] of ['Equipment', 'Specification', 'Test sample'].entries()) {
      await data.createObjectType({
        name,
        pluralName: `${name}s`,
        key: `catalog-${index}`,
        description: index === 1 ? 'Controlled requirement baseline' : '',
        requestId: `catalog-table-${index}`,
      });
    }

    const first = await data.listObjectTypePage({ query: '', limit: 2, offset: 0 });
    const searched = await data.listObjectTypePage({ query: 'REQUIREMENT', limit: 10, offset: 0 });
    expect(first.pageInfo).toEqual({ limit: 2, offset: 0, total: 3, hasNext: true });
    expect(first.items.map((item) => item.name)).toEqual(['Equipment', 'Specification']);
    expect(searched.pageInfo).toMatchObject({ total: 1, hasNext: false });
    expect(searched.items[0]?.name).toBe('Specification');
    await expect(data.getObjectType(searched.items[0]!.id)).resolves.toMatchObject({
      publicId: searched.items[0]!.publicId,
      key: searched.items[0]!.key,
    });
  });

  it('enforces table visibility and record actions for roles, members, and groups', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Permission workspace',
      slug: 'permission-workspace',
      requestId: 'permission-workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Restricted qualification',
      key: 'RESTRICT',
      requestId: 'permission-project-create',
    });
    const ownerData = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const table = await ownerData.createObjectType({
      name: 'Controlled sample',
      pluralName: 'Controlled samples',
      key: 'controlled-sample',
      requestId: 'permission-table-create',
    });
    const seedRecord = await ownerData.createRecord({
      objectTypeId: table.id,
      displayName: 'Owner baseline',
      values: {},
      requestId: 'permission-record-create',
    });
    const contributorId = '019fbcf9-e020-71da-935a-6a6a728b3750';
    const outsiderId = '019fbcf9-e020-71da-935a-6a6a728b3751';
    const engineerId = '019fbcf9-e020-71da-935a-6a6a728b3752';
    await pool.query(
      `insert into users (id,email,display_name,password_hash) values
       ($1,'permission-contributor@example.com','Permission Contributor','not-used'),
       ($2,'permission-outsider@example.com','Permission Outsider','not-used'),
       ($3,'permission-engineer@example.com','Permission Engineer','not-used')`,
      [contributorId, outsiderId, engineerId],
    );
    await pool.query(
      `insert into memberships (id,organization_id,user_id,role,created_by) values
       ('019fbcf9-e020-71da-935a-6a6a728b3753',$1,$2,'contributor',$5),
       ('019fbcf9-e020-71da-935a-6a6a728b3754',$1,$3,'contributor',$5),
       ('019fbcf9-e020-71da-935a-6a6a728b3755',$1,$4,'engineer',$5)`,
      [organizationId, contributorId, outsiderId, engineerId, actorId],
    );
    const group = await createMemberGroup(pool, actor, {
      name: 'Controlled lab',
      description: 'Members who can discover the controlled table',
      color: 'violet',
      requestId: 'permission-group-create',
    });
    await replaceMemberGroupMembers(pool, actor, {
      groupId: group.id,
      memberIds: [contributorId, engineerId],
      requestId: 'permission-group-members',
    });

    const initial = await ownerData.getObjectTypePermissions(table.id);
    const updated = await ownerData.updateObjectTypePermissions({
      objectTypeId: table.id,
      modes: {
        visibility: 'specific',
        create: 'specific',
        update: 'engineers',
        archive: 'nobody',
      },
      subjects: {
        visibility: { userIds: [], groupIds: [group.id] },
        create: { userIds: [contributorId], groupIds: [] },
        update: { userIds: [], groupIds: [] },
        archive: { userIds: [], groupIds: [] },
      },
      rowVersion: initial.rowVersion,
      requestId: 'permission-policy-update',
    });
    expect(updated).toMatchObject({
      modes: { visibility: 'specific', create: 'specific', update: 'engineers', archive: 'nobody' },
      subjects: { visibility: { groupIds: [group.id] }, create: { userIds: [contributorId] } },
      rowVersion: initial.rowVersion + 1,
    });
    await expect(
      ownerData.updateObjectTypePermissions({
        objectTypeId: table.id,
        modes: updated.modes,
        subjects: updated.subjects,
        rowVersion: initial.rowVersion,
        requestId: 'permission-policy-stale',
      }),
    ).rejects.toMatchObject({ code: 'TABLE_PERMISSION_VERSION_CONFLICT', status: 409 });

    const contributorActor: ActorSession = {
      ...actor,
      actorId: contributorId,
      role: 'contributor',
      email: 'permission-contributor@example.com',
      displayName: 'Permission Contributor',
    };
    const outsiderActor: ActorSession = {
      ...actor,
      actorId: outsiderId,
      role: 'contributor',
      email: 'permission-outsider@example.com',
      displayName: 'Permission Outsider',
    };
    const engineerActor: ActorSession = {
      ...actor,
      actorId: engineerId,
      role: 'engineer',
      email: 'permission-engineer@example.com',
      displayName: 'Permission Engineer',
    };
    const contributorData = await ScopedProjectRepository.open(
      pool,
      contributorActor,
      workspace.id,
      project.id,
    );
    const outsiderData = await ScopedProjectRepository.open(
      pool,
      outsiderActor,
      workspace.id,
      project.id,
    );
    const engineerData = await ScopedProjectRepository.open(
      pool,
      engineerActor,
      workspace.id,
      project.id,
    );

    await expect(contributorData.listObjectTypes()).resolves.toEqual([
      expect.objectContaining({
        id: table.id,
        recordPermissions: { canCreate: true, canUpdate: false, canArchive: false },
      }),
    ]);
    const created = await contributorData.createRecord({
      objectTypeId: table.id,
      displayName: 'Contributor sample',
      values: {},
      requestId: 'permission-contributor-create',
    });
    await expect(
      contributorData.updateRecord({
        objectTypeId: table.id,
        recordId: created.id,
        displayName: 'Forbidden update',
        values: {},
        rowVersion: created.rowVersion,
        requestId: 'permission-contributor-update',
      }),
    ).rejects.toMatchObject({ code: 'TABLE_ACTION_FORBIDDEN', status: 403 });
    await expect(outsiderData.listObjectTypes()).resolves.toEqual([]);
    await expect(outsiderData.getObjectType(table.id)).rejects.toMatchObject({
      code: 'OBJECT_TYPE_NOT_FOUND',
      status: 404,
    });
    await expect(
      engineerData.updateRecord({
        objectTypeId: table.id,
        recordId: seedRecord.id,
        displayName: 'Engineer update',
        values: {},
        rowVersion: seedRecord.rowVersion,
        requestId: 'permission-engineer-update',
      }),
    ).resolves.toMatchObject({ displayName: 'Engineer update' });
    await expect(
      engineerData.setRecordArchived({
        objectTypeId: table.id,
        recordId: seedRecord.id,
        archived: true,
        requestId: 'permission-engineer-archive',
      }),
    ).rejects.toMatchObject({ code: 'TABLE_ACTION_FORBIDDEN', status: 403 });
    await expect(ownerData.getObjectType(table.id)).resolves.toMatchObject({
      id: table.id,
      recordPermissions: { canCreate: false, canUpdate: true, canArchive: false },
    });
    const audit = await pool.query<{ action: string; payload: { rowVersion: number } }>(
      `select action,payload from audit_events
       where target_id=$1 and action='schema.object_type_permissions_updated'`,
      [table.id],
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({
        action: 'schema.object_type_permissions_updated',
        payload: expect.objectContaining({ rowVersion: updated.rowVersion }),
      }),
    ]);
  });

  it('searches and pages large task candidate sets without a full-project response', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Candidate workspace',
      slug: 'candidate-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Candidate project',
      key: 'CAND',
      requestId: 'project-create',
    });
    await pool.query(
      `insert into tasks
       (id,project_id,task_number,title,description,status,priority,board_position,created_by)
       select gen_random_uuid(),$1,sequence,'Candidate motor '||sequence,'','todo','medium',
         sequence*1024,$2 from generate_series(1,125) sequence`,
      [project.id, actorId],
    );
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    await expect(
      tasks.listAssigneePage({ query: 'integration owner', limit: 1, offset: 0 }),
    ).resolves.toEqual({
      items: [{ id: actorId, displayName: 'Integration Owner', email: actor.email }],
      pageInfo: { limit: 1, offset: 0, total: 1, hasNext: false },
      overallTotal: 1,
    });
    const first = await tasks.listCandidates({
      query: 'Candidate motor',
      topLevelOnly: true,
      limit: 20,
      offset: 100,
    });
    const last = await tasks.listCandidates({
      query: 'Candidate motor',
      topLevelOnly: true,
      limit: 20,
      offset: 120,
    });
    expect(first.pageInfo).toEqual({ limit: 20, offset: 100, total: 125, hasNext: true });
    expect(last.pageInfo).toEqual({ limit: 20, offset: 120, total: 125, hasNext: false });
    expect(first.items).toHaveLength(20);
    expect(last.items).toHaveLength(5);
    expect(
      last.items.some((item) => first.items.some((candidate) => candidate.id === item.id)),
    ).toBe(false);
  });

  it('hydrates task evidence with a human record label and preserves it when unlinked', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Task evidence workspace',
      slug: 'task-evidence-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Qualification project',
      key: 'EVIDENCE',
      requestId: 'project-create',
    });
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const objectType = await data.createObjectType({
      name: 'Sample',
      pluralName: 'Samples',
      key: 'sample',
      requestId: 'sample-type-create',
    });
    const record = await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Qualification Sample 42',
      values: {},
      requestId: 'sample-create',
    });
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const task = await tasks.createTask({
      title: 'Review qualification evidence',
      description: '',
      priority: 'medium',
      links: [{ entityType: 'sample', entityId: record.id }],
      requestId: 'task-create',
    });

    expect(task.links).toEqual([
      expect.objectContaining({
        entity_type: 'sample',
        entity_id: record.id,
        title: 'Qualification Sample 42',
        detail: 'Sample',
        object_type_public_id: objectType.publicId,
      }),
    ]);
    expect(task).toMatchObject({
      created_by_name: actor.displayName,
      created_at: expect.any(Date),
      updated_at: expect.any(Date),
    });

    const removed = await tasks.removeLink(task.id, task.links[0]!.id, 'task-evidence-remove');
    expect(removed.links).toEqual([]);
    expect(removed.link_history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'task.link_removed',
          entity_type: 'sample',
          entity_id: record.id,
          title: 'Qualification Sample 42',
        }),
      ]),
    );
  });

  it('pages mixed task activity and lazy-loads comment revisions without duplicates', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Activity workspace',
      slug: 'activity-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Long-running release',
      key: 'LONG',
      requestId: 'project-create',
    });
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const task = await tasks.createTask({
      title: 'Retain a long decision trail',
      description: '',
      priority: 'medium',
      links: [],
      requestId: 'task-create',
    });
    const comments = await pool.query<{ id: string }>(
      `insert into task_comments
       (id,project_id,task_id,author_id,body,created_at,updated_at)
       select gen_random_uuid(),$1,$2,$3,'Activity comment '||sequence,
         now()-((60-sequence)||' minutes')::interval,
         now()-((60-sequence)||' minutes')::interval
       from generate_series(1,25) sequence returning id`,
      [project.id, task.id, actorId],
    );
    await pool.query(
      `insert into task_status_history
       (id,project_id,task_id,from_status,to_status,changed_by,changed_at)
       select gen_random_uuid(),$1,$2,'todo','todo',$3,
         now()-((35-sequence)||' minutes')::interval
       from generate_series(1,15) sequence`,
      [project.id, task.id, actorId],
    );
    await pool.query(
      `insert into audit_events
       (id,organization_id,workspace_id,project_id,actor_id,action,target_type,target_id,request_id,payload,created_at)
       select gen_random_uuid(),$1,$2,$3,$4,'task.updated','task',$5,
         'activity-change-'||sequence,
         jsonb_build_object('changes',jsonb_build_object('title',jsonb_build_object(
           'from','Before '||sequence,'to','After '||sequence))),
         now()-((20-sequence)||' minutes')::interval
       from generate_series(1,15) sequence`,
      [organizationId, workspace.id, project.id, actorId, task.id],
    );

    const detail = await tasks.getTask(task.id);
    const firstIds = [
      ...detail.status_history.map((item: { id: string }) => item.id),
      ...detail.comments.map((item: { id: string }) => item.id),
      ...detail.change_history.map((item: { id: string }) => item.id),
      ...detail.link_history.map((item: { id: string }) => item.id),
    ];
    expect(detail.activity_page_info).toEqual({
      limit: 50,
      offset: 0,
      total: 56,
      hasNext: true,
    });
    expect(firstIds).toHaveLength(50);
    expect(new Set(firstIds).size).toBe(50);

    const older = await tasks.getTaskActivity(task.id, { limit: 50, offset: 50 });
    const olderIds = [
      ...older.status_history.map((item) => item.id),
      ...older.comments.map((item) => item.id),
      ...older.change_history.map((item) => item.id),
      ...older.link_history.map((item) => item.id),
    ];
    expect(older.pageInfo).toEqual({ limit: 50, offset: 50, total: 56, hasNext: false });
    expect(olderIds).toHaveLength(6);
    expect(olderIds.some((id) => firstIds.includes(id))).toBe(false);

    const revisedCommentId = comments.rows[0]!.id;
    await pool.query('update task_comments set row_version=26,edited_at=now() where id=$1', [
      revisedCommentId,
    ]);
    await pool.query(
      `insert into audit_events
       (id,organization_id,workspace_id,project_id,actor_id,action,target_type,target_id,request_id,payload,created_at)
       select gen_random_uuid(),$1,$2,$3,$4,'task.comment_edited','task',$5,
         'comment-revision-'||sequence,
         jsonb_build_object('commentId',$6::text,'fromRowVersion',sequence,
           'previousBody','Revision '||sequence,'previousMentions','[]'::jsonb),
         now()+(sequence||' seconds')::interval
       from generate_series(1,25) sequence`,
      [organizationId, workspace.id, project.id, actorId, task.id, revisedCommentId],
    );
    const firstRevisions = await tasks.getCommentRevisions(task.id, revisedCommentId);
    const olderRevisions = await tasks.getCommentRevisions(task.id, revisedCommentId, {
      offset: 20,
    });
    expect(firstRevisions.pageInfo).toEqual({
      limit: 20,
      offset: 0,
      total: 25,
      hasNext: true,
    });
    expect(olderRevisions.pageInfo).toEqual({
      limit: 20,
      offset: 20,
      total: 25,
      hasNext: false,
    });
    expect(firstRevisions.items).toHaveLength(20);
    expect(olderRevisions.items).toHaveLength(5);
    expect(
      new Set([...firstRevisions.items, ...olderRevisions.items].map((item) => item.revision)).size,
    ).toBe(25);
  });

  it('tracks authored work atomically and derives spent and remaining time', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Time tracking workspace',
      slug: 'time-tracking-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Timed release',
      key: 'TIME',
      requestId: 'project-create',
    });
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const created = await tasks.createTask({
      title: 'Validate release evidence',
      description: '',
      priority: 'medium',
      originalEstimateMinutes: 120,
      links: [],
      requestId: 'task-create',
    });
    expect(created).toMatchObject({
      original_estimate_minutes: 120,
      remaining_estimate_minutes: 120,
      time_spent_minutes: 0,
      row_version: 1,
      worklogs: [],
    });

    const logged = await tasks.createWorklog(created.id, {
      durationMinutes: 30,
      startedAt: '2026-08-10T14:00:00.000Z',
      note: 'Reviewed the supplier packet.',
      taskRowVersion: 1,
      requestId: 'worklog-create',
    });
    expect(logged).toMatchObject({
      remaining_estimate_minutes: 90,
      time_spent_minutes: 30,
      row_version: 2,
      worklogs: [
        expect.objectContaining({
          duration_minutes: 30,
          row_version: 1,
          author_id: actorId,
          can_edit: true,
        }),
      ],
    });
    const worklog = logged.worklogs[0]!;
    await expect(
      tasks.createWorklog(created.id, {
        durationMinutes: 10,
        startedAt: '2026-08-10T15:00:00.000Z',
        taskRowVersion: 1,
        requestId: 'worklog-stale-create',
      }),
    ).rejects.toMatchObject({ code: 'TASK_VERSION_CONFLICT', status: 409 });

    const updated = await tasks.updateWorklog(created.id, worklog.id, {
      durationMinutes: 45,
      startedAt: '2026-08-10T14:15:00.000Z',
      note: 'Reviewed the supplier packet and disposition.',
      taskRowVersion: 2,
      worklogRowVersion: 1,
      requestId: 'worklog-update',
    });
    expect(updated).toMatchObject({
      remaining_estimate_minutes: 75,
      time_spent_minutes: 45,
      row_version: 3,
      worklogs: [expect.objectContaining({ duration_minutes: 45, row_version: 2 })],
    });

    const otherActorId = '019fbcf9-e020-71da-935a-6a6a728b3798';
    await pool.query(
      `insert into users (id,email,display_name,password_hash)
       values ($1,'other@example.com','Other Contributor','not-used')`,
      [otherActorId],
    );
    const otherTasks = await ScopedTaskRepository.open(
      pool,
      { ...actor, actorId: otherActorId, role: 'contributor', email: 'other@example.com' },
      workspace.id,
      project.id,
    );
    await expect(
      otherTasks.updateWorklog(created.id, worklog.id, {
        durationMinutes: 50,
        startedAt: '2026-08-10T14:15:00.000Z',
        taskRowVersion: 3,
        worklogRowVersion: 2,
        requestId: 'worklog-other-update',
      }),
    ).rejects.toMatchObject({ code: 'TASK_WORKLOG_FORBIDDEN', status: 403 });

    const removed = await tasks.deleteWorklog(created.id, worklog.id, {
      taskRowVersion: 3,
      worklogRowVersion: 2,
      requestId: 'worklog-delete',
    });
    expect(removed).toMatchObject({
      remaining_estimate_minutes: 120,
      time_spent_minutes: 0,
      row_version: 4,
      worklogs: [],
      worklog_page_info: { total: 0, hasNext: false },
    });
    await expect(tasks.listTaskWorklogs(created.id, { offset: 100 })).resolves.toMatchObject({
      items: [],
      pageInfo: { offset: 100, total: 0, hasNext: false },
    });
    const audits = await pool.query<{ action: string }>(
      `select action from audit_events where target_id=$1
       and action in ('task.work_logged','task.worklog_updated','task.worklog_deleted')
       order by created_at`,
      [created.id],
    );
    expect(audits.rows.map((entry) => entry.action)).toEqual([
      'task.work_logged',
      'task.worklog_updated',
      'task.worklog_deleted',
    ]);
  });

  it('links project tasks to key dates and derives completion from workflow categories', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Milestone workspace',
      slug: 'milestone-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Release qualification',
      key: 'QUAL',
      requestId: 'project-create',
    });
    const otherProject = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Other program',
      key: 'OTHER',
      requestId: 'other-project-create',
    });
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const otherTasks = await ScopedTaskRepository.open(pool, actor, workspace.id, otherProject.id);
    const openTask = await tasks.createTask({
      title: 'Prepare release package',
      description: '',
      priority: 'high',
      links: [],
      requestId: 'task-open',
    });
    const doneTask = await tasks.createTask({
      title: 'Approve evidence',
      description: '',
      priority: 'high',
      links: [],
      requestId: 'task-done',
    });
    await pool.query("update tasks set status='done' where project_id=$1 and id=$2", [
      project.id,
      doneTask.id,
    ]);
    const foreignTask = await otherTasks.createTask({
      title: 'Unrelated work',
      description: '',
      priority: 'medium',
      links: [],
      requestId: 'foreign-task',
    });
    const milestones = await ScopedMilestoneRepository.open(pool, actor, workspace.id, project.id);
    const milestone = await milestones.createMilestone({
      title: 'Production release',
      description: '',
      status: 'active',
      targetDate: '2026-10-01',
      taskIds: [openTask.id, doneTask.id],
      requestId: 'milestone-create',
    });

    expect(milestone).toMatchObject({
      task_count: 2,
      completed_task_count: 1,
      linked_tasks: [
        expect.objectContaining({ id: openTask.id, task_key: 'QUAL-1', status_category: 'todo' }),
        expect.objectContaining({ id: doneTask.id, task_key: 'QUAL-2', status_category: 'done' }),
      ],
    });
    await expect(tasks.getTask(doneTask.id)).resolves.toMatchObject({
      linked_key_dates: [
        expect.objectContaining({
          id: milestone.id,
          title: 'Production release',
          status: 'active',
          target_date: '2026-10-01',
        }),
      ],
    });
    const reduced = await milestones.updateMilestone(milestone.id, {
      title: milestone.title,
      description: milestone.description,
      status: milestone.status,
      targetDate: milestone.target_date,
      taskIds: [doneTask.id],
      rowVersion: milestone.row_version,
      requestId: 'milestone-update',
    });
    expect(reduced).toMatchObject({ task_count: 1, completed_task_count: 1 });
    await expect(
      milestones.createMilestone({
        title: 'Invalid cross-project link',
        description: '',
        status: 'planned',
        targetDate: '2026-10-02',
        taskIds: [foreignTask.id],
        requestId: 'milestone-invalid-link',
      }),
    ).rejects.toMatchObject({ code: 'MILESTONE_TASK_INVALID', status: 400 });
  });

  it('replays concurrent task and key-date creates without duplicating side effects', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Retry-safe workspace',
      slug: 'retry-safe-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Retry-safe release',
      key: 'RETRY',
      requestId: 'project-create',
    });
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const taskInput = {
      title: 'Publish verification package',
      description: 'Created by a retrying integration.',
      priority: 'high' as const,
      labels: ['release'],
      links: [],
      idempotencyKey: 'task-create-retry-001',
      requestId: 'task-create',
    };
    const [firstTask, replayedTask] = await Promise.all([
      tasks.createTask(taskInput),
      tasks.createTask({ ...taskInput, requestId: 'task-create-retry' }),
    ]);
    expect(firstTask.id).toBe(replayedTask.id);
    expect([firstTask.idempotent_replay, replayedTask.idempotent_replay].sort()).toEqual([
      false,
      true,
    ]);
    await expect(
      tasks.createTask({
        ...taskInput,
        title: 'A different request',
        requestId: 'task-create-conflict',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
    const taskEffects = await pool.query<{ tasks: number; audits: number; events: number }>(
      `select
         (select count(*)::int from tasks where project_id=$1 and title=$2) tasks,
         (select count(*)::int from audit_events where project_id=$1 and action='task.created'
            and target_id=$3) audits,
         (select count(*)::int from outbox_events where project_id=$1 and event_type='task.created'
            and entity_id=$3) events`,
      [project.id, taskInput.title, firstTask.id],
    );
    expect(taskEffects.rows[0]).toEqual({ tasks: 1, audits: 1, events: 1 });

    const clonedTask = await tasks.createTask({
      title: 'Copy of publish verification package',
      description: taskInput.description,
      priority: taskInput.priority,
      labels: taskInput.labels,
      cloneSourceTaskId: firstTask.id,
      links: [],
      idempotencyKey: 'task-clone-retry-001',
      requestId: 'task-clone',
    });
    expect(clonedTask).toMatchObject({
      title: 'Copy of publish verification package',
      status: 'todo',
      relationships: expect.arrayContaining([
        expect.objectContaining({ related_task_id: firstTask.id, relation_type: 'relates_to' }),
      ]),
    });
    await expect(
      tasks.createTask({
        title: 'Invalid clone',
        description: '',
        priority: 'medium',
        cloneSourceTaskId: '019fbcf9-e020-71da-935a-6a6a728b3700',
        links: [],
        requestId: 'task-clone-invalid-source',
      }),
    ).rejects.toMatchObject({ code: 'TASK_CLONE_SOURCE_INVALID', status: 400 });
    const cloneEffects = await pool.query<{ audits: number; relationships: number }>(
      `select
         (select count(*)::int from audit_events where project_id=$1 and action='task.cloned'
            and target_id=$2 and payload->>'sourceTaskId'=$3::text) audits,
         (select count(*)::int from task_relationships where project_id=$1
            and relation_type='relates_to'
            and (source_task_id=$2 or target_task_id=$2)
            and (source_task_id=$3::uuid or target_task_id=$3::uuid)) relationships`,
      [project.id, clonedTask.id, firstTask.id],
    );
    expect(cloneEffects.rows[0]).toEqual({ audits: 1, relationships: 1 });

    const milestones = await ScopedMilestoneRepository.open(pool, actor, workspace.id, project.id);
    const milestoneInput = {
      title: 'Verification decision',
      description: '',
      status: 'planned' as const,
      targetDate: '2026-11-20',
      taskIds: [firstTask.id],
      idempotencyKey: 'milestone-create-retry-001',
      requestId: 'milestone-create',
    };
    const firstMilestone = await milestones.createMilestone(milestoneInput);
    const replayedMilestone = await milestones.createMilestone({
      ...milestoneInput,
      requestId: 'milestone-create-retry',
    });
    expect(firstMilestone).toMatchObject({
      idempotent_replay: false,
      task_count: 1,
      linked_tasks: [expect.objectContaining({ id: firstTask.id })],
    });
    expect(replayedMilestone).toMatchObject({
      id: firstMilestone.id,
      idempotent_replay: true,
      task_count: 1,
    });
    await expect(
      milestones.createMilestone({
        ...milestoneInput,
        targetDate: '2026-11-21',
        requestId: 'milestone-create-conflict',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
    const milestoneEffects = await pool.query<{
      milestones: number;
      links: number;
      audits: number;
    }>(
      `select
         (select count(*)::int from project_milestones where project_id=$1 and title=$2) milestones,
         (select count(*)::int from project_milestone_tasks where project_id=$1
            and milestone_id=$3) links,
         (select count(*)::int from audit_events where project_id=$1
            and action='project_milestone.created' and target_id=$3) audits`,
      [project.id, milestoneInput.title, firstMilestone.id],
    );
    expect(milestoneEffects.rows[0]).toEqual({ milestones: 1, links: 1, audits: 1 });

    await pool.query(
      `update project_idempotency_requests set expires_at=now()-interval '1 second'
       where project_id=$1`,
      [project.id],
    );
    await expect(cleanupExpiredProjectIdempotencyRequests(pool)).resolves.toBe(3);
  });

  it('returns a bounded cross-project queue for the signed-in member', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Personal queue workspace',
      slug: 'personal-queue-workspace',
      requestId: 'workspace-create',
    });
    const firstProject = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Brake validation',
      key: 'BRAKE',
      requestId: 'first-project',
    });
    const secondProject = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Steering validation',
      key: 'STEER',
      requestId: 'second-project',
    });
    const dates = (
      await pool.query<{ today: string; yesterday: string; tomorrow: string }>(
        `select current_date::text today,(current_date-1)::text yesterday,
          (current_date+1)::text tomorrow`,
      )
    ).rows[0]!;
    const firstTasks = await ScopedTaskRepository.open(pool, actor, workspace.id, firstProject.id);
    const secondTasks = await ScopedTaskRepository.open(
      pool,
      actor,
      workspace.id,
      secondProject.id,
    );
    const overdue = await firstTasks.createTask({
      title: 'Approve brake report',
      description: '',
      priority: 'critical',
      assigneeId: actorId,
      dueDate: dates.yesterday,
      links: [],
      requestId: 'overdue-task',
    });
    await secondTasks.createTask({
      title: 'Review steering evidence',
      description: '',
      priority: 'high',
      assigneeId: actorId,
      dueDate: dates.tomorrow,
      links: [],
      requestId: 'upcoming-task',
    });
    await secondTasks.createTask({
      title: 'Unassigned steering note',
      description: '',
      priority: 'high',
      dueDate: dates.today,
      links: [],
      requestId: 'unassigned-task',
    });

    await expect(
      getWorkspaceMyWork(pool, actor, workspace.id, {
        today: dates.today,
        urgency: 'all',
        sort: 'attention',
        limit: 1,
      }),
    ).resolves.toMatchObject({
      summary: { total: 2, overdue: 1, dueSoon: 1, blocked: 0 },
      items: [{ id: overdue.id, taskKey: 'BRAKE-1', project: { name: 'Brake validation' } }],
      pageInfo: { limit: 1, offset: 0, total: 2, hasMore: true },
    });
    await expect(
      getWorkspaceMyWork(pool, actor, workspace.id, {
        today: dates.today,
        urgency: 'week',
        query: 'steering',
      }),
    ).resolves.toMatchObject({
      items: [{ taskKey: 'STEER-1', title: 'Review steering evidence' }],
      pageInfo: { total: 1, hasMore: false },
    });
  });

  it('creates one due-date reminder per task deadline across repeated worker scans', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Reminder workspace',
      slug: 'reminder-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Reminder project',
      key: 'REM',
      requestId: 'project-create',
    });
    const tomorrow = (
      await pool.query<{ tomorrow: string }>('select (current_date+1)::text tomorrow')
    ).rows[0]!.tomorrow;
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const task = await tasks.createTask({
      title: 'Submit qualification report',
      description: '',
      priority: 'high',
      assigneeId: actorId,
      dueDate: tomorrow,
      links: [],
      requestId: 'task-create',
    });
    await tasks.createTask({
      title: 'Confirm release checklist',
      description: '',
      priority: 'medium',
      assigneeId: actorId,
      dueDate: tomorrow,
      links: [],
      requestId: 'task-create-second',
    });

    await expect(createTaskDueDateNotifications(pool)).resolves.toBe(2);
    await expect(createTaskDueDateNotifications(pool)).resolves.toBe(0);
    await expect(
      pool.query<{ type: string; payload: { dueDate: string; daysRemaining: number } }>(
        `select type,payload from notifications
         where task_id=$1 and recipient_id=$2 and type='task.due_soon'`,
        [task.id, actorId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          type: 'task.due_soon',
          payload: { dueDate: tomorrow, daysRemaining: 1 },
        },
      ],
    });
    const firstPage = await listNotifications(pool, actor, { limit: 1, offset: 0 });
    expect(firstPage).toMatchObject({
      unreadCount: 2,
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
      items: [expect.objectContaining({ type: 'task.due_soon' })],
    });
    const secondPage = await listNotifications(pool, actor, { limit: 1, offset: 1 });
    expect(secondPage).toMatchObject({
      unreadCount: 2,
      pageInfo: { limit: 1, offset: 1, total: 2, hasNext: false },
      items: [expect.objectContaining({ type: 'task.due_soon' })],
    });
    expect(new Set([...firstPage.items, ...secondPage.items].map((item) => item.taskKey))).toEqual(
      new Set(['REM-1', 'REM-2']),
    );
  });

  it('queues signed webhook tests and manually recovers terminal deliveries with audit history', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Webhook operations workspace',
      slug: 'webhook-operations-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Webhook operations',
      key: 'HOOK',
      requestId: 'project-create',
    });
    const webhooks = await ScopedWebhookRepository.open(pool, actor, workspace.id, project.id);
    const endpoint = await webhooks.createEndpoint({
      name: 'Operations gateway',
      url: 'https://example.com/hooks/operations',
      objectTypeId: null,
      eventTypes: ['task.updated'],
      requestId: 'webhook-create',
    });

    const testDelivery = await webhooks.enqueueTest(endpoint.id, 'webhook-test');
    const newerDelivery = await webhooks.enqueueTest(endpoint.id, 'webhook-test-newer');
    expect(testDelivery).toMatchObject({
      eventType: 'webhook.test',
      status: 'queued',
      attemptCount: 0,
      responseSnippet: null,
    });
    await expect(
      pool.query<{ dispatched_at: Date | null; type: string }>(
        `select dispatched_at,payload->>'type' type from outbox_events where id=(
           select event_id from webhook_deliveries where id=$1
         )`,
        [testDelivery.id],
      ),
    ).resolves.toMatchObject({
      rows: [expect.objectContaining({ dispatched_at: expect.any(Date), type: 'webhook.test' })],
    });

    await pool.query(
      `update webhook_deliveries set status='failed',attempt_count=5,response_status=503,
         response_snippet='upstream unavailable',last_error='WEBHOOK_HTTP_503'
       where id=$1`,
      [testDelivery.id],
    );
    await expect(
      webhooks.listDeliveryPage(endpoint.id, { limit: 1, offset: 0 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: newerDelivery.id, status: 'queued' })],
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
      summary: { queued: 1, sending: 0, succeeded: 0, failed: 1 },
    });
    await expect(
      webhooks.listDeliveryPage(endpoint.id, { status: 'failed', limit: 1 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: testDelivery.id, status: 'failed' })],
      pageInfo: { total: 1, hasNext: false },
      summary: { queued: 1, sending: 0, succeeded: 0, failed: 1 },
    });
    const retried = await webhooks.retryDelivery(endpoint.id, testDelivery.id, 'webhook-retry');
    expect(retried).toMatchObject({
      status: 'queued',
      attemptCount: 0,
      responseStatus: 503,
      responseSnippet: 'upstream unavailable',
      lastError: 'WEBHOOK_HTTP_503',
    });
    await expect(webhooks.listDeliveryPage(endpoint.id)).resolves.toMatchObject({
      pageInfo: { total: 2, hasNext: false },
      summary: { queued: 2, sending: 0, succeeded: 0, failed: 0 },
    });
    await expect(
      pool.query<{ action: string; payload: { previousAttemptCount: number } }>(
        `select action,payload from audit_events
         where project_id=$1 and target_id=$2 and action='webhook.delivery_retried'`,
        [project.id, endpoint.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        expect.objectContaining({
          action: 'webhook.delivery_retried',
          payload: expect.objectContaining({ previousAttemptCount: 5 }),
        }),
      ],
    });
  });

  it('summarizes every workspace task and bounds date details in one consistent snapshot', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Program workspace',
      slug: 'program-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Battery qualification',
      key: 'BATT',
      requestId: 'project-create',
    });
    await pool.query(
      `insert into tasks
        (id,project_id,task_number,title,status,priority,board_position,created_by,archived_at)
       select gen_random_uuid(),$1,number,'Qualification task '||number,
              case when number<=5 or number=126 then 'blocked'
                   when number<=10 then 'done' else 'todo' end,
              'medium',number*1024,$2,case when number=126 then now() else null end
       from generate_series(1,126) number`,
      [project.id, actor.actorId],
    );
    const milestones = await ScopedMilestoneRepository.open(pool, actor, workspace.id, project.id);
    const overdue = await milestones.createMilestone({
      title: 'Design freeze',
      description: '',
      status: 'active',
      targetDate: '2026-08-01',
      requestId: 'milestone-overdue',
    });
    await milestones.createMilestone({
      title: 'Qualification release',
      description: '',
      status: 'at_risk',
      targetDate: '2026-08-20',
      requestId: 'milestone-upcoming',
    });
    const completed = await milestones.createMilestone({
      title: 'Completed checkpoint',
      description: '',
      status: 'completed',
      targetDate: '2026-07-15',
      requestId: 'milestone-completed',
    });
    const reopened = await milestones.updateMilestone(completed.id, {
      title: completed.title,
      description: completed.description,
      status: 'planned',
      targetDate: completed.target_date,
      rowVersion: completed.row_version,
      requestId: 'milestone-reopen',
    });
    expect(reopened.completed_at).toBeNull();
    await milestones.updateMilestone(completed.id, {
      title: reopened.title,
      description: reopened.description,
      status: 'completed',
      targetDate: reopened.target_date,
      rowVersion: reopened.row_version,
      requestId: 'milestone-recomplete',
    });
    const archived = await milestones.createMilestone({
      title: 'Retired checkpoint',
      description: '',
      status: 'planned',
      targetDate: '2026-07-01',
      requestId: 'milestone-archived',
    });
    await milestones.setArchived(archived.id, true, 'Superseded checkpoint', 'milestone-archive');

    const milestoneCatalog = await milestones.listMilestonePage({
      archiveState: 'all',
      query: 'checkpoint',
      limit: 1,
      offset: 0,
    });
    expect(milestoneCatalog).toMatchObject({
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
      summary: { planned: 0, active: 0, atRisk: 0, completed: 1, archived: 1 },
    });
    expect(milestoneCatalog.items).toHaveLength(1);

    await expect(
      getWorkspaceOverview(pool, actor, workspace.id, '2026-08-09', 1),
    ).resolves.toMatchObject({
      workspace: { id: workspace.id, publicId: workspace.publicId, name: 'Program workspace' },
      summary: {
        activeProjects: 1,
        openTasks: 120,
        blockedTasks: 5,
        overdueDates: 1,
        nextUpcomingDate: {
          title: 'Qualification release',
          targetDate: '2026-08-20',
          project: { id: project.id, publicId: project.publicId },
        },
      },
      projects: [
        expect.objectContaining({
          id: project.id,
          openTaskCount: 120,
          blockedTaskCount: 5,
          overdueDateCount: 1,
          nextDate: expect.objectContaining({ title: 'Qualification release' }),
        }),
      ],
      projectPageInfo: { limit: 20, offset: 0, total: 1, hasNext: false },
      dates: [{ id: overdue.id, title: 'Design freeze', targetDate: '2026-08-01' }],
    });

    const literalProject = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Literal _% qualification',
      key: 'LITERAL',
      requestId: 'literal-project-create',
    });
    await expect(
      getWorkspaceOverview(pool, actor, workspace.id, '2026-08-09', 1, 20, 0, '_%'),
    ).resolves.toMatchObject({
      summary: {
        activeProjects: 2,
        openTasks: 120,
        blockedTasks: 5,
        overdueDates: 1,
      },
      projects: [expect.objectContaining({ id: literalProject.id })],
      projectPageInfo: { limit: 20, offset: 0, total: 1, hasNext: false },
    });
  });

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
    const duration = await data.createField({
      objectTypeId: objectType.id,
      name: 'Duration',
      key: 'duration',
      fieldType: 'decimal',
      requestId: 'field-create',
    });
    const note = await data.createField({
      objectTypeId: objectType.id,
      name: 'Note',
      key: 'note',
      fieldType: 'text',
      requestId: 'note-field-create',
    });
    const view = await data.createRecordView({
      objectTypeId: objectType.id,
      name: 'Review queue',
      viewType: 'grid',
      config: {
        visibleFieldIds: [duration.id],
        fieldWidths: {},
        filters: [],
        sorts: [],
        rowDensity: 'compact',
        pageSize: 25,
        groupings: [{ fieldId: note.id, direction: 'asc', enabled: true }],
        summaries: [{ fieldId: duration.id, operation: 'average' }],
      },
      requestId: 'view-create',
    });

    expect(view.publicId).toMatch(/^v[0-9a-z]{14}$/);
    await expect(resolveRecordViewIdentifier(pool, view.publicId)).resolves.toBe(view.id);
    await expect(resolveRecordViewIdentifier(pool, view.id)).resolves.toBe(view.id);
    await expect(data.listRecordViewPage(objectType.id)).resolves.toMatchObject({
      items: [
        {
          id: view.id,
          publicId: view.publicId,
          config: {
            groupings: [{ fieldId: note.id, direction: 'asc', enabled: true }],
            summaries: [{ fieldId: duration.id, operation: 'average' }],
          },
        },
      ],
    });
    await expect(
      data.createRecordView({
        objectTypeId: objectType.id,
        name: 'Invalid text total',
        viewType: 'grid',
        config: {
          visibleFieldIds: [note.id],
          fieldWidths: {},
          filters: [],
          sorts: [],
          rowDensity: 'compact',
          pageSize: 25,
          summaries: [{ fieldId: note.id, operation: 'sum' }],
        },
        requestId: 'invalid-summary-view-create',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_VIEW_CONFIG_INVALID', status: 400 });
    await expect(
      data.createRecordView({
        objectTypeId: objectType.id,
        name: 'Invalid duplicate groups',
        viewType: 'grid',
        config: {
          visibleFieldIds: [note.id],
          fieldWidths: {},
          filters: [],
          sorts: [],
          rowDensity: 'compact',
          pageSize: 25,
          groupings: [
            { fieldId: note.id, direction: 'asc', enabled: true },
            { fieldId: note.id, direction: 'desc', enabled: true },
          ],
        },
        requestId: 'invalid-group-view-create',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_VIEW_CONFIG_INVALID', status: 400 });
  });

  it('enforces collaborative, personal, and locked saved-view ownership boundaries', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'View permission workspace',
      slug: 'view-permission-workspace',
      requestId: 'workspace-create',
    });
    const project = await ensureWorkspaceDataProject(pool, actor, workspace.id, 'data-context');
    const ownerData = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const objectType = await ownerData.createObjectType({
      name: 'Inspection',
      pluralName: 'Inspections',
      key: 'inspection',
      requestId: 'object-create',
    });
    const firstContributorId = '019fbcf9-e020-71da-935a-6a6a728b3730';
    const secondContributorId = '019fbcf9-e020-71da-935a-6a6a728b3731';
    await pool.query(
      `insert into users (id,email,display_name,password_hash) values
       ($1,'view-owner@example.com','View Owner','not-used'),
       ($2,'view-peer@example.com','View Peer','not-used')`,
      [firstContributorId, secondContributorId],
    );
    await pool.query(
      `insert into memberships (id,organization_id,user_id,role,created_by) values
       ('019fbcf9-e020-71da-935a-6a6a728b3732',$1,$2,'contributor',$4),
       ('019fbcf9-e020-71da-935a-6a6a728b3733',$1,$3,'contributor',$4)`,
      [organizationId, firstContributorId, secondContributorId, actorId],
    );
    const firstContributor: ActorSession = {
      ...actor,
      actorId: firstContributorId,
      role: 'contributor',
      email: 'view-owner@example.com',
      displayName: 'View Owner',
    };
    const secondContributor: ActorSession = {
      ...actor,
      actorId: secondContributorId,
      role: 'contributor',
      email: 'view-peer@example.com',
      displayName: 'View Peer',
    };
    const firstData = await ScopedProjectRepository.open(
      pool,
      firstContributor,
      workspace.id,
      project.id,
    );
    const secondData = await ScopedProjectRepository.open(
      pool,
      secondContributor,
      workspace.id,
      project.id,
    );
    const config = {
      visibleFieldIds: [],
      fieldWidths: {},
      filters: [],
      sorts: [],
      rowDensity: 'compact' as const,
      pageSize: 25 as const,
    };
    const collaborative = await firstData.createRecordView({
      objectTypeId: objectType.id,
      name: 'Release queue',
      viewType: 'grid',
      permissionType: 'collaborative',
      config,
      requestId: 'view-create',
    });
    expect(collaborative).toMatchObject({ permissionType: 'collaborative', ownerId: null });

    await expect(
      secondData.setRecordViewPermission({
        objectTypeId: objectType.id,
        viewId: collaborative.id,
        permissionType: 'personal',
        rowVersion: collaborative.rowVersion,
        requestId: 'view-takeover',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_VIEW_PERMISSION_DENIED', status: 403 });

    const personal = await firstData.setRecordViewPermission({
      objectTypeId: objectType.id,
      viewId: collaborative.id,
      permissionType: 'personal',
      rowVersion: collaborative.rowVersion,
      requestId: 'view-personal',
    });
    expect(personal).toMatchObject({ permissionType: 'personal', ownerId: firstContributorId });
    await expect(
      secondData.updateRecordView({
        objectTypeId: objectType.id,
        viewId: personal.id,
        name: 'Peer overwrite',
        viewType: 'grid',
        config,
        rowVersion: personal.rowVersion,
        requestId: 'view-update-peer',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_VIEW_PERSONAL', status: 403 });

    const locked = await ownerData.setRecordViewPermission({
      objectTypeId: objectType.id,
      viewId: personal.id,
      permissionType: 'locked',
      lockReason: 'Approved release baseline',
      rowVersion: personal.rowVersion,
      requestId: 'view-lock',
    });
    expect(locked).toMatchObject({
      permissionType: 'locked',
      ownerId: null,
      lockReason: 'Approved release baseline',
    });
    await expect(
      ownerData.updateRecordView({
        objectTypeId: objectType.id,
        viewId: locked.id,
        name: 'Locked overwrite',
        viewType: 'grid',
        config,
        rowVersion: locked.rowVersion,
        requestId: 'view-update-locked',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_VIEW_LOCKED', status: 403 });

    const unlocked = await ownerData.setRecordViewPermission({
      objectTypeId: objectType.id,
      viewId: locked.id,
      permissionType: 'collaborative',
      rowVersion: locked.rowVersion,
      requestId: 'view-unlock',
    });
    await expect(
      secondData.updateRecordView({
        objectTypeId: objectType.id,
        viewId: unlocked.id,
        name: 'Team release queue',
        viewType: 'grid',
        config,
        rowVersion: unlocked.rowVersion,
        requestId: 'view-update-collaborative',
      }),
    ).resolves.toMatchObject({ name: 'Team release queue', permissionType: 'collaborative' });
    await expect(
      secondData.createRecordView({
        objectTypeId: objectType.id,
        name: 'Unauthorized lock',
        viewType: 'grid',
        permissionType: 'locked',
        config,
        requestId: 'view-create-locked',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_VIEW_PERMISSION_DENIED', status: 403 });
  });

  it('publishes a bounded read-only view without leaking hidden field values', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Public view workspace',
      slug: 'public-view-workspace',
      requestId: 'workspace-create',
    });
    const project = await ensureWorkspaceDataProject(pool, actor, workspace.id, 'data-context');
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const objectType = await data.createObjectType({
      name: 'Release',
      pluralName: 'Releases',
      key: 'release',
      requestId: 'object-create',
    });
    const status = await data.createField({
      objectTypeId: objectType.id,
      name: 'Status',
      key: 'status',
      fieldType: 'single_select',
      required: true,
      config: {
        options: [
          { key: 'ready', label: 'Ready' },
          { key: 'draft', label: 'Draft' },
        ],
      },
      requestId: 'status-field',
    });
    await data.createField({
      objectTypeId: objectType.id,
      name: 'Secret note',
      key: 'secret-note',
      fieldType: 'text',
      required: false,
      config: {},
      requestId: 'secret-field',
    });
    await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Approved release',
      values: { status: 'ready', 'secret-note': 'CLASSIFIED-ALPHA' },
      requestId: 'record-ready',
    });
    await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Draft release',
      values: { status: 'draft', 'secret-note': 'public draft' },
      requestId: 'record-draft',
    });
    const view = await data.createRecordView({
      objectTypeId: objectType.id,
      name: 'Approved releases',
      viewType: 'grid',
      config: {
        visibleFieldIds: [status.id],
        fieldWidths: { [status.id]: 160 },
        filters: [{ fieldId: status.id, operator: 'eq', value: 'ready' }],
        sorts: [{ fieldId: status.id, direction: 'asc' }],
        rowDensity: 'compact',
        pageSize: 25,
      },
      requestId: 'view-create',
    });
    const created = await createRecordViewShare(pool, actor, {
      workspaceId: workspace.id,
      projectId: project.id,
      objectTypeId: objectType.id,
      recordViewId: view.id,
      passwordHash: 'argon-hash-placeholder',
      allowDownload: false,
      expiresAt: new Date(Date.now() + 86_400_000),
      requestId: 'share-create',
    });
    expect(created.token).toMatch(/^sv_[A-Za-z0-9_-]{43}$/);
    const context = await resolvePublicRecordViewShare(pool, created.token);
    await expect(getPublicSharedViewMetadata(pool, context, false)).resolves.toEqual({
      requiresPassword: true,
    });
    await expect(getPublicSharedViewMetadata(pool, context, true)).resolves.toMatchObject({
      view: {
        name: 'Approved releases',
        fields: [{ id: status.id, key: 'status' }],
        allowDownload: false,
      },
    });
    await expect(queryPublicSharedViewRecords(pool, context, {})).resolves.toMatchObject({
      total: 1,
      items: [
        {
          displayName: 'Approved release',
          values: { status: 'ready' },
        },
      ],
    });
    await expect(
      queryPublicSharedViewRecords(pool, context, { search: 'CLASSIFIED-ALPHA' }),
    ).resolves.toMatchObject({ total: 0, items: [] });
    await expect(
      queryPublicSharedViewRecords(pool, context, {
        filters: [
          {
            fieldId: '019fbcf9-e020-71da-935a-6a6a728b3799',
            operator: 'eq',
            value: 'CLASSIFIED-ALPHA',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'SHARED_VIEW_FIELD_NOT_VISIBLE', status: 400 });

    const rotated = await createRecordViewShare(pool, actor, {
      workspaceId: workspace.id,
      projectId: project.id,
      objectTypeId: objectType.id,
      recordViewId: view.id,
      allowDownload: true,
      requestId: 'share-rotate',
    });
    expect(rotated.passwordProtected).toBe(true);
    await expect(resolvePublicRecordViewShare(pool, created.token)).rejects.toMatchObject({
      code: 'SHARED_VIEW_NOT_FOUND',
      status: 404,
    });
    await revokeRecordViewShare(pool, actor, {
      workspaceId: workspace.id,
      projectId: project.id,
      objectTypeId: objectType.id,
      recordViewId: view.id,
      rowVersion: rotated.rowVersion,
      requestId: 'share-revoke',
    });
    await expect(resolvePublicRecordViewShare(pool, rotated.token)).rejects.toMatchObject({
      code: 'SHARED_VIEW_NOT_FOUND',
      status: 404,
    });
  });

  it('accepts idempotent public form submissions without attributing them to the link owner', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Public intake workspace',
      slug: 'public-intake',
      requestId: 'public-intake-workspace',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Public intake project',
      key: 'INTAKE',
      requestId: 'public-intake-project',
    });
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const objectType = await data.createObjectType({
      name: 'Request',
      pluralName: 'Requests',
      key: 'request',
      requestId: 'public-intake-table',
    });
    const subject = await data.createField({
      objectTypeId: objectType.id,
      name: 'Subject',
      key: 'subject',
      fieldType: 'text',
      required: true,
      config: {},
      requestId: 'public-intake-subject',
    });
    const form = await data.createRecordView({
      objectTypeId: objectType.id,
      name: 'External request',
      viewType: 'form',
      config: {
        visibleFieldIds: [subject.id],
        fieldWidths: {},
        filters: [],
        sorts: [],
        rowDensity: 'compact',
        pageSize: 25,
      },
      requestId: 'public-intake-form',
    });
    const share = await createRecordViewShare(pool, actor, {
      workspaceId: workspace.id,
      projectId: project.id,
      objectTypeId: objectType.id,
      recordViewId: form.id,
      allowDownload: true,
      requestId: 'public-intake-share',
    });
    expect(share.allowDownload).toBe(false);
    const context = await resolvePublicRecordViewShare(pool, share.token);
    await expect(getPublicSharedViewMetadata(pool, context, true)).resolves.toMatchObject({
      view: {
        viewType: 'form',
        allowDownload: false,
        fields: [{ key: 'subject', required: true }],
      },
    });
    await expect(queryPublicSharedViewRecords(pool, context, {})).rejects.toMatchObject({
      code: 'SHARED_VIEW_QUERY_UNSUPPORTED',
      status: 405,
    });

    const submission = {
      displayName: 'Motor inquiry',
      values: { subject: 'Need qualification evidence' },
      idempotencyHash: '1'.repeat(64),
      requestHash: '2'.repeat(64),
      networkFingerprint: '3'.repeat(64),
      requestId: 'public-intake-submit',
    };
    const created = await submitPublicForm(pool, context, submission);
    expect(created.idempotentReplay).toBe(false);
    await expect(submitPublicForm(pool, context, submission)).resolves.toMatchObject({
      recordId: created.recordId,
      idempotentReplay: true,
    });
    await expect(
      submitPublicForm(pool, context, { ...submission, requestHash: '4'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });

    const permissions = await data.getObjectTypePermissions(objectType.id);
    await data.updateObjectTypePermissions({
      objectTypeId: objectType.id,
      modes: { ...permissions.modes, create: 'nobody' },
      subjects: permissions.subjects,
      rowVersion: permissions.rowVersion,
      requestId: 'public-intake-disable-create',
    });
    await expect(
      submitPublicForm(pool, context, {
        ...submission,
        idempotencyHash: '5'.repeat(64),
        requestHash: '6'.repeat(64),
        requestId: 'public-intake-denied',
      }),
    ).rejects.toMatchObject({ code: 'PUBLIC_FORM_TABLE_CREATE_FORBIDDEN', status: 403 });

    const [record, provenance, audit, webhook] = await Promise.all([
      pool.query<{ created_by: string | null; updated_by: string | null }>(
        'select created_by,updated_by from records where id=$1',
        [created.recordId],
      ),
      pool.query('select share_id,record_id from public_form_submissions where record_id=$1', [
        created.recordId,
      ]),
      pool.query<{ actor_id: string | null; action: string }>(
        `select actor_id,action from audit_events
         where target_id=$1 and action='record.public_form_submitted'`,
        [created.recordId],
      ),
      pool.query<{ payload: { actorId: string | null; data: { source: string } } }>(
        `select payload from outbox_events where entity_id=$1 and event_type='record.created'`,
        [created.recordId],
      ),
    ]);
    expect(record.rows[0]).toEqual({ created_by: null, updated_by: null });
    expect(provenance.rows[0]).toMatchObject({ share_id: context.id, record_id: created.recordId });
    expect(audit.rows[0]).toEqual({ actor_id: null, action: 'record.public_form_submitted' });
    expect(webhook.rows[0]?.payload).toMatchObject({
      actorId: null,
      data: { source: 'public_form' },
    });

    const ownerField = await data.createField({
      objectTypeId: objectType.id,
      name: 'Internal owner',
      key: 'internal-owner',
      fieldType: 'user',
      required: false,
      config: {},
      requestId: 'public-intake-owner-field',
    });
    const unsafeForm = await data.createRecordView({
      objectTypeId: objectType.id,
      name: 'Unsafe external request',
      viewType: 'form',
      config: {
        visibleFieldIds: [subject.id, ownerField.id],
        fieldWidths: {},
        filters: [],
        sorts: [],
        rowDensity: 'compact',
        pageSize: 25,
      },
      requestId: 'public-intake-unsafe-form',
    });
    await expect(
      createRecordViewShare(pool, actor, {
        workspaceId: workspace.id,
        projectId: project.id,
        objectTypeId: objectType.id,
        recordViewId: unsafeForm.id,
        allowDownload: false,
        requestId: 'public-intake-unsafe-share',
      }),
    ).rejects.toMatchObject({ code: 'PUBLIC_FORM_FIELD_UNSUPPORTED', status: 400 });
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
    await expect(listProjectPage(pool, actor, workspace.id)).resolves.toMatchObject({
      items: [{ id: project.id }],
      pageInfo: { total: 1, hasNext: false },
      overallTotal: 1,
    });
    await expect(
      listProjectPage(pool, actor, workspace.id, {
        query: 'no matching project',
        archiveState: 'active',
        limit: 1,
        offset: 10,
      }),
    ).resolves.toEqual({
      items: [],
      pageInfo: { limit: 1, offset: 10, total: 0, hasNext: false },
      overallTotal: 1,
    });
    await expect(
      listProjectOptions(pool, actor, workspace.id, 'ordinary', 20),
    ).resolves.toMatchObject({
      items: [{ id: project.id, publicId: project.publicId }],
      pageInfo: { limit: 20, total: 1, hasMore: false },
    });
    await expect(getProject(pool, actor, workspace.id, project.publicId)).resolves.toMatchObject({
      id: project.id,
      publicId: project.publicId,
      workspaceId: workspace.id,
    });
    await expect(
      pool.query('select count(*)::int count from projects where workspace_id=$1 and system=true', [
        workspace.id,
      ]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });

    const systemProjectId = scopes[0]!.id;
    await expect(getProject(pool, actor, workspace.id, systemProjectId)).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
      status: 404,
    });
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

  it('pages engineering histories and joins the latest measurement evaluation', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Engineering history workspace',
      slug: 'engineering-history-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Force qualification',
      key: 'FORCE-HISTORY',
      requestId: 'project-create',
    });
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const objectType = await data.createObjectType({
      name: 'Sample',
      pluralName: 'Samples',
      key: 'sample',
      requestId: 'object-create',
    });
    const statusField = await data.createField({
      objectTypeId: objectType.id,
      name: 'Status',
      key: 'status',
      fieldType: 'single_select',
      config: { options: [{ key: 'ready', label: 'Ready' }] },
      requestId: 'status-field-create',
    });
    const measurementField = await data.createField({
      objectTypeId: objectType.id,
      name: 'Displacement',
      key: 'displacement',
      fieldType: 'measurement',
      config: {
        dimension: 'length',
        canonicalUnit: 'm',
        allowedUnits: ['m', 'mm'],
        displayPrecision: 3,
      },
      requestId: 'field-create',
    });
    const record = await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Qualification sample',
      values: { status: 'ready' },
      requestId: 'record-create',
    });
    const engineering = await ScopedEngineeringRepository.open(
      pool,
      actor,
      workspace.id,
      project.id,
    );
    await engineering.createSpecification({
      name: 'Force displacement envelope',
      measurementFieldId: measurementField.id,
      limits: { lowerLimit: '0', upperLimit: '2' },
      changeNote: 'Initial qualification limits',
      requestId: 'specification-create',
    });
    const initial = await engineering.createMeasurement({
      recordId: record.id,
      fieldId: measurementField.id,
      value: '1000',
      unit: 'mm',
      measuredAt: '2026-08-10T12:00:00.000Z',
      requestId: 'measurement-create',
    });
    const corrected = await engineering.createMeasurement({
      recordId: record.id,
      fieldId: measurementField.id,
      value: '1100',
      unit: 'mm',
      measuredAt: '2026-08-10T13:00:00.000Z',
      supersedesResultId: String(initial.id),
      correctionReason: 'Fixture offset correction',
      requestId: 'measurement-correct',
    });

    await expect(
      data.queryRecords(objectType.id, {
        summaries: [{ fieldId: measurementField.id, operation: 'average' }],
        groupings: [{ fieldId: statusField.id, direction: 'asc', enabled: true }],
      }),
    ).resolves.toMatchObject({
      summaries: [
        {
          fieldId: measurementField.id,
          operation: 'average',
          value: '1.1',
          unit: 'm',
        },
      ],
      groupHierarchy: [
        {
          level: 1,
          fieldId: statusField.id,
          path: [{ fieldId: statusField.id, value: 'ready' }],
          count: 1,
          summaries: [
            {
              fieldId: measurementField.id,
              operation: 'average',
              value: '1.1',
              unit: 'm',
            },
          ],
        },
      ],
    });

    await expect(
      engineering.listMeasurementPage({
        recordId: record.id,
        currentState: 'all',
        query: 'mm',
        limit: 1,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          id: corrected.id,
          current: true,
          evaluation: { status: 'pass', measurement_result_id: corrected.id },
        },
      ],
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
    });
    await expect(
      engineering.listMeasurementPage({
        recordId: record.id,
        currentState: 'superseded',
        query: '',
        limit: 10,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [{ id: initial.id, current: false }],
      pageInfo: { total: 1, hasNext: false },
    });
    await expect(
      engineering.listSpecificationPage({
        archiveState: 'active',
        query: 'displacement',
        limit: 10,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [{ name: 'Force displacement envelope', revisions: [{ revision_number: 1 }] }],
      pageInfo: { total: 1, hasNext: false },
    });
    await expect(
      engineering.listEvaluationPage({
        recordId: record.id,
        status: 'pass',
        query: '',
        limit: 1,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [{ status: 'pass' }],
      pageInfo: { total: 2, hasNext: true },
    });
  });

  it('creates one atomic follow-up task when a failed evaluation is submitted concurrently', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Failed evaluation workspace',
      slug: 'failed-evaluation-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Qualification investigation',
      key: 'INVESTIGATE',
      requestId: 'project-create',
    });
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const objectType = await data.createObjectType({
      name: 'Sample',
      pluralName: 'Samples',
      key: 'sample',
      requestId: 'object-create',
    });
    const measurementField = await data.createField({
      objectTypeId: objectType.id,
      name: 'Displacement',
      key: 'displacement',
      fieldType: 'measurement',
      config: {
        dimension: 'length',
        canonicalUnit: 'm',
        allowedUnits: ['m', 'mm'],
        displayPrecision: 3,
      },
      requestId: 'field-create',
    });
    const record = await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Over-travel sample',
      values: {},
      requestId: 'record-create',
    });
    const engineering = await ScopedEngineeringRepository.open(
      pool,
      actor,
      workspace.id,
      project.id,
    );
    await engineering.createSpecification({
      name: 'Travel limit',
      measurementFieldId: measurementField.id,
      limits: { lowerLimit: '0', upperLimit: '0.002' },
      changeNote: 'Initial travel limit',
      requestId: 'specification-create',
    });
    await engineering.createMeasurement({
      recordId: record.id,
      fieldId: measurementField.id,
      value: '5',
      unit: 'mm',
      measuredAt: '2026-08-11T12:00:00.000Z',
      requestId: 'measurement-create',
    });
    const evaluations = await engineering.listEvaluationPage({
      recordId: record.id,
      status: 'fail',
      query: '',
      limit: 10,
      offset: 0,
    });
    const evaluationId = evaluations.items[0]!.id;
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        tasks.createFromFailedEvaluation(evaluationId, `follow-up-${index + 1}`),
      ),
    );

    expect(new Set(results.map((task) => task.id))).toEqual(new Set([results[0]!.id]));
    expect(results.filter((task) => task.idempotent_replay === false)).toHaveLength(1);
    expect(results.filter((task) => task.idempotent_replay === true)).toHaveLength(4);
    expect(results[0]).toMatchObject({
      title: 'Investigate failed specification: Over-travel sample',
      priority: 'high',
      status: 'todo',
      links: expect.arrayContaining([
        expect.objectContaining({ entity_type: 'record', entity_id: record.id }),
        expect.objectContaining({
          entity_type: 'specification_evaluation',
          entity_id: evaluationId,
        }),
      ]),
    });
    const effects = await pool.query<{
      tasks: number;
      evaluation_links: number;
      created_audits: number;
      origin_audits: number;
      webhook_events: number;
    }>(
      `select
         (select count(*)::int from tasks where project_id=$1 and title=$2) tasks,
         (select count(*)::int from task_links where project_id=$1
            and entity_type='specification_evaluation' and entity_id=$3) evaluation_links,
         (select count(*)::int from audit_events where project_id=$1 and action='task.created'
            and target_id=$4) created_audits,
         (select count(*)::int from audit_events where project_id=$1
            and action='task.created_from_evaluation' and target_id=$4
            and payload->>'evaluationId'=$3::text) origin_audits,
         (select count(*)::int from outbox_events where project_id=$1
            and event_type='task.created' and entity_id=$4) webhook_events`,
      [
        project.id,
        'Investigate failed specification: Over-travel sample',
        evaluationId,
        results[0]!.id,
      ],
    );
    expect(effects.rows[0]).toEqual({
      tasks: 1,
      evaluation_links: 1,
      created_audits: 1,
      origin_audits: 1,
      webhook_events: 1,
    });
  });

  it('pages searchable chart and dashboard catalogs with lifecycle filtering', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Visualization catalog workspace',
      slug: 'visualization-catalog-workspace',
      requestId: 'visualization-workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Visualization catalog',
      key: 'VISUAL',
      requestId: 'visualization-project-create',
    });
    const visualizations = await ScopedVisualizationRepository.open(
      pool,
      actor,
      workspace.id,
      project.id,
    );

    const chartIds: string[] = [];
    for (const [index, name] of ['Thermal alpha', 'Thermal beta', 'Force trend'].entries()) {
      const chart = await pool.query<{ id: string }>(
        `insert into charts (id,project_id,name,description,created_by)
         values (gen_random_uuid(),$1,$2,'Catalog integration chart',$3) returning id`,
        [project.id, name, actorId],
      );
      const chartId = chart.rows[0]!.id;
      chartIds.push(chartId);
      const revision = await pool.query<{ id: string }>(
        `insert into chart_revisions
         (id,project_id,chart_id,revision_number,config_version,chart_type,config,change_note,created_by)
         values (gen_random_uuid(),$1,$2,1,1,'line','{}'::jsonb,$3,$4) returning id`,
        [project.id, chartId, `Initial chart ${index + 1}`, actorId],
      );
      await pool.query('update charts set current_revision_id=$2 where id=$1', [
        chartId,
        revision.rows[0]!.id,
      ]);
    }
    await visualizations.setChartArchived(chartIds[1]!, true, 'Historical series', 'archive-chart');

    const dashboards: Array<{ id: string }> = [];
    for (const name of ['Operations alpha', 'Operations beta', 'Quality review']) {
      dashboards.push(
        await visualizations.createDashboard({
          name,
          description: 'Catalog integration canvas',
          changeNote: 'Initial canvas',
          cards: [],
          requestId: `create-${name.toLocaleLowerCase().replaceAll(' ', '-')}`,
        }),
      );
    }
    await visualizations.setDashboardArchived(
      dashboards[1]!.id,
      true,
      'Historical canvas',
      'archive-dashboard',
    );

    await expect(
      visualizations.listChartPage({
        archiveState: 'active',
        query: 'THERMAL',
        limit: 1,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [{ name: 'Thermal alpha', archived_at: null }],
      pageInfo: { limit: 1, offset: 0, total: 1, hasNext: false },
    });
    await expect(
      visualizations.listChartPage({
        archiveState: 'all',
        query: 'thermal',
        limit: 1,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ name: 'Thermal beta' })],
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
    });
    await expect(
      visualizations.listDashboardPage({
        archiveState: 'all',
        query: 'operations',
        limit: 1,
        offset: 1,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ name: 'Operations alpha' })],
      pageInfo: { limit: 1, offset: 1, total: 2, hasNext: false },
    });
  });

  it('searches active projects, tasks, and tables across one workspace', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Search workspace',
      slug: 'search-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Motor validation',
      key: 'MOTOR',
      requestId: 'project-create',
    });
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const task = await tasks.createTask({
      title: 'Review motor evidence',
      description: '',
      priority: 'high',
      labels: ['Safety', 'supplier'],
      links: [],
      requestId: 'task-create',
    });
    const milestones = await ScopedMilestoneRepository.open(pool, actor, workspace.id, project.id);
    const milestone = await milestones.createMilestone({
      title: 'Motor design release',
      description: 'Release after evidence approval',
      status: 'active',
      targetDate: '2026-10-01',
      requestId: 'milestone-create',
    });
    const systemProject = await ensureWorkspaceDataProject(
      pool,
      actor,
      workspace.id,
      'data-context',
    );
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, systemProject.id);
    const table = await data.createObjectType({
      name: 'Motor sample',
      pluralName: 'Motor samples',
      key: 'motor_sample',
      requestId: 'table-create',
    });

    const result = await searchWorkspace(pool, actor, workspace.id, 'motor', 10);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'project',
          id: project.id,
          publicId: project.publicId,
          key: 'MOTOR',
        }),
        expect.objectContaining({
          type: 'task',
          id: task.id,
          key: 'MOTOR-1',
          projectPublicId: project.publicId,
        }),
        expect.objectContaining({
          type: 'milestone',
          id: milestone.id,
          key: '2026-10-01',
          projectPublicId: project.publicId,
        }),
        expect.objectContaining({
          type: 'table',
          id: table.id,
          publicId: table.publicId,
          workspaceShared: true,
        }),
      ]),
    );
    expect(result.pageInfo).toEqual({ limit: 10, total: 4, hasMore: false });
    await expect(tasks.listLabels()).resolves.toEqual([
      { value: 'safety', count: 1 },
      { value: 'supplier', count: 1 },
    ]);
    await expect(tasks.listTasks({ labels: ['SUPPLIER'] })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: task.id, labels: ['safety', 'supplier'] })],
      pageInfo: { total: 1 },
    });
    await expect(searchWorkspace(pool, actor, workspace.id, 'supplier', 10)).resolves.toMatchObject(
      {
        items: [expect.objectContaining({ type: 'task', id: task.id })],
      },
    );
    await expect(
      searchWorkspace(pool, actor, workspace.id, '2026-10-01', 10),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ type: 'milestone', id: milestone.id })],
      pageInfo: { total: 1 },
    });
    await expect(
      searchWorkspace(pool, actor, workspace.id, 'motor', 10, ['milestone']),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ type: 'milestone', id: milestone.id })],
      pageInfo: { total: 1 },
    });
    await milestones.setArchived(milestone.id, true, 'release cancelled', 'milestone-archive');
    await expect(
      searchWorkspace(pool, actor, workspace.id, 'design release', 10),
    ).resolves.toMatchObject({
      items: [],
      pageInfo: { total: 0 },
    });

    await tasks.setArchived(task.id, true, 'no longer active', task.row_version, 'task-archive');
    await expect(searchWorkspace(pool, actor, workspace.id, 'MOTOR-1', 10)).resolves.toMatchObject({
      items: [],
      pageInfo: { total: 0 },
    });
  });

  it('calculates project flow aging and cycle time from complete status history', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Flow workspace',
      slug: 'flow-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Flow project',
      key: 'FLOW',
      requestId: 'project-create',
    });
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const seeded = await pool.query<{ id: string; title: string }>(
      `insert into tasks
         (id,project_id,task_number,title,description,status,priority,board_position,created_by,created_at,updated_at)
       values
         (gen_random_uuid(),$1,1,'Old backlog item','','todo','medium',1024,$2,now()-interval '12 days',now()),
         (gen_random_uuid(),$1,2,'Long running test','','in_progress','high',2048,$2,now()-interval '10 days',now()),
         (gen_random_uuid(),$1,3,'Completed analysis','','done','low',3072,$2,now()-interval '10 days',now()),
         (gen_random_uuid(),$1,4,'Paused and restored intake','','todo','medium',4096,$2,now()-interval '6 days',now())
       returning id,title`,
      [project.id, actorId],
    );
    const taskByTitle = new Map(seeded.rows.map((task) => [task.title, task.id]));
    const backlog = { id: taskByTitle.get('Old backlog item')! };
    const active = { id: taskByTitle.get('Long running test')! };
    const completed = { id: taskByTitle.get('Completed analysis')! };
    const restored = { id: taskByTitle.get('Paused and restored intake')! };
    await pool.query(
      `insert into task_status_history
         (id,project_id,task_id,from_status,to_status,changed_by,changed_at)
       values
         (gen_random_uuid(),$1,$2,null,'todo',$5,now()-interval '12 days'),
         (gen_random_uuid(),$1,$3,null,'todo',$5,now()-interval '10 days'),
         (gen_random_uuid(),$1,$3,'todo','in_progress',$5,now()-interval '8 days'),
         (gen_random_uuid(),$1,$4,null,'todo',$5,now()-interval '10 days'),
         (gen_random_uuid(),$1,$4,'todo','in_progress',$5,now()-interval '4 days'),
         (gen_random_uuid(),$1,$4,'in_progress','done',$5,now()-interval '2 days'),
         (gen_random_uuid(),$1,$6,null,'todo',$5,now()-interval '6 days')`,
      [project.id, backlog.id, active.id, completed.id, actorId, restored.id],
    );
    await pool.query(
      `insert into audit_events
         (id,organization_id,workspace_id,project_id,actor_id,action,target_type,target_id,request_id,payload,created_at)
       values
         (gen_random_uuid(),$1,$2,$3,$4,'task.archived','task',$5,'flow-archive','{}',now()-interval '4 days'),
         (gen_random_uuid(),$1,$2,$3,$4,'task.restored','task',$5,'flow-restore','{}',now()-interval '2 days')`,
      [organizationId, workspace.id, project.id, actorId, restored.id],
    );

    const insights = await tasks.getFlowInsights(30, 7);
    expect(insights).toMatchObject({
      window_days: 30,
      stale_after_days: 7,
      summary: {
        active_count: 3,
        wip_count: 1,
        stale_count: 2,
        completed_count: 1,
        average_cycle_hours: 48,
        median_cycle_hours: 48,
        p85_cycle_hours: 48,
      },
      statuses: expect.arrayContaining([
        expect.objectContaining({ key: 'todo', current_count: 2, stale_count: 1 }),
        expect.objectContaining({ key: 'in_progress', current_count: 1, stale_count: 1 }),
        expect.objectContaining({ key: 'done', current_count: 1, average_age_hours: null }),
      ]),
      aging_tasks: expect.arrayContaining([
        expect.objectContaining({ id: backlog.id, task_key: 'FLOW-1', age_hours: 288 }),
        expect.objectContaining({ id: active.id, task_key: 'FLOW-2', age_hours: 192 }),
      ]),
      completed_tasks: [
        expect.objectContaining({ id: completed.id, task_key: 'FLOW-3', cycle_time_hours: 48 }),
      ],
      flow_statuses: expect.arrayContaining([
        expect.objectContaining({ key: 'todo', archived: false }),
        expect.objectContaining({ key: 'in_progress', archived: false }),
        expect.objectContaining({ key: 'done', archived: false }),
      ]),
    });
    expect(insights.flow_series).toHaveLength(30);
    expect(insights.flow_series.at(-1)).toMatchObject({
      counts: { todo: 2, in_progress: 1, done: 1 },
    });
    expect(insights.flow_series.slice(-7).map((point) => point.counts)).toEqual([
      { todo: 3, in_progress: 1, blocked: 0, done: 0 },
      { todo: 3, in_progress: 1, blocked: 0, done: 0 },
      { todo: 1, in_progress: 2, blocked: 0, done: 0 },
      { todo: 1, in_progress: 2, blocked: 0, done: 0 },
      { todo: 2, in_progress: 1, blocked: 0, done: 1 },
      { todo: 2, in_progress: 1, blocked: 0, done: 1 },
      { todo: 2, in_progress: 1, blocked: 0, done: 1 },
    ]);
    expect(insights.throughput_series).toHaveLength(30);
    expect(insights.throughput_series.slice(-7)).toEqual([
      expect.objectContaining({ created_count: 1, completed_count: 0 }),
      expect.objectContaining({ created_count: 0, completed_count: 0 }),
      expect.objectContaining({ created_count: 0, completed_count: 0 }),
      expect.objectContaining({ created_count: 0, completed_count: 0 }),
      expect.objectContaining({ created_count: 0, completed_count: 1 }),
      expect.objectContaining({ created_count: 0, completed_count: 0 }),
      expect.objectContaining({ created_count: 0, completed_count: 0 }),
    ]);
    expect(
      insights.throughput_series.reduce((total, point) => total + point.created_count, 0),
    ).toBe(4);
    expect(
      insights.throughput_series.reduce((total, point) => total + point.completed_count, 0),
    ).toBe(insights.summary.completed_count);
  });

  it('keeps one-level task hierarchy searchable, summarized, and lifecycle-safe', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Hierarchy workspace',
      slug: 'hierarchy-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Qualification project',
      key: 'QUAL',
      requestId: 'project-create',
    });
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const parent = await tasks.createTask({
      title: 'Supplier qualification package',
      description: '',
      priority: 'high',
      links: [],
      requestId: 'parent-create',
    });
    const child = await tasks.createTask({
      title: 'Confirm salt spray evidence',
      description: '',
      priority: 'medium',
      parentTaskId: parent.id,
      links: [],
      requestId: 'child-create',
    });
    const standalone = await tasks.createTask({
      title: 'Alpha qualification intake',
      description: '',
      priority: 'low',
      dueDate: '2026-08-12',
      links: [],
      requestId: 'standalone-create',
    });

    await expect(tasks.listTasks({ sort: 'title', direction: 'asc' })).resolves.toMatchObject({
      items: [
        expect.objectContaining({ id: standalone.id }),
        expect.objectContaining({ id: parent.id }),
        expect.objectContaining({ id: child.id, parent_task_id: parent.id }),
      ],
    });

    await expect(tasks.listCandidates()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: parent.id, child_count: 1, parent_task_id: null }),
        expect.objectContaining({ id: child.id, parent_task_id: parent.id }),
      ]),
      pageInfo: { total: 3, hasNext: false },
    });
    await expect(tasks.getTask(parent.id)).resolves.toMatchObject({
      child_count: 1,
      child_done_count: 0,
      children: [expect.objectContaining({ id: child.id, task_key: 'QUAL-2' })],
    });
    await expect(tasks.getTask(child.id)).resolves.toMatchObject({
      parent_task_id: parent.id,
      parent_task_key: 'QUAL-1',
      parent_task_title: 'Supplier qualification package',
    });
    const completedChild = await tasks.updateTask(child.id, {
      title: child.title,
      description: child.description,
      status: 'done',
      priority: child.priority,
      rowVersion: child.row_version,
      requestId: 'child-complete',
    });
    await expect(tasks.getTask(parent.id)).resolves.toMatchObject({
      child_count: 1,
      child_done_count: 1,
    });
    await expect(tasks.listTasks({ statuses: ['done'] })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: child.id, status: 'done' })],
      pageInfo: { total: 1 },
    });
    await expect(tasks.listTasks({ statuses: ['todo'] })).resolves.toMatchObject({
      items: [
        expect.objectContaining({ id: parent.id, status: 'todo' }),
        expect.objectContaining({ id: standalone.id, status: 'todo' }),
      ],
      pageInfo: { total: 2 },
    });
    await expect(tasks.listTasks({ hasDueDate: true })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: standalone.id, due_date: '2026-08-12' })],
      pageInfo: { total: 1, hasNext: false },
    });
    await expect(
      tasks.createTask({
        title: 'Invalid nested work',
        description: '',
        priority: 'low',
        parentTaskId: child.id,
        links: [],
        requestId: 'nested-create',
      }),
    ).rejects.toMatchObject({ code: 'TASK_PARENT_DEPTH_LIMIT', status: 409 });
    await expect(
      tasks.setArchived(parent.id, true, 'premature archive', parent.row_version, 'parent-archive'),
    ).rejects.toMatchObject({ code: 'TASK_HAS_ACTIVE_CHILDREN', status: 409 });
    const archivedChild = await tasks.setArchived(
      child.id,
      true,
      'archive child first',
      completedChild.row_version,
      'child-archive',
    );
    const archivedParent = await tasks.setArchived(
      parent.id,
      true,
      'children are archived',
      parent.row_version,
      'parent-archive',
    );
    await expect(
      tasks.setArchived(child.id, false, '', archivedChild.row_version, 'child-restore'),
    ).rejects.toMatchObject({
      code: 'TASK_PARENT_ARCHIVED',
      status: 409,
    });
    await tasks.setArchived(parent.id, false, '', archivedParent.row_version, 'parent-restore');
    await expect(
      tasks.setArchived(child.id, false, '', archivedChild.row_version, 'child-restore'),
    ).resolves.toMatchObject({ id: child.id, archived_at: null, row_version: 4 });
    await expect(
      tasks.setArchived(
        child.id,
        true,
        'stale archive attempt',
        archivedChild.row_version,
        'child-stale-archive',
      ),
    ).rejects.toMatchObject({ code: 'TASK_VERSION_CONFLICT', status: 409 });
    const childWebhookEvents = await pool.query<{
      event_type: string;
      payload: {
        taskId: string;
        data: { task: { key: string; status: string; archived: boolean; rowVersion: number } };
      };
    }>(
      `select event_type,payload from outbox_events
       where project_id=$1 and entity_type='task' and entity_id=$2
       order by created_at,id`,
      [project.id, child.id],
    );
    expect(childWebhookEvents.rows.map((event) => event.event_type)).toEqual([
      'task.created',
      'task.updated',
      'task.archived',
      'task.restored',
    ]);
    expect(childWebhookEvents.rows.at(-1)?.payload).toMatchObject({
      taskId: child.id,
      data: {
        task: {
          key: 'QUAL-2',
          status: 'done',
          archived: false,
          rowVersion: 4,
        },
      },
    });
    const lifecycleAudit = await pool.query<{
      action: string;
      payload: { reason?: string; fromRowVersion: number; toRowVersion: number };
    }>(
      `select action,payload from audit_events
       where project_id=$1 and target_type='task' and target_id=$2
         and action in ('task.archived','task.restored')
       order by created_at,id`,
      [project.id, child.id],
    );
    expect(lifecycleAudit.rows).toEqual([
      {
        action: 'task.archived',
        payload: {
          reason: 'archive child first',
          fromRowVersion: 2,
          toRowVersion: 3,
        },
      },
      {
        action: 'task.restored',
        payload: { fromRowVersion: 3, toRowVersion: 4 },
      },
    ]);
    await expect(
      searchWorkspace(pool, actor, workspace.id, 'qualification package', 10),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ type: 'task', id: child.id })]),
    });
  });

  it('edits only authored comments with row-version conflicts and immutable revisions', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Comment workspace',
      slug: 'comment-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Comment project',
      key: 'COMMENT',
      requestId: 'project-create',
    });
    const reviewerId = '019fbcf9-e020-71da-935a-6a6a728b3710';
    await pool.query(
      `insert into users (id,email,display_name,password_hash)
       values ($1,'comment-reviewer@example.com','Comment Reviewer','not-used')`,
      [reviewerId],
    );
    await pool.query(
      `insert into memberships (id,organization_id,user_id,role,created_by)
       values ('019fbcf9-e020-71da-935a-6a6a728b3711',$1,$2,'contributor',$3)`,
      [organizationId, reviewerId, actorId],
    );
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const task = await tasks.createTask({
      title: 'Record release decision',
      description: '',
      priority: 'high',
      links: [],
      requestId: 'task-create',
    });
    const comment = await tasks.addComment({
      taskId: task.id,
      body: 'Release is blocked.',
      mentionedUserIds: [],
      requestId: 'comment-create',
    });
    expect(comment).toMatchObject({ row_version: 1, revisions: [] });

    const edited = await tasks.updateComment({
      taskId: task.id,
      commentId: comment.id,
      body: 'Release is approved with monitoring.',
      mentionedUserIds: [reviewerId],
      rowVersion: comment.row_version,
      requestId: 'comment-edit',
    });
    expect(edited).toMatchObject({
      body: 'Release is approved with monitoring.',
      row_version: 2,
      edited_at: expect.any(String),
      mentions: [{ id: reviewerId, displayName: 'Comment Reviewer' }],
      revision_count: 1,
      revisions: [],
    });
    await expect(tasks.getCommentRevisions(task.id, comment.id)).resolves.toMatchObject({
      pageInfo: { total: 1, hasNext: false },
      items: [
        {
          revision: 1,
          body: 'Release is blocked.',
          mentions: [],
          edited_by_name: actor.displayName,
          edited_at: expect.any(String),
        },
      ],
    });
    await expect(
      tasks.updateComment({
        taskId: task.id,
        commentId: comment.id,
        body: 'A stale overwrite.',
        mentionedUserIds: [],
        rowVersion: 1,
        requestId: 'comment-edit-stale',
      }),
    ).rejects.toMatchObject({ code: 'TASK_COMMENT_VERSION_CONFLICT', status: 409 });

    const reviewer: ActorSession = {
      ...actor,
      actorId: reviewerId,
      role: 'contributor',
      email: 'comment-reviewer@example.com',
      displayName: 'Comment Reviewer',
    };
    const reviewerTasks = await ScopedTaskRepository.open(pool, reviewer, workspace.id, project.id);
    await expect(
      reviewerTasks.updateComment({
        taskId: task.id,
        commentId: comment.id,
        body: 'Someone else rewrote the decision.',
        mentionedUserIds: [],
        rowVersion: 2,
        requestId: 'comment-edit-other-author',
      }),
    ).rejects.toMatchObject({ code: 'TASK_COMMENT_EDIT_FORBIDDEN', status: 403 });
    await expect(
      pool.query(
        `select action,payload from audit_events
         where project_id=$1 and target_id=$2 and action='task.comment_edited'`,
        [project.id, task.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          action: 'task.comment_edited',
          payload: expect.objectContaining({
            commentId: comment.id,
            fromRowVersion: 1,
            toRowVersion: 2,
            previousBody: 'Release is blocked.',
          }),
        },
      ],
    });
  });

  it('enforces restricted task visibility across direct, group, list, search, and webhook paths', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Confidential work',
      slug: 'confidential-work',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Restricted project',
      key: 'SECRET',
      requestId: 'project-create',
    });
    const directId = '019fbcf9-e020-71da-935a-6a6a728b3720';
    const groupedId = '019fbcf9-e020-71da-935a-6a6a728b3721';
    const outsiderId = '019fbcf9-e020-71da-935a-6a6a728b3722';
    const groupId = '019fbcf9-e020-71da-935a-6a6a728b3723';
    for (const [id, email, name] of [
      [directId, 'direct@example.com', 'Direct Member'],
      [groupedId, 'grouped@example.com', 'Grouped Member'],
      [outsiderId, 'outsider@example.com', 'Outside Member'],
    ]) {
      await pool.query(
        "insert into users (id,email,display_name,password_hash) values ($1,$2,$3,'not-used')",
        [id, email, name],
      );
      await pool.query(
        `insert into memberships (id,organization_id,user_id,role,created_by)
         values (gen_random_uuid(),$1,$2,'contributor',$3)`,
        [organizationId, id, actorId],
      );
    }
    await pool.query(
      `insert into member_groups (id,organization_id,name,description,color,created_by)
       values ($1,$2,'Security reviewers','','violet',$3)`,
      [groupId, organizationId, actorId],
    );
    await pool.query(
      `insert into member_group_memberships
       (id,organization_id,group_id,user_id,assigned_by)
       values (gen_random_uuid(),$1,$2,$3,$4)`,
      [organizationId, groupId, groupedId, actorId],
    );

    const ownerTasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const task = await ownerTasks.createTask({
      title: 'Confidential supplier disposition',
      description: 'Sensitive negotiation details.',
      priority: 'critical',
      visibility: 'restricted',
      links: [],
      requestId: 'restricted-create',
    });
    expect(task.visibility).toBe('restricted');
    await expect(
      pool.query(
        `select 1 from outbox_events
         where project_id=$1 and entity_type='task' and entity_id=$2`,
        [project.id, task.id],
      ),
    ).resolves.toMatchObject({ rowCount: 0 });

    await expect(
      ownerTasks.setTaskVisibility({
        taskId: task.id,
        visibility: 'restricted',
        userIds: [directId],
        groupIds: [groupId],
        rowVersion: task.row_version,
        requestId: 'visibility-update',
      }),
    ).resolves.toMatchObject({
      visibility: 'restricted',
      rowVersion: task.row_version + 1,
      members: [expect.objectContaining({ id: directId })],
      groups: [expect.objectContaining({ id: groupId })],
    });

    const session = (actorId: string, email: string, displayName: string): ActorSession => ({
      ...actor,
      actorId,
      role: 'contributor',
      email,
      displayName,
    });
    for (const member of [
      session(directId, 'direct@example.com', 'Direct Member'),
      session(groupedId, 'grouped@example.com', 'Grouped Member'),
    ]) {
      const repository = await ScopedTaskRepository.open(pool, member, workspace.id, project.id);
      await expect(repository.resolveTaskIdentifier(task.id)).resolves.toBe(task.id);
      await expect(repository.listTasks({})).resolves.toMatchObject({
        items: [expect.objectContaining({ id: task.id })],
      });
    }

    const outsider = session(outsiderId, 'outsider@example.com', 'Outside Member');
    const outsiderTasks = await ScopedTaskRepository.open(pool, outsider, workspace.id, project.id);
    await expect(outsiderTasks.resolveTaskIdentifier(task.id)).rejects.toMatchObject({
      code: 'TASK_NOT_FOUND',
      status: 404,
    });
    await expect(outsiderTasks.listTasks({})).resolves.toMatchObject({
      items: [],
      pageInfo: { total: 0 },
    });
    await expect(
      searchWorkspace(pool, outsider, workspace.id, 'Confidential supplier', 10),
    ).resolves.toMatchObject({ items: [], pageInfo: { total: 0 } });
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
    const duration = await data.createField({
      objectTypeId: objectType.id,
      name: 'Duration',
      key: 'duration',
      fieldType: 'decimal',
      required: true,
      config: {},
      requestId: 'duration-field-create',
    });
    const phase = await data.createField({
      objectTypeId: objectType.id,
      name: 'Phase',
      key: 'phase',
      fieldType: 'single_select',
      required: true,
      config: {
        options: [
          { key: 'build', label: 'Build' },
          { key: 'test', label: 'Test' },
        ],
      },
      requestId: 'phase-field-create',
    });
    await data.createRecord({
      objectTypeId: objectType.id,
      contextProjectId: firstProject.id,
      displayName: 'Alpha run',
      values: { status: 'ready', duration: '10.5', phase: 'build' },
      requestId: 'record-alpha',
    });
    await data.createRecord({
      objectTypeId: objectType.id,
      contextProjectId: secondProject.id,
      displayName: 'Beta run',
      values: { status: 'ready', duration: '20.5', phase: 'build' },
      requestId: 'record-beta',
    });
    await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Unassigned run',
      values: { status: 'ready', duration: '5', phase: 'test' },
      requestId: 'record-none',
    });

    const alpha = await data.queryRecords(objectType.id, {
      contextProjectId: firstProject.id,
      groupByFieldId: status.id,
      summaries: [{ fieldId: duration.id, operation: 'sum' }],
    });
    expect(alpha.items.map((item) => item.displayName)).toEqual(['Alpha run']);
    expect(alpha.groups).toEqual([{ value: 'ready', count: 1 }]);
    expect(alpha.summaries).toEqual([
      { fieldId: duration.id, operation: 'sum', value: '10.5', unit: null },
    ]);
    const completeSummary = await data.queryRecords(objectType.id, {
      pageSize: 1,
      summaries: [
        { fieldId: duration.id, operation: 'average' },
        { fieldId: status.id, operation: 'count' },
      ],
    });
    expect(completeSummary.items).toHaveLength(1);
    expect(completeSummary.total).toBe(3);
    expect(completeSummary.summaries).toEqual([
      { fieldId: duration.id, operation: 'average', value: '12', unit: null },
      { fieldId: status.id, operation: 'count', value: '3', unit: null },
    ]);
    const grouped = await data.queryRecords(objectType.id, {
      pageSize: 1,
      summaries: [
        { fieldId: duration.id, operation: 'average' },
        { fieldId: status.id, operation: 'count' },
      ],
      groupings: [
        { fieldId: status.id, direction: 'asc', enabled: true },
        { fieldId: phase.id, direction: 'desc', enabled: true },
      ],
    });
    expect(grouped.items).toHaveLength(1);
    expect(grouped.items[0]?.values.phase).toBe('test');
    expect(grouped.groupHierarchy).toEqual([
      {
        level: 1,
        fieldId: status.id,
        path: [{ fieldId: status.id, value: 'ready' }],
        count: 3,
        summaries: [
          { fieldId: duration.id, operation: 'average', value: '12', unit: null },
          { fieldId: status.id, operation: 'count', value: '3', unit: null },
        ],
      },
      {
        level: 2,
        fieldId: phase.id,
        path: [
          { fieldId: status.id, value: 'ready' },
          { fieldId: phase.id, value: 'build' },
        ],
        count: 2,
        summaries: [
          { fieldId: duration.id, operation: 'average', value: '15.5', unit: null },
          { fieldId: status.id, operation: 'count', value: '2', unit: null },
        ],
      },
      {
        level: 2,
        fieldId: phase.id,
        path: [
          { fieldId: status.id, value: 'ready' },
          { fieldId: phase.id, value: 'test' },
        ],
        count: 1,
        summaries: [
          { fieldId: duration.id, operation: 'average', value: '5', unit: null },
          { fieldId: status.id, operation: 'count', value: '1', unit: null },
        ],
      },
    ]);
    const unassigned = await data.queryRecords(objectType.id, { contextProjectId: null });
    expect(unassigned.items.map((item) => item.displayName)).toEqual(['Unassigned run']);
  });

  it('searches bounded relation candidates and hydrates linked display names', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Relations workspace',
      slug: 'relations-workspace',
      requestId: 'workspace-create',
    });
    const project = await ensureWorkspaceDataProject(pool, actor, workspace.id, 'data-context');
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const samples = await data.createObjectType({
      name: 'Sample',
      pluralName: 'Samples',
      key: 'sample',
      requestId: 'samples-create',
    });
    const experiments = await data.createObjectType({
      name: 'Experiment',
      pluralName: 'Experiments',
      key: 'experiment',
      requestId: 'experiments-create',
    });
    const sampleRelation = await data.createField({
      objectTypeId: experiments.id,
      name: 'Samples',
      key: 'samples',
      fieldType: 'relation',
      config: { targetObjectTypeId: samples.id, multiple: true },
      requestId: 'samples-relation-create',
    });
    const experimentStatus = await data.createField({
      objectTypeId: experiments.id,
      name: 'Status',
      key: 'status',
      fieldType: 'single_select',
      config: { options: [{ key: 'open', label: 'Open' }] },
      requestId: 'experiment-status-create',
    });
    const active = await data.createRecord({
      objectTypeId: samples.id,
      displayName: 'Catalyst Alpha',
      values: {},
      requestId: 'active-sample-create',
    });
    const archived = await data.createRecord({
      objectTypeId: samples.id,
      displayName: 'Catalyst Archive',
      values: {},
      requestId: 'archived-sample-create',
    });
    const experiment = await data.createRecord({
      objectTypeId: experiments.id,
      displayName: 'Screening run',
      values: { status: 'open' },
      relations: { [sampleRelation.id]: [active.id, archived.id] },
      requestId: 'experiment-create',
    });
    await data.setRecordArchived({
      objectTypeId: samples.id,
      recordId: archived.id,
      archived: true,
      reason: 'Retired reference',
      requestId: 'archived-sample-archive',
    });

    const candidates = await data.listRecordReferencePage(samples.id, {
      query: 'catalyst',
      limit: 20,
      offset: 0,
    });
    expect(candidates.items).toEqual([
      expect.objectContaining({ id: active.id, displayName: 'Catalyst Alpha', archivedAt: null }),
    ]);
    expect(candidates.pageInfo).toMatchObject({ total: 1, hasNext: false });

    const resolved = await data.listRecordReferencePage(samples.id, {
      query: '',
      ids: [archived.id, active.id],
      limit: 20,
      offset: 0,
    });
    expect(resolved.items.map((item) => item.id)).toEqual([archived.id, active.id]);
    expect(resolved.items[0]?.archivedAt).not.toBeNull();

    const records = await data.queryRecords(experiments.id, {});
    expect(records.items[0]).toMatchObject({
      id: experiment.id,
      relations: { [sampleRelation.id]: [active.id, archived.id] },
      relationLabels: {
        [sampleRelation.id]: [
          expect.objectContaining({ id: active.id, displayName: 'Catalyst Alpha' }),
          expect.objectContaining({ id: archived.id, displayName: 'Catalyst Archive' }),
        ],
      },
    });
    await expect(
      data.queryRecords(experiments.id, {
        groupings: [{ fieldId: experimentStatus.id, direction: 'asc', enabled: true }],
        summaries: [{ fieldId: sampleRelation.id, operation: 'count' }],
      }),
    ).resolves.toMatchObject({
      groupHierarchy: [
        {
          path: [{ fieldId: experimentStatus.id, value: 'open' }],
          count: 1,
          summaries: [{ fieldId: sampleRelation.id, operation: 'count', value: '1', unit: null }],
        },
      ],
    });
  });

  it('hydrates user, file, and dataset labels once per bounded record page', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Reference labels workspace',
      slug: 'reference-labels-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Reference labels project',
      key: 'REFERENCE-LABELS',
      requestId: 'project-create',
    });
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const files = await ScopedFileDatasetRepository.open(pool, actor, workspace.id, project.id);
    const objectType = await data.createObjectType({
      name: 'Run',
      pluralName: 'Runs',
      key: 'run',
      requestId: 'object-create',
    });
    const operator = await data.createField({
      objectTypeId: objectType.id,
      name: 'Operator',
      key: 'operator',
      fieldType: 'user',
      requestId: 'operator-field',
    });
    const rawFile = await data.createField({
      objectTypeId: objectType.id,
      name: 'Raw file',
      key: 'raw-file',
      fieldType: 'file',
      requestId: 'file-field',
    });
    const datasetField = await data.createField({
      objectTypeId: objectType.id,
      name: 'Dataset',
      key: 'dataset',
      fieldType: 'dataset',
      requestId: 'dataset-field',
    });
    const fileId = '019fbcf9-e020-71da-935a-6a6a728b37b0';
    const uploadId = '019fbcf9-e020-71da-935a-6a6a728b37b1';
    await files.issueUpload({
      fileId,
      uploadId,
      seriesName: 'Qualification evidence',
      originalName: 'force.csv',
      contentType: 'text/csv',
      sizeBytes: 64,
      checksum: 'b'.repeat(64),
      stagingObjectKey: 'staging/reference-label-fixture',
      finalObjectKey: 'committed/reference-label-fixture',
      expiresAt: new Date(Date.now() + 60_000),
      requestId: 'file-upload',
    });
    await files.beginFinalization(uploadId);
    await files.completeFinalization(uploadId, 'storage-reference-label-version', 'file-finalize');
    const createdDataset = await files.createDataset({
      name: 'Force response',
      sourceFileId: fileId,
      datasetType: 'tabular',
      parameters: { delimiter: ',' },
      requestId: 'dataset-create',
    });
    await pool.query("update datasets set status='ready' where id=$1", [createdDataset.dataset.id]);
    const record = await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Run 001',
      values: { operator: actorId },
      fileReferences: { [rawFile.id]: [fileId] },
      datasetReferences: { [datasetField.id]: [createdDataset.dataset.id] },
      requestId: 'record-create',
    });

    await expect(data.queryRecords(objectType.id, {})).resolves.toMatchObject({
      items: [
        {
          id: record.id,
          referenceLabels: {
            [operator.id]: [{ id: actorId, displayName: actor.displayName, archivedAt: null }],
            [rawFile.id]: [
              {
                id: fileId,
                displayName: 'Qualification evidence · v1 · force.csv',
                archivedAt: null,
              },
            ],
            [datasetField.id]: [
              {
                id: createdDataset.dataset.id,
                displayName: 'Force response · tabular',
                archivedAt: null,
              },
            ],
          },
        },
      ],
    });
    await expect(data.queryRecords(objectType.id, { fields: ['operator'] })).resolves.toMatchObject(
      {
        items: [
          {
            referenceLabels: {
              [operator.id]: [{ id: actorId, displayName: actor.displayName }],
            },
          },
        ],
      },
    );
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
    const spectrum = await data.createField({
      objectTypeId: objectType.id,
      name: 'UV-Vis spectrum',
      key: 'uv-vis-spectrum',
      fieldType: 'spectral_data',
      config: { xLabel: 'Wavelength', xUnit: 'nm', yLabel: 'Absorbance', yUnit: 'a.u.' },
      requestId: 'spectrum-field',
    });
    const conditions = await data.createField({
      objectTypeId: objectType.id,
      name: 'Conditions',
      key: 'conditions',
      fieldType: 'tabular_data',
      config: { firstRowHeader: true },
      requestId: 'table-field',
    });
    const secondaryType = await data.createObjectType({
      name: 'Zeta scan',
      pluralName: 'Zeta scans',
      key: 'zeta-scan',
      requestId: 'secondary-object-create',
    });
    const secondaryField = await data.createField({
      objectTypeId: secondaryType.id,
      name: 'Operator note',
      key: 'operator-note',
      fieldType: 'text',
      requestId: 'secondary-field-create',
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

    const catalog = await data.getSchemaCatalog({ query: '', limit: 1, offset: 0 });
    expect(catalog.pageInfo).toEqual({ limit: 1, offset: 0, total: 2, hasNext: true });
    expect(catalog.tables).toEqual([
      expect.objectContaining({
        id: objectType.id,
        publicId: objectType.publicId,
        fields: [
          expect.objectContaining({ id: spectrum.id, key: 'uv-vis-spectrum' }),
          expect.objectContaining({ id: conditions.id, key: 'conditions' }),
        ],
      }),
    ]);
    const searchedCatalog = await data.getSchemaCatalog({ query: 'zeta', limit: 10, offset: 0 });
    expect(searchedCatalog.pageInfo).toEqual({
      limit: 10,
      offset: 0,
      total: 1,
      hasNext: false,
    });
    expect(searchedCatalog.tables).toEqual([
      expect.objectContaining({
        id: secondaryType.id,
        fields: [expect.objectContaining({ id: secondaryField.id, key: 'operator-note' })],
      }),
    ]);

    const selected = await data.queryRecords(objectType.id, { fields: ['conditions'] });
    expect(selected.items[0]?.values).toEqual({
      conditions: {
        columns: ['Time', 'Temperature'],
        rows: [
          [0, 20],
          [1, 21.5],
        ],
      },
    });
    expect(selected.items[0]?.values).not.toHaveProperty('uv-vis-spectrum');
    await expect(
      data.queryRecords(objectType.id, { fields: ['not-a-field'] }),
    ).rejects.toMatchObject({ code: 'FIELD_NOT_FOUND', status: 404 });

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
    expect((await listMemberGroupPage(pool, actor)).items).toMatchObject([
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
    expect((await listMemberGroupPage(pool, actor)).items[0]).toMatchObject({
      name: 'Materials & Spectroscopy',
      color: 'violet',
      memberIds: [actorId, secondUserId],
    });

    await archiveMemberGroup(pool, actor, group.id, 'group-archive');
    expect(await listMemberGroupPage(pool, actor)).toMatchObject({
      items: [],
      pageInfo: { total: 0, hasNext: false },
    });
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

  it('keeps task dependency graphs acyclic and reports unresolved blockers', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Dependency workspace',
      slug: 'dependency-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Dependency project',
      key: 'DEPEND',
      requestId: 'project-create',
    });
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const automations = await ScopedTaskAutomationRepository.open(
      pool,
      actor,
      workspace.id,
      project.id,
    );
    const createTask = (title: string, requestId: string) =>
      tasks.createTask({
        title,
        description: '',
        status: 'todo',
        priority: 'medium',
        links: [],
        requestId,
      });
    const first = await createTask('Prepare fixture', 'task-first');
    const second = await createTask('Run validation', 'task-second');
    const third = await createTask('Publish report', 'task-third');
    expect([first.task_key, second.task_key, third.task_key]).toEqual([
      'DEPEND-1',
      'DEPEND-2',
      'DEPEND-3',
    ]);
    await expect(tasks.resolveTaskIdentifier('depend-1')).resolves.toBe(first.id);
    await expect(tasks.resolveTaskIdentifier(first.id)).resolves.toBe(first.id);
    await expect(tasks.resolveTaskIdentifier('OTHER-1')).rejects.toMatchObject({
      code: 'TASK_NOT_FOUND',
      status: 404,
    });

    const concurrent = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        createTask(`Concurrent task ${index + 1}`, `task-concurrent-${index + 1}`),
      ),
    );
    expect(
      concurrent.map((task) => Number(task.task_number)).sort((left, right) => left - right),
    ).toEqual([4, 5, 6, 7, 8]);
    expect([first.board_position, second.board_position, third.board_position]).toEqual([
      1024, 2048, 3072,
    ]);
    const rankedFirst = await tasks.moveTask(concurrent[4]!.id, {
      status: 'todo',
      beforeTaskId: first.id,
      rowVersion: concurrent[4]!.row_version,
      requestId: 'task-rank-first',
    });
    expect(rankedFirst).toMatchObject({ status: 'todo', board_position: 512, row_version: 2 });
    await expect(tasks.listTasks({ limit: 2 })).resolves.toMatchObject({
      items: [
        expect.objectContaining({ id: concurrent[4]!.id }),
        expect.objectContaining({ id: first.id }),
      ],
    });
    const rankedLast = await tasks.moveTask(rankedFirst.id, {
      status: 'todo',
      placement: 'bottom',
      rowVersion: rankedFirst.row_version,
      requestId: 'task-rank-last',
    });
    await expect(tasks.listTasks({ limit: 100 })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: rankedLast.id })]),
    });
    expect((await tasks.listTasks({ limit: 100 })).items.at(-1)?.id).toBe(rankedLast.id);
    const rankedTop = await tasks.moveTask(rankedLast.id, {
      status: 'todo',
      placement: 'top',
      rowVersion: rankedLast.row_version,
      requestId: 'task-rank-top',
    });
    expect((await tasks.listTasks({ limit: 2 })).items[0]?.id).toBe(rankedTop.id);
    await expect(
      tasks.moveTask(concurrent[4]!.id, {
        status: 'todo',
        beforeTaskId: first.id,
        rowVersion: rankedFirst.row_version,
        requestId: 'task-rank-stale',
      }),
    ).rejects.toMatchObject({ code: 'TASK_VERSION_CONFLICT', status: 409 });

    const escalationRule = await automations.createRule({
      name: 'Escalate blockers',
      description: 'Blocked work is always critical.',
      triggerType: 'task.status_changed',
      triggerConfig: { fromStatus: 'any', toStatus: 'blocked' },
      conditionConfig: {},
      actionConfig: { priority: 'critical' },
      active: true,
      requestId: 'automation-create-escalation',
    });
    await automations.createRule({
      name: 'Keep critical blockers blocked',
      description: 'Exercises chained event handling without repeating rules.',
      triggerType: 'task.priority_changed',
      triggerConfig: { fromPriority: 'any', toPriority: 'critical' },
      conditionConfig: { status: 'blocked' },
      actionConfig: { status: 'blocked' },
      active: true,
      requestId: 'automation-create-chain',
    });
    const automated = await tasks.updateTask(second.id, {
      title: second.title,
      description: second.description,
      status: 'blocked',
      priority: second.priority,
      assigneeId: second.assignee_id ?? undefined,
      dueDate: second.due_date ?? undefined,
      rowVersion: second.row_version,
      requestId: 'task-trigger-automation',
    });
    expect(automated).toMatchObject({ status: 'blocked', priority: 'critical', row_version: 3 });
    expect(automated.change_history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'task.automated',
          automation_rule_name: 'Escalate blockers',
          changes: expect.arrayContaining([
            {
              field: 'priority',
              from: 'medium',
              to: 'critical',
              changed: true,
            },
          ]),
        }),
      ]),
    );
    await expect(automations.listExecutionPage({ limit: 1 })).resolves.toMatchObject({
      items: [expect.objectContaining({ taskId: second.id })],
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
      summary: { succeeded: 1, no_change: 1, failed: 0 },
    });
    await expect(automations.listExecutionPage({ outcome: 'no_change' })).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ruleName: 'Keep critical blockers blocked',
          taskId: second.id,
          outcome: 'no_change',
        }),
      ],
      pageInfo: { total: 1, hasNext: false },
      summary: { succeeded: 1, no_change: 1, failed: 0 },
    });
    await automations.updateRule(escalationRule.id as string, {
      name: 'Escalate blocked work',
      description: 'Renamed after execution.',
      triggerType: 'task.status_changed',
      triggerConfig: { fromStatus: 'any', toStatus: 'blocked' },
      conditionConfig: {},
      actionConfig: { priority: 'critical' },
      active: true,
      requestId: 'automation-rename-escalation',
    });
    await expect(
      automations.listExecutionPage({ ruleId: escalationRule.id as string }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ruleName: 'Escalate blockers',
          triggerType: 'task.status_changed',
          triggerEvent: { type: 'task.status_changed', from: 'todo', to: 'blocked' },
          durationMs: expect.any(Number),
        }),
      ],
      pageInfo: { total: 1, hasNext: false },
      summary: { succeeded: 1, no_change: 0, failed: 0 },
    });
    const auditPage = await listAuditEventPage(pool, actor, { query: 'task.', limit: 1 });
    expect(auditPage.items).toEqual([
      expect.objectContaining({
        actorName: actor.displayName,
        action: expect.stringMatching(/^task\./),
      }),
    ]);
    expect(auditPage.pageInfo).toMatchObject({ limit: 1, offset: 0, hasNext: true });
    expect(auditPage.pageInfo.total).toBeGreaterThan(1);

    const bulkUpdated = await tasks.bulkUpdateTasks({
      items: [
        { id: first.id, rowVersion: first.row_version },
        { id: second.id, rowVersion: automated.row_version },
      ],
      changes: { priority: 'high', status: 'in_progress' },
      requestId: 'tasks-bulk-update',
    });
    expect(bulkUpdated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, priority: 'high', status: 'in_progress' }),
        expect.objectContaining({ id: second.id, priority: 'high', status: 'in_progress' }),
      ]),
    );
    await expect(tasks.getTask(first.id)).resolves.toMatchObject({
      change_history: expect.arrayContaining([
        expect.objectContaining({
          action: 'task.updated',
          changes: expect.arrayContaining([
            { field: 'priority', from: 'medium', to: 'high', changed: true },
          ]),
        }),
      ]),
    });
    await expect(
      tasks.listTasks({ query: 'DEPEND-1', priority: 'high', limit: 1, offset: 0 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: first.id, task_key: 'DEPEND-1' })],
      pageInfo: { limit: 1, offset: 0, total: 1, hasNext: false },
    });
    await expect(tasks.listTasks({ limit: 2, offset: 2 })).resolves.toMatchObject({
      items: expect.any(Array),
      pageInfo: { limit: 2, offset: 2, total: 8, hasNext: true },
    });
    const firstBulkResult = bulkUpdated.find((task) => task.id === first.id)!;
    await expect(
      tasks.bulkUpdateTasks({
        items: [{ id: first.id, rowVersion: firstBulkResult.row_version }],
        changes: { priority: 'high' },
        requestId: 'tasks-bulk-noop',
      }),
    ).resolves.toMatchObject([{ id: first.id, row_version: firstBulkResult.row_version }]);
    await expect(
      tasks.bulkUpdateTasks({
        items: [
          { id: first.id, rowVersion: first.row_version },
          { id: third.id, rowVersion: third.row_version },
        ],
        changes: { status: 'done' },
        requestId: 'tasks-bulk-conflict',
      }),
    ).rejects.toMatchObject({ code: 'TASK_BULK_VERSION_CONFLICT' });
    await expect(tasks.getTask(third.id)).resolves.toMatchObject({ status: 'todo' });

    const filter = await tasks.createSavedFilter({
      name: 'Urgent work',
      config: { query: '', assignee: 'mine', priority: 'high', view: 'board' },
      requestId: 'task-filter-create',
    });
    await expect(tasks.listSavedFilterPage()).resolves.toMatchObject({
      items: [
        {
          id: filter.id,
          name: 'Urgent work',
          visibility: 'personal',
          favorite: true,
          is_owner: true,
          config: { priority: 'high' },
        },
      ],
      pageInfo: { total: 1, hasNext: false },
    });
    await expect(
      tasks.createSavedFilter({
        name: 'urgent WORK',
        config: { query: '', assignee: 'all', priority: 'all', view: 'board' },
        requestId: 'task-filter-conflict',
      }),
    ).rejects.toMatchObject({ code: 'TASK_FILTER_NAME_CONFLICT' });

    const sharedFilter = await tasks.createSavedFilter({
      name: 'Team urgent work',
      visibility: 'project',
      config: { query: 'fixture', assignee: 'all', priority: 'high', view: 'board' },
      requestId: 'task-filter-shared-create',
    });
    const filterViewerId = '019fbcf9-e020-71da-935a-6a6a728b3780';
    await pool.query(
      `insert into users (id,email,display_name,password_hash)
       values ($1,'filter-viewer@example.com','Filter Viewer','not-used')`,
      [filterViewerId],
    );
    await pool.query(
      `insert into memberships (id,organization_id,user_id,role,created_by)
       values ('019fbcf9-e020-71da-935a-6a6a728b3781',$1,$2,'viewer',$3)`,
      [organizationId, filterViewerId, actorId],
    );
    const filterViewer: ActorSession = {
      ...actor,
      actorId: filterViewerId,
      role: 'viewer',
      email: 'filter-viewer@example.com',
      displayName: 'Filter Viewer',
    };
    const viewerTasks = await ScopedTaskRepository.open(
      pool,
      filterViewer,
      workspace.id,
      project.id,
    );
    await expect(
      viewerTasks.listSavedFilterPage({ query: actor.displayName, limit: 1 }),
    ).resolves.toMatchObject({
      items: [
        {
          id: sharedFilter.id,
          visibility: 'project',
          favorite: false,
          is_owner: false,
          owner_name: actor.displayName,
        },
      ],
      pageInfo: { limit: 1, offset: 0, total: 1, hasNext: false },
    });
    await expect(viewerTasks.getSavedFilter(sharedFilter.id)).resolves.toMatchObject({
      id: sharedFilter.id,
      visibility: 'project',
      is_owner: false,
    });
    await expect(
      viewerTasks.setSavedFilterFavorite(sharedFilter.id, true, 'task-filter-favorite'),
    ).resolves.toEqual({ favorite: true });
    await expect(viewerTasks.listSavedFilterPage()).resolves.toMatchObject({
      items: [{ id: sharedFilter.id, favorite: true }],
    });
    await expect(
      viewerTasks.updateSavedFilter(sharedFilter.id, {
        name: 'Hijacked filter',
        visibility: 'project',
        config: sharedFilter.config,
        requestId: 'task-filter-cross-user-update',
      }),
    ).rejects.toMatchObject({ code: 'TASK_FILTER_NOT_FOUND' });

    await tasks.deleteSavedFilter(filter.id, 'task-filter-delete');
    await tasks.deleteSavedFilter(sharedFilter.id, 'task-filter-shared-delete');
    await expect(tasks.listSavedFilterPage()).resolves.toMatchObject({
      items: [],
      pageInfo: { total: 0, hasNext: false },
    });
    await expect(viewerTasks.listSavedFilterPage()).resolves.toMatchObject({
      items: [],
      pageInfo: { total: 0, hasNext: false },
    });

    const files = await ScopedFileDatasetRepository.open(pool, actor, workspace.id, project.id);
    const issuedAttachment = await files.issueUpload({
      fileId: '019fbcf9-e020-71da-935a-6a6a728b37a0',
      uploadId: '019fbcf9-e020-71da-935a-6a6a728b37a1',
      seriesName: 'Fixture evidence',
      originalName: 'fixture-report.pdf',
      contentType: 'application/pdf',
      sizeBytes: 12_345,
      checksum: 'a'.repeat(64),
      stagingObjectKey: 'staging/task-attachment-fixture',
      finalObjectKey: 'committed/task-attachment-fixture',
      expiresAt: new Date(Date.now() + 60_000),
      requestId: 'task-attachment-upload',
    });
    await files.beginFinalization(issuedAttachment.uploadId);
    await files.completeFinalization(
      issuedAttachment.uploadId,
      'storage-version-1',
      'task-attachment-finalize',
    );
    const attachedFile = await tasks.addFileLink(
      first.id,
      issuedAttachment.fileId,
      'task-attachment-link',
    );
    expect(attachedFile).toMatchObject({
      links: [
        expect.objectContaining({
          entity_type: 'file',
          entity_id: issuedAttachment.fileId,
          title: 'fixture-report.pdf',
          content_type: 'application/pdf',
          size_bytes: 12_345,
          file_series_name: 'Fixture evidence',
          file_version_number: 1,
          file_status: 'available',
        }),
      ],
    });
    const fileLink = attachedFile.links[0]!;
    const duplicateAttachment = await tasks.addFileLink(
      first.id,
      issuedAttachment.fileId,
      'task-attachment-idempotent',
    );
    expect(duplicateAttachment.links).toHaveLength(1);
    const removedAttachment = await tasks.removeLink(
      first.id,
      fileLink.id,
      'task-attachment-unlink',
    );
    expect(removedAttachment.links).toEqual([]);
    const reattachedFile = await tasks.addFileLink(
      first.id,
      issuedAttachment.fileId,
      'task-attachment-relink',
    );
    expect(reattachedFile.links).toEqual([expect.objectContaining({ entity_type: 'file' })]);
    expect(reattachedFile.links[0]!.id).not.toBe(fileLink.id);
    expect(reattachedFile.link_history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'task.link_added', title: 'fixture-report.pdf' }),
        expect.objectContaining({
          action: 'task.link_removed',
          entity_id: issuedAttachment.fileId,
        }),
      ]),
    );
    await tasks.removeLink(first.id, reattachedFile.links[0]!.id, 'task-attachment-final-unlink');
    await expect(
      tasks.addFileLink(
        first.id,
        '019fbcf9-e020-71da-935a-6a6a728b37af',
        'task-attachment-missing',
      ),
    ).rejects.toMatchObject({ code: 'TASK_FILE_NOT_AVAILABLE', status: 400 });

    const linkedEvidence = await tasks.addExternalLink({
      taskId: first.id,
      title: 'Supplier qualification report',
      provider: 'supplier.example',
      url: 'https://supplier.example/reports/qualification-42',
      externalId: '',
      version: '',
      observedOn: '2026-08-09',
      notes: '',
      requestId: 'task-evidence-link',
    });
    expect(linkedEvidence).toMatchObject({
      links: [
        expect.objectContaining({
          entity_type: 'external_source',
          title: 'Supplier qualification report',
          provider: 'supplier.example',
          url: 'https://supplier.example/reports/qualification-42',
          observed_on: '2026-08-09',
        }),
      ],
      link_history: expect.arrayContaining([
        expect.objectContaining({
          action: 'task.link_added',
          changed_by_name: actor.displayName,
          title: 'Supplier qualification report',
        }),
      ]),
    });
    const evidenceLink = linkedEvidence.links[0]!;
    const evidenceSourceId = evidenceLink.entity_id;
    const unlinkedEvidence = await tasks.removeLink(
      first.id,
      evidenceLink.id,
      'task-evidence-unlink',
    );
    expect(unlinkedEvidence.links).toEqual([]);
    expect(unlinkedEvidence.link_history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'task.link_added', entity_id: evidenceSourceId }),
        expect.objectContaining({ action: 'task.link_removed', entity_id: evidenceSourceId }),
      ]),
    );
    await expect(
      pool.query('select id from external_sources where project_id=$1 and id=$2', [
        project.id,
        evidenceSourceId,
      ]),
    ).resolves.toMatchObject({ rowCount: 1 });

    await tasks.addRelationship({
      taskId: first.id,
      relatedTaskId: second.id,
      type: 'blocks',
      requestId: 'relationship-first-second',
    });
    await tasks.addRelationship({
      taskId: second.id,
      relatedTaskId: third.id,
      type: 'blocks',
      requestId: 'relationship-second-third',
    });

    await expect(
      tasks.addRelationship({
        taskId: third.id,
        relatedTaskId: first.id,
        type: 'blocks',
        requestId: 'relationship-cycle',
      }),
    ).rejects.toMatchObject({ code: 'TASK_RELATIONSHIP_CYCLE', status: 409 });
    await expect(tasks.getTask(second.id)).resolves.toMatchObject({
      open_blocker_count: 1,
      relationships: expect.arrayContaining([
        expect.objectContaining({
          related_task_id: first.id,
          related_task_key: 'DEPEND-1',
          direction: 'inward',
        }),
        expect.objectContaining({
          related_task_id: third.id,
          related_task_key: 'DEPEND-3',
          direction: 'outward',
        }),
      ]),
    });
  });

  it('pages and searches external traceability links with exact lifecycle totals', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Traceability workspace',
      slug: 'traceability-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Qualification project',
      key: 'TRACE',
      requestId: 'project-create',
    });
    const sources = await ScopedSourceRepository.open(pool, actor, workspace.id, project.id);
    const supplier = await sources.createSource({
      title: 'Supplier qualification report',
      provider: 'SharePoint',
      url: 'https://sharepoint.example/qualification',
      externalId: 'DOC-1842',
      version: 'Rev 4',
      observedOn: '2026-08-06',
      notes: 'Approved evidence',
      requestId: 'source-create-supplier',
    });
    await sources.createSource({
      title: 'Test evidence',
      provider: 'LIMS',
      url: 'https://lims.example/runs/42',
      externalId: 'RUN-42',
      version: '1',
      observedOn: '2026-08-07',
      notes: 'Force sweep',
      requestId: 'source-create-test',
    });
    await sources.createSource({
      title: 'Supplier approval ticket',
      provider: 'SharePoint',
      url: 'https://sharepoint.example/approval',
      externalId: 'DOC-1843',
      version: 'Rev 1',
      observedOn: '2026-08-08',
      notes: '',
      requestId: 'source-create-approval',
    });

    await expect(
      sources.listSources({ query: 'Supplier', limit: 1, offset: 0 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ title: 'Supplier approval ticket' })],
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
      summary: { providerCount: 1 },
    });
    await sources.setArchived(supplier.id as string, true, 'Superseded', 'source-archive');
    await expect(
      sources.listSources({ archiveState: 'archived', provider: 'sharepoint' }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: supplier.id })],
      pageInfo: { total: 1, hasNext: false },
      summary: { providerCount: 1 },
    });
    await expect(sources.listSources({ limit: 2, offset: 2 })).resolves.toMatchObject({
      items: [],
      pageInfo: { limit: 2, offset: 2, total: 2, hasNext: false },
    });
  });

  it('pages the exact review inbox and keeps queue summaries independent of the page', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Review workspace',
      slug: 'review-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Review project',
      key: 'REVIEW',
      requestId: 'project-create',
    });
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const objectType = await data.createObjectType({
      name: 'Certificate',
      pluralName: 'Certificates',
      key: 'certificate',
      requestId: 'object-create',
    });
    const record = await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Calibration certificate',
      values: {},
      requestId: 'record-create',
    });
    const eligibleReviewerId = '019fbcf9-e020-71da-935a-6a6a728b3794';
    const viewerId = '019fbcf9-e020-71da-935a-6a6a728b3795';
    await pool.query(
      `insert into users (id,email,display_name,password_hash) values
       ($1,'qa-reviewer@example.com','QA_100% Reviewer','not-used'),
       ($2,'review-viewer@example.com','Review Viewer','not-used')`,
      [eligibleReviewerId, viewerId],
    );
    await pool.query(
      `insert into memberships (id,organization_id,user_id,role,created_by) values
       ('019fbcf9-e020-71da-935a-6a6a728b3796',$1,$2,'reviewer',$4),
       ('019fbcf9-e020-71da-935a-6a6a728b3797',$1,$3,'viewer',$4)`,
      [organizationId, eligibleReviewerId, viewerId, actorId],
    );
    const reviews = await RecordReviewRepository.open(pool, actor, workspace.id, project.id);
    await expect(
      reviews.listParticipantPage({ query: 'QA_100%', reviewerOnly: true, limit: 1 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: eligibleReviewerId, role: 'reviewer' })],
      pageInfo: { limit: 1, offset: 0, total: 1, hasNext: false },
      overallTotal: 2,
    });
    const discussion = await reviews.createThread({
      objectTypeId: objectType.id,
      recordId: record.id,
      subject: 'Certificate traceability',
      body: 'Confirm the calibration certificate revision.',
      mentionedUserIds: [viewerId],
      requestId: 'review-discussion',
    });
    expect(discussion.messages[0]).toMatchObject({
      mentionedUserIds: [viewerId],
      mentionedUsers: [{ id: viewerId, displayName: 'Review Viewer' }],
    });
    const requested = await reviews.createThread({
      objectTypeId: objectType.id,
      recordId: record.id,
      subject: 'Release gate',
      body: 'Approve this record for release.',
      reviewerId: actor.actorId,
      requestId: 'review-request',
    });
    await expect(
      reviews.createThread({
        objectTypeId: objectType.id,
        recordId: record.id,
        subject: 'Invalid reviewer',
        body: 'A viewer cannot decide this request.',
        reviewerId: viewerId,
        requestId: 'invalid-review-request',
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_REVIEWER_INELIGIBLE', status: 400 });

    const first = await reviews.listInboxPage({ limit: 1, offset: 0 });
    const second = await reviews.listInboxPage({ limit: 1, offset: 1 });
    expect(first).toMatchObject({
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
      summary: { waitingForMe: 1, openInvolved: 2 },
    });
    expect(second).toMatchObject({
      pageInfo: { limit: 1, offset: 1, total: 2, hasNext: false },
      summary: { waitingForMe: 1, openInvolved: 2 },
    });
    expect(new Set([...first.items, ...second.items].map((item) => item.id))).toEqual(
      new Set([discussion.id, requested.id]),
    );
    await expect(reviews.listInboxPage({ query: 'Confirm', limit: 10 })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: discussion.id })],
      pageInfo: { limit: 10, offset: 0, total: 1, hasNext: false },
      summary: { waitingForMe: 1, openInvolved: 2 },
    });

    await pool.query(
      `insert into record_review_messages
         (id,thread_id,author_id,body,mentioned_user_ids,created_at)
       select gen_random_uuid(),$1,$2,'Follow-up '||sequence,'[]'::jsonb,
              now()+(sequence||' milliseconds')::interval
       from generate_series(1,21) sequence`,
      [discussion.id, actorId],
    );
    const threadPage = await reviews.listThreadPage(objectType.id, record.id, {
      includeResolved: true,
      limit: 1,
    });
    expect(threadPage).toMatchObject({
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
      summary: { open: 2, resolved: 0 },
    });
    const discussionPage = await reviews.listThreadPage(objectType.id, record.id, {
      includeResolved: true,
      threadId: discussion.id,
      limit: 1,
    });
    expect(discussionPage.items[0]).toMatchObject({
      id: discussion.id,
      messagePageInfo: { limit: 20, offset: 0, total: 22, hasNext: true },
    });
    expect(discussionPage.items[0]?.messages).toHaveLength(20);
    await expect(
      reviews.listMessagePage(discussion.id, { limit: 20, offset: 20 }),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ body: 'Confirm the calibration certificate revision.' }),
      ]),
      pageInfo: { limit: 20, offset: 20, total: 22, hasNext: false },
    });

    await reviews.resolve(discussion.id, 'review-resolve');
    await expect(
      reviews.listThreadPage(objectType.id, record.id, { includeResolved: false }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: requested.id })],
      pageInfo: { limit: 20, offset: 0, total: 1, hasNext: false },
      summary: { open: 1, resolved: 1 },
    });
  });

  it('creates idempotent record batches and rolls back bulk updates on any version conflict', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Batch workspace',
      slug: 'batch-workspace',
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
      name: 'Sample',
      pluralName: 'Samples',
      key: 'sample',
      requestId: 'object-create',
    });
    await data.createField({
      objectTypeId: objectType.id,
      name: 'Serial',
      key: 'serial',
      fieldType: 'text',
      required: true,
      unique: true,
      position: 0,
      config: {},
      requestId: 'field-create',
    });
    const batch = {
      objectTypeId: objectType.id,
      items: [
        { displayName: 'Sample A', values: { serial: 'SN-A' } },
        { displayName: 'Sample B', values: { serial: 'SN-B' } },
      ],
      idempotencyKey: 'integration-batch-001',
      requestId: 'batch-create',
    };

    const created = await data.createRecordsBulk(batch);
    expect(created).toMatchObject({
      created: [
        { id: expect.any(String), rowVersion: 1 },
        { id: expect.any(String), rowVersion: 1 },
      ],
      idempotentReplay: false,
    });
    await expect(data.createRecordsBulk(batch)).resolves.toEqual({
      ...created,
      idempotentReplay: true,
    });
    await expect(
      data.createRecordsBulk({
        ...batch,
        items: [{ displayName: 'Different payload', values: { serial: 'SN-C' } }],
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });

    const records = await data.queryRecords(objectType.id, {
      sorts: [{ systemField: 'displayName', direction: 'asc' }],
    });
    expect(records.total).toBe(2);
    const first = records.items[0]!;
    const second = records.items[1]!;
    await expect(
      data.updateRecordsBulk({
        objectTypeId: objectType.id,
        items: [
          {
            recordId: first.id,
            displayName: 'Changed A',
            values: { serial: 'SN-A' },
            rowVersion: first.rowVersion,
          },
          {
            recordId: second.id,
            displayName: 'Changed B',
            values: { serial: 'SN-B' },
            rowVersion: second.rowVersion + 10,
          },
        ],
        requestId: 'batch-update-conflict',
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    await expect(data.getRecord(objectType.id, first.id)).resolves.toMatchObject({
      displayName: 'Sample A',
      rowVersion: 1,
    });

    await expect(
      data.updateRecordsBulk({
        objectTypeId: objectType.id,
        items: [
          {
            recordId: second.id,
            displayName: 'Changed B',
            values: { serial: 'SN-B' },
            rowVersion: second.rowVersion,
          },
          {
            recordId: first.id,
            displayName: 'Changed A',
            values: { serial: 'SN-A' },
            rowVersion: first.rowVersion,
          },
        ],
        requestId: 'batch-update',
      }),
    ).resolves.toMatchObject({
      updated: expect.arrayContaining([
        { id: first.id, rowVersion: 2 },
        { id: second.id, rowVersion: 2 },
      ]),
    });
    await expect(
      data.listRecordHistoryPage(objectType.id, first.id, { limit: 1, offset: 0 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ action: 'record.updated', undoable: true })],
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
    });
    await expect(
      data.listRecordHistoryPage(objectType.id, first.id, { limit: 1, offset: 1 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ action: 'record.created', undoable: false })],
      pageInfo: { limit: 1, offset: 1, total: 2, hasNext: false },
    });

    const recordMentionId = '019fbcf9-e020-71da-935a-6a6a728b3799';
    await pool.query(
      `insert into users (id,email,display_name,password_hash)
       values ($1,'record-mention@example.com','Record Reviewer','not-used')`,
      [recordMentionId],
    );
    await pool.query(
      `insert into memberships (id,organization_id,user_id,role,created_by)
       values ('019fbcf9-e020-71da-935a-6a6a728b3798',$1,$2,'reviewer',$3)`,
      [organizationId, recordMentionId, actorId],
    );
    const comment = await data.addRecordComment({
      objectTypeId: objectType.id,
      recordId: first.id,
      body: 'Verify the supplier certificate.',
      mentionedUserIds: [recordMentionId],
      requestId: 'record-comment-add',
    });
    expect(comment).toMatchObject({
      authorId: actor.actorId,
      authorName: actor.displayName,
      body: 'Verify the supplier certificate.',
      mentionedUserIds: [recordMentionId],
      mentionedUsers: [{ id: recordMentionId, displayName: 'Record Reviewer' }],
      rowVersion: 1,
      editedAt: null,
    });
    const mentionNotifications = await listNotifications(pool, {
      ...actor,
      actorId: recordMentionId,
      role: 'reviewer',
      email: 'record-mention@example.com',
      displayName: 'Record Reviewer',
    });
    expect(mentionNotifications).toMatchObject({
      unreadCount: 1,
      items: [
        {
          type: 'record.mentioned',
          taskId: null,
          taskTitle: null,
          objectTypeId: objectType.publicId,
          recordId: first.id,
          recordTitle: 'Changed A',
          payload: { commentId: comment.id },
        },
      ],
    });
    await expect(
      data.listRecordCommentPage(objectType.id, first.id, { limit: 1 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: comment.id })],
      pageInfo: { limit: 1, offset: 0, total: 1, hasNext: false },
    });
    const editedComment = await data.updateRecordComment({
      objectTypeId: objectType.id,
      recordId: first.id,
      commentId: comment.id,
      body: 'Supplier certificate verified.',
      rowVersion: comment.rowVersion,
      requestId: 'record-comment-edit',
    });
    expect(editedComment).toMatchObject({
      body: 'Supplier certificate verified.',
      rowVersion: 2,
      editedAt: expect.any(String),
    });
    await expect(
      data.updateRecordComment({
        objectTypeId: objectType.id,
        recordId: first.id,
        commentId: comment.id,
        body: 'Stale overwrite.',
        rowVersion: comment.rowVersion,
        requestId: 'record-comment-stale',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_COMMENT_VERSION_CONFLICT', status: 409 });
    await expect(
      data.listRecordHistoryPage(objectType.id, first.id, { limit: 2, offset: 0 }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({ action: 'record.comment_edited', undoable: false }),
        expect.objectContaining({ action: 'record.comment_added', undoable: false }),
      ],
      pageInfo: { limit: 2, offset: 0, total: 4, hasNext: true },
    });

    await expect(
      data.setRecordsArchivedBulk({
        objectTypeId: objectType.id,
        recordIds: [second.id, first.id],
        archived: true,
        reason: 'Batch lifecycle test',
        requestId: 'batch-archive',
      }),
    ).resolves.toEqual({
      updated: [
        { id: second.id, rowVersion: 3 },
        { id: first.id, rowVersion: 3 },
      ],
      archived: true,
    });
    await expect(
      data.queryRecords(objectType.id, { archiveState: 'active' }),
    ).resolves.toMatchObject({ total: 0, items: [] });
    await expect(
      data.queryRecords(objectType.id, { archiveState: 'archived' }),
    ).resolves.toMatchObject({ total: 2 });
    await expect(
      data.addRecordComment({
        objectTypeId: objectType.id,
        recordId: first.id,
        body: 'Should not be accepted.',
        requestId: 'record-comment-archived',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACTIVE', status: 409 });
    await expect(
      data.updateRecordsBulk({
        objectTypeId: objectType.id,
        items: [
          {
            recordId: first.id,
            displayName: 'Archived edit',
            values: { serial: 'SN-A' },
            rowVersion: 3,
          },
        ],
        requestId: 'batch-update-archived',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_ARCHIVED', status: 409 });

    await data.setRecordsArchivedBulk({
      objectTypeId: objectType.id,
      recordIds: [second.id],
      archived: false,
      requestId: 'batch-restore-second',
    });
    await expect(
      data.setRecordsArchivedBulk({
        objectTypeId: objectType.id,
        recordIds: [first.id, second.id],
        archived: false,
        requestId: 'batch-restore-conflict',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_STATE_CONFLICT', status: 409 });
    await expect(data.getRecord(objectType.id, first.id)).resolves.toMatchObject({
      archivedAt: expect.any(String),
      rowVersion: 3,
    });
    await expect(data.getRecord(objectType.id, second.id)).resolves.toMatchObject({
      archivedAt: null,
      rowVersion: 4,
    });
    await expect(
      data.setRecordsArchivedBulk({
        objectTypeId: objectType.id,
        recordIds: [first.id],
        archived: false,
        requestId: 'batch-restore-first',
      }),
    ).resolves.toMatchObject({
      updated: [{ id: first.id, rowVersion: 4 }],
      archived: false,
    });
  });

  it('enforces project workflow statuses and directed task transitions', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Workflow workspace',
      slug: 'workflow-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Workflow project',
      key: 'FLOW',
      requestId: 'project-create',
    });
    const workflow = await ScopedTaskWorkflowRepository.open(pool, actor, workspace.id, project.id);
    const tasks = await ScopedTaskRepository.open(pool, actor, workspace.id, project.id);
    const defaults = await workflow.getWorkflow();
    expect(defaults.statuses).toMatchObject([
      { key: 'todo', category: 'todo', initial: true },
      { key: 'in_progress', category: 'in_progress' },
      { key: 'blocked', category: 'in_progress' },
      { key: 'done', category: 'done' },
    ]);

    const withReview = await workflow.createStatus({
      key: 'quality_review',
      name: 'Quality review',
      category: 'in_progress',
      color: 'violet',
      wipLimit: 1,
      requestId: 'status-create',
    });
    const review = withReview.statuses.find((status) => status.key === 'quality_review')!;
    expect(review.wip_limit).toBe(1);
    const withTransition = await workflow.createTransition({
      name: 'Send to quality',
      fromStatus: 'todo',
      toStatus: 'quality_review',
      requestId: 'transition-create',
    });
    const transition = withTransition.transitions.find(
      (item) => item.from_status === 'todo' && item.to_status === 'quality_review',
    )!;
    const task = await tasks.createTask({
      title: 'Inspect release evidence',
      description: '',
      priority: 'medium',
      links: [],
      requestId: 'task-create',
    });
    expect(task.status).toBe('todo');
    const reviewed = await tasks.updateTask(task.id, {
      title: task.title,
      description: task.description,
      status: 'quality_review',
      priority: task.priority,
      rowVersion: task.row_version,
      requestId: 'task-review',
    });
    expect(reviewed.status).toBe('quality_review');
    await expect(workflow.archiveStatus(review.id, 'status-archive')).rejects.toMatchObject({
      code: 'TASK_STATUS_IN_USE',
    });

    await workflow.deleteTransition(transition.id, 'transition-delete');
    const another = await tasks.createTask({
      title: 'Second inspection',
      description: '',
      priority: 'medium',
      links: [],
      requestId: 'task-create-second',
    });
    await expect(
      tasks.updateTask(another.id, {
        title: another.title,
        description: another.description,
        status: 'quality_review',
        priority: another.priority,
        rowVersion: another.row_version,
        requestId: 'task-invalid-transition',
      }),
    ).rejects.toMatchObject({ code: 'TASK_TRANSITION_NOT_ALLOWED', status: 409 });
  });

  it('bulk updates selected record fields atomically without replacing hidden values', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Bulk edit workspace',
      slug: 'bulk-edit-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Bulk edit project',
      key: 'BULK',
      requestId: 'project-create',
    });
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const objectType = await data.createObjectType({
      name: 'Specimen',
      pluralName: 'Specimens',
      key: 'specimen',
      requestId: 'object-create',
    });
    await data.createField({
      objectTypeId: objectType.id,
      name: 'Serial',
      key: 'serial',
      fieldType: 'text',
      required: true,
      config: {},
      requestId: 'field-serial',
    });
    await data.createField({
      objectTypeId: objectType.id,
      name: 'Disposition',
      key: 'disposition',
      fieldType: 'single_select',
      required: false,
      config: {
        options: [
          { key: 'pending', label: 'Pending' },
          { key: 'approved', label: 'Approved' },
        ],
      },
      requestId: 'field-disposition',
    });
    const first = await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Specimen one',
      values: { serial: 'SERIAL-1', disposition: 'pending' },
      requestId: 'record-first',
    });
    const second = await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Specimen two',
      values: { serial: 'SERIAL-2', disposition: 'pending' },
      requestId: 'record-second',
    });

    await expect(
      data.updateRecordFieldsBulk({
        objectTypeId: objectType.id,
        records: [
          { recordId: first.id, rowVersion: first.rowVersion },
          { recordId: second.id, rowVersion: second.rowVersion },
        ],
        changes: [{ fieldKey: 'disposition', operation: 'set', value: 'approved' }],
        requestId: 'bulk-set',
      }),
    ).resolves.toEqual({
      updated: [
        { id: first.id, rowVersion: 2 },
        { id: second.id, rowVersion: 2 },
      ],
    });
    await expect(data.getRecord(objectType.id, first.id)).resolves.toMatchObject({
      values: { serial: 'SERIAL-1', disposition: 'approved' },
    });
    await expect(data.getRecord(objectType.id, second.id)).resolves.toMatchObject({
      values: { serial: 'SERIAL-2', disposition: 'approved' },
    });

    await data.updateRecord({
      objectTypeId: objectType.id,
      recordId: second.id,
      displayName: 'Specimen two changed elsewhere',
      values: { serial: 'SERIAL-2', disposition: 'approved' },
      rowVersion: 2,
      requestId: 'concurrent-update',
    });
    await expect(
      data.updateRecordFieldsBulk({
        objectTypeId: objectType.id,
        records: [
          { recordId: first.id, rowVersion: 2 },
          { recordId: second.id, rowVersion: 2 },
        ],
        changes: [{ fieldKey: 'disposition', operation: 'clear' }],
        requestId: 'bulk-conflict',
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    await expect(data.getRecord(objectType.id, first.id)).resolves.toMatchObject({
      rowVersion: 2,
      values: { serial: 'SERIAL-1', disposition: 'approved' },
    });
  });

  it('previews CSV mappings and safely skips or updates matches by a unique field', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Import workspace',
      slug: 'import-workspace',
      requestId: 'import-workspace-create',
    });
    const project = await ensureWorkspaceDataProject(pool, actor, workspace.id, 'data-context');
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const table = await data.createObjectType({
      name: 'Equipment',
      pluralName: 'Equipment',
      key: 'equipment',
      requestId: 'import-table-create',
    });
    await data.createField({
      objectTypeId: table.id,
      name: 'Serial number',
      key: 'serial-number',
      fieldType: 'text',
      required: true,
      unique: true,
      requestId: 'import-serial-create',
    });
    await data.createField({
      objectTypeId: table.id,
      name: 'Inspection note',
      key: 'inspection-note',
      fieldType: 'text',
      requestId: 'import-note-create',
    });
    const csv = 'Record name,Serial number,Inspection note\nPump A,SN-1,Original note';
    await expect(data.previewRecordsCsv({ objectTypeId: table.id, csv })).resolves.toMatchObject({
      headers: ['Record name', 'Serial number', 'Inspection note'],
      totalRows: 1,
      sampleRows: [{ 'Record name': 'Pump A', 'Serial number': 'SN-1' }],
      suggestedMappings: [
        { sourceHeader: 'Record name', targetFieldKey: 'displayName' },
        { sourceHeader: 'Serial number', targetFieldKey: 'serial-number' },
        { sourceHeader: 'Inspection note', targetFieldKey: 'inspection-note' },
      ],
    });
    const mappings = [
      { sourceHeader: 'Record name', targetFieldKey: 'displayName' },
      { sourceHeader: 'Serial number', targetFieldKey: 'serial-number' },
      { sourceHeader: 'Inspection note', targetFieldKey: 'inspection-note' },
    ];
    const created = await data.importRecordsCsv({
      objectTypeId: table.id,
      csv,
      mappings,
      duplicateStrategy: 'allow',
      idempotencyKey: 'csv-import-create-001',
      requestId: 'csv-import-create',
    });
    expect(created).toMatchObject({ created: 1, updated: 0, skipped: 0, failed: 0 });

    const skipped = await data.importRecordsCsv({
      objectTypeId: table.id,
      csv: 'Record name,Serial number,Inspection note\nIgnored name,SN-1,Ignored note\nPump B,SN-2,New',
      mappings,
      duplicateStrategy: 'skip',
      uniqueFieldKey: 'serial-number',
      idempotencyKey: 'csv-import-skip-001',
      requestId: 'csv-import-skip',
    });
    expect(skipped).toMatchObject({ created: 1, updated: 0, skipped: 1, failed: 0 });

    const updated = await data.importRecordsCsv({
      objectTypeId: table.id,
      csv: 'Name,Serial\nPump A revised,SN-1',
      mappings: [
        { sourceHeader: 'Name', targetFieldKey: 'displayName' },
        { sourceHeader: 'Serial', targetFieldKey: 'serial-number' },
      ],
      duplicateStrategy: 'update',
      uniqueFieldKey: 'serial-number',
      idempotencyKey: 'csv-import-update-001',
      requestId: 'csv-import-update',
    });
    expect(updated).toMatchObject({ created: 0, updated: 1, skipped: 0, failed: 0 });
    await expect(
      data.importRecordsCsv({
        objectTypeId: table.id,
        csv: 'Name,Serial\nPump A revised,SN-1',
        mappings: [
          { sourceHeader: 'Name', targetFieldKey: 'displayName' },
          { sourceHeader: 'Serial', targetFieldKey: 'serial-number' },
        ],
        duplicateStrategy: 'update',
        uniqueFieldKey: 'serial-number',
        idempotencyKey: 'csv-import-update-001',
        requestId: 'csv-import-update-retry',
      }),
    ).resolves.toMatchObject({ updated: 1, idempotentReplay: true });
    await expect(data.queryRecords(table.id, {})).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          displayName: 'Pump A revised',
          values: { 'serial-number': 'SN-1', 'inspection-note': 'Original note' },
        }),
      ]),
      total: 2,
    });
  });

  it('queues private idempotent record exports and completes them with expiring artifacts', async () => {
    const workspace = await createWorkspace(pool, actor, {
      name: 'Export workspace',
      slug: 'export-workspace',
      requestId: 'workspace-create',
    });
    const project = await createProject(pool, actor, {
      workspaceId: workspace.id,
      name: 'Export project',
      key: 'EXPORT',
      requestId: 'project-create',
    });
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, project.id);
    const objectType = await data.createObjectType({
      name: 'Sample',
      pluralName: 'Samples',
      key: 'sample',
      requestId: 'object-create',
    });
    await data.createField({
      objectTypeId: objectType.id,
      name: 'Serial',
      key: 'serial',
      fieldType: 'text',
      required: true,
      config: {},
      requestId: 'field-create',
    });
    await data.createRecord({
      objectTypeId: objectType.id,
      displayName: 'Sample one',
      values: { serial: 'A-1' },
      requestId: 'record-create',
    });

    const requested = await data.requestRecordExport(
      objectType.id,
      'export-request',
      'idempotency-export-1',
      { fields: ['serial'], search: 'Sample', archiveState: 'active' },
    );
    const replayed = await data.requestRecordExport(
      objectType.id,
      'export-replay',
      'idempotency-export-1',
      { fields: ['serial'], search: 'Sample', archiveState: 'active' },
    );
    expect(replayed.id).toBe(requested.id);
    await expect(
      data.requestRecordExport(objectType.id, 'export-conflict', 'idempotency-export-1', {
        fields: ['serial'],
        search: 'Different',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });

    const claimed = await claimRecordExportJob(pool, 'integration-worker');
    expect(claimed).toMatchObject({ id: requested.id, entity_id: objectType.id });
    const objectKey = `committed/${project.id}/record-exports/${requested.id}/${claimed!.attemptId}/records.csv`;
    await pool.query(`update background_job_attempts set result_checkpoint=$2::jsonb where id=$1`, [
      claimed!.attemptId,
      JSON.stringify({ artifact: { objectKey, fileName: 'sample.csv' } }),
    ]);
    const files = await ScopedFileDatasetRepository.open(pool, actor, workspace.id, project.id);
    await expect(files.storageCleanupProtection(60)).resolves.toMatchObject({
      protectedCommittedKeys: expect.arrayContaining([objectKey]),
    });
    await expect(
      files.storageCleanupCandidateDeletable(objectKey, 'unreferenced-committed', 60),
    ).resolves.toBe(false);
    await completeRecordExportJob(pool, {
      jobId: claimed!.id,
      attemptId: claimed!.attemptId,
      workerId: 'integration-worker',
      projectId: project.id,
      objectTypeId: objectType.id,
      requestedBy: actorId,
      artifact: {
        objectKey,
        storageVersionId: 'version-1',
        checksum: 'a'.repeat(64),
        sizeBytes: 42,
        rowCount: 1,
        fieldCount: 1,
        fileName: 'sample.csv',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    await expect(data.getRecordExport(objectType.id, requested.id)).resolves.toMatchObject({
      status: 'succeeded',
      rowCount: 1,
      fieldCount: 1,
      downloadReady: true,
    });
    await expect(data.getRecordExportArtifact(objectType.id, requested.id)).resolves.toMatchObject({
      sizeBytes: 42,
      fileName: 'sample.csv',
    });
    await expect(files.storageCleanupProtection(60)).resolves.toMatchObject({
      protectedCommittedKeys: expect.arrayContaining([objectKey]),
    });

    const otherActorId = '019fbcf9-e020-71da-935a-6a6a728b3798';
    await pool.query(
      `insert into users (id,email,display_name,password_hash)
       values ($1,'other-exporter@example.com','Other exporter','not-used')`,
      [otherActorId],
    );
    await pool.query(
      `insert into memberships (id,organization_id,user_id,role,created_by)
       values ('019fbcf9-e020-71da-935a-6a6a728b3799',$1,$2,'contributor',$3)`,
      [organizationId, otherActorId, actorId],
    );
    const otherData = await ScopedProjectRepository.open(
      pool,
      { ...actor, actorId: otherActorId, email: 'other-exporter@example.com' },
      workspace.id,
      project.id,
    );
    await expect(
      otherData.listRecordExports(objectType.id, { limit: 10, offset: 0 }),
    ).resolves.toEqual({
      items: [],
      pageInfo: { limit: 10, offset: 0, total: 0, hasNext: false },
    });
    await expect(otherData.getRecordExport(objectType.id, requested.id)).rejects.toMatchObject({
      code: 'RECORD_EXPORT_NOT_FOUND',
      status: 404,
    });
  });
});
