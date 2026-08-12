import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ScopedSourceRepository } from '../src/sources.js';

const actor = {
  sessionId: 'session-1',
  actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'contributor' as const,
  email: 'contributor@example.com',
  displayName: 'Contributor',
  csrfTokenHash: '',
};

describe('external source list pagination', () => {
  it('bounds source results and applies escaped metadata search with exact totals', async () => {
    const item = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3792',
      title: 'Force report',
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ total: '245', provider_count: '7' }] })
      .mockResolvedValueOnce({ rows: [item] });
    const repository = await ScopedSourceRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listSources({
        archiveState: 'archived',
        query: '100% force_',
        provider: 'SharePoint',
        limit: 20,
        offset: 40,
      }),
    ).resolves.toEqual({
      items: [item],
      pageInfo: { limit: 20, offset: 40, total: 245, hasNext: true },
      summary: { providerCount: 7 },
    });

    expect(query.mock.calls[1]?.[0]).toContain('s.archived_at is not null');
    expect(query.mock.calls[1]?.[0]).toContain('count(distinct lower(s.provider))');
    expect(query.mock.calls[1]?.[0]).toContain('s.external_id ilike $2 escape');
    expect(query.mock.calls[1]?.[1]).toEqual(['project-1', '%100\\% force\\_%', 'SharePoint']);
    expect(query.mock.calls[2]?.[0]).toContain('limit $4 offset $5');
    expect(query.mock.calls[2]?.[1]).toEqual([
      'project-1',
      '%100\\% force\\_%',
      'SharePoint',
      20,
      40,
    ]);
  });

  it('caps callers at 200 rows and defaults to active sources', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ total: '0', provider_count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = await ScopedSourceRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    const result = await repository.listSources({ limit: 5_000 });

    expect(result.pageInfo).toEqual({ limit: 200, offset: 0, total: 0, hasNext: false });
    expect(query.mock.calls[1]?.[0]).toContain('s.archived_at is null');
    expect(query.mock.calls[2]?.[1]).toEqual(['project-1', 200, 0]);
  });
});
