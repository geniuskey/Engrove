import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { canonicalDecimal, parseCsv, ScopedProjectRepository } from '../src/configurable-data.js';

const actor = {
  sessionId: 'session-1',
  actorId: 'actor-1',
  organizationId: 'organization-1',
  role: 'owner' as const,
  email: 'owner@example.com',
  displayName: 'Owner',
  csrfTokenHash: '',
};

describe('configurable record canonicalization', () => {
  it.each([
    ['0010.00', '10'],
    ['-0.000', '0'],
    ['1.20e-2', '0.012'],
    ['2e3', '2000'],
    ['.00042', '0.00042'],
  ])('canonicalizes %s without binary floating point', (input, expected) => {
    expect(canonicalDecimal(input)).toBe(expected);
  });

  it('enforces significant digit and integer boundaries', () => {
    expect(() => canonicalDecimal('12345678901234567890123456789012345')).toThrow(/34/);
    expect(() => canonicalDecimal('1.5', true)).toThrow(/integer/);
    expect(canonicalDecimal('1.0', true)).toBe('1');
  });

  it('parses quoted commas, quotes, and line breaks deterministically', () => {
    expect(parseCsv('displayName,notes\r\n"A, 1","line 1\nline ""2"""\r\n')).toEqual([
      ['displayName', 'notes'],
      ['A, 1', 'line 1\nline "2"'],
    ]);
  });
});

describe('workspace configurable data boundaries', () => {
  it('rejects project-scoped resource fields in the workspace system project', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ system: true }] });
    const repository = await ScopedProjectRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.createField({
        objectTypeId: 'object-1',
        name: 'Evidence',
        key: 'evidence',
        fieldType: 'file',
        requestId: 'request-1',
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FIELD_TYPE_UNSUPPORTED' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects defaults for fields whose values use dedicated reference storage', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ system: false }] });
    const repository = await ScopedProjectRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.createField({
        objectTypeId: 'object-1',
        name: 'Parent',
        key: 'parent',
        fieldType: 'relation',
        config: { targetObjectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3795' },
        defaultValue: '019fbcf9-e020-71da-935a-6a6a728b3796',
        requestId: 'request-1',
      }),
    ).rejects.toMatchObject({ code: 'FIELD_DEFAULT_UNSUPPORTED' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects empty defaults before they can bypass required-field backfills', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ system: false }] });
    const repository = await ScopedProjectRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.createField({
        objectTypeId: 'object-1',
        name: 'Serial number',
        key: 'serial-number',
        fieldType: 'text',
        required: true,
        defaultValue: null,
        requestId: 'request-1',
      }),
    ).rejects.toMatchObject({ code: 'FIELD_DEFAULT_INVALID' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects form views that hide a required field without a default', async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('select 1 from object_types'))
        return { rowCount: 1, rows: [{ '?column?': 1 }] };
      if (sql.includes('select id, field_type from field_definitions'))
        return { rowCount: 0, rows: [] };
      if (sql.includes('select name from field_definitions'))
        return { rowCount: 1, rows: [{ name: 'Serial number' }] };
      return { rowCount: null, rows: [] };
    });
    const client = { query: clientQuery, release: vi.fn() };
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ system: false }] }),
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const repository = await ScopedProjectRepository.open(pool, actor, 'workspace-1', 'project-1');

    await expect(
      repository.createRecordView({
        objectTypeId: 'object-1',
        name: 'Submission form',
        viewType: 'form',
        config: {
          visibleFieldIds: [],
          fieldWidths: {},
          filters: [],
          sorts: [],
          rowDensity: 'compact',
          pageSize: 25,
        },
        requestId: 'request-1',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_VIEW_CONFIG_INVALID' });
    expect(clientQuery).toHaveBeenCalledWith('rollback');
  });

  it('rejects saved project filters outside the current workspace', async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('select 1 from object_types')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('select id, field_type from field_definitions'))
        return { rowCount: 0, rows: [] };
      if (sql.includes('select 1 from projects')) return { rowCount: 0, rows: [] };
      return { rowCount: null, rows: [] };
    });
    const client = { query: clientQuery, release: vi.fn() };
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ system: true }] }),
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const repository = await ScopedProjectRepository.open(pool, actor, 'workspace-1', 'project-1');

    await expect(
      repository.createRecordView({
        objectTypeId: 'object-1',
        name: 'Outside project',
        viewType: 'grid',
        config: {
          visibleFieldIds: [],
          fieldWidths: {},
          filters: [],
          sorts: [],
          rowDensity: 'compact',
          pageSize: 25,
          viewOptions: { contextProjectId: '019fbcf9-e020-71da-935a-6a6a728b3795' },
        },
        requestId: 'request-1',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(clientQuery).toHaveBeenCalledWith('rollback');
  });
});
