import type { Pool, PoolClient } from 'pg';
import type { ActorSession } from './community.js';
import { RepositoryError } from './errors.js';

export interface WorkspaceOverviewDate {
  id: string;
  title: string;
  status: 'planned' | 'active' | 'at_risk' | 'completed';
  targetDate: string;
  project: {
    id: string;
    publicId: string;
    name: string;
  };
}

export interface WorkspaceOverviewProject {
  id: string;
  publicId: string;
  name: string;
  key: string;
  status: 'active' | 'on_hold' | 'completed';
  archivedAt: string | null;
  openTaskCount: number;
  blockedTaskCount: number;
  overdueDateCount: number;
  nextDate: Omit<WorkspaceOverviewDate, 'project'> | null;
}

export interface WorkspaceOverviewResult {
  workspace: {
    id: string;
    publicId: string;
    name: string;
    description: string;
  };
  summary: {
    activeProjects: number;
    openTasks: number;
    blockedTasks: number;
    overdueDates: number;
    nextUpcomingDate: WorkspaceOverviewDate | null;
  };
  projects: WorkspaceOverviewProject[];
  projectPageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
  dates: WorkspaceOverviewDate[];
}

interface ProjectSummaryRow {
  id: string;
  public_id: string;
  name: string;
  key: string;
  status: WorkspaceOverviewProject['status'];
  archived_at: Date | null;
  open_task_count: number;
  blocked_task_count: number;
  overdue_date_count: number;
  next_date_id: string | null;
  next_date_title: string | null;
  next_date_status: WorkspaceOverviewDate['status'] | null;
  next_target_date: string | null;
  project_total: number;
  active_project_total: number;
  open_task_total: number;
  blocked_task_total: number;
  overdue_date_total: number;
}

interface OverviewTotalsRow {
  project_total: number;
  matching_project_total?: number;
  active_project_total: number;
  open_task_total: number;
  blocked_task_total: number;
  overdue_date_total: number;
}

interface DateRow {
  id: string;
  title: string;
  status: WorkspaceOverviewDate['status'];
  target_date: string;
  project_id: string;
  project_public_id: string;
  project_name: string;
}

async function readSnapshot<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
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

export async function getWorkspaceOverview(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
  today: string,
  dateLimit = 6,
  projectLimit = 20,
  projectOffset = 0,
  projectQuery = '',
): Promise<WorkspaceOverviewResult> {
  const boundedDateLimit = Math.max(1, Math.min(dateLimit, 50));
  const boundedProjectLimit = Math.max(1, Math.min(projectLimit, 50));
  const boundedProjectOffset = Math.max(0, Math.min(projectOffset, 1_000_000));
  const normalizedProjectQuery = projectQuery.trim().normalize('NFKC');
  const escapedProjectQuery = normalizedProjectQuery.replace(/[\\%_]/g, '\\$&');
  return readSnapshot(pool, async (client) => {
    const workspaceResult = await client.query<{
      id: string;
      public_id: string;
      name: string;
      description: string;
    }>(
      `select id,public_id,name,description from workspaces
       where id=$1 and organization_id=$2 and ($3::uuid is null or id=$3)
         and workspace_visible_to(id,$2,$4,$5)`,
      [
        workspaceId,
        actor.organizationId,
        actor.apiTokenWorkspaceId ?? null,
        actor.actorId,
        actor.role,
      ],
    );
    const workspace = workspaceResult.rows[0];
    if (!workspace)
      throw new RepositoryError('WORKSPACE_NOT_FOUND', 404, 'Workspace was not found.');

    // A PostgreSQL client executes one statement at a time. Keep the repeatable-read snapshot on
    // this connection and await each query instead of queueing concurrent client.query calls.
    const projectResult = await client.query<ProjectSummaryRow>(
      `with visible_projects as materialized (
           select p.* from projects p join workspaces w on w.id=p.workspace_id
           where p.workspace_id=$1 and w.organization_id=$2 and p.system=false
             and project_visible_to(p.id,$1,$2,$7::uuid,$8::text)
         ), task_counts as (
           select t.project_id,
             (count(*) filter(where ws.category<>'done'))::int open_task_count,
             (count(*) filter(where ws.category<>'done' and t.status='blocked'))::int blocked_task_count
           from tasks t join visible_projects p on p.id=t.project_id and p.archived_at is null
           join task_workflow_statuses ws on ws.project_id=t.project_id and ws.key=t.status
           where t.archived_at is null and task_visible_to(t.id,$7::uuid,$8::text)
           group by t.project_id
         ), milestone_counts as (
           select m.project_id,
             (count(*) filter(where m.status<>'completed' and m.target_date<$3::date))::int overdue_date_count
           from project_milestones m
           join visible_projects p on p.id=m.project_id and p.archived_at is null
           where m.archived_at is null group by m.project_id
         ), next_dates as (
           select distinct on (m.project_id) m.project_id,m.id,m.title,m.status,m.target_date
           from project_milestones m
           join visible_projects p on p.id=m.project_id and p.archived_at is null
           where m.archived_at is null and m.status<>'completed' and m.target_date>=$3::date
           order by m.project_id,m.target_date,m.id
         )
         select p.id,p.public_id,p.name,p.key,p.status,p.archived_at,
           coalesce(task_counts.open_task_count,0) open_task_count,
           coalesce(task_counts.blocked_task_count,0) blocked_task_count,
           coalesce(milestone_counts.overdue_date_count,0) overdue_date_count,
           next_dates.id next_date_id,next_dates.title next_date_title,
           next_dates.status next_date_status,next_dates.target_date::text next_target_date,
           count(*) over()::int project_total,
           (count(*) filter(where p.archived_at is null and p.status='active') over())::int active_project_total,
           (sum(coalesce(task_counts.open_task_count,0)) over())::int open_task_total,
           (sum(coalesce(task_counts.blocked_task_count,0)) over())::int blocked_task_total,
           (sum(coalesce(milestone_counts.overdue_date_count,0)) over())::int overdue_date_total
         from visible_projects p
         left join task_counts on task_counts.project_id=p.id
         left join milestone_counts on milestone_counts.project_id=p.id
         left join next_dates on next_dates.project_id=p.id
         where $6::text='' or p.name ilike ('%'||$6||'%') escape '\\'
           or p.key ilike ('%'||$6||'%') escape '\\'
           or p.description ilike ('%'||$6||'%') escape '\\'
         order by (p.archived_at is not null),p.name,p.id
         limit $4 offset $5`,
      [
        workspaceId,
        actor.organizationId,
        today,
        boundedProjectLimit,
        boundedProjectOffset,
        escapedProjectQuery,
        actor.actorId,
        actor.role,
      ],
    );
    let totals: OverviewTotalsRow | undefined = normalizedProjectQuery
      ? undefined
      : projectResult.rows[0];
    if (!totals) {
      const totalsResult = await client.query<OverviewTotalsRow>(
        `with visible_projects as materialized (
           select p.* from projects p join workspaces w on w.id=p.workspace_id
           where p.workspace_id=$1 and w.organization_id=$2 and p.system=false
             and project_visible_to(p.id,$1,$2,$5::uuid,$6::text)
         ), task_totals as (
           select
             (count(*) filter(where ws.category<>'done'))::int open_task_total,
             (count(*) filter(where ws.category<>'done' and t.status='blocked'))::int blocked_task_total
           from tasks t join visible_projects p on p.id=t.project_id and p.archived_at is null
           join task_workflow_statuses ws on ws.project_id=t.project_id and ws.key=t.status
           where t.archived_at is null and task_visible_to(t.id,$5::uuid,$6::text)
         ), milestone_totals as (
           select (count(*) filter(where m.status<>'completed' and m.target_date<$3::date))::int overdue_date_total
           from project_milestones m
           join visible_projects p on p.id=m.project_id and p.archived_at is null
           where m.archived_at is null
         )
         select count(*)::int project_total,
           (count(*) filter(where $4::text='' or name ilike ('%'||$4||'%') escape '\\'
             or key ilike ('%'||$4||'%') escape '\\'
             or description ilike ('%'||$4||'%') escape '\\'))::int matching_project_total,
           (count(*) filter(where archived_at is null and status='active'))::int active_project_total,
           task_totals.open_task_total,task_totals.blocked_task_total,
           milestone_totals.overdue_date_total
         from visible_projects cross join task_totals cross join milestone_totals
         group by task_totals.open_task_total,task_totals.blocked_task_total,
                  milestone_totals.overdue_date_total`,
        [workspaceId, actor.organizationId, today, escapedProjectQuery, actor.actorId, actor.role],
      );
      totals = totalsResult.rows[0];
    }
    const dateResult = await client.query<DateRow>(
      `select m.id,m.title,m.status,m.target_date::text target_date,
                p.id project_id,p.public_id project_public_id,p.name project_name
         from project_milestones m join projects p on p.id=m.project_id
         join workspaces w on w.id=p.workspace_id
         where p.workspace_id=$1 and w.organization_id=$2 and p.system=false and p.archived_at is null
           and project_visible_to(p.id,$1,$2,$4::uuid,$5::text)
           and m.archived_at is null and m.status<>'completed'
         order by m.target_date,m.id limit $3`,
      [workspaceId, actor.organizationId, boundedDateLimit, actor.actorId, actor.role],
    );
    const nextUpcomingDateResult = await client.query<DateRow>(
      `select m.id,m.title,m.status,m.target_date::text target_date,
                p.id project_id,p.public_id project_public_id,p.name project_name
         from project_milestones m join projects p on p.id=m.project_id
         join workspaces w on w.id=p.workspace_id
         where p.workspace_id=$1 and w.organization_id=$2 and p.system=false and p.archived_at is null
           and project_visible_to(p.id,$1,$2,$4::uuid,$5::text)
           and m.archived_at is null and m.status<>'completed' and m.target_date>=$3::date
         order by m.target_date,m.id limit 1`,
      [workspaceId, actor.organizationId, today, actor.actorId, actor.role],
    );

    const projects = projectResult.rows.map(mapProject);
    const dates = dateResult.rows.map(mapDate);
    const total = Number(
      projectResult.rows[0]?.project_total ?? totals?.matching_project_total ?? 0,
    );
    const nextUpcomingDate = nextUpcomingDateResult.rows[0]
      ? mapDate(nextUpcomingDateResult.rows[0])
      : null;

    return {
      workspace: {
        id: workspace.id,
        publicId: workspace.public_id,
        name: workspace.name,
        description: workspace.description,
      },
      summary: {
        activeProjects: Number(totals?.active_project_total ?? 0),
        openTasks: Number(totals?.open_task_total ?? 0),
        blockedTasks: Number(totals?.blocked_task_total ?? 0),
        overdueDates: Number(totals?.overdue_date_total ?? 0),
        nextUpcomingDate,
      },
      projects,
      projectPageInfo: {
        limit: boundedProjectLimit,
        offset: boundedProjectOffset,
        total,
        hasNext: boundedProjectOffset + projects.length < total,
      },
      dates,
    };
  });
}

function mapProject(row: ProjectSummaryRow): WorkspaceOverviewProject {
  return {
    id: row.id,
    publicId: row.public_id,
    name: row.name,
    key: row.key,
    status: row.status,
    archivedAt: row.archived_at?.toISOString() ?? null,
    openTaskCount: Number(row.open_task_count),
    blockedTaskCount: Number(row.blocked_task_count),
    overdueDateCount: Number(row.overdue_date_count),
    nextDate:
      row.next_date_id && row.next_date_title && row.next_date_status && row.next_target_date
        ? {
            id: row.next_date_id,
            title: row.next_date_title,
            status: row.next_date_status,
            targetDate: row.next_target_date,
          }
        : null,
  };
}

function mapDate(row: DateRow): WorkspaceOverviewDate {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    targetDate: row.target_date,
    project: {
      id: row.project_id,
      publicId: row.project_public_id,
      name: row.project_name,
    },
  };
}
