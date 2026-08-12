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
  it('returns bounded project overview counts without listing each resource', async () => {
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes('from projects p')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('total_samples')) {
        return {
          rowCount: 1,
          rows: [
            {
              total_samples: 42,
              dataset_count: 3,
              chart_count: 7,
              dashboard_count: 2,
              object_type_count: 5,
            },
          ],
        };
      }
      if (sql.includes('from datasets')) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected query ${sql}`);
    });
    const repository = await ScopedVisualizationRepository.open(
      { query: poolQuery } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(repository.dashboardMetrics()).resolves.toMatchObject({
      total_samples: 42,
      chart_count: 7,
      dashboard_count: 2,
      object_type_count: 5,
      recent_datasets: [],
    });
    const metricsSql = String(
      poolQuery.mock.calls.find(([sql]) => String(sql).includes('total_samples'))?.[0],
    );
    expect(metricsSql).toContain('from charts');
    expect(metricsSql).toContain('from dashboards');
    expect(metricsSql).toContain('from object_types');
  });

  it('searches and pages chart and dashboard catalogs with explicit lifecycle scope', async () => {
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes('from projects p')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('count(*)::int total from charts')) {
        return { rowCount: 1, rows: [{ total: 61 }] };
      }
      if (sql.includes('from charts c join chart_revisions')) {
        return { rowCount: 1, rows: [{ id: 'chart-51', name: 'Thermal trend' }] };
      }
      if (sql.includes('count(*)::int total from dashboards')) {
        return { rowCount: 1, rows: [{ total: 52 }] };
      }
      if (sql.includes('from dashboards d join dashboard_revisions')) {
        return { rowCount: 2, rows: [{ id: 'dashboard-51' }, { id: 'dashboard-52' }] };
      }
      throw new Error(`Unexpected query ${sql}`);
    });
    const repository = await ScopedVisualizationRepository.open(
      { query: poolQuery } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listChartPage({
        archiveState: 'all',
        query: 'Thermal',
        limit: 50,
        offset: 50,
      }),
    ).resolves.toMatchObject({
      items: [{ id: 'chart-51' }],
      pageInfo: { limit: 50, offset: 50, total: 61, hasNext: true },
    });
    await expect(
      repository.listDashboardPage({
        archiveState: 'active',
        query: '',
        limit: 50,
        offset: 50,
      }),
    ).resolves.toMatchObject({
      items: [{ id: 'dashboard-51' }, { id: 'dashboard-52' }],
      pageInfo: { limit: 50, offset: 50, total: 52, hasNext: false },
    });
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('limit $4 offset $5'), [
      'project-1',
      'all',
      'thermal',
      50,
      50,
    ]);
  });

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
