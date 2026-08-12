import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  createTaskDueDateNotifications,
  updateNotificationPreferences,
} from '../src/notifications.js';

const actor = {
  sessionId: 'session-1',
  actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'viewer' as const,
  email: 'viewer@example.com',
  displayName: 'Viewer',
  csrfTokenHash: '',
};

describe('notification repository', () => {
  it('uses safe defaults until a user stores personal preferences', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(getNotificationPreferences({ query } as unknown as Pool, actor)).resolves.toEqual({
      autoWatchCreated: true,
      autoWatchCommented: true,
      notifyAssigned: true,
      notifyMentioned: true,
      notifyTaskActivity: true,
      notifyDueDates: true,
      dueReminderDays: 1,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('organization_id=$1'), [
      actor.organizationId,
      actor.actorId,
    ]);
  });

  it('upserts preferences in the actor organization and audits the change', async () => {
    const saved = {
      autoWatchCreated: false,
      autoWatchCommented: false,
      notifyAssigned: true,
      notifyMentioned: true,
      notifyTaskActivity: false,
      notifyDueDates: true,
      dueReminderDays: 3 as const,
    };
    const clientQuery = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{}] });
    const release = vi.fn();
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          auto_watch_created: false,
          auto_watch_commented: false,
          notify_assigned: true,
          notify_mentioned: true,
          notify_task_activity: false,
          notify_due_dates: true,
          due_reminder_days: 3,
        },
      ],
    });
    const pool = {
      query,
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release }),
    } as unknown as Pool;

    await expect(
      updateNotificationPreferences(pool, actor, { ...saved, requestId: 'request-1' }),
    ).resolves.toEqual(saved);
    const upsert = clientQuery.mock.calls.find(([statement]) =>
      String(statement).includes('insert into user_notification_preferences'),
    );
    expect(upsert?.[1]?.slice(0, 2)).toEqual([actor.organizationId, actor.actorId]);
    expect(
      clientQuery.mock.calls.some(([statement]) => String(statement).includes('audit_events')),
    ).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it('creates idempotent due-date notifications with preference and completion guards', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 2, rows: [{}, {}] });

    await expect(createTaskDueDateNotifications({ query } as unknown as Pool)).resolves.toBe(2);

    const statement = String(query.mock.calls[0]?.[0]);
    expect(statement).toContain("s.category<>'done'");
    expect(statement).toContain('coalesce(pref.notify_due_dates,true)');
    expect(statement).toContain('coalesce(pref.due_reminder_days,1)');
    expect(statement).toContain('on conflict (event_id,recipient_id) do nothing');
  });

  it('lists only the current actor notifications and returns the unread count', async () => {
    const createdAt = new Date('2026-08-08T12:00:00.000Z');
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3792',
            type: 'task.commented',
            payload: { commentId: '019fbcf9-e020-71da-935a-6a6a728b3793' },
            read_at: null,
            created_at: createdAt,
            actor_name: 'Ada',
            workspace_public_id: 'w1234567890abcd',
            project_public_id: 'p1234567890abcd',
            task_id: '019fbcf9-e020-71da-935a-6a6a728b3794',
            task_key: 'FORCE-6',
            task_title: 'Review evidence',
            object_type_public_id: null,
            record_id: null,
            record_title: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: '12', unread_count: '1' }] });

    const result = await listNotifications({ query } as unknown as Pool, actor, {
      unreadOnly: true,
      limit: 500,
      offset: 10,
    });

    expect(result.unreadCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      actorName: 'Ada',
      taskKey: 'FORCE-6',
      taskTitle: 'Review evidence',
      objectTypeId: null,
      recordId: null,
      createdAt: createdAt.toISOString(),
    });
    expect(result.pageInfo).toEqual({ limit: 100, offset: 10, total: 12, hasNext: true });
    expect(query.mock.calls[0]?.[1]).toEqual([
      actor.organizationId,
      actor.actorId,
      true,
      100,
      10,
      actor.role,
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual([
      actor.organizationId,
      actor.actorId,
      true,
      actor.role,
    ]);
    expect(query.mock.calls[0]?.[0]).toContain('task_visible_to');
  });

  it('scopes single and bulk read mutations to the current actor', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'notification-1' }] })
      .mockResolvedValueOnce({ rowCount: 3, rows: [{}, {}, {}] });
    const pool = { query } as unknown as Pool;

    await expect(markNotificationRead(pool, actor, 'notification-1')).resolves.toBeUndefined();
    await expect(markAllNotificationsRead(pool, actor)).resolves.toBe(3);
    expect(query.mock.calls[0]?.[1]).toEqual([
      'notification-1',
      actor.organizationId,
      actor.actorId,
      actor.role,
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual([actor.organizationId, actor.actorId, actor.role]);
  });

  it('does not reveal whether another actor notification exists', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(
      markNotificationRead({ query } as unknown as Pool, actor, 'someone-elses-notification'),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND', status: 404 });
  });
});
