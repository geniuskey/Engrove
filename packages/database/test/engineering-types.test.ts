import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ScopedEngineeringRepository } from '../src/engineering-types.js';

const actor = {
  sessionId: 'session-1',
  actorId: 'actor-1',
  organizationId: 'organization-1',
  role: 'owner' as const,
  email: 'owner@example.com',
  displayName: 'Owner',
  csrfTokenHash: '',
};

describe('engineering history pages', () => {
  it('bounds measurement history and attaches only the latest evaluation per result', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('select 1 from projects'))
        return { rowCount: 1, rows: [{ '?column?': 1 }] };
      if (sql.includes('count(*)::int total from measurement_results'))
        return { rowCount: 1, rows: [{ total: 52 }] };
      if (sql.includes('select mr.*,not'))
        return {
          rowCount: 1,
          rows: [{ id: 'measurement-51', current: false, evaluation: { status: 'fail' } }],
        };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await ScopedEngineeringRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listMeasurementPage({
        recordId: 'record-1',
        fieldId: 'field-1',
        currentState: 'superseded',
        query: ' MM ',
        limit: 25,
        offset: 50,
      }),
    ).resolves.toEqual({
      items: [{ id: 'measurement-51', current: false, evaluation: { status: 'fail' } }],
      pageInfo: { limit: 25, offset: 50, total: 52, hasNext: true },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('left join lateral'), [
      'project-1',
      'record-1',
      'field-1',
      'superseded',
      'mm',
      25,
      50,
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('count(*)::int total from measurement_results'),
      ['project-1', 'record-1', 'field-1', 'superseded', 'mm'],
    );
  });

  it('searches specifications without an N+1 revision query', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('select 1 from projects'))
        return { rowCount: 1, rows: [{ '?column?': 1 }] };
      if (sql.includes('count(*)::int total from specifications'))
        return { rowCount: 1, rows: [{ total: 1 }] };
      if (sql.includes('select s.*,coalesce'))
        return {
          rowCount: 1,
          rows: [{ id: 'specification-1', name: 'Force envelope', revisions: [{ id: 'r1' }] }],
        };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await ScopedEngineeringRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listSpecificationPage({
        archiveState: 'all',
        query: ' Force ',
        limit: 50,
        offset: 0,
      }),
    ).resolves.toEqual({
      items: [{ id: 'specification-1', name: 'Force envelope', revisions: [{ id: 'r1' }] }],
      pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('json_agg(sr'), [
      'project-1',
      'all',
      'force',
      50,
      0,
    ]);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('filters and bounds specification evaluations', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('select 1 from projects'))
        return { rowCount: 1, rows: [{ '?column?': 1 }] };
      if (sql.includes('count(*)::int total from specification_evaluations'))
        return { rowCount: 1, rows: [{ total: 101 }] };
      if (sql.includes('select e.* from specification_evaluations'))
        return { rowCount: 1, rows: [{ id: 'evaluation-101', status: 'fail' }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await ScopedEngineeringRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listEvaluationPage({
        recordId: 'record-1',
        status: 'fail',
        query: ' outside ',
        limit: 50,
        offset: 100,
      }),
    ).resolves.toEqual({
      items: [{ id: 'evaluation-101', status: 'fail' }],
      pageInfo: { limit: 50, offset: 100, total: 101, hasNext: false },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('limit $5 offset $6'), [
      'project-1',
      'record-1',
      'fail',
      'outside',
      50,
      100,
    ]);
  });
});
