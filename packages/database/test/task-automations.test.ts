import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ScopedTaskAutomationRepository } from '../src/task-automations.js';

const actor = {
  sessionId: 'session-automation',
  actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'engineer' as const,
  email: 'engineer@example.com',
  displayName: 'Engineer',
  csrfTokenHash: '',
};

describe('task automation scope', () => {
  it('lists rules only within the opened project', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('from projects p join workspaces')) return { rowCount: 1, rows: [{}] };
      if (statement.startsWith('select count(*)')) return { rows: [{ count: '0' }] };
      if (statement.includes('from task_automation_rules')) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected query: ${statement}`);
    });
    const repository = await ScopedTaskAutomationRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(repository.listRulePage({ limit: 25, offset: 50 })).resolves.toEqual({
      items: [],
      pageInfo: { limit: 25, offset: 50, total: 0, hasNext: false },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('limit $2 offset $3'), [
      'project-1',
      25,
      50,
    ]);
  });

  it('rejects an action assignee outside the active organization', async () => {
    const clientQuery = vi.fn(async (statement: string) => {
      if (statement === 'begin' || statement === 'rollback') return { rowCount: null, rows: [] };
      if (statement.includes('from memberships')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{}] };
    });
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{}] }),
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
    } as unknown as Pool;
    const repository = await ScopedTaskAutomationRepository.open(
      pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.createRule({
        name: 'Assign invalid member',
        description: '',
        triggerType: 'task.created',
        triggerConfig: {},
        conditionConfig: {},
        actionConfig: { assigneeId: '019fbcf9-e020-71da-935a-6a6a728b3799' },
        active: true,
        requestId: 'request-automation',
      }),
    ).rejects.toMatchObject({ code: 'TASK_AUTOMATION_ASSIGNEE_INVALID', status: 400 });
    expect(clientQuery).toHaveBeenCalledWith('rollback');
  });

  it('pages execution history with exact project-wide outcome totals', async () => {
    const createdAt = new Date('2026-08-10T00:00:00.000Z');
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('from projects p join workspaces')) return { rowCount: 1, rows: [{}] };
      if (statement.includes('count(*) filter'))
        return { rows: [{ total: '1', succeeded: '2', no_change: '3', failed: '1' }] };
      if (statement.includes('from task_automation_executions e'))
        return {
          rows: [
            {
              id: 'execution-1',
              rule_id: 'rule-1',
              rule_name: 'Escalate blockers',
              trigger_type: 'task.status_changed',
              trigger_event: { type: 'task.status_changed', from: 'todo', to: 'blocked' },
              task_id: 'task-1',
              task_key: 'OPS-17',
              task_title: 'Recover gateway',
              trace_id: 'trace-1',
              depth: 0,
              outcome: 'failed',
              changes: {},
              error_code: 'ASSIGNEE_UNAVAILABLE',
              duration_ms: 12,
              created_at: createdAt,
            },
          ],
        };
      throw new Error(`Unexpected query: ${statement}`);
    });
    const repository = await ScopedTaskAutomationRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listExecutionPage({ outcome: 'failed', ruleId: 'rule-1', limit: 1 }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: 'execution-1',
          outcome: 'failed',
          errorCode: 'ASSIGNEE_UNAVAILABLE',
          durationMs: 12,
          triggerType: 'task.status_changed',
        }),
      ],
      pageInfo: { limit: 1, offset: 0, total: 1, hasNext: false },
      summary: { succeeded: 2, no_change: 3, failed: 1 },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('limit $4 offset $5'), [
      'project-1',
      'failed',
      'rule-1',
      1,
      0,
    ]);
  });
});
