import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { appendAudit, type ActorSession } from './community.js';
import { RepositoryError } from './errors.js';

export type WorkspaceVisibility = 'organization' | 'restricted';
export type ProjectVisibility = 'workspace' | 'restricted';

export interface AccessMember {
  id: string;
  displayName: string;
  email: string;
}

export interface AccessGroup {
  id: string;
  name: string;
  color: string;
}

export interface ResourceAccessPolicy<TVisibility extends string> {
  visibility: TVisibility;
  accessVersion: number;
  members: AccessMember[];
  groups: AccessGroup[];
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin isolation level serializable');
    const result = await action(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function assertWorkspaceVisible(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
): Promise<void> {
  const result = await pool.query('select workspace_visible_to($1,$2,$3,$4) visible', [
    workspaceId,
    actor.organizationId,
    actor.actorId,
    actor.role,
  ]);
  if (!result.rows[0]?.visible)
    throw new RepositoryError('WORKSPACE_NOT_FOUND', 404, 'Workspace was not found.');
}

export async function assertProjectVisible(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  const result = await pool.query('select project_visible_to($1,$2,$3,$4,$5) visible', [
    projectId,
    workspaceId,
    actor.organizationId,
    actor.actorId,
    actor.role,
  ]);
  if (!result.rows[0]?.visible)
    throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
}

async function loadSubjects(
  pool: Pool,
  table: 'workspace_access_subjects' | 'project_access_subjects',
  key: 'workspace_id' | 'project_id',
  resourceId: string,
): Promise<{ members: AccessMember[]; groups: AccessGroup[] }> {
  const [members, groups] = await Promise.all([
    pool.query<{ id: string; display_name: string; email: string }>(
      `select users.id,users.display_name,users.email
       from ${table} subject join users on users.id=subject.user_id
       where subject.${key}=$1 and users.disabled_at is null
       order by lower(users.display_name),users.id`,
      [resourceId],
    ),
    pool.query<AccessGroup>(
      `select member_group.id,member_group.name,member_group.color
       from ${table} subject
       join member_groups member_group on member_group.id=subject.group_id
        and member_group.organization_id=subject.organization_id
       where subject.${key}=$1 and member_group.archived_at is null
       order by lower(member_group.name),member_group.id`,
      [resourceId],
    ),
  ]);
  return {
    members: members.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
    })),
    groups: groups.rows,
  };
}

export async function getWorkspaceAccess(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
): Promise<ResourceAccessPolicy<WorkspaceVisibility>> {
  await assertWorkspaceVisible(pool, actor, workspaceId);
  const workspace = await pool.query<{ visibility: WorkspaceVisibility; access_version: number }>(
    'select visibility,access_version from workspaces where id=$1 and organization_id=$2',
    [workspaceId, actor.organizationId],
  );
  if (!workspace.rows[0])
    throw new RepositoryError('WORKSPACE_NOT_FOUND', 404, 'Workspace was not found.');
  return {
    visibility: workspace.rows[0].visibility,
    accessVersion: workspace.rows[0].access_version,
    ...(await loadSubjects(pool, 'workspace_access_subjects', 'workspace_id', workspaceId)),
  };
}

export async function getProjectAccess(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
  projectId: string,
): Promise<ResourceAccessPolicy<ProjectVisibility>> {
  await assertProjectVisible(pool, actor, workspaceId, projectId);
  const project = await pool.query<{ visibility: ProjectVisibility; access_version: number }>(
    'select visibility,access_version from projects where id=$1 and workspace_id=$2 and system=false',
    [projectId, workspaceId],
  );
  if (!project.rows[0])
    throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
  return {
    visibility: project.rows[0].visibility,
    accessVersion: project.rows[0].access_version,
    ...(await loadSubjects(pool, 'project_access_subjects', 'project_id', projectId)),
  };
}

async function validateSubjects(
  client: PoolClient,
  actor: ActorSession,
  userIds: string[],
  groupIds: string[],
): Promise<void> {
  if (
    userIds.length > 100 ||
    groupIds.length > 100 ||
    [...userIds, ...groupIds].some((id) => !uuidPattern.test(id))
  )
    throw new RepositoryError(
      'RESOURCE_ACCESS_SUBJECT_INVALID',
      400,
      'Access subjects must contain at most 100 valid member and group IDs.',
    );
  if (userIds.length) {
    const result = await client.query(
      `select membership.user_id
       from memberships membership join users on users.id=membership.user_id
       where membership.organization_id=$1 and membership.user_id=any($2::uuid[])
         and users.disabled_at is null`,
      [actor.organizationId, userIds],
    );
    if (result.rowCount !== userIds.length)
      throw new RepositoryError(
        'RESOURCE_ACCESS_SUBJECT_INVALID',
        400,
        'Every selected member must be active in this organization.',
      );
  }
  if (groupIds.length) {
    const result = await client.query(
      `select id from member_groups
       where organization_id=$1 and id=any($2::uuid[]) and archived_at is null`,
      [actor.organizationId, groupIds],
    );
    if (result.rowCount !== groupIds.length)
      throw new RepositoryError(
        'RESOURCE_ACCESS_SUBJECT_INVALID',
        400,
        'Every selected group must be active in this organization.',
      );
  }
}

export async function setWorkspaceAccess(
  pool: Pool,
  actor: ActorSession,
  input: {
    workspaceId: string;
    visibility: WorkspaceVisibility;
    userIds: string[];
    groupIds: string[];
    accessVersion: number;
    requestId: string;
  },
): Promise<ResourceAccessPolicy<WorkspaceVisibility>> {
  const userIds = [...new Set(input.userIds)];
  const groupIds = [...new Set(input.groupIds)];
  await transaction(pool, async (client) => {
    await validateSubjects(client, actor, userIds, groupIds);
    const current = await client.query<{ visibility: WorkspaceVisibility }>(
      `select visibility from workspaces
       where id=$1 and organization_id=$2 and access_version=$3 for update`,
      [input.workspaceId, actor.organizationId, input.accessVersion],
    );
    if (!current.rows[0])
      throw new RepositoryError(
        'WORKSPACE_ACCESS_VERSION_CONFLICT',
        409,
        'Workspace access changed or is unavailable.',
      );
    await client.query(
      'update workspaces set visibility=$3,access_version=access_version+1,updated_at=now() where id=$1 and organization_id=$2',
      [input.workspaceId, actor.organizationId, input.visibility],
    );
    await client.query('delete from workspace_access_subjects where workspace_id=$1', [
      input.workspaceId,
    ]);
    for (const userId of userIds)
      await client.query(
        `insert into workspace_access_subjects
         (id,organization_id,workspace_id,user_id,created_by) values ($1,$2,$3,$4,$5)`,
        [uuidv7(), actor.organizationId, input.workspaceId, userId, actor.actorId],
      );
    for (const groupId of groupIds)
      await client.query(
        `insert into workspace_access_subjects
         (id,organization_id,workspace_id,group_id,created_by) values ($1,$2,$3,$4,$5)`,
        [uuidv7(), actor.organizationId, input.workspaceId, groupId, actor.actorId],
      );
    if (input.visibility === 'restricted') {
      await client.query(
        `delete from task_watchers watcher using tasks task,projects project,memberships membership
         where watcher.task_id=task.id and task.project_id=project.id
           and project.workspace_id=$1 and membership.organization_id=$2
           and membership.user_id=watcher.user_id
           and not project_visible_to(project.id,$1,$2,membership.user_id,membership.role::text)`,
        [input.workspaceId, actor.organizationId],
      );
      await client.query(
        `delete from notifications notification using memberships membership
         where notification.workspace_id=$1 and membership.organization_id=$2
           and membership.user_id=notification.recipient_id
           and not project_visible_to(notification.project_id,$1,$2,membership.user_id,membership.role::text)`,
        [input.workspaceId, actor.organizationId],
      );
    }
    await appendAudit(client, {
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
      actorId: actor.actorId,
      action: 'workspace.access_changed',
      targetType: 'workspace',
      targetId: input.workspaceId,
      requestId: input.requestId,
      payload: {
        from: current.rows[0].visibility,
        to: input.visibility,
        memberCount: userIds.length,
        groupCount: groupIds.length,
      },
    });
  });
  return getWorkspaceAccess(pool, actor, input.workspaceId);
}

export async function setProjectAccess(
  pool: Pool,
  actor: ActorSession,
  input: {
    workspaceId: string;
    projectId: string;
    visibility: ProjectVisibility;
    userIds: string[];
    groupIds: string[];
    accessVersion: number;
    requestId: string;
  },
): Promise<ResourceAccessPolicy<ProjectVisibility>> {
  const userIds = [...new Set(input.userIds)];
  const groupIds = [...new Set(input.groupIds)];
  await transaction(pool, async (client) => {
    await validateSubjects(client, actor, userIds, groupIds);
    const current = await client.query<{ visibility: ProjectVisibility }>(
      `select visibility from projects
       where id=$1 and workspace_id=$2 and system=false and access_version=$3 for update`,
      [input.projectId, input.workspaceId, input.accessVersion],
    );
    if (!current.rows[0])
      throw new RepositoryError(
        'PROJECT_ACCESS_VERSION_CONFLICT',
        409,
        'Project access changed or is unavailable.',
      );
    await client.query(
      'update projects set visibility=$3,access_version=access_version+1,updated_at=now() where id=$1 and workspace_id=$2',
      [input.projectId, input.workspaceId, input.visibility],
    );
    await client.query('delete from project_access_subjects where project_id=$1', [
      input.projectId,
    ]);
    for (const userId of userIds)
      await client.query(
        `insert into project_access_subjects
         (id,organization_id,workspace_id,project_id,user_id,created_by) values ($1,$2,$3,$4,$5,$6)`,
        [uuidv7(), actor.organizationId, input.workspaceId, input.projectId, userId, actor.actorId],
      );
    for (const groupId of groupIds)
      await client.query(
        `insert into project_access_subjects
         (id,organization_id,workspace_id,project_id,group_id,created_by) values ($1,$2,$3,$4,$5,$6)`,
        [
          uuidv7(),
          actor.organizationId,
          input.workspaceId,
          input.projectId,
          groupId,
          actor.actorId,
        ],
      );
    if (input.visibility === 'restricted') {
      await client.query(
        `delete from task_watchers watcher using tasks task,memberships membership
         where watcher.task_id=task.id and task.project_id=$1
           and membership.organization_id=$2 and membership.user_id=watcher.user_id
           and not project_visible_to($1,$3,$2,membership.user_id,membership.role::text)`,
        [input.projectId, actor.organizationId, input.workspaceId],
      );
      await client.query(
        `delete from notifications notification using memberships membership
         where notification.project_id=$1 and membership.organization_id=$2
           and membership.user_id=notification.recipient_id
           and not project_visible_to($1,$3,$2,membership.user_id,membership.role::text)`,
        [input.projectId, actor.organizationId, input.workspaceId],
      );
    }
    await appendAudit(client, {
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: actor.actorId,
      action: 'project.access_changed',
      targetType: 'project',
      targetId: input.projectId,
      requestId: input.requestId,
      payload: {
        from: current.rows[0].visibility,
        to: input.visibility,
        memberCount: userIds.length,
        groupCount: groupIds.length,
      },
    });
  });
  return getProjectAccess(pool, actor, input.workspaceId, input.projectId);
}
