import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ScopedTaskRepository } from '../src/tasks.js';

const actor = {
  sessionId: 'session-1',
  actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'contributor' as const,
  email: 'contributor@example.com',
  displayName: 'Contributor',
  csrfTokenHash: '',
};

describe('task identifiers', () => {
  it('checks UUID identifiers against task visibility before resolving them', async () => {
    const taskId = '019fbcf9-e020-71da-935a-6a6a728b3792';
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    const repository = await ScopedTaskRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(repository.resolveTaskIdentifier(taskId)).resolves.toBe(taskId);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toContain('task_visible_to');
  });

  it('resolves a human-readable task key case-insensitively inside the project scope', async () => {
    const taskId = '019fbcf9-e020-71da-935a-6a6a728b3792';
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: taskId }] });
    const repository = await ScopedTaskRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(repository.resolveTaskIdentifier(' force-6 ')).resolves.toBe(taskId);
    expect(query.mock.calls[1]?.[0]).toContain('t.project_id=$1');
    expect(query.mock.calls[1]?.[0]).toContain('p.key=upper($2) and t.task_number=$3');
    expect(query.mock.calls[1]?.[1]).toEqual(['project-1', 'force', 6]);
  });

  it('does not reveal a missing or out-of-scope task key', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const repository = await ScopedTaskRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(repository.resolveTaskIdentifier('OTHER-9')).rejects.toMatchObject({
      code: 'TASK_NOT_FOUND',
      status: 404,
    });
  });
});

describe('task assignees', () => {
  it('searches and pages active members without requiring member-management access', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3792',
            display_name: 'Ada Engineer',
            email: 'ada@example.com',
          },
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3793',
            display_name: 'Lin Reviewer',
            email: 'lin@example.com',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: '140', overall_total: '240' }] });
    const repository = await ScopedTaskRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listAssigneePage({ query: '  Lab%_  ', limit: 5_000, offset: 50 }),
    ).resolves.toEqual({
      items: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3792',
          displayName: 'Ada Engineer',
          email: 'ada@example.com',
        },
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3793',
          displayName: 'Lin Reviewer',
          email: 'lin@example.com',
        },
      ],
      pageInfo: { limit: 100, offset: 50, total: 140, hasNext: true },
      overallTotal: 240,
    });
    expect(query.mock.calls[1]?.[0]).toContain('u.disabled_at is null');
    expect(query.mock.calls[1]?.[0]).toContain('u.email ilike');
    expect(query.mock.calls[1]?.[0]).toContain('u.id::text=$2');
    expect(query.mock.calls[1]?.[1]).toEqual([
      actor.organizationId,
      'Lab%_',
      'Lab\\%\\_',
      'project-1',
      'workspace-1',
      100,
      50,
    ]);
    expect(query.mock.calls[2]?.[1]).toEqual([
      actor.organizationId,
      'Lab%_',
      'Lab\\%\\_',
      'project-1',
      'workspace-1',
    ]);
  });
});

describe('collaborative task filters', () => {
  it('searches and pages visible filters with exact totals and personal favorites', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: 2 }] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: '019fbcf9-e020-71da-935a-6a6a728b3792', name: 'Safety %_' }],
      });
    const repository = await ScopedTaskRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listSavedFilterPage({ query: ' Safety %_ ', limit: 1, offset: 0 }),
    ).resolves.toEqual({
      items: [{ id: '019fbcf9-e020-71da-935a-6a6a728b3792', name: 'Safety %_' }],
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
    });
    expect(query.mock.calls[1]?.[0]).toContain("f.user_id=$2 or f.visibility='project'");
    expect(query.mock.calls[1]?.[0]).toContain("concat_ws(' ',f.name,u.display_name)");
    expect(query.mock.calls[1]?.[1]).toEqual(['project-1', actor.actorId, 'Safety \\%\\_']);
    expect(query.mock.calls[2]?.[0]).toContain('task_saved_filter_favorites');
    expect(query.mock.calls[2]?.[0]).toContain('limit $4 offset $5');
    expect(query.mock.calls[2]?.[1]).toEqual(['project-1', actor.actorId, 'Safety \\%\\_', 1, 0]);
  });

  it('restores one visible filter by stable id', async () => {
    const saved = { id: '019fbcf9-e020-71da-935a-6a6a728b3792', name: 'Shared safety' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [saved] });
    const repository = await ScopedTaskRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(repository.getSavedFilter(saved.id)).resolves.toEqual(saved);
    expect(query.mock.calls[1]?.[0]).toContain(
      "f.id=$1 and f.project_id=$2 and (f.user_id=$3 or f.visibility='project')",
    );
  });
});

describe('task list pagination', () => {
  it('applies bounded pagination and server-side board filters with total metadata', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: 5_100 }] })
      .mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          { id: '019fbcf9-e020-71da-935a-6a6a728b3792', row_version: 1 },
          { id: '019fbcf9-e020-71da-935a-6a6a728b3793', row_version: 2 },
        ],
      });
    const repository = await ScopedTaskRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listTasks({
        includeArchived: true,
        entityType: 'external_source',
        query: '100% force_',
        assignee: 'mine',
        priority: 'high',
        statuses: ['in_progress', 'blocked', 'in_progress'],
        labels: ['Supplier', 'safety'],
        hasDueDate: true,
        sort: 'dueDate',
        direction: 'desc',
        limit: 20,
        offset: 40,
      }),
    ).resolves.toEqual({
      items: [
        { id: '019fbcf9-e020-71da-935a-6a6a728b3792', row_version: 1 },
        { id: '019fbcf9-e020-71da-935a-6a6a728b3793', row_version: 2 },
      ],
      pageInfo: { limit: 20, offset: 40, total: 5_100, hasNext: true },
    });

    expect(query.mock.calls[1]?.[0]).toContain('select count(*)::int count');
    expect(query.mock.calls[1]?.[0]).toContain('ilike');
    expect(query.mock.calls[1]?.[0]).toContain('$4::text is null or f.entity_type=$4');
    expect(query.mock.calls[1]?.[1]).toEqual([
      'project-1',
      'all',
      null,
      'external_source',
      '100\\% force\\_',
      actor.actorId,
      false,
      'high',
      ['safety', 'supplier'],
      ['in_progress', 'blocked'],
      null,
      true,
    ]);
    expect(query.mock.calls[2]?.[0]).toContain('not $12::boolean or t.due_date is not null');
    expect(query.mock.calls[2]?.[0]).toContain('limit $13 offset $14');
    expect(query.mock.calls[2]?.[0]).toContain('t.labels @> $9');
    expect(query.mock.calls[2]?.[0]).toContain('t.status=any($10)');
    expect(query.mock.calls[2]?.[0]).toContain('root.due_date desc nulls last');
    expect(query.mock.calls[2]?.[0]).toContain('t.due_date desc nulls last');
    expect(query.mock.calls[2]?.[0]).toContain('creator.display_name created_by_name');
    expect(query.mock.calls[2]?.[0]).toContain('join users creator on creator.id=t.created_by');
    expect(query.mock.calls[2]?.[0]).toContain(
      'case when t.parent_task_id is null then 0 else 1 end',
    );
    expect(query.mock.calls[2]?.[1]).toEqual([
      'project-1',
      'all',
      null,
      'external_source',
      '100\\% force\\_',
      actor.actorId,
      false,
      'high',
      ['safety', 'supplier'],
      ['in_progress', 'blocked'],
      null,
      true,
      20,
      40,
    ]);
  });

  it('enforces the public 100-item hard limit below the repository boundary', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: 250 }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const repository = await ScopedTaskRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(repository.listTasks({ limit: 5_000 })).resolves.toEqual({
      items: [],
      pageInfo: { limit: 100, offset: 0, total: 250, hasNext: true },
    });
    expect(query.mock.calls[2]?.[1]?.slice(-2)).toEqual([100, 0]);
  });
});

describe('task candidate search', () => {
  it('searches eligible parents with a bounded page instead of loading the project', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: 120 }] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3792',
            task_key: 'FORCE-42',
            title: 'Review 100% force_value',
            parent_task_id: null,
            child_count: 0,
          },
        ],
      });
    const repository = await ScopedTaskRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listCandidates({
        query: '100% force_',
        topLevelOnly: true,
        limit: 20,
        offset: 40,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ task_key: 'FORCE-42' })],
      pageInfo: { limit: 20, offset: 40, total: 120, hasNext: true },
    });
    expect(query.mock.calls[1]?.[0]).toContain('not $3::boolean or t.parent_task_id is null');
    expect(query.mock.calls[1]?.[1]).toEqual(['project-1', '100\\% force\\_', true]);
    expect(query.mock.calls[2]?.[0]).toContain('limit $4 offset $5');
    expect(query.mock.calls[2]?.[1]).toEqual(['project-1', '100\\% force\\_', true, 20, 40]);
  });
});

describe('task change activity', () => {
  it('returns a bounded page of typed field changes from immutable audit events', async () => {
    const taskId = '019fbcf9-e020-71da-935a-6a6a728b3798';
    const changeId = '019fbcf9-e020-71da-935a-6a6a728b3799';
    const changedAt = new Date('2026-08-09T12:00:00.000Z');
    const query = vi.fn(async (statement: string, parameters?: unknown[]) => {
      if (statement.includes('select 1 from projects')) return { rowCount: 1, rows: [{}] };
      if (statement.startsWith('select 1 from tasks')) return { rowCount: 1, rows: [{}] };
      if (statement.includes('with activity as materialized'))
        return {
          rowCount: 1,
          rows: [{ items: [{ kind: 'change', id: changeId }], total: 51 }],
        };
      if (statement.includes('a.id=any') && (parameters?.[2] as string[])?.includes(changeId))
        return {
          rowCount: 1,
          rows: [
            {
              id: changeId,
              action: 'task.automated',
              changed_by_name: 'Ada Engineer',
              changed_at: changedAt,
              payload: {
                ruleName: 'Escalate critical work',
                changes: {
                  status: { from: 'todo', to: 'in_progress' },
                  priority: { from: 'medium', to: 'critical' },
                  description: { changed: true },
                },
              },
            },
          ],
        };
      return { rowCount: 0, rows: [] };
    });
    const repository = await ScopedTaskRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    const activity = await repository.getTaskActivity(taskId, { limit: 10, offset: 40 });

    expect(activity.change_history).toEqual([
      {
        id: '019fbcf9-e020-71da-935a-6a6a728b3799',
        action: 'task.automated',
        changed_by_name: 'Ada Engineer',
        changed_at: changedAt.toISOString(),
        automation_rule_name: 'Escalate critical work',
        changes: [
          {
            field: 'description',
            from: null,
            to: null,
            changed: true,
          },
          {
            field: 'priority',
            from: 'medium',
            to: 'critical',
            changed: true,
          },
        ],
      },
    ]);
    expect(activity.pageInfo).toEqual({ limit: 10, offset: 40, total: 51, hasNext: true });
    expect(
      query.mock.calls.find(([statement]) =>
        statement.includes('with activity as materialized'),
      )?.[0],
    ).toContain('limit $4 offset $5');
    expect(
      query.mock.calls.find(([statement]) =>
        statement.includes('with activity as materialized'),
      )?.[1],
    ).toEqual([
      'project-1',
      taskId,
      [
        'title',
        'description',
        'priority',
        'assigneeId',
        'dueDate',
        'labels',
        'parentTaskId',
        'originalEstimateMinutes',
        'remainingEstimateMinutes',
      ],
      10,
      40,
    ]);
  });
});

describe('bulk task updates', () => {
  it('rolls back every task when any row version is stale', async () => {
    const taskId = '019fbcf9-e020-71da-935a-6a6a728b3798';
    const clientQuery = vi.fn(async (statement: string) => {
      if (statement === 'begin' || statement === 'rollback') return { rowCount: null, rows: [] };
      if (statement.includes('from tasks')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: taskId,
              status: 'todo',
              priority: 'medium',
              assignee_id: null,
              row_version: 2,
            },
          ],
        };
      }
      return { rowCount: 1, rows: [{}] };
    });
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{}] }),
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
    } as unknown as Pool;
    const repository = await ScopedTaskRepository.open(pool, actor, 'workspace-1', 'project-1');

    await expect(
      repository.bulkUpdateTasks({
        items: [{ id: taskId, rowVersion: 1 }],
        changes: { status: 'done' },
        requestId: 'request-bulk',
      }),
    ).rejects.toMatchObject({ code: 'TASK_BULK_VERSION_CONFLICT', status: 409 });
    expect(
      clientQuery.mock.calls.some(([statement]) => String(statement).startsWith('update tasks')),
    ).toBe(false);
    expect(clientQuery).toHaveBeenCalledWith('rollback');
  });
});

describe('task collaboration', () => {
  it('rejects comment edits by another author before changing stored content', async () => {
    const clientQuery = vi.fn(async (statement: string) => {
      if (statement === 'begin' || statement === 'rollback') return { rowCount: null, rows: [] };
      if (statement.includes('from task_comments c join tasks t'))
        return {
          rowCount: 1,
          rows: [{ body: 'Original decision', author_id: 'another-user', row_version: 1 }],
        };
      return { rowCount: 0, rows: [] };
    });
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{}] }),
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
    } as unknown as Pool;
    const repository = await ScopedTaskRepository.open(pool, actor, 'workspace-1', 'project-1');

    await expect(
      repository.updateComment({
        taskId: '019fbcf9-e020-71da-935a-6a6a728b3792',
        commentId: '019fbcf9-e020-71da-935a-6a6a728b3793',
        body: 'Rewritten decision',
        mentionedUserIds: [],
        rowVersion: 1,
        requestId: 'comment-edit-forbidden',
      }),
    ).rejects.toMatchObject({ code: 'TASK_COMMENT_EDIT_FORBIDDEN', status: 403 });
    expect(
      clientQuery.mock.calls.some(([statement]) =>
        String(statement).startsWith('update task_comments'),
      ),
    ).toBe(false);
    expect(clientQuery).toHaveBeenCalledWith('rollback');
  });

  it('rejects stale comment edits with an optimistic concurrency conflict', async () => {
    const clientQuery = vi.fn(async (statement: string) => {
      if (statement === 'begin' || statement === 'rollback') return { rowCount: null, rows: [] };
      if (statement.includes('from task_comments c join tasks t'))
        return {
          rowCount: 1,
          rows: [{ body: 'Current decision', author_id: actor.actorId, row_version: 2 }],
        };
      return { rowCount: 0, rows: [] };
    });
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{}] }),
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
    } as unknown as Pool;
    const repository = await ScopedTaskRepository.open(pool, actor, 'workspace-1', 'project-1');

    await expect(
      repository.updateComment({
        taskId: '019fbcf9-e020-71da-935a-6a6a728b3792',
        commentId: '019fbcf9-e020-71da-935a-6a6a728b3793',
        body: 'Stale decision',
        mentionedUserIds: [],
        rowVersion: 1,
        requestId: 'comment-edit-stale',
      }),
    ).rejects.toMatchObject({ code: 'TASK_COMMENT_VERSION_CONFLICT', status: 409 });
    expect(clientQuery).toHaveBeenCalledWith('rollback');
  });

  it('rejects mentions that are not active organization members', async () => {
    const clientQuery = vi.fn(async (statement: string, _parameters?: unknown[]) => {
      if (statement === 'begin' || statement === 'rollback') return { rowCount: null, rows: [] };
      if (statement.includes('select 1 from tasks')) return { rowCount: 1, rows: [{}] };
      if (statement.includes('from memberships m join users u')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{}] };
    });
    const release = vi.fn();
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{}] }),
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release }),
    } as unknown as Pool;
    const repository = await ScopedTaskRepository.open(pool, actor, 'workspace-1', 'project-1');

    await expect(
      repository.addComment({
        taskId: '019fbcf9-e020-71da-935a-6a6a728b3792',
        body: 'Please review this evidence.',
        mentionedUserIds: ['019fbcf9-e020-71da-935a-6a6a728b3793'],
        watch: true,
        requestId: 'request-1',
      }),
    ).rejects.toMatchObject({ code: 'TASK_MENTION_INVALID', status: 400 });
    expect(
      clientQuery.mock.calls.find(([statement]) => String(statement).includes('memberships'))?.[0],
    ).toContain('u.disabled_at is null');
    expect(clientQuery).toHaveBeenCalledWith('rollback');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects a blocking relationship that would close a dependency cycle', async () => {
    const taskId = '019fbcf9-e020-71da-935a-6a6a728b3798';
    const relatedTaskId = '019fbcf9-e020-71da-935a-6a6a728b3799';
    const clientQuery = vi.fn(async (statement: string, _parameters?: unknown[]) => {
      if (statement === 'begin' || statement === 'rollback') return { rowCount: null, rows: [] };
      if (statement.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [{}] };
      if (statement.includes('id=any'))
        return { rowCount: 2, rows: [{ id: taskId }, { id: relatedTaskId }] };
      if (statement.includes('with recursive reachable')) return { rowCount: 1, rows: [{}] };
      return { rowCount: 1, rows: [{}] };
    });
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{}] }),
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
    } as unknown as Pool;
    const repository = await ScopedTaskRepository.open(pool, actor, 'workspace-1', 'project-1');

    await expect(
      repository.addRelationship({
        taskId,
        relatedTaskId,
        type: 'blocks',
        requestId: 'request-2',
      }),
    ).rejects.toMatchObject({ code: 'TASK_RELATIONSHIP_CYCLE', status: 409 });
    expect(
      clientQuery.mock.calls.some(([statement]) =>
        String(statement).includes('insert into task_relationships'),
      ),
    ).toBe(false);
    expect(clientQuery).toHaveBeenCalledWith('rollback');
  });

  it('stores symmetric relationships in a canonical order and returns both-side context', async () => {
    const taskId = '019fbcf9-e020-71da-935a-6a6a728b3799';
    const relatedTaskId = '019fbcf9-e020-71da-935a-6a6a728b3792';
    const createdAt = new Date('2026-08-08T12:00:00.000Z');
    const clientQuery = vi.fn(async (statement: string, _parameters?: unknown[]) => {
      if (statement === 'begin' || statement === 'commit') return { rowCount: null, rows: [] };
      if (statement.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [{}] };
      if (statement.includes('id=any'))
        return { rowCount: 2, rows: [{ id: taskId }, { id: relatedTaskId }] };
      if (statement.includes('insert into task_relationships'))
        return { rowCount: 1, rows: [{ id: 'relationship-1' }] };
      if (statement.includes('select w.user_id')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{}] };
    });
    const poolQuery = vi.fn(async (statement: string) => {
      if (statement.includes('select 1 from projects')) return { rowCount: 1, rows: [{}] };
      if (statement.includes('select 1 from tasks t')) return { rowCount: 1, rows: [{}] };
      if (statement.includes('select count(w.id)::int total'))
        return { rowCount: 1, rows: [{ total: 0 }] };
      if (statement.includes('select t.*')) {
        return {
          rowCount: 1,
          rows: [{ id: taskId, title: 'Current task', open_blocker_count: 0 }],
        };
      }
      if (statement.includes('from task_relationships r join tasks related')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'relationship-1',
              relation_type: 'relates_to',
              direction: 'inward',
              related_task_id: relatedTaskId,
              related_task_title: 'Related task',
              related_task_status: 'todo',
              related_task_archived_at: null,
              created_at: createdAt,
            },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    });
    const pool = {
      query: poolQuery,
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
    } as unknown as Pool;
    const repository = await ScopedTaskRepository.open(pool, actor, 'workspace-1', 'project-1');

    const result = await repository.addRelationship({
      taskId,
      relatedTaskId,
      type: 'relates_to',
      requestId: 'request-3',
    });

    const insert = clientQuery.mock.calls.find(([statement]) =>
      String(statement).includes('insert into task_relationships'),
    );
    expect(insert?.[1]?.slice(2, 5)).toEqual([relatedTaskId, taskId, 'relates_to']);
    expect(result.relationships[0]).toMatchObject({
      id: 'relationship-1',
      related_task_title: 'Related task',
      created_at: createdAt.toISOString(),
    });
  });
});
