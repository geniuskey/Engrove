import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { renewDatasetJobLease, ScopedFileDatasetRepository } from '../src/files-datasets.js';

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
});

describe('project resource scopes', () => {
  it('requires an ordinary non-system project', async () => {
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
    ]);
  });
});
