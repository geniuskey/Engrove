import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';

export type TaskStatusCategory = 'todo' | 'in_progress' | 'done';
export type TaskStatusColor = 'slate' | 'sky' | 'violet' | 'amber' | 'rose' | 'emerald';

interface Scope {
  actor: ActorSession;
  workspaceId: string;
  projectId: string;
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function initialTaskStatus(client: PoolClient, projectId: string): Promise<string> {
  const result = await client.query<{ key: string }>(
    `select key from task_workflow_statuses
     where project_id=$1 and initial and archived_at is null`,
    [projectId],
  );
  if (!result.rows[0])
    throw new RepositoryError(
      'TASK_WORKFLOW_INITIAL_MISSING',
      409,
      'The project workflow has no initial status.',
    );
  return result.rows[0].key;
}

export async function assertTaskStatus(
  client: PoolClient,
  projectId: string,
  status: string,
): Promise<void> {
  const found = await client.query(
    `select 1 from task_workflow_statuses
     where project_id=$1 and key=$2 and archived_at is null`,
    [projectId, status],
  );
  if (!found.rowCount)
    throw new RepositoryError(
      'TASK_STATUS_INVALID',
      400,
      'Status is not active in this project workflow.',
    );
}

export async function assertTaskTransition(
  client: PoolClient,
  projectId: string,
  fromStatus: string,
  toStatus: string,
): Promise<void> {
  if (fromStatus === toStatus) return;
  const found = await client.query(
    `select 1 from task_workflow_transitions tr
     join task_workflow_statuses destination
       on destination.project_id=tr.project_id and destination.key=tr.to_status
      and destination.archived_at is null
     where tr.project_id=$1 and tr.from_status=$2 and tr.to_status=$3`,
    [projectId, fromStatus, toStatus],
  );
  if (!found.rowCount)
    throw new RepositoryError(
      'TASK_TRANSITION_NOT_ALLOWED',
      409,
      'This workflow does not allow the requested status transition.',
    );
}

export class ScopedTaskWorkflowRepository {
  private constructor(
    private readonly pool: Pool,
    private readonly scope: Scope,
  ) {}

  static async open(pool: Pool, actor: ActorSession, workspaceId: string, projectId: string) {
    const found = await pool.query(
      `select 1 from projects p join workspaces w on w.id=p.workspace_id
       where p.id=$1 and p.workspace_id=$2 and w.organization_id=$3 and p.system=false
         and project_visible_to(p.id,$2,$3,$4,$5)`,
      [projectId, workspaceId, actor.organizationId, actor.actorId, actor.role],
    );
    if (!found.rowCount)
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    return new ScopedTaskWorkflowRepository(pool, { actor, workspaceId, projectId });
  }

  private audit(
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    payload = {},
  ) {
    return {
      organizationId: this.scope.actor.organizationId,
      workspaceId: this.scope.workspaceId,
      projectId: this.scope.projectId,
      actorId: this.scope.actor.actorId,
      action,
      targetType,
      targetId,
      requestId,
      payload,
    };
  }

  async getWorkflow() {
    const [statuses, transitions] = await Promise.all([
      this.pool.query(
        `select s.id,s.key,s.name,s.category,s.color,s.position,s.wip_limit,s.initial,s.row_version,
                count(t.id)::int task_count
         from task_workflow_statuses s
         left join tasks t on t.project_id=s.project_id and t.status=s.key and t.archived_at is null
         where s.project_id=$1 and s.archived_at is null
         group by s.id order by s.position,lower(s.name),s.id`,
        [this.scope.projectId],
      ),
      this.pool.query(
        `select id,name,from_status,to_status,created_at
         from task_workflow_transitions where project_id=$1
         order by from_status,to_status,id`,
        [this.scope.projectId],
      ),
    ]);
    return { statuses: statuses.rows, transitions: transitions.rows };
  }

  async createStatus(input: {
    key: string;
    name: string;
    category: TaskStatusCategory;
    color: TaskStatusColor;
    wipLimit?: number | null | undefined;
    requestId: string;
  }) {
    const statusId = uuidv7();
    try {
      await transaction(this.pool, async (client) => {
        const next = await client.query<{ position: number }>(
          `select coalesce(max(position),-1)::int+1 position from task_workflow_statuses
           where project_id=$1 and archived_at is null`,
          [this.scope.projectId],
        );
        await client.query(
          `insert into task_workflow_statuses
           (id,project_id,key,name,category,color,position,wip_limit,initial,created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,false,$9)`,
          [
            statusId,
            this.scope.projectId,
            input.key,
            input.name,
            input.category,
            input.color,
            next.rows[0]?.position ?? 0,
            input.wipLimit ?? null,
            this.scope.actor.actorId,
          ],
        );
        await appendAudit(
          client,
          this.audit(
            'task_workflow.status_created',
            'task_workflow_status',
            statusId,
            input.requestId,
            {
              key: input.key,
              category: input.category,
              wipLimit: input.wipLimit ?? null,
            },
          ),
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new RepositoryError(
          'TASK_STATUS_KEY_CONFLICT',
          409,
          'A workflow status with this key already exists.',
        );
      throw error;
    }
    return this.getWorkflow();
  }

  async updateStatus(
    statusId: string,
    input: {
      name: string;
      category: TaskStatusCategory;
      color: TaskStatusColor;
      position: number;
      wipLimit: number | null;
      initial: boolean;
      rowVersion: number;
      requestId: string;
    },
  ) {
    await transaction(this.pool, async (client) => {
      if (input.initial)
        await client.query(
          `update task_workflow_statuses set initial=false,updated_at=now()
           where project_id=$1 and initial and archived_at is null and id<>$2`,
          [this.scope.projectId, statusId],
        );
      const updated = await client.query(
        `update task_workflow_statuses
         set name=$4,category=$5,color=$6,position=$7,wip_limit=$8,initial=$9,
             row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and row_version=$3 and archived_at is null returning key`,
        [
          this.scope.projectId,
          statusId,
          input.rowVersion,
          input.name,
          input.category,
          input.color,
          input.position,
          input.wipLimit,
          input.initial,
        ],
      );
      if (!updated.rows[0])
        throw new RepositoryError(
          'TASK_STATUS_VERSION_CONFLICT',
          409,
          'Workflow status changed or is unavailable.',
        );
      if (!input.initial) await initialTaskStatus(client, this.scope.projectId);
      await appendAudit(
        client,
        this.audit(
          'task_workflow.status_updated',
          'task_workflow_status',
          statusId,
          input.requestId,
          {
            key: updated.rows[0].key,
            category: input.category,
            initial: input.initial,
            wipLimit: input.wipLimit,
          },
        ),
      );
    });
    return this.getWorkflow();
  }

  async archiveStatus(statusId: string, requestId: string): Promise<void> {
    await transaction(this.pool, async (client) => {
      const status = await client.query<{ key: string; initial: boolean }>(
        `select key,initial from task_workflow_statuses
         where project_id=$1 and id=$2 and archived_at is null for update`,
        [this.scope.projectId, statusId],
      );
      if (!status.rows[0])
        throw new RepositoryError('TASK_STATUS_NOT_FOUND', 404, 'Workflow status was not found.');
      if (status.rows[0].initial)
        throw new RepositoryError(
          'TASK_STATUS_INITIAL_ARCHIVE_FORBIDDEN',
          409,
          'Choose another initial status before archiving this status.',
        );
      const used = await client.query(
        `select 1 from tasks where project_id=$1 and status=$2 and archived_at is null limit 1`,
        [this.scope.projectId, status.rows[0].key],
      );
      if (used.rowCount)
        throw new RepositoryError(
          'TASK_STATUS_IN_USE',
          409,
          'Move active tasks out of this status before archiving it.',
        );
      const automated = await client.query(
        `select 1 from task_automation_rules where project_id=$1 and archived_at is null and
          (trigger_config->>'fromStatus'=$2 or trigger_config->>'toStatus'=$2 or
           condition_config->>'status'=$2 or action_config->>'status'=$2) limit 1`,
        [this.scope.projectId, status.rows[0].key],
      );
      if (automated.rowCount)
        throw new RepositoryError(
          'TASK_STATUS_AUTOMATION_IN_USE',
          409,
          'Update automation rules that reference this status before archiving it.',
        );
      await client.query(
        `delete from task_workflow_transitions
         where project_id=$1 and (from_status=$2 or to_status=$2)`,
        [this.scope.projectId, status.rows[0].key],
      );
      await client.query(
        `update task_workflow_statuses
         set archived_at=now(),archived_by=$3,updated_at=now(),row_version=row_version+1
         where project_id=$1 and id=$2`,
        [this.scope.projectId, statusId, this.scope.actor.actorId],
      );
      await appendAudit(
        client,
        this.audit('task_workflow.status_archived', 'task_workflow_status', statusId, requestId, {
          key: status.rows[0].key,
        }),
      );
    });
  }

  async createTransition(input: {
    name: string;
    fromStatus: string;
    toStatus: string;
    requestId: string;
  }) {
    const transitionId = uuidv7();
    if (input.fromStatus === input.toStatus)
      throw new RepositoryError(
        'TASK_TRANSITION_SELF_FORBIDDEN',
        400,
        'A status transition must move to a different status.',
      );
    try {
      await transaction(this.pool, async (client) => {
        await assertTaskStatus(client, this.scope.projectId, input.fromStatus);
        await assertTaskStatus(client, this.scope.projectId, input.toStatus);
        await client.query(
          `insert into task_workflow_transitions
           (id,project_id,name,from_status,to_status,created_by) values ($1,$2,$3,$4,$5,$6)`,
          [
            transitionId,
            this.scope.projectId,
            input.name,
            input.fromStatus,
            input.toStatus,
            this.scope.actor.actorId,
          ],
        );
        await appendAudit(
          client,
          this.audit(
            'task_workflow.transition_created',
            'task_workflow_transition',
            transitionId,
            input.requestId,
            {
              from: input.fromStatus,
              to: input.toStatus,
            },
          ),
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new RepositoryError(
          'TASK_TRANSITION_CONFLICT',
          409,
          'This workflow transition already exists.',
        );
      throw error;
    }
    return this.getWorkflow();
  }

  async deleteTransition(transitionId: string, requestId: string): Promise<void> {
    await transaction(this.pool, async (client) => {
      const deleted = await client.query(
        `delete from task_workflow_transitions where project_id=$1 and id=$2
         returning from_status,to_status`,
        [this.scope.projectId, transitionId],
      );
      if (!deleted.rows[0])
        throw new RepositoryError(
          'TASK_TRANSITION_NOT_FOUND',
          404,
          'Workflow transition was not found.',
        );
      await appendAudit(
        client,
        this.audit(
          'task_workflow.transition_deleted',
          'task_workflow_transition',
          transitionId,
          requestId,
          {
            from: deleted.rows[0].from_status,
            to: deleted.rows[0].to_status,
          },
        ),
      );
    });
  }
}
