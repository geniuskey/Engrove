import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  claimDatasetJob,
  completeDatasetJob,
  failDatasetJob,
  renewDatasetJobLease,
  ScopedFileDatasetRepository,
} from '../src/files-datasets.js';

const actor = {
  sessionId: 'session-1',
  actorId: 'actor-1',
  organizationId: 'organization-1',
  role: 'owner' as const,
  email: 'owner@example.com',
  displayName: 'Owner',
  csrfTokenHash: '',
};

describe('dataset job leases', () => {
  it('claims only dataset processing jobs', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'begin' || sql === 'commit') return { rowCount: null, rows: [] };
      if (sql.startsWith('select * from background_jobs')) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    });

    await expect(claimDatasetJob(transactionPool(query), 'worker-1')).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("job_type='dataset.process' and entity_type='dataset'"),
    );
    expect(
      query.mock.calls
        .map(([sql]) => sql)
        .filter((sql) => sql.startsWith('update'))
        .every((sql) => sql.includes("job_type='dataset.process'")),
    ).toBe(true);
  });

  it('renews only the active attempt owned by the worker', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const renewed = await renewDatasetJobLease(
      { query } as unknown as Pool,
      { jobId: 'job-1', attemptId: 'attempt-1', workerId: 'worker-1' },
      90,
    );

    expect(renewed).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("j.status='running' and j.lease_owner=$3"),
      ['job-1', 'attempt-1', 'worker-1', 90],
    );
  });

  it('reports a lost lease when no owned attempt is updated', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0 });

    await expect(
      renewDatasetJobLease({ query } as unknown as Pool, {
        jobId: 'job-1',
        attemptId: 'attempt-1',
        workerId: 'worker-1',
      }),
    ).resolves.toBe(false);
  });

  it.each([
    ['completion', completeStaleAttempt],
    ['failure', failStaleAttempt],
  ])(
    'prevents a stale attempt from recording job %s after another worker claims it',
    async (_, run) => {
      const query = vi.fn(async (sql: string) => {
        if (sql === 'begin' || sql === 'rollback') return { rowCount: null, rows: [] };
        if (sql.includes('select j.project_id from background_jobs'))
          return { rowCount: 0, rows: [] };
        throw new Error(`Unexpected mutation by stale attempt: ${sql}`);
      });
      const pool = transactionPool(query);

      await expect(run(pool)).rejects.toMatchObject({ code: 'JOB_LEASE_LOST', status: 409 });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('for update of j,a'),
        expect.arrayContaining(['job-1', 'attempt-1', 'dataset-1', 'worker-a']),
      );
      expect(query.mock.calls.map(([sql]) => sql)).toEqual([
        'begin',
        expect.stringContaining('j.lease_expires_at>now()'),
        'rollback',
      ]);
    },
  );
});

describe('storage cleanup protection', () => {
  it('protects pending and verifying final keys and returns canonical and legacy prefixes', async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql === 'begin' || sql === 'commit') return { rowCount: null, rows: [] };
      if (sql.startsWith('update file_upload_sessions')) return { rowCount: 0, rows: [] };
      if (sql === 'select public_id from projects where id=$1')
        return { rowCount: 1, rows: [{ public_id: 'p1234567890abcd' }] };
      if (sql.includes("status in ('issued','verifying')")) return { rowCount: 0, rows: [] };
      if (sql.includes("status in ('finalized','failed','expired')"))
        return { rowCount: 0, rows: [] };
      if (sql.includes('select final_object_key object_key'))
        return {
          rowCount: 2,
          rows: [{ object_key: 'pending-key' }, { object_key: 'verifying-key' }],
        };
      if (sql.includes('select a.result_checkpoint')) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const pool = repositoryPool(clientQuery);
    const repo = await ScopedFileDatasetRepository.open(
      pool,
      actor,
      'workspace-1',
      '019fbcf9-e020-71da-935a-6a6a728b3704',
    );

    const protection = await repo.storageCleanupProtection(60);

    expect(protection.storageProjectIds).toEqual([
      '019fbcf9-e020-71da-935a-6a6a728b3704',
      'p1234567890abcd',
    ]);
    expect(protection.protectedCommittedKeys).toEqual(['pending-key', 'verifying-key']);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("status in ('pending_upload','verifying','available')"),
      ['019fbcf9-e020-71da-935a-6a6a728b3704'],
    );
  });

  it('rechecks committed references immediately before deletion', async () => {
    const poolQuery = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'project-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
    const repo = await ScopedFileDatasetRepository.open(
      { query: poolQuery } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repo.storageCleanupCandidateDeletable(
        'committed/project-1/file',
        'unreferenced-committed',
        60,
      ),
    ).resolves.toBe(false);
    expect(poolQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("status in ('pending_upload','verifying','available')"),
      ['project-1', 'committed/project-1/file'],
    );
  });
});

describe('project resource scopes', () => {
  it('requires an ordinary non-system project by default', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });

    await expect(
      ScopedFileDatasetRepository.open(
        { query } as unknown as Pool,
        actor,
        'workspace-1',
        'project-1',
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('p.system=false'), [
      'project-1',
      'workspace-1',
      'organization-1',
      false,
      'actor-1',
      'owner',
    ]);
  });

  it('can explicitly scope image resources to a workspace data project', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'project-1' }] });

    await expect(
      ScopedFileDatasetRepository.open(
        { query } as unknown as Pool,
        actor,
        'workspace-1',
        'project-1',
        { allowSystem: true },
      ),
    ).resolves.toBeInstanceOf(ScopedFileDatasetRepository);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('$4::boolean'), [
      'project-1',
      'workspace-1',
      'organization-1',
      true,
      'actor-1',
      'owner',
    ]);
  });
});

describe('dataset catalog', () => {
  it('searches and pages datasets without loading the full project catalog', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from projects p')) return { rowCount: 1, rows: [{ id: 'project-1' }] };
      if (sql.includes('count(*)::int total from datasets'))
        return { rowCount: 1, rows: [{ total: 51 }] };
      if (sql.includes('from datasets d'))
        return {
          rowCount: 1,
          rows: [
            {
              id: 'dataset-51',
              name: 'Thermal sweep',
              dataset_type: 'xy',
              status: 'ready',
              row_count: '24',
              artifacts: [],
            },
          ],
        };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await ScopedFileDatasetRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listDatasetPage({
        includeArchived: false,
        query: ' Thermal ',
        limit: 50,
        offset: 50,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: 'dataset-51', row_count: 24 })],
      pageInfo: { limit: 50, offset: 50, total: 51, hasNext: false },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('limit $4 offset $5'), [
      'project-1',
      false,
      'thermal',
      50,
      50,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('count(*)::int total'), [
      'project-1',
      false,
      'thermal',
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('d.id::text=$3'), [
      'project-1',
      false,
      'thermal',
      50,
      50,
    ]);
  });
});

describe('file and job catalogs', () => {
  it('searches and pages file evidence without loading the complete project history', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from projects p')) return { rowCount: 1, rows: [{ id: 'project-1' }] };
      if (sql.includes('count(*)::int total') && sql.includes('from file_objects f'))
        return { rowCount: 1, rows: [{ total: 51 }] };
      if (sql.includes('select f.*,s.name series_name'))
        return {
          rowCount: 1,
          rows: [
            {
              id: 'file-52',
              series_name: 'Qualification evidence',
              original_name: 'report.pdf',
              status: 'available',
              size_bytes: '2048',
            },
          ],
        };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await ScopedFileDatasetRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listFilePage({
        archiveState: 'all',
        query: ' Report ',
        status: 'available',
        limit: 25,
        offset: 50,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: 'file-52', size_bytes: 2048 })],
      pageInfo: { limit: 25, offset: 50, total: 51, hasNext: false },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('limit $5 offset $6'), [
      'project-1',
      'all',
      'report',
      'available',
      25,
      50,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('count(*)::int total'), [
      'project-1',
      'all',
      'report',
      'available',
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('f.id::text=$3'), [
      'project-1',
      'all',
      'report',
      'available',
      25,
      50,
    ]);
  });

  it('searches and pages background jobs while keeping attempts scoped to each page', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from projects p')) return { rowCount: 1, rows: [{ id: 'project-1' }] };
      if (sql.includes('count(*)::int total from background_jobs'))
        return { rowCount: 1, rows: [{ total: 101 }] };
      if (sql.includes('select j.*,coalesce'))
        return {
          rowCount: 1,
          rows: [
            {
              id: 'job-101',
              job_type: 'dataset.process',
              status: 'failed',
              attempts: [{ attempt_number: 3 }],
            },
          ],
        };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await ScopedFileDatasetRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listJobPage({ status: 'failed', query: ' Dataset ', limit: 50, offset: 50 }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: 'job-101', attempts: [{ attempt_number: 3 }] })],
      pageInfo: { limit: 50, offset: 50, total: 101, hasNext: true },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('limit $4 offset $5'), [
      'project-1',
      'failed',
      'dataset',
      50,
      50,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('left join lateral'), [
      'project-1',
      'failed',
      'dataset',
      50,
      50,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('count(*)::int total'), [
      'project-1',
      'failed',
      'dataset',
    ]);
  });
});

function transactionPool(query: ReturnType<typeof vi.fn>) {
  return {
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
  } as unknown as Pool;
}

function repositoryPool(clientQuery: ReturnType<typeof vi.fn>) {
  return {
    query: vi.fn(async () => ({ rowCount: 1, rows: [{ id: 'project-1' }] })),
    connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
  } as unknown as Pool;
}

function completeStaleAttempt(pool: Pool) {
  return completeDatasetJob(pool, {
    jobId: 'job-1',
    attemptId: 'attempt-1',
    workerId: 'worker-a',
    datasetId: 'dataset-1',
    projectId: 'project-1',
    artifacts: [],
    schema: {},
    statistics: {},
    rowCount: 0,
  });
}

function failStaleAttempt(pool: Pool) {
  return failDatasetJob(pool, {
    jobId: 'job-1',
    attemptId: 'attempt-1',
    workerId: 'worker-a',
    datasetId: 'dataset-1',
    attemptNumber: 1,
    maxAttempts: 3,
    code: 'FAILED',
    retryable: true,
  });
}
