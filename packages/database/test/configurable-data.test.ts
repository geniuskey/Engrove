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
