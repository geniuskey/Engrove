import type { Pool } from 'pg';
import type { ActorSession } from './community.js';

export type WorkspaceSearchResultType = 'project' | 'task' | 'milestone' | 'table';

export interface WorkspaceSearchResult {
  type: WorkspaceSearchResultType;
  id: string;
  publicId: string | null;
  title: string;
  key: string;
  projectPublicId: string | null;
  projectName: string | null;
  workspaceShared: boolean;
}

export interface WorkspaceSearchPage {
  items: WorkspaceSearchResult[];
  pageInfo: {
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

interface SearchRow {
  type: WorkspaceSearchResultType;
  id: string;
  public_id: string | null;
  title: string;
  key: string;
  project_public_id: string | null;
  project_name: string | null;
  workspace_shared: boolean;
  total: number;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * Searches navigation targets within one active workspace. Organization and workspace scope are
 * applied inside every union branch so a future branch cannot accidentally inherit scope only
 * from a sibling query.
 */
export async function searchWorkspace(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
  query: string,
  limit = 20,
  allowedTypes: readonly WorkspaceSearchResultType[] = ['project', 'task', 'milestone', 'table'],
): Promise<WorkspaceSearchPage> {
  const normalized = query.trim();
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const scopedTypes = [...new Set(allowedTypes)].filter((type) =>
    ['project', 'task', 'milestone', 'table'].includes(type),
  );
  if (normalized.length < 2 || scopedTypes.length === 0) {
    return { items: [], pageInfo: { limit: boundedLimit, total: 0, hasMore: false } };
  }

  const escaped = escapeLike(normalized);
  const result = await pool.query<SearchRow>(
    `with candidates as (
       select 'project'::text as type,
              p.id,
              p.public_id,
              p.name as title,
              p.key,
              p.public_id as project_public_id,
              p.name as project_name,
              false as workspace_shared,
              case
                when lower(p.key) = lower($3) then 0
                when lower(p.name) = lower($3) then 1
                when p.key ilike $4 escape '\\' then 2
                when p.name ilike $4 escape '\\' then 3
                else 6
              end as relevance,
              0 as type_order
       from projects p
       join workspaces w on w.id = p.workspace_id
       where p.workspace_id = $1
         and w.organization_id = $2
         and w.archived_at is null
         and p.archived_at is null
         and p.system = false
         and project_visible_to(p.id,$1,$2,$8::uuid,$9::text)
         and 'project'=any($7::text[])
         and (p.key ilike $5 escape '\\'
              or p.name ilike $5 escape '\\'
              or p.description ilike $5 escape '\\')

       union all

       select 'task'::text as type,
              t.id,
              null::text as public_id,
              t.title,
              p.key || '-' || t.task_number::text as key,
              p.public_id as project_public_id,
              p.name as project_name,
              false as workspace_shared,
              case
                when lower(p.key || '-' || t.task_number::text) = lower($3) then 0
                when lower(t.title) = lower($3) then 1
                when (p.key || '-' || t.task_number::text) ilike $4 escape '\\' then 2
                when t.title ilike $4 escape '\\' then 3
                else 6
              end as relevance,
              1 as type_order
       from tasks t
       join projects p on p.id = t.project_id
       join workspaces w on w.id = p.workspace_id
       left join tasks parent on parent.project_id = t.project_id and parent.id = t.parent_task_id
         and task_visible_to(parent.id,$8::uuid,$9::text)
       where p.workspace_id = $1
         and w.organization_id = $2
         and w.archived_at is null
         and p.archived_at is null
         and p.system = false
         and project_visible_to(p.id,$1,$2,$8::uuid,$9::text)
         and t.archived_at is null
         and task_visible_to(t.id,$8::uuid,$9::text)
         and 'task'=any($7::text[])
         and ((p.key || '-' || t.task_number::text) ilike $5 escape '\\'
              or t.title ilike $5 escape '\\'
              or t.description ilike $5 escape '\\'
              or array_to_string(t.labels,' ') ilike $5 escape '\\'
              or (p.key || '-' || parent.task_number::text) ilike $5 escape '\\'
              or parent.title ilike $5 escape '\\')

       union all

       select 'milestone'::text as type,
              m.id,
              null::text as public_id,
              m.title,
              m.target_date::text as key,
              p.public_id as project_public_id,
              p.name as project_name,
              false as workspace_shared,
              case
                when lower(m.title) = lower($3) or m.target_date::text = $3 then 1
                when m.title ilike $4 escape '\\' or m.target_date::text ilike $4 escape '\\' then 3
                else 6
              end as relevance,
              2 as type_order
       from project_milestones m
       join projects p on p.id = m.project_id
       join workspaces w on w.id = p.workspace_id
       where p.workspace_id = $1
         and w.organization_id = $2
         and w.archived_at is null
         and p.archived_at is null
         and p.system = false
         and project_visible_to(p.id,$1,$2,$8::uuid,$9::text)
         and m.archived_at is null
         and 'milestone'=any($7::text[])
         and (m.title ilike $5 escape '\\'
              or m.description ilike $5 escape '\\'
              or m.status::text ilike $5 escape '\\'
              or m.target_date::text ilike $5 escape '\\')

       union all

       select 'table'::text as type,
              o.id,
              o.public_id,
              o.name as title,
              o.key,
              case when p.system then null else p.public_id end as project_public_id,
              case when p.system then null else p.name end as project_name,
              p.system as workspace_shared,
              case
                when lower(o.key) = lower($3) or lower(o.public_id) = lower($3) then 0
                when lower(o.name) = lower($3) or lower(o.plural_name) = lower($3) then 1
                when o.key ilike $4 escape '\\' or o.public_id ilike $4 escape '\\' then 2
                when o.name ilike $4 escape '\\' or o.plural_name ilike $4 escape '\\' then 3
                else 6
              end as relevance,
              3 as type_order
       from object_types o
       join projects p on p.id = o.project_id
       join workspaces w on w.id = p.workspace_id
       where p.workspace_id = $1
         and w.organization_id = $2
         and w.archived_at is null
         and p.archived_at is null
         and project_visible_to(p.id,$1,$2,$8::uuid,$9::text)
         and 'table'=any($7::text[])
         and (o.key ilike $5 escape '\\'
              or o.public_id ilike $5 escape '\\'
              or o.name ilike $5 escape '\\'
              or o.plural_name ilike $5 escape '\\'
              or o.description ilike $5 escape '\\')
     )
     select type, id, public_id, title, key, project_public_id, project_name, workspace_shared,
            count(*) over()::int as total
     from candidates
     order by relevance, type_order, lower(title), id
     limit $6`,
    [
      workspaceId,
      actor.organizationId,
      normalized,
      `${escaped}%`,
      `%${escaped}%`,
      boundedLimit,
      scopedTypes,
      actor.actorId,
      actor.role,
    ],
  );

  const total = result.rows[0]?.total ?? 0;
  return {
    items: result.rows.map((row) => ({
      type: row.type,
      id: row.id,
      publicId: row.public_id,
      title: row.title,
      key: row.key,
      projectPublicId: row.project_public_id,
      projectName: row.project_name,
      workspaceShared: row.workspace_shared,
    })),
    pageInfo: { limit: boundedLimit, total, hasMore: total > result.rows.length },
  };
}
