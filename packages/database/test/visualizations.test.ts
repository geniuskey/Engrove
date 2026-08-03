import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { type DashboardCardInput, ScopedVisualizationRepository } from '../src/visualizations.js';

const actor = {
  sessionId: 'session-1',
  actorId: 'actor-1',
  organizationId: 'organization-1',
  role: 'owner' as const,
  email: 'owner@example.com',
  displayName: 'Owner',
  csrfTokenHash: '',
};

describe('dashboard record source snapshots', () => {
  it('keeps archived saved views valid as historical source metadata', async () => {
    const clientQuery = vi.fn(async (sql: string, _parameters?: unknown[]) => {
      if (sql.includes('select 1 from object_types')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('select 1 from record_views')) return { rowCount: 1, rows: [{}] };
      return { rowCount: 1, rows: [] };
    });
    const client = { query: clientQuery, release: vi.fn() };
    const poolQuery = vi.fn(async (sql: string, _parameters?: unknown[]) => {
      if (sql.includes('from projects p')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('from dashboards d'))
        return {
          rowCount: 1,
          rows: [
            {
              id: 'dashboard-1',
              current_revision_id: 'revision-1',
              revision_number: 1,
            },
          ],
        };
      return { rowCount: 0, rows: [] };
    });
    const repository = await ScopedVisualizationRepository.open(
      { query: poolQuery, connect: vi.fn().mockResolvedValue(client) } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );
    const card: DashboardCardInput = {
      cardType: 'record_kpi',
      configVersion: 2,
      config: {
        title: 'Open issues',
        metric: 'count',
        source: {
          objectTypeId: 'object-type-1',
          tableName: 'Issues',
          viewId: 'archived-view-1',
          viewName: 'Open issues',
          filters: [],
          sorts: [],
        },
      },
      x: 0,
      y: 0,
      width: 4,
      height: 3,
      position: 0,
    };

    await expect(
      repository.createDashboard({
        name: 'Operations',
        description: '',
        changeNote: 'Initial layout',
        cards: [card],
        requestId: 'request-1',
      }),
    ).resolves.toMatchObject({ id: 'dashboard-1' });

    const viewLookup = clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('select 1 from record_views'),
    );
    expect(viewLookup?.[0]).not.toContain('archived_at is null');
    expect(viewLookup?.[1]).toEqual(['project-1', 'object-type-1', 'archived-view-1']);
  });
});
