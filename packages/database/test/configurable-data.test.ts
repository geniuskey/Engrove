import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { evaluateFormula, formulaReferences } from '../src/calculated-fields.js';
import { canonicalDecimal, parseCsv, ScopedProjectRepository } from '../src/configurable-data.js';
import {
  generateBasePublicId,
  generateTablePublicId,
  generateViewPublicId,
  generateWorkspacePublicId,
  resolveObjectTypeIdentifier,
  resolveProjectIdentifier,
  resolveRecordViewIdentifier,
  resolveWorkspaceIdentifier,
} from '../src/public-ids.js';

const actor = {
  sessionId: 'session-1',
  actorId: 'actor-1',
  organizationId: 'organization-1',
  role: 'owner' as const,
  email: 'owner@example.com',
  displayName: 'Owner',
  csrfTokenHash: '',
};

describe('Engrove public identifiers', () => {
  it('generates 15-character workspace, project, table, and view IDs with canonical prefixes', () => {
    const workspaceIds = Array.from({ length: 1_000 }, generateWorkspacePublicId);
    const baseIds = Array.from({ length: 1_000 }, generateBasePublicId);
    const tableIds = Array.from({ length: 1_000 }, generateTablePublicId);
    const viewIds = Array.from({ length: 1_000 }, generateViewPublicId);
    expect(workspaceIds.every((value) => /^w[0-9a-z]{14}$/.test(value))).toBe(true);
    expect(baseIds.every((value) => /^p[0-9a-z]{14}$/.test(value))).toBe(true);
    expect(tableIds.every((value) => /^t[0-9a-z]{14}$/.test(value))).toBe(true);
    expect(viewIds.every((value) => /^v[0-9a-z]{14}$/.test(value))).toBe(true);
    expect(new Set(workspaceIds).size).toBe(workspaceIds.length);
    expect(new Set(baseIds).size).toBe(baseIds.length);
    expect(new Set(tableIds).size).toBe(tableIds.length);
    expect(new Set(viewIds).size).toBe(viewIds.length);
  });

  it('keeps UUIDs compatible and resolves short IDs to internal UUIDs', async () => {
    const uuid = '019fbcf9-e020-71da-935a-6a6a728b3795';
    const query = vi.fn().mockResolvedValue({ rows: [{ id: uuid }] });
    const database = { query } as unknown as Pool;
    await expect(resolveWorkspaceIdentifier(database, 'w1234567890abcd')).resolves.toBe(uuid);
    await expect(resolveProjectIdentifier(database, uuid)).resolves.toBe(uuid);
    await expect(resolveProjectIdentifier(database, 'p1234567890abcd')).resolves.toBe(uuid);
    await expect(resolveObjectTypeIdentifier(database, 't1234567890abcd')).resolves.toBe(uuid);
    await expect(resolveObjectTypeIdentifier(database, 'm1234567890abcd')).resolves.toBe(uuid);
    await expect(resolveRecordViewIdentifier(database, 'v1234567890abcd')).resolves.toBe(uuid);
    await expect(resolveRecordViewIdentifier(database, uuid)).resolves.toBe(uuid);
    expect(query).toHaveBeenCalledTimes(5);
  });
});

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

describe('saved record view pages', () => {
  it('applies literal search before returning an exact bounded page', async () => {
    const createdAt = new Date('2026-08-11T00:00:00.000Z');
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('select p.system')) return { rowCount: 1, rows: [{ system: false }] };
      if (statement.includes(' visible,') && statement.includes('from object_types o'))
        return { rowCount: 1, rows: [{ visible: true, allowed: true }] };
      if (statement.startsWith('select count(*)')) return { rows: [{ count: '2' }] };
      if (statement.includes('from record_views where'))
        return {
          rows: [
            {
              id: 'view-1',
              public_id: 'v1234567890abcd',
              project_id: 'project-1',
              object_type_id: 'object-1',
              name: 'Release readiness',
              view_type: 'grid',
              permission_type: 'collaborative',
              owner_id: null,
              lock_reason: null,
              config: {
                visibleFieldIds: [],
                fieldWidths: {},
                filters: [],
                sorts: [],
                rowDensity: 'compact',
                pageSize: 50,
              },
              row_version: 1,
              created_by: actor.actorId,
              updated_by: actor.actorId,
              archived_at: null,
              created_at: createdAt,
              updated_at: createdAt,
            },
          ],
        };
      throw new Error(`Unexpected query: ${statement}`);
    });
    const repository = await ScopedProjectRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listRecordViewPage('object-1', { query: ' RELEASE ', limit: 1 }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: 'view-1', name: 'Release readiness' })],
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('limit $5 offset $6'), [
      'project-1',
      'object-1',
      'release',
      false,
      1,
      0,
    ]);
  });
});

describe('calculated field formulas', () => {
  it('evaluates arithmetic, references, conditions, and text without dynamic code execution', () => {
    expect(
      evaluateFormula('ROUND({mass} * {unit-price}, 2)', { mass: '2.5', 'unit-price': 4 }),
    ).toBe(10);
    expect(
      evaluateFormula('IF({passed}, CONCAT("Lot ", {lot}), "Blocked")', { passed: true, lot: 7 }),
    ).toBe('Lot 7');
    expect(evaluateFormula('AVG({readings})', { readings: [2, 4, 6] })).toBe(4);
  });

  it('extracts stable field-key dependencies and rejects unsupported syntax', () => {
    expect(formulaReferences('{mass} * {rate} + {mass}')).toEqual(['mass', 'rate']);
    expect(() => evaluateFormula('globalThis.process.exit()', {})).toThrow(/unsupported|expected/i);
  });
});

describe('workspace configurable data boundaries', () => {
  it('pages and searches the table catalog without wildcard semantics', async () => {
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('join workspaces')) return { rowCount: 1, rows: [{ system: false }] };
      if (sql.includes('count(*)')) return { rowCount: 1, rows: [{ count: '3' }] };
      return {
        rowCount: 1,
        rows: [
          {
            id: 'object-1',
            public_id: 't1234567890abcd',
            project_id: 'project-1',
            name: 'Specification',
            plural_name: 'Specifications',
            key: 'specification',
            icon: 'table',
            description: 'Controlled requirements',
            system: false,
          },
        ],
        parameters,
      };
    });
    const repository = await ScopedProjectRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listObjectTypePage({ query: ' SPEC% ', limit: 1, offset: 1 }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ name: 'Specification', publicId: 't1234567890abcd' })],
      pageInfo: { limit: 1, offset: 1, total: 3, hasNext: true },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('position($5 in lower'), [
      'project-1',
      'owner',
      'actor-1',
      'organization-1',
      'spec%',
      1,
      1,
    ]);
  });

  it('rejects project-scoped resource fields in the workspace system project', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('join workspaces')
        ? { rowCount: 1, rows: [{ system: true }] }
        : { rowCount: 1, rows: [{ visible: true, allowed: true }] },
    );
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
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rejects defaults for fields whose values use dedicated reference storage', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('join workspaces')
        ? { rowCount: 1, rows: [{ system: false }] }
        : { rowCount: 1, rows: [{ visible: true, allowed: true }] },
    );
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
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rejects empty defaults before they can bypass required-field backfills', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('join workspaces')
        ? { rowCount: 1, rows: [{ system: false }] }
        : { rowCount: 1, rows: [{ visible: true, allowed: true }] },
    );
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
    expect(query).toHaveBeenCalledTimes(2);
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
      query: vi.fn(async (sql: string) =>
        sql.includes('join workspaces')
          ? { rowCount: 1, rows: [{ system: false }] }
          : { rowCount: 1, rows: [{ visible: true, allowed: true }] },
      ),
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
      query: vi.fn(async (sql: string) =>
        sql.includes('join workspaces')
          ? { rowCount: 1, rows: [{ system: true }] }
          : { rowCount: 1, rows: [{ visible: true, allowed: true }] },
      ),
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

describe('scoped record CSV export', () => {
  it('exports every matching row with only the requested visible fields', async () => {
    const auditQuery = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const client = { query: auditQuery, release: vi.fn() };
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ system: false }] }),
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const repository = await ScopedProjectRepository.open(pool, actor, 'workspace-1', 'project-1');
    vi.spyOn(repository, 'listFields').mockResolvedValue([
      {
        id: 'field-serial',
        key: 'serial',
        fieldType: 'text',
        projectionStatus: 'ready',
      },
      {
        id: 'field-internal',
        key: 'internal-note',
        fieldType: 'text',
        projectionStatus: 'ready',
      },
    ] as never);
    const record = (id: string, displayName: string, serial: string) =>
      ({
        id,
        displayName,
        values: { serial, 'internal-note': 'not exported' },
        relations: {},
        fileReferences: {},
        datasetReferences: {},
        measurements: {},
      }) as never;
    const queryRecords = vi
      .spyOn(repository, 'queryRecords')
      .mockResolvedValueOnce({
        items: [record('record-1', 'First, sample', 'A-1')],
        page: 1,
        pageSize: 500,
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [record('record-2', 'Second sample', 'A-2')],
        page: 2,
        pageSize: 500,
        total: 2,
      });

    const csv = await repository.exportRecordsCsv('object-1', 'request-1', {
      fields: ['serial'],
      filters: [{ fieldId: 'field-serial', operator: 'eq', value: 'A-1' }],
      sorts: [{ systemField: 'displayName', direction: 'asc' }],
      search: 'sample',
      archiveState: 'all',
    });

    expect(csv).toBe('displayName,serial\r\n"First, sample",A-1\r\nSecond sample,A-2\r\n');
    expect(queryRecords).toHaveBeenNthCalledWith(
      1,
      'object-1',
      expect.objectContaining({
        filters: [{ fieldId: 'field-serial', operator: 'eq', value: 'A-1' }],
        sorts: [{ systemField: 'displayName', direction: 'asc' }],
        search: 'sample',
        archiveState: 'all',
        page: 1,
        pageSize: 500,
      }),
    );
    expect(queryRecords).toHaveBeenNthCalledWith(
      2,
      'object-1',
      expect.objectContaining({ page: 2, pageSize: 500 }),
    );
    const auditParameters = auditQuery.mock.calls.find(([sql]) =>
      String(sql).includes('insert into audit_events'),
    )?.[1] as unknown[];
    expect(JSON.parse(String(auditParameters[9]))).toEqual({
      rowCount: 2,
      fieldCount: 1,
      archiveState: 'all',
      scoped: true,
    });
  });
});
