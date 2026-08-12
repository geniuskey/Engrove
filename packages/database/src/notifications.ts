import type { Pool, PoolClient } from 'pg';
import { appendAudit, type ActorSession } from './community.js';
import { RepositoryError } from './errors.js';

export interface NotificationRow {
  id: string;
  type:
    | 'task.assigned'
    | 'task.updated'
    | 'task.status_changed'
    | 'task.commented'
    | 'task.mentioned'
    | 'task.archived'
    | 'task.restored'
    | 'task.due_soon'
    | 'task.overdue'
    | 'record.mentioned';
  actorName: string;
  workspaceId: string;
  projectId: string;
  taskId: string | null;
  taskKey: string | null;
  taskTitle: string | null;
  objectTypeId: string | null;
  recordId: string | null;
  recordTitle: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreferences {
  autoWatchCreated: boolean;
  autoWatchCommented: boolean;
  notifyAssigned: boolean;
  notifyMentioned: boolean;
  notifyTaskActivity: boolean;
  notifyDueDates: boolean;
  dueReminderDays: 0 | 1 | 3 | 7;
}

export const defaultNotificationPreferences: NotificationPreferences = {
  autoWatchCreated: true,
  autoWatchCommented: true,
  notifyAssigned: true,
  notifyMentioned: true,
  notifyTaskActivity: true,
  notifyDueDates: true,
  dueReminderDays: 1,
};

function preferencesFromRow(row: Record<string, unknown> | undefined): NotificationPreferences {
  if (!row) return defaultNotificationPreferences;
  return {
    autoWatchCreated: row.auto_watch_created !== false,
    autoWatchCommented: row.auto_watch_commented !== false,
    notifyAssigned: row.notify_assigned !== false,
    notifyMentioned: row.notify_mentioned !== false,
    notifyTaskActivity: row.notify_task_activity !== false,
    notifyDueDates: row.notify_due_dates !== false,
    dueReminderDays:
      row.due_reminder_days === 0 || row.due_reminder_days === 3 || row.due_reminder_days === 7
        ? row.due_reminder_days
        : 1,
  };
}

export async function notificationPreferencesForUser(
  pool: Pool | PoolClient,
  organizationId: string,
  userId: string,
): Promise<NotificationPreferences> {
  const result = await pool.query(
    `select auto_watch_created,auto_watch_commented,notify_assigned,notify_mentioned,
      notify_task_activity,notify_due_dates,due_reminder_days from user_notification_preferences
     where organization_id=$1 and user_id=$2`,
    [organizationId, userId],
  );
  return preferencesFromRow(result.rows[0]);
}

export function getNotificationPreferences(pool: Pool, actor: ActorSession) {
  return notificationPreferencesForUser(pool, actor.organizationId, actor.actorId);
}

export async function updateNotificationPreferences(
  pool: Pool,
  actor: ActorSession,
  input: NotificationPreferences & { requestId: string },
): Promise<NotificationPreferences> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into user_notification_preferences
       (organization_id,user_id,auto_watch_created,auto_watch_commented,notify_assigned,
        notify_mentioned,notify_task_activity,notify_due_dates,due_reminder_days)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (organization_id,user_id) do update set
        auto_watch_created=excluded.auto_watch_created,
        auto_watch_commented=excluded.auto_watch_commented,
        notify_assigned=excluded.notify_assigned,
        notify_mentioned=excluded.notify_mentioned,
        notify_task_activity=excluded.notify_task_activity,
        notify_due_dates=excluded.notify_due_dates,
        due_reminder_days=excluded.due_reminder_days,updated_at=now()`,
      [
        actor.organizationId,
        actor.actorId,
        input.autoWatchCreated,
        input.autoWatchCommented,
        input.notifyAssigned,
        input.notifyMentioned,
        input.notifyTaskActivity,
        input.notifyDueDates,
        input.dueReminderDays,
      ],
    );
    await appendAudit(client, {
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: 'notification_preferences.updated',
      targetType: 'user',
      targetId: actor.actorId,
      requestId: input.requestId,
      payload: {
        autoWatchCreated: input.autoWatchCreated,
        autoWatchCommented: input.autoWatchCommented,
        notifyAssigned: input.notifyAssigned,
        notifyMentioned: input.notifyMentioned,
        notifyTaskActivity: input.notifyTaskActivity,
        notifyDueDates: input.notifyDueDates,
        dueReminderDays: input.dueReminderDays,
      },
    });
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return getNotificationPreferences(pool, actor);
}

/**
 * Creates at most one approaching and one overdue notification for each task due-date version.
 * The deterministic event id makes this safe across worker replicas and repeated reconciliation.
 */
export async function createTaskDueDateNotifications(pool: Pool): Promise<number> {
  const result = await pool.query(
    `with candidates as (
       select t.id task_id,t.project_id,t.assignee_id recipient_id,t.due_date,
         p.workspace_id,w.organization_id,
         case when t.due_date<current_date then 'task.overdue'
              else 'task.due_soon' end notification_type,
         (t.due_date-current_date)::int days_remaining
       from tasks t
       join task_workflow_statuses s on s.project_id=t.project_id and s.key=t.status
       join projects p on p.id=t.project_id
       join workspaces w on w.id=p.workspace_id
       join users u on u.id=t.assignee_id and u.disabled_at is null
       join memberships m on m.organization_id=w.organization_id and m.user_id=t.assignee_id
       left join user_notification_preferences pref
         on pref.organization_id=w.organization_id and pref.user_id=t.assignee_id
       where t.archived_at is null and t.assignee_id is not null and t.due_date is not null
         and s.category<>'done' and coalesce(pref.notify_due_dates,true)
         and project_visible_to(p.id,p.workspace_id,w.organization_id,t.assignee_id,m.role::text)
         and task_visible_to(t.id,t.assignee_id,m.role::text)
         and (t.due_date<current_date
           or t.due_date between current_date and current_date+coalesce(pref.due_reminder_days,1))
     ), prepared as (
       select c.*,
         (substr(md5(c.task_id::text||':'||c.due_date::text||':'||c.notification_type),1,8)||'-'||
          substr(md5(c.task_id::text||':'||c.due_date::text||':'||c.notification_type),9,4)||'-'||
          substr(md5(c.task_id::text||':'||c.due_date::text||':'||c.notification_type),13,4)||'-'||
          substr(md5(c.task_id::text||':'||c.due_date::text||':'||c.notification_type),17,4)||'-'||
          substr(md5(c.task_id::text||':'||c.due_date::text||':'||c.notification_type),21,12))::uuid event_id
       from candidates c
     )
     insert into notifications
       (id,event_id,organization_id,workspace_id,project_id,task_id,recipient_id,actor_id,type,payload)
     select event_id,event_id,organization_id,workspace_id,project_id,task_id,recipient_id,
       recipient_id,notification_type,
       jsonb_build_object('dueDate',due_date::text,'daysRemaining',days_remaining)
     from prepared
     on conflict (event_id,recipient_id) do nothing
     returning id`,
  );
  return result.rowCount ?? 0;
}

export async function listNotifications(
  pool: Pool,
  actor: ActorSession,
  options: { unreadOnly?: boolean; limit?: number; offset?: number } = {},
): Promise<{
  items: NotificationRow[];
  unreadCount: number;
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
}> {
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  const offset = Math.max(0, Math.min(options.offset ?? 0, 1_000_000));
  const [notifications, count] = await Promise.all([
    pool.query(
      `select n.id,n.type,n.payload,n.read_at,n.created_at,a.display_name actor_name,
              w.public_id workspace_public_id,p.public_id project_public_id,n.task_id,
              case when t.id is null then null else p.key||'-'||t.task_number end task_key,
              t.title task_title,
              ot.public_id object_type_public_id,n.record_id,r.display_name record_title
       from notifications n join users a on a.id=n.actor_id
       join workspaces w on w.id=n.workspace_id join projects p on p.id=n.project_id
       left join tasks t on t.id=n.task_id and t.project_id=n.project_id
       left join records r on r.id=n.record_id and r.project_id=n.project_id
         and r.object_type_id=n.object_type_id
       left join object_types ot on ot.id=n.object_type_id and ot.project_id=n.project_id
       where n.organization_id=$1 and n.recipient_id=$2 and ($3::boolean=false or n.read_at is null)
         and project_visible_to(n.project_id,n.workspace_id,n.organization_id,$2::uuid,$6::text)
         and (n.task_id is null or task_visible_to(n.task_id,$2::uuid,$6::text))
       order by n.created_at desc,n.id desc limit $4 offset $5`,
      [actor.organizationId, actor.actorId, options.unreadOnly ?? false, limit, offset, actor.role],
    ),
    pool.query<{ total: string; unread_count: string }>(
      `select count(*) filter (where $3::boolean=false or read_at is null)::text total,
              count(*) filter (where read_at is null)::text unread_count
       from notifications
       where organization_id=$1 and recipient_id=$2
         and project_visible_to(project_id,workspace_id,organization_id,$2::uuid,$4::text)
         and (task_id is null or task_visible_to(task_id,$2::uuid,$4::text))`,
      [actor.organizationId, actor.actorId, options.unreadOnly ?? false, actor.role],
    ),
  ]);
  const total = Number(count.rows[0]?.total ?? 0);
  return {
    items: notifications.rows.map((row) => ({
      id: row.id,
      type: row.type,
      actorName: row.actor_name,
      workspaceId: row.workspace_public_id,
      projectId: row.project_public_id,
      taskId: row.task_id,
      taskKey: row.task_key,
      taskTitle: row.task_title,
      objectTypeId: row.object_type_public_id,
      recordId: row.record_id,
      recordTitle: row.record_title,
      payload: row.payload,
      readAt: row.read_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    })),
    unreadCount: Number(count.rows[0]?.unread_count ?? 0),
    pageInfo: {
      limit,
      offset,
      total,
      hasNext: offset + notifications.rows.length < total,
    },
  };
}

export async function markNotificationRead(
  pool: Pool,
  actor: ActorSession,
  notificationId: string,
): Promise<void> {
  const result = await pool.query(
    `update notifications set read_at=coalesce(read_at,now())
     where id=$1 and organization_id=$2 and recipient_id=$3
       and project_visible_to(project_id,workspace_id,organization_id,$3::uuid,$4::text)
     returning id`,
    [notificationId, actor.organizationId, actor.actorId, actor.role],
  );
  if (!result.rowCount)
    throw new RepositoryError('NOTIFICATION_NOT_FOUND', 404, 'Notification was not found.');
}

export async function markAllNotificationsRead(pool: Pool, actor: ActorSession): Promise<number> {
  const result = await pool.query(
    `update notifications set read_at=now()
     where organization_id=$1 and recipient_id=$2 and read_at is null
       and project_visible_to(project_id,workspace_id,organization_id,$2::uuid,$3::text)
     returning id`,
    [actor.organizationId, actor.actorId, actor.role],
  );
  return result.rowCount ?? 0;
}
