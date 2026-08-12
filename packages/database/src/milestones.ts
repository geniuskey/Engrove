import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7, validate as validateUuid } from 'uuid';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';
import {
  claimProjectCreate,
  hashIdempotencyPayload,
  rememberProjectCreate,
} from './project-idempotency.js';

export type MilestoneStatus = 'planned' | 'active' | 'at_risk' | 'completed';

interface Scope {
  actor: ActorSession;
  workspaceId: string;
  projectId: string;
}

interface MilestoneInput {
  title: string;
  description: string;
  status: MilestoneStatus;
  targetDate: string;
  taskIds?: string[] | undefined;
  idempotencyKey?: string | undefined;
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

export class ScopedMilestoneRepository {
  private constructor(
    private readonly pool: Pool,
    private readonly scope: Scope,
  ) {}

  static async open(pool: Pool, actor: ActorSession, workspaceId: string, projectId: string) {
    const found = await pool.query(
      'select 1 from projects p join workspaces w on w.id=p.workspace_id where p.id=$1 and p.workspace_id=$2 and w.organization_id=$3 and p.system=false and project_visible_to(p.id,$2,$3,$4,$5)',
      [projectId, workspaceId, actor.organizationId, actor.actorId, actor.role],
    );
    if (!found.rowCount)
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    return new ScopedMilestoneRepository(pool, { actor, workspaceId, projectId });
  }

  private audit(action: string, milestoneId: string, requestId: string, payload = {}) {
    return {
      organizationId: this.scope.actor.organizationId,
      workspaceId: this.scope.workspaceId,
      projectId: this.scope.projectId,
      actorId: this.scope.actor.actorId,
      action,
      targetType: 'project_milestone',
      targetId: milestoneId,
      requestId,
      payload,
    };
  }

  private taskVisibilityPredicate(alias = 't') {
    if (!validateUuid(this.scope.actor.actorId))
      throw new RepositoryError('ACTOR_INVALID', 401, 'Authenticated user is invalid.');
    return `task_visible_to(${alias}.id,'${this.scope.actor.actorId}'::uuid,'${this.scope.actor.role}'::text)`;
  }

  private milestoneSelect(where: string) {
    return `select m.*,m.target_date::text target_date,
      coalesce(linked.linked_tasks,'[]'::jsonb) linked_tasks,
      coalesce(linked.task_count,0)::int task_count,
      coalesce(linked.completed_task_count,0)::int completed_task_count
     from project_milestones m
     left join lateral (
       select jsonb_agg(jsonb_build_object(
         'id',t.id,
         'task_key',p.key||'-'||t.task_number,
         'title',t.title,
         'status',t.status,
         'status_name',workflow.name,
         'status_category',workflow.category,
         'archived_at',t.archived_at
       ) order by t.task_number,t.id) linked_tasks,
       count(*)::int task_count,
       count(*) filter (where workflow.category='done')::int completed_task_count
       from project_milestone_tasks link
       join tasks t on t.project_id=link.project_id and t.id=link.task_id
       join projects p on p.id=t.project_id
       join task_workflow_statuses workflow
         on workflow.project_id=t.project_id and workflow.key=t.status
       where link.project_id=m.project_id and link.milestone_id=m.id
         and ${this.taskVisibilityPredicate('t')}
     ) linked on true
     where ${where}`;
  }

  private async replaceTaskLinks(client: PoolClient, milestoneId: string, taskIds: string[]) {
    if (taskIds.length > 200)
      throw new RepositoryError(
        'MILESTONE_TASKS_LIMIT_EXCEEDED',
        400,
        'A key date can link at most 200 tasks.',
      );
    const uniqueTaskIds = [...new Set(taskIds)];
    if (uniqueTaskIds.length !== taskIds.length)
      throw new RepositoryError('MILESTONE_TASKS_DUPLICATE', 400, 'Linked tasks must be unique.');
    if (uniqueTaskIds.length > 0) {
      const available = await client.query<{ id: string }>(
        `select id from tasks
         where project_id=$1 and id=any($2::uuid[])
           and ${this.taskVisibilityPredicate('tasks')}
           and (archived_at is null or exists(
             select 1 from project_milestone_tasks link
             where link.project_id=$1 and link.milestone_id=$3 and link.task_id=tasks.id
           ))`,
        [this.scope.projectId, uniqueTaskIds, milestoneId],
      );
      if (available.rowCount !== uniqueTaskIds.length)
        throw new RepositoryError(
          'MILESTONE_TASK_INVALID',
          400,
          'Every linked task must be active and belong to this project.',
        );
    }
    await client.query(
      'delete from project_milestone_tasks where project_id=$1 and milestone_id=$2',
      [this.scope.projectId, milestoneId],
    );
    if (uniqueTaskIds.length > 0)
      await client.query(
        `insert into project_milestone_tasks (project_id,milestone_id,task_id,linked_by)
         select $1,$2,task_id,$4 from unnest($3::uuid[]) task_id`,
        [this.scope.projectId, milestoneId, uniqueTaskIds, this.scope.actor.actorId],
      );
  }

  async listMilestonePage(options: {
    archiveState: 'active' | 'archived' | 'all';
    query: string;
    limit: number;
    offset: number;
  }) {
    const query = options.query.trim().toLocaleLowerCase();
    const parameters = [
      this.scope.projectId,
      options.archiveState,
      query,
      options.limit,
      options.offset,
    ];
    const predicate = `m.project_id=$1
      and ($2='all' or ($2='active' and m.archived_at is null)
        or ($2='archived' and m.archived_at is not null))
      and ($3='' or position($3 in lower(concat_ws(' ',m.title,m.description,m.status::text,
        m.target_date::text)))>0)`;
    const [items, aggregate, next] = await Promise.all([
      this.pool.query(
        `${this.milestoneSelect(predicate)}
         order by (m.archived_at is not null),m.target_date,m.created_at,m.id limit $4 offset $5`,
        parameters,
      ),
      this.pool.query<{
        total: string;
        planned: string;
        active: string;
        at_risk: string;
        completed: string;
        archived: string;
      }>(
        `select count(*)::text total,
           count(*) filter (where m.archived_at is null and m.status='planned')::text planned,
           count(*) filter (where m.archived_at is null and m.status='active')::text active,
           count(*) filter (where m.archived_at is null and m.status='at_risk')::text at_risk,
           count(*) filter (where m.archived_at is null and m.status='completed')::text completed,
           count(*) filter (where m.archived_at is not null)::text archived
         from project_milestones m where ${predicate}`,
        parameters.slice(0, 3),
      ),
      this.pool.query<{ id: string }>(
        `select m.id from project_milestones m
         where ${predicate} and m.archived_at is null and m.status<>'completed'
           and m.target_date>=current_date
         order by m.target_date,m.created_at,m.id limit 1`,
        parameters.slice(0, 3),
      ),
    ]);
    const counts = aggregate.rows[0] ?? {
      total: '0',
      planned: '0',
      active: '0',
      at_risk: '0',
      completed: '0',
      archived: '0',
    };
    const total = Number(counts.total);
    return {
      items: items.rows,
      pageInfo: {
        limit: options.limit,
        offset: options.offset,
        total,
        hasNext: options.offset + items.rows.length < total,
      },
      summary: {
        planned: Number(counts.planned),
        active: Number(counts.active),
        atRisk: Number(counts.at_risk),
        completed: Number(counts.completed),
        archived: Number(counts.archived),
      },
      nextMilestoneId: next.rows[0]?.id ?? null,
    };
  }

  async getMilestone(milestoneId: string) {
    const result = await this.pool.query(this.milestoneSelect('m.project_id=$1 and m.id=$2'), [
      this.scope.projectId,
      milestoneId,
    ]);
    if (!result.rows[0])
      throw new RepositoryError('MILESTONE_NOT_FOUND', 404, 'Milestone was not found.');
    return result.rows[0];
  }

  async createMilestone(input: MilestoneInput & { requestId: string }) {
    const milestoneId = uuidv7();
    const creation = await transaction(this.pool, async (client) => {
      const idempotencyScope = input.idempotencyKey
        ? {
            projectId: this.scope.projectId,
            actorId: this.scope.actor.actorId,
            operation: 'milestone.create' as const,
            idempotencyKey: input.idempotencyKey,
          }
        : undefined;
      const requestHash = hashIdempotencyPayload({
        title: input.title,
        description: input.description,
        status: input.status,
        targetDate: input.targetDate,
        taskIds: input.taskIds ?? [],
      });
      if (idempotencyScope) {
        const replayId = await claimProjectCreate(client, idempotencyScope, requestHash);
        if (replayId) return { resourceId: replayId, idempotentReplay: true };
      }
      await client.query(
        `insert into project_milestones
         (id,project_id,title,description,status,target_date,completed_at,created_by)
         values ($1,$2,$3,$4,$5::milestone_status,$6,
                 case when $5::milestone_status='completed'::milestone_status then now() else null end,$7)`,
        [
          milestoneId,
          this.scope.projectId,
          input.title,
          input.description,
          input.status,
          input.targetDate,
          this.scope.actor.actorId,
        ],
      );
      await this.replaceTaskLinks(client, milestoneId, input.taskIds ?? []);
      await appendAudit(
        client,
        this.audit('project_milestone.created', milestoneId, input.requestId, {
          taskIds: input.taskIds ?? [],
        }),
      );
      if (idempotencyScope)
        await rememberProjectCreate(client, idempotencyScope, requestHash, milestoneId);
      return { resourceId: milestoneId, idempotentReplay: false };
    });
    return {
      ...(await this.getMilestone(creation.resourceId)),
      idempotent_replay: creation.idempotentReplay,
    };
  }

  async updateMilestone(
    milestoneId: string,
    input: MilestoneInput & { rowVersion: number; requestId: string },
  ) {
    await transaction(this.pool, async (client) => {
      const changed = await client.query(
        `update project_milestones set title=$4,description=$5,status=$6::milestone_status,target_date=$7,
         completed_at=case when $6::milestone_status='completed'::milestone_status then coalesce(completed_at,now()) else null end,
         row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and row_version=$3 and archived_at is null returning id`,
        [
          this.scope.projectId,
          milestoneId,
          input.rowVersion,
          input.title,
          input.description,
          input.status,
          input.targetDate,
        ],
      );
      if (!changed.rowCount)
        throw new RepositoryError(
          'MILESTONE_VERSION_CONFLICT',
          409,
          'Milestone changed or is unavailable.',
        );
      if (input.taskIds) await this.replaceTaskLinks(client, milestoneId, input.taskIds);
      await appendAudit(
        client,
        this.audit('project_milestone.updated', milestoneId, input.requestId, {
          ...(input.taskIds ? { taskIds: input.taskIds } : {}),
        }),
      );
    });
    return this.getMilestone(milestoneId);
  }

  async setArchived(milestoneId: string, archived: boolean, reason: string, requestId: string) {
    await transaction(this.pool, async (client) => {
      const changed = await client.query(
        `update project_milestones set archived_at=${archived ? 'now()' : 'null'},archived_by=${archived ? '$3' : 'null'},archive_reason=${archived ? '$4' : 'null'},
         row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and archived_at is ${archived ? 'null' : 'not null'} returning id`,
        archived
          ? [this.scope.projectId, milestoneId, this.scope.actor.actorId, reason]
          : [this.scope.projectId, milestoneId],
      );
      if (!changed.rowCount)
        throw new RepositoryError('MILESTONE_STATE_CONFLICT', 409, 'Milestone state conflicts.');
      await appendAudit(
        client,
        this.audit(
          archived ? 'project_milestone.archived' : 'project_milestone.restored',
          milestoneId,
          requestId,
        ),
      );
    });
    return this.getMilestone(milestoneId);
  }
}
