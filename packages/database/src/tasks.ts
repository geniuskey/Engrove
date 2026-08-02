import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';

type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskEntityType =
  | 'record'
  | 'sample'
  | 'issue'
  | 'test_run'
  | 'measurement_result'
  | 'specification_evaluation'
  | 'dataset';
export interface TaskLinkInput {
  entityType: TaskEntityType;
  entityId: string;
}
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

export class ScopedTaskRepository {
  private constructor(
    private readonly pool: Pool,
    private readonly scope: Scope,
  ) {}

  static async open(pool: Pool, actor: ActorSession, workspaceId: string, projectId: string) {
    const found = await pool.query(
      'select 1 from projects p join workspaces w on w.id=p.workspace_id where p.id=$1 and p.workspace_id=$2 and w.organization_id=$3 and p.system=false',
      [projectId, workspaceId, actor.organizationId],
    );
    if (!found.rowCount)
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    return new ScopedTaskRepository(pool, { actor, workspaceId, projectId });
  }

  private audit(action: string, taskId: string, requestId: string, payload = {}) {
    return {
      organizationId: this.scope.actor.organizationId,
      workspaceId: this.scope.workspaceId,
      projectId: this.scope.projectId,
      actorId: this.scope.actor.actorId,
      action,
      targetType: 'task',
      targetId: taskId,
      requestId,
      payload,
    };
  }

  async listTasks(options: {
    includeArchived?: boolean;
    entityType?: TaskEntityType | undefined;
    entityId?: string | undefined;
  }) {
    const result = await this.pool.query(
      `select t.*,t.due_date::text due_date,u.display_name assignee_name,
       coalesce(json_agg(distinct l) filter(where l.id is not null),'[]') links
       from tasks t left join users u on u.id=t.assignee_id
       left join task_links l on l.task_id=t.id and l.project_id=t.project_id
       where t.project_id=$1 and ($2::boolean or t.archived_at is null)
       and ($3::uuid is null or exists(select 1 from task_links f where f.task_id=t.id and f.project_id=t.project_id and f.entity_id=$3 and ($4::text is null or f.entity_type=$4)))
       group by t.id,u.display_name order by
       case t.status when 'in_progress' then 0 when 'blocked' then 1 when 'todo' then 2 else 3 end,
       t.due_date nulls last,t.updated_at desc,t.id`,
      [
        this.scope.projectId,
        options.includeArchived ?? false,
        options.entityId ?? null,
        options.entityType ?? null,
      ],
    );
    return result.rows;
  }

  async getTask(taskId: string) {
    const task = await this.pool.query(
      'select t.*,t.due_date::text due_date,u.display_name assignee_name from tasks t left join users u on u.id=t.assignee_id where t.project_id=$1 and t.id=$2',
      [this.scope.projectId, taskId],
    );
    if (!task.rows[0]) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task was not found.');
    const [links, history] = await Promise.all([
      this.pool.query(
        'select * from task_links where project_id=$1 and task_id=$2 order by created_at,id',
        [this.scope.projectId, taskId],
      ),
      this.pool.query(
        `select h.*,u.display_name changed_by_name from task_status_history h
         join users u on u.id=h.changed_by where h.project_id=$1 and h.task_id=$2 order by h.changed_at,h.id`,
        [this.scope.projectId, taskId],
      ),
    ]);
    return { ...task.rows[0], links: links.rows, status_history: history.rows };
  }

  private async validateAssignee(client: PoolClient, assigneeId?: string | undefined) {
    if (!assigneeId) return;
    const found = await client.query(
      'select 1 from memberships where organization_id=$1 and user_id=$2',
      [this.scope.actor.organizationId, assigneeId],
    );
    if (!found.rowCount)
      throw new RepositoryError(
        'TASK_ASSIGNEE_INVALID',
        400,
        'Assignee is not an organization member.',
      );
  }

  private async validateLink(client: PoolClient, link: TaskLinkInput) {
    let query: string;
    let parameters: unknown[] = [this.scope.projectId, link.entityId];
    if (['record', 'sample', 'issue', 'test_run'].includes(link.entityType)) {
      query = `select 1 from records r join object_types o on o.id=r.object_type_id and o.project_id=r.project_id
        where r.project_id=$1 and r.id=$2`;
      const recordKeyByType: Partial<Record<TaskEntityType, string>> = {
        sample: 'sample',
        issue: 'issue',
        test_run: 'test-run',
      };
      const expected = recordKeyByType[link.entityType];
      if (expected) {
        query += ' and o.key=$3';
        parameters = [...parameters, expected];
      }
    } else if (link.entityType === 'measurement_result')
      query = 'select 1 from measurement_results where project_id=$1 and id=$2';
    else if (link.entityType === 'specification_evaluation')
      query = 'select 1 from specification_evaluations where project_id=$1 and id=$2';
    else query = 'select 1 from datasets where project_id=$1 and id=$2';
    if (!(await client.query(query, parameters)).rowCount)
      throw new RepositoryError(
        'TASK_LINK_NOT_FOUND',
        400,
        'Linked engineering entity was not found.',
      );
  }

  private async insertLinks(client: PoolClient, taskId: string, links: TaskLinkInput[]) {
    const unique = new Map(links.map((link) => [`${link.entityType}:${link.entityId}`, link]));
    for (const link of unique.values()) {
      await this.validateLink(client, link);
      await client.query(
        'insert into task_links (id,project_id,task_id,entity_type,entity_id) values ($1,$2,$3,$4,$5)',
        [uuidv7(), this.scope.projectId, taskId, link.entityType, link.entityId],
      );
    }
  }

  async createTask(input: {
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeId?: string | undefined;
    dueDate?: string | undefined;
    links: TaskLinkInput[];
    requestId: string;
  }) {
    const taskId = uuidv7();
    await transaction(this.pool, async (client) => {
      await this.validateAssignee(client, input.assigneeId);
      await client.query(
        `insert into tasks (id,project_id,title,description,status,priority,assignee_id,due_date,created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          taskId,
          this.scope.projectId,
          input.title,
          input.description,
          input.status,
          input.priority,
          input.assigneeId ?? null,
          input.dueDate ?? null,
          this.scope.actor.actorId,
        ],
      );
      await client.query(
        'insert into task_status_history (id,project_id,task_id,from_status,to_status,changed_by) values ($1,$2,$3,null,$4,$5)',
        [uuidv7(), this.scope.projectId, taskId, input.status, this.scope.actor.actorId],
      );
      await this.insertLinks(client, taskId, input.links);
      await appendAudit(client, this.audit('task.created', taskId, input.requestId));
    });
    return this.getTask(taskId);
  }

  async createFromFailedEvaluation(evaluationId: string, requestId: string) {
    const existing = await this.pool.query<{ task_id: string }>(
      `select l.task_id from task_links l join tasks t on t.id=l.task_id and t.project_id=l.project_id
       where l.project_id=$1 and l.entity_type='specification_evaluation' and l.entity_id=$2 order by t.created_at limit 1`,
      [this.scope.projectId, evaluationId],
    );
    if (existing.rows[0]) return this.getTask(existing.rows[0].task_id);
    const evidence = await this.pool.query<{
      status: string;
      record_id: string;
      display_name: string;
      object_key: string;
      measurement_result_id: string | null;
      dataset_id: string | null;
    }>(
      `select e.status,e.record_id,r.display_name,o.key object_key,e.measurement_result_id,m.dataset_id
       from specification_evaluations e join records r on r.id=e.record_id and r.project_id=e.project_id
       join object_types o on o.id=r.object_type_id and o.project_id=r.project_id
       left join measurement_results m on m.id=e.measurement_result_id and m.project_id=e.project_id
       where e.project_id=$1 and e.id=$2`,
      [this.scope.projectId, evaluationId],
    );
    const row = evidence.rows[0];
    if (!row) throw new RepositoryError('EVALUATION_NOT_FOUND', 404, 'Evaluation was not found.');
    if (row.status !== 'fail')
      throw new RepositoryError(
        'EVALUATION_NOT_FAILED',
        409,
        'Only a failed evaluation can create a task.',
      );
    const specialized = { sample: 'sample', issue: 'issue', 'test-run': 'test_run' }[
      row.object_key
    ] as TaskEntityType | undefined;
    const links: TaskLinkInput[] = [
      { entityType: 'record', entityId: row.record_id },
      { entityType: 'specification_evaluation', entityId: evaluationId },
      ...(specialized ? [{ entityType: specialized, entityId: row.record_id }] : []),
      ...(row.measurement_result_id
        ? [{ entityType: 'measurement_result' as const, entityId: row.measurement_result_id }]
        : []),
      ...(row.dataset_id ? [{ entityType: 'dataset' as const, entityId: row.dataset_id }] : []),
    ];
    const task = await this.createTask({
      title: `Investigate failed specification: ${row.display_name}`,
      description: 'Created from a failed specification evaluation with exact evidence links.',
      status: 'todo',
      priority: 'high',
      links,
      requestId,
    });
    await transaction(this.pool, (client) =>
      appendAudit(
        client,
        this.audit('task.created_from_evaluation', task.id, requestId, { evaluationId }),
      ),
    );
    return task;
  }

  async updateTask(
    taskId: string,
    input: {
      title: string;
      description: string;
      status: TaskStatus;
      priority: TaskPriority;
      assigneeId?: string | undefined;
      dueDate?: string | undefined;
      rowVersion: number;
      requestId: string;
    },
  ) {
    await transaction(this.pool, async (client) => {
      await this.validateAssignee(client, input.assigneeId);
      const current = await client.query<{ status: TaskStatus }>(
        'select status from tasks where project_id=$1 and id=$2 and archived_at is null and row_version=$3 for update',
        [this.scope.projectId, taskId, input.rowVersion],
      );
      if (!current.rows[0])
        throw new RepositoryError('TASK_VERSION_CONFLICT', 409, 'Task changed or is unavailable.');
      await client.query(
        `update tasks set title=$4,description=$5,status=$6,priority=$7,assignee_id=$8,due_date=$9,
         row_version=row_version+1,updated_at=now() where project_id=$1 and id=$2 and row_version=$3`,
        [
          this.scope.projectId,
          taskId,
          input.rowVersion,
          input.title,
          input.description,
          input.status,
          input.priority,
          input.assigneeId ?? null,
          input.dueDate ?? null,
        ],
      );
      if (current.rows[0].status !== input.status) {
        await client.query(
          'insert into task_status_history (id,project_id,task_id,from_status,to_status,changed_by) values ($1,$2,$3,$4,$5,$6)',
          [
            uuidv7(),
            this.scope.projectId,
            taskId,
            current.rows[0].status,
            input.status,
            this.scope.actor.actorId,
          ],
        );
        await appendAudit(
          client,
          this.audit('task.status_changed', taskId, input.requestId, {
            from: current.rows[0].status,
            to: input.status,
          }),
        );
      }
      await appendAudit(client, this.audit('task.updated', taskId, input.requestId));
    });
    return this.getTask(taskId);
  }

  async setArchived(taskId: string, archived: boolean, reason: string, requestId: string) {
    await transaction(this.pool, async (client) => {
      const changed = await client.query(
        `update tasks set archived_at=${archived ? 'now()' : 'null'},archived_by=${archived ? '$3' : 'null'},archive_reason=${archived ? '$4' : 'null'},row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and archived_at is ${archived ? 'null' : 'not null'} returning id`,
        archived
          ? [this.scope.projectId, taskId, this.scope.actor.actorId, reason]
          : [this.scope.projectId, taskId],
      );
      if (!changed.rowCount)
        throw new RepositoryError('TASK_STATE_CONFLICT', 409, 'Task lifecycle state conflicts.');
      await appendAudit(
        client,
        this.audit(archived ? 'task.archived' : 'task.restored', taskId, requestId),
      );
    });
    return this.getTask(taskId);
  }
}
