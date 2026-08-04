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
