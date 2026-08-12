import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { searchWorkspace } from '../src/workspace-search.js';

const actor = {
  sessionId: 'session-1',
  actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'viewer' as const,
  email: 'viewer@example.com',
  displayName: 'Viewer',
  csrfTokenHash: '',
};

describe('workspace search', () => {
  it('returns ranked navigation targets with a bounded result count', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          type: 'task',
          id: '019fbcf9-e020-71da-935a-6a6a728b3792',
          public_id: null,
          title: 'Review motor validation',
          key: 'MOTOR-42',
          project_public_id: 'p1234567890abcd',
          project_name: 'Motor validation',
          workspace_shared: false,
          total: 4,
        },
      ],
    });

    const result = await searchWorkspace(
      { query } as unknown as Pool,
      actor,
      '019fbcf9-e020-71da-935a-6a6a728b3793',
      'MOTOR-42',
      1,
    );

    expect(result).toEqual({
      items: [
        {
          type: 'task',
          id: '019fbcf9-e020-71da-935a-6a6a728b3792',
          publicId: null,
          title: 'Review motor validation',
          key: 'MOTOR-42',
          projectPublicId: 'p1234567890abcd',
          projectName: 'Motor validation',
          workspaceShared: false,
        },
      ],
      pageInfo: { limit: 1, total: 4, hasMore: true },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("'task'::text"), [
      '019fbcf9-e020-71da-935a-6a6a728b3793',
      actor.organizationId,
      'MOTOR-42',
      'MOTOR-42%',
      '%MOTOR-42%',
      1,
      ['project', 'task', 'milestone', 'table'],
      actor.actorId,
      actor.role,
    ]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("'milestone'::text");
    expect(sql).toContain('from project_milestones m');
    expect(sql.match(/w\.organization_id = \$2/g)).toHaveLength(4);
    expect(sql.match(/p\.archived_at is null/g)).toHaveLength(4);
    expect(sql).toContain('m.archived_at is null');
    expect(sql.match(/=any\(\$7::text\[\]\)/g)).toHaveLength(4);
    expect(sql).toContain('task_visible_to(t.id,$8::uuid,$9::text)');
  });

  it('does not scan for a one-character query', async () => {
    const query = vi.fn();
    await expect(
      searchWorkspace({ query } as unknown as Pool, actor, 'workspace-id', 'a', 500),
    ).resolves.toEqual({
      items: [],
      pageInfo: { limit: 50, total: 0, hasMore: false },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('does not scan when the caller has no searchable capability', async () => {
    const query = vi.fn();
    await expect(
      searchWorkspace({ query } as unknown as Pool, actor, 'workspace-id', 'motor', 20, []),
    ).resolves.toEqual({
      items: [],
      pageInfo: { limit: 20, total: 0, hasMore: false },
    });
    expect(query).not.toHaveBeenCalled();
  });
});
