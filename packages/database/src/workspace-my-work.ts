import type { Pool, PoolClient } from 'pg';
import type { ActorSession } from './community.js';
import { RepositoryError } from './errors.js';

export type MyWorkUrgency = 'all' | 'overdue' | 'today' | 'week' | 'blocked' | 'no_due';
export type MyWorkSort = 'attention' | 'dueDate' | 'priority' | 'updated';

export interface WorkspaceMyWorkItem {
  id: string;
  taskKey: string;
  title: string;
  status: { key: string; name: string; category: 'todo' | 'in_progress'; color: string };
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate: string | null;
  updatedAt: string;
  openBlockerCount: number;
  parentTaskKey: string | null;
  project: { id: string; publicId: string; name: string };
}

export interface WorkspaceMyWorkResult {
  summary: { total: number; overdue: number; dueSoon: number; blocked: number; noDueDate: number };
  items: WorkspaceMyWorkItem[];
  pageInfo: { limit: number; offset: number; total: number; hasMore: boolean };
}

interface MyWorkRow {
  id: string;
  task_key: string;
  title: string;
  status: string;
  status_name: string;
  status_category: 'todo' | 'in_progress';
  status_color: string;
  priority: WorkspaceMyWorkItem['priority'];
  due_date: string | null;
  updated_at: Date;
  open_blocker_count: number;
  parent_task_key: string | null;
  project_id: string;
  project_public_id: string;
  project_name: string;
}

async function snapshot<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
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

export async function getWorkspaceMyWork(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
  options: {
    today: string;
    query?: string;
    urgency?: MyWorkUrgency;
    priority?: WorkspaceMyWorkItem['priority'];
    sort?: MyWorkSort;
    limit?: number;
    offset?: number;
  },
): Promise<WorkspaceMyWorkResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const offset = Math.max(0, options.offset ?? 0);
  const query = options.query?.trim() || null;
  const urgency = options.urgency ?? 'all';
  const priority = options.priority ?? null;
  const order = {
    attention: 'attention_rank,priority_rank,due_date asc nulls last,updated_at desc,id',
    dueDate: 'due_date asc nulls last,priority_rank,updated_at desc,id',
    priority: 'priority_rank,due_date asc nulls last,updated_at desc,id',
    updated: 'updated_at desc,id',
  }[options.sort ?? 'attention'];

  return snapshot(pool, async (client) => {
    const workspace = await client.query(
      `select 1 from workspaces where id=$1 and organization_id=$2
       and ($3::uuid is null or id=$3) and workspace_visible_to(id,$2,$4,$5)`,
      [
        workspaceId,
        actor.organizationId,
        actor.apiTokenWorkspaceId ?? null,
        actor.actorId,
        actor.role,
      ],
    );
    if (!workspace.rowCount)
      throw new RepositoryError('WORKSPACE_NOT_FOUND', 404, 'Workspace was not found.');

    const base = `from (
      select t.id,p.key||'-'||t.task_number task_key,t.title,t.status,s.name status_name,
        s.category status_category,s.color status_color,t.priority,t.due_date,
        t.updated_at,p.id project_id,p.public_id project_public_id,p.name project_name,
        case t.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end priority_rank,
        case when t.due_date<$4::date then 0
             when exists(select 1 from task_relationships tr join tasks blocker
               on blocker.project_id=tr.project_id and blocker.id=tr.source_task_id
               join task_workflow_statuses blocker_status
                 on blocker_status.project_id=blocker.project_id and blocker_status.key=blocker.status
               where tr.project_id=t.project_id and tr.target_task_id=t.id
                 and tr.relation_type='blocks' and blocker.archived_at is null
                 and blocker_status.category<>'done'
                 and task_visible_to(blocker.id,$7::uuid,$8::text)) then 1
             when t.due_date<=$4::date+7 then 2 else 3 end attention_rank,
        (select count(*)::int from task_relationships tr join tasks blocker
          on blocker.project_id=tr.project_id and blocker.id=tr.source_task_id
          join task_workflow_statuses blocker_status
            on blocker_status.project_id=blocker.project_id and blocker_status.key=blocker.status
          where tr.project_id=t.project_id and tr.target_task_id=t.id
            and tr.relation_type='blocks' and blocker.archived_at is null
            and blocker_status.category<>'done'
            and task_visible_to(blocker.id,$7::uuid,$8::text)) open_blocker_count,
        case when parent.id is null then null else p.key||'-'||parent.task_number end parent_task_key
      from tasks t join projects p on p.id=t.project_id
      join task_workflow_statuses s on s.project_id=t.project_id and s.key=t.status
      left join tasks parent on parent.project_id=t.project_id and parent.id=t.parent_task_id
        and task_visible_to(parent.id,$7::uuid,$8::text)
      where p.workspace_id=$1 and p.system=false and p.archived_at is null
        and project_visible_to(p.id,$1,$9::uuid,$7::uuid,$8::text)
        and t.assignee_id=$2 and t.archived_at is null and s.category<>'done'
        and task_visible_to(t.id,$7::uuid,$8::text)
    ) work
    where ($3::text is null or concat_ws(' ',task_key,title,project_name,status_name) ilike '%'||$3||'%' escape '\\')
      and ($5::text is null or priority=$5::task_priority)
      and ($6::text='all'
        or ($6::text='overdue' and due_date<$4::date)
        or ($6::text='today' and due_date=$4::date)
        or ($6::text='week' and due_date between $4::date and $4::date+7)
        or ($6::text='blocked' and open_blocker_count>0)
        or ($6::text='no_due' and due_date is null))`;
    const parameters = [
      workspaceId,
      actor.actorId,
      query,
      options.today,
      priority,
      urgency,
      actor.actorId,
      actor.role,
      actor.organizationId,
    ];
    const summaryResult = await client.query<{
      total: number;
      overdue: number;
      due_soon: number;
      blocked: number;
      no_due_date: number;
    }>(
      `select count(*)::int total,
          (count(*) filter(where t.due_date<$3::date))::int overdue,
          (count(*) filter(where t.due_date between $3::date and $3::date+7))::int due_soon,
          (count(*) filter(where exists(select 1 from task_relationships tr join tasks blocker
            on blocker.project_id=tr.project_id and blocker.id=tr.source_task_id
            join task_workflow_statuses bs on bs.project_id=blocker.project_id and bs.key=blocker.status
            where tr.project_id=t.project_id and tr.target_task_id=t.id and tr.relation_type='blocks'
              and blocker.archived_at is null and bs.category<>'done'
              and task_visible_to(blocker.id,$4::uuid,$5::text))))::int blocked,
          (count(*) filter(where t.due_date is null))::int no_due_date
         from tasks t join projects p on p.id=t.project_id
         join task_workflow_statuses s on s.project_id=t.project_id and s.key=t.status
         where p.workspace_id=$1 and p.system=false and p.archived_at is null
           and project_visible_to(p.id,$1,$6::uuid,$4::uuid,$5::text)
           and t.assignee_id=$2 and t.archived_at is null and s.category<>'done'
           and task_visible_to(t.id,$4::uuid,$5::text)`,
      [workspaceId, actor.actorId, options.today, actor.actorId, actor.role, actor.organizationId],
    );
    const totalResult = await client.query<{ count: number }>(
      `select count(*)::int count ${base}`,
      parameters,
    );
    const itemResult = await client.query<MyWorkRow>(
      `select id,task_key,title,status,status_name,status_category,status_color,priority,
          due_date::text due_date,updated_at,open_blocker_count,parent_task_key,
          project_id,project_public_id,project_name ${base}
         order by ${order} limit $10 offset $11`,
      [...parameters, limit, offset],
    );
    const summary = summaryResult.rows[0]!;
    const total = Number(totalResult.rows[0]?.count ?? 0);
    return {
      summary: {
        total: Number(summary.total),
        overdue: Number(summary.overdue),
        dueSoon: Number(summary.due_soon),
        blocked: Number(summary.blocked),
        noDueDate: Number(summary.no_due_date),
      },
      items: itemResult.rows.map((row) => ({
        id: row.id,
        taskKey: row.task_key,
        title: row.title,
        status: {
          key: row.status,
          name: row.status_name,
          category: row.status_category,
          color: row.status_color,
        },
        priority: row.priority,
        dueDate: row.due_date,
        updatedAt: row.updated_at.toISOString(),
        openBlockerCount: Number(row.open_blocker_count),
        parentTaskKey: row.parent_task_key,
        project: {
          id: row.project_id,
          publicId: row.project_public_id,
          name: row.project_name,
        },
      })),
      pageInfo: { limit, offset, total, hasMore: offset + itemResult.rows.length < total },
    };
  });
}
