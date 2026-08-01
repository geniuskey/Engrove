import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  assertCompatibleUnit,
  compareCanonical,
  convertQuantity,
  type Dimension,
} from '@engrove/units';
import { appendAudit, RepositoryError, type ActorSession, type AuditInput } from './community.js';
import { evaluateNewRecord } from './engineering-types.js';
import { installDefaultVisualizations } from './visualizations.js';

export const RECORD_PROJECTION_VERSION = 1;

export const configurableFieldTypes = [
  'text',
  'long_text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'single_select',
  'multi_select',
  'user',
  'relation',
  'quantity',
  'measurement',
  'range',
  'file',
  'dataset',
] as const;

export type ConfigurableFieldType = (typeof configurableFieldTypes)[number];
export type ProjectionStatus = 'ready' | 'rebuilding' | 'failed';
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ProjectScope {
  actor: ActorSession;
  workspaceId: string;
  projectId: string;
}

export interface ObjectTypeRow {
  id: string;
  projectId: string;
  name: string;
  pluralName: string;
  key: string;
  icon: string;
  description: string;
  system: boolean;
}

export interface FieldDefinitionRow {
  id: string;
  projectId: string;
  objectTypeId: string;
  name: string;
  key: string;
  description: string;
  fieldType: ConfigurableFieldType;
  required: boolean;
  unique: boolean;
  position: number;
  config: Record<string, JsonValue>;
  defaultValue: JsonValue | undefined;
  system: boolean;
  projectionStatus: ProjectionStatus;
  projectionVersion: number;
}

export interface RecordRow {
  id: string;
  projectId: string;
  objectTypeId: string;
  displayName: string;
  values: Record<string, JsonValue>;
  relations: Record<string, string[]>;
  fileReferences: Record<string, string[]>;
  datasetReferences: Record<string, string[]>;
  measurements: Record<
    string,
    { resultId: string | null; value: string | null; unit: string | null; status: string | null }
  >;
  rowVersion: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RecordFilterOperator =
  'eq' | 'ne' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is_null';

export interface RecordFilter {
  fieldId: string;
  operator: RecordFilterOperator;
  value?: JsonValue;
}

export interface RecordSort {
  fieldId?: string;
  systemField?: 'displayName' | 'createdAt' | 'updatedAt';
  direction: 'asc' | 'desc';
}

export interface RecordQuery {
  filters?: RecordFilter[];
  sorts?: RecordSort[];
  groupByFieldId?: string;
  page?: number;
  pageSize?: number;
  includeArchived?: boolean;
}

export interface RecordQueryResult {
  items: RecordRow[];
  page: number;
  pageSize: number;
  total: number;
  groups?: Array<{ value: string | null; count: number }>;
}

interface ProjectionValue {
  ordinal: number;
  valueKind: 'text' | 'numeric' | 'boolean' | 'date' | 'datetime' | 'uuid';
  value: string | boolean;
  uniqueKey: string | undefined;
}

interface DbFieldRow {
  id: string;
  project_id: string;
  object_type_id: string;
  name: string;
  key: string;
  description: string;
  field_type: ConfigurableFieldType;
  required: boolean;
  unique: boolean;
  position: number;
  config: Record<string, JsonValue>;
  default_value: JsonValue | null;
  system: boolean;
  projection_status: ProjectionStatus;
  projection_version: number;
}

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin isolation level serializable');
    const result = await action(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function mapObjectType(row: Record<string, unknown>): ObjectTypeRow {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    pluralName: String(row.plural_name),
    key: String(row.key),
    icon: String(row.icon),
    description: String(row.description),
    system: Boolean(row.system),
  };
}

function mapField(row: DbFieldRow): FieldDefinitionRow {
  return {
    id: row.id,
    projectId: row.project_id,
    objectTypeId: row.object_type_id,
    name: row.name,
    key: row.key,
    description: row.description,
    fieldType: row.field_type,
    required: row.required,
    unique: row.unique,
    position: row.position,
    config: row.config,
    defaultValue: row.default_value ?? undefined,
    system: row.system,
    projectionStatus: row.projection_status,
    projectionVersion: row.projection_version,
  };
}

export function canonicalDecimal(value: unknown, integerOnly = false): string {
  const source = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof source !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(source)) {
    throw new Error(integerOnly ? 'must be an integer' : 'must be a canonical decimal string');
  }
  const negative = source.startsWith('-');
  const unsigned = source.replace(/^[+-]/, '');
  const [mantissa, exponentText = '0'] = unsigned.toLowerCase().split('e');
  const exponent = Number(exponentText);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 1000)
    throw new Error('exponent is out of range');
  const [whole = '', fraction = ''] = mantissa!.split('.');
  const significant = `${whole}${fraction}`.replace(/^0+/, '');
  if (significant.length > 34) throw new Error('must contain at most 34 significant digits');
  const digits = `${whole}${fraction}`.replace(/^0+/, '') || '0';
  const decimalAt = whole.length + exponent - (`${whole}${fraction}`.length - digits.length);
  let normalized: string;
  if (digits === '0') normalized = '0';
  else if (decimalAt <= 0) normalized = `0.${'0'.repeat(-decimalAt)}${digits}`;
  else if (decimalAt >= digits.length)
    normalized = `${digits}${'0'.repeat(decimalAt - digits.length)}`;
  else normalized = `${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
  normalized = normalized.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (integerOnly && normalized.includes('.')) throw new Error('must be an integer');
  return negative && normalized !== '0' ? `-${normalized}` : normalized;
}

function canonicalDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('must use YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('must be a real calendar date');
  }
  return value;
}

function canonicalDateTime(value: unknown): string {
  if (typeof value !== 'string') throw new Error('must be an ISO 8601 datetime');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('must be an ISO 8601 datetime');
  return parsed.toISOString();
}

function selectKeys(field: FieldDefinitionRow): Set<string> {
  const options = field.config.options;
  if (!Array.isArray(options)) return new Set();
  return new Set(
    options.flatMap((option) =>
      option &&
      typeof option === 'object' &&
      !Array.isArray(option) &&
      typeof option.key === 'string'
        ? [option.key]
        : [],
    ),
  );
}

function fieldProjection(field: FieldDefinitionRow, value: JsonValue): ProjectionValue[] {
  if (value === null || value === '') return [];
  const unique = (prefix: string, canonical: string) =>
    field.unique ? `${prefix}:${canonical}` : undefined;
  switch (field.fieldType) {
    case 'text':
    case 'long_text': {
      if (typeof value !== 'string') throw new Error('must be text');
      const normalized = value.normalize('NFC');
      return [
        {
          ordinal: 0,
          valueKind: 'text',
          value: normalized,
          uniqueKey: unique('text', normalized),
        },
      ];
    }
    case 'integer': {
      const normalized = canonicalDecimal(value, true);
      return [
        {
          ordinal: 0,
          valueKind: 'numeric',
          value: normalized,
          uniqueKey: unique('integer', normalized),
        },
      ];
    }
    case 'decimal': {
      const normalized = canonicalDecimal(value);
      return [
        {
          ordinal: 0,
          valueKind: 'numeric',
          value: normalized,
          uniqueKey: unique('decimal', normalized),
        },
      ];
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error('must be true or false');
      return [{ ordinal: 0, valueKind: 'boolean', value, uniqueKey: undefined }];
    case 'date': {
      const normalized = canonicalDate(value);
      return [
        {
          ordinal: 0,
          valueKind: 'date',
          value: normalized,
          uniqueKey: unique('date', normalized),
        },
      ];
    }
    case 'datetime': {
      const normalized = canonicalDateTime(value);
      return [
        {
          ordinal: 0,
          valueKind: 'datetime',
          value: normalized,
          uniqueKey: unique('datetime', normalized),
        },
      ];
    }
    case 'single_select': {
      if (typeof value !== 'string' || !selectKeys(field).has(value)) {
        throw new Error('must be a configured option key');
      }
      return [
        {
          ordinal: 0,
          valueKind: 'text',
          value,
          uniqueKey: unique('select', value),
        },
      ];
    }
    case 'multi_select': {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new Error('must be an array of option keys');
      }
      if (
        new Set(value).size !== value.length ||
        value.some((item) => !selectKeys(field).has(item as string))
      ) {
        throw new Error('contains an unknown or duplicate option key');
      }
      return value.map((item, ordinal) => ({
        ordinal,
        valueKind: 'text',
        value: item as string,
        uniqueKey: undefined,
      }));
    }
    case 'user':
      if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
        throw new Error('must be a user UUID');
      }
      return [
        {
          ordinal: 0,
          valueKind: 'uuid',
          value,
          uniqueKey: unique('user', value.toLowerCase()),
        },
      ];
    case 'relation':
      throw new Error('must be supplied through the relations property');
    case 'measurement':
      throw new Error('observations must be supplied through measurement results');
    case 'file':
    case 'dataset':
      throw new Error('references must be supplied through their dedicated endpoint');
    case 'range':
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('must be a range object');
      return [];
    case 'quantity': {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        typeof value.value !== 'string' ||
        typeof value.unit !== 'string'
      )
        throw new Error('must contain decimal string value and unit');
      const dimension = String(field.config.dimension) as Dimension;
      if (!(field.config.allowedUnits as JsonValue[]).includes(value.unit))
        throw new Error('uses a unit that is not allowed');
      const quantity = convertQuantity(value.value, value.unit, dimension);
      return [
        {
          ordinal: 0,
          valueKind: 'numeric',
          value: quantity.canonicalValue,
          uniqueKey: unique(
            'quantity',
            `${quantity.dimension}:${quantity.canonicalUnit}:${quantity.canonicalValue}`,
          ),
        },
      ];
    }
  }
}

function normalizeValue(field: FieldDefinitionRow, value: JsonValue): JsonValue {
  if (field.fieldType === 'quantity') {
    const input = value as {
      value: string;
      unit: string;
      precision?: number;
      uncertainty?: string;
    };
    return {
      ...convertQuantity(input.value, input.unit, String(field.config.dimension) as Dimension),
      ...(input.precision === undefined ? {} : { precision: input.precision }),
      ...(input.uncertainty === undefined
        ? {}
        : { uncertainty: canonicalDecimal(input.uncertainty) }),
    };
  }
  if (field.fieldType === 'range') {
    const input = value as {
      lower?: { value: string; unit: string };
      upper?: { value: string; unit: string };
    };
    const dimension = String(field.config.dimension) as Dimension;
    const allowed = field.config.allowedUnits as JsonValue[];
    if (
      (input.lower && !allowed.includes(input.lower.unit)) ||
      (input.upper && !allowed.includes(input.upper.unit))
    )
      throw new Error('uses a unit that is not allowed');
    if (!input.lower && !input.upper) throw new Error('requires a lower or upper bound');
    const lower = input.lower
      ? convertQuantity(input.lower.value, input.lower.unit, dimension)
      : undefined;
    const upper = input.upper
      ? convertQuantity(input.upper.value, input.upper.unit, dimension)
      : undefined;
    if (lower && upper && compareCanonical(lower.canonicalValue, upper.canonicalValue) > 0)
      throw new Error('lower bound exceeds upper bound');
    return { ...(lower ? { lower } : {}), ...(upper ? { upper } : {}) };
  }
  const projection = fieldProjection(field, value);
  if (!projection.length) return value;
  if (field.fieldType === 'integer' || field.fieldType === 'decimal') return projection[0]!.value;
  if (field.fieldType === 'date' || field.fieldType === 'datetime') return projection[0]!.value;
  if (field.fieldType === 'text' || field.fieldType === 'long_text') return projection[0]!.value;
  return value;
}

function validateConfig(type: ConfigurableFieldType, config: Record<string, JsonValue>): void {
  if (type === 'single_select' || type === 'multi_select') {
    const options = config.options;
    if (!Array.isArray(options) || options.length === 0) {
      throw new RepositoryError('FIELD_CONFIG_INVALID', 400, 'Select fields require options.');
    }
    const keys = options.map((option) =>
      option && typeof option === 'object' && !Array.isArray(option) ? option.key : undefined,
    );
    if (
      keys.some((key) => typeof key !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(key)) ||
      new Set(keys).size !== keys.length
    ) {
      throw new RepositoryError('FIELD_CONFIG_INVALID', 400, 'Select option keys must be unique.');
    }
  }
  if (type === 'relation') {
    const target = config.targetObjectTypeId;
    if (typeof target !== 'string' || !/^[0-9a-f-]{36}$/i.test(target)) {
      throw new RepositoryError(
        'FIELD_CONFIG_INVALID',
        400,
        'Relation fields require targetObjectTypeId.',
      );
    }
  }
  if (type === 'quantity' || type === 'measurement' || type === 'range') {
    const dimension = config.dimension;
    const canonicalUnit = config.canonicalUnit;
    const allowedUnits = config.allowedUnits;
    if (
      typeof dimension !== 'string' ||
      typeof canonicalUnit !== 'string' ||
      !Array.isArray(allowedUnits) ||
      allowedUnits.some((unit) => typeof unit !== 'string')
    )
      throw new RepositoryError(
        'FIELD_CONFIG_INVALID',
        400,
        'Engineering fields require dimension, canonicalUnit, and allowedUnits.',
      );
    try {
      assertCompatibleUnit(canonicalUnit, dimension as Dimension);
      for (const unit of allowedUnits) assertCompatibleUnit(unit as string, dimension as Dimension);
    } catch {
      throw new RepositoryError(
        'FIELD_CONFIG_INVALID',
        400,
        'Field units must exist and share the configured dimension.',
      );
    }
  }
}

function uniqueAllowed(type: ConfigurableFieldType): boolean {
  return [
    'text',
    'long_text',
    'integer',
    'decimal',
    'date',
    'datetime',
    'single_select',
    'user',
    'quantity',
  ].includes(type);
}

function projectionColumn(field: FieldDefinitionRow): string {
  switch (field.fieldType) {
    case 'text':
    case 'long_text':
    case 'single_select':
    case 'multi_select':
      return 'text_value';
    case 'integer':
    case 'decimal':
    case 'quantity':
      return 'numeric_value';
    case 'boolean':
      return 'boolean_value';
    case 'date':
      return 'date_value';
    case 'datetime':
      return 'datetime_value';
    case 'user':
      return 'uuid_value';
    case 'relation':
      throw new RepositoryError('FIELD_SORT_UNSUPPORTED', 400, 'Relation fields cannot be sorted.');
    case 'measurement':
    case 'range':
    case 'file':
    case 'dataset':
      throw new RepositoryError('FIELD_SORT_UNSUPPORTED', 400, 'This field type cannot be sorted.');
  }
}

function canonicalQueryValue(field: FieldDefinitionRow, value: JsonValue): string | boolean {
  if (field.fieldType === 'multi_select') {
    if (typeof value !== 'string' || !selectKeys(field).has(value)) {
      throw new RepositoryError('FIELD_VALIDATION_FAILED', 400, 'Invalid select filter value.');
    }
    return value;
  }
  if (field.fieldType === 'relation') {
    if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
      throw new RepositoryError('FIELD_VALIDATION_FAILED', 400, 'Invalid relation filter value.');
    }
    return value;
  }
  try {
    const projected = fieldProjection(field, value)[0];
    if (!projected) throw new Error('cannot be empty');
    return projected.value;
  } catch (error) {
    throw new RepositoryError(
      'FIELD_VALIDATION_FAILED',
      400,
      `Invalid filter for '${field.key}': ${error instanceof Error ? error.message : 'invalid'}.`,
    );
  }
}

export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) throw new RepositoryError('CSV_INVALID', 400, 'CSV contains an unterminated quote.');
  if (cell.length || row.length) {
    row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value.length > 0));
}

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvValue(field: FieldDefinitionRow, cell: string): JsonValue | undefined {
  if (cell === '') return undefined;
  switch (field.fieldType) {
    case 'boolean':
      if (cell.toLowerCase() === 'true') return true;
      if (cell.toLowerCase() === 'false') return false;
      return cell;
    case 'multi_select':
      return cell
        .split(';')
        .map((value) => value.trim())
        .filter(Boolean);
    case 'quantity':
    case 'range':
      try {
        return JSON.parse(cell) as JsonValue;
      } catch {
        return cell;
      }
    default:
      return cell;
  }
}

export interface CsvImportResult {
  imported: number;
  failed: number;
  createdIds: string[];
  errors: Array<{ row: number; field?: string; reason: string }>;
  idempotentReplay: boolean;
}

function mapUniqueViolation(error: unknown): never {
  if (
    typeof error === 'object' &&
    error &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'record_index_values_field_unique_key'
  ) {
    throw new RepositoryError(
      'DUPLICATE_FIELD_VALUE',
      409,
      'A unique field already contains this canonical value.',
    );
  }
  throw error;
}

interface TemplateField {
  key: string;
  name: string;
  type: ConfigurableFieldType;
  required?: boolean;
  unique?: boolean;
  options?: Array<{ key: string; label: string }>;
  target?: string;
  config?: Record<string, JsonValue>;
}

interface TemplateObject {
  key: string;
  name: string;
  pluralName: string;
  icon: string;
  fields: TemplateField[];
}

const statusOptions = [
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'complete', label: 'Complete' },
];

const phase2Template: TemplateObject[] = [
  {
    key: 'test-item',
    name: 'Test Item',
    pluralName: 'Test Items',
    icon: 'package',
    fields: [
      { key: 'name', name: 'Name', type: 'text', required: true },
      { key: 'part-number', name: 'Part Number', type: 'text' },
      { key: 'revision', name: 'Revision', type: 'text' },
      { key: 'description', name: 'Description', type: 'long_text' },
      { key: 'status', name: 'Status', type: 'single_select', options: statusOptions },
    ],
  },
  {
    key: 'sample',
    name: 'Sample',
    pluralName: 'Samples',
    icon: 'flask-conical',
    fields: [
      { key: 'sample-id', name: 'Sample ID', type: 'text', required: true, unique: true },
      { key: 'test-item', name: 'Test Item', type: 'relation', target: 'test-item' },
      { key: 'lot', name: 'Lot', type: 'text' },
      { key: 'batch', name: 'Batch', type: 'text' },
      { key: 'serial-number', name: 'Serial Number', type: 'text' },
      { key: 'received-date', name: 'Received Date', type: 'date' },
      { key: 'status', name: 'Status', type: 'single_select', options: statusOptions },
      { key: 'notes', name: 'Notes', type: 'long_text' },
    ],
  },
  {
    key: 'equipment',
    name: 'Equipment',
    pluralName: 'Equipment',
    icon: 'wrench',
    fields: [
      { key: 'equipment-id', name: 'Equipment ID', type: 'text', required: true, unique: true },
      { key: 'name', name: 'Name', type: 'text', required: true },
      { key: 'manufacturer', name: 'Manufacturer', type: 'text' },
      { key: 'model', name: 'Model', type: 'text' },
      { key: 'serial-number', name: 'Serial Number', type: 'text' },
      { key: 'calibration-due-date', name: 'Calibration Due Date', type: 'date' },
      { key: 'status', name: 'Status', type: 'single_select', options: statusOptions },
    ],
  },
  {
    key: 'test-method',
    name: 'Test Method',
    pluralName: 'Test Methods',
    icon: 'clipboard-list',
    fields: [
      { key: 'name', name: 'Name', type: 'text', required: true },
      { key: 'method-version', name: 'Method Version', type: 'text' },
      { key: 'description', name: 'Description', type: 'long_text' },
      {
        key: 'default-equipment',
        name: 'Default Equipment',
        type: 'relation',
        target: 'equipment',
      },
      { key: 'procedure-file', name: 'Procedure File', type: 'file' },
      { key: 'status', name: 'Status', type: 'single_select', options: statusOptions },
    ],
  },
  {
    key: 'test-run',
    name: 'Test Run',
    pluralName: 'Test Runs',
    icon: 'play',
    fields: [
      { key: 'run-id', name: 'Run ID', type: 'text', required: true, unique: true },
      { key: 'sample', name: 'Sample', type: 'relation', target: 'sample' },
      { key: 'test-method', name: 'Test Method', type: 'relation', target: 'test-method' },
      { key: 'equipment', name: 'Equipment', type: 'relation', target: 'equipment' },
      { key: 'operator', name: 'Operator', type: 'user' },
      { key: 'start-time', name: 'Start Time', type: 'datetime' },
      { key: 'end-time', name: 'End Time', type: 'datetime' },
      {
        key: 'environment-temperature',
        name: 'Environment Temperature',
        type: 'quantity',
        config: {
          dimension: 'temperature',
          canonicalUnit: 'K',
          allowedUnits: ['K', 'degC', 'degF'],
          displayPrecision: 2,
        },
      },
      { key: 'raw-file', name: 'Raw File', type: 'file' },
      { key: 'dataset', name: 'Dataset', type: 'dataset' },
      { key: 'status', name: 'Status', type: 'single_select', options: statusOptions },
    ],
  },
  {
    key: 'issue',
    name: 'Issue',
    pluralName: 'Issues',
    icon: 'circle-alert',
    fields: [
      { key: 'title', name: 'Title', type: 'text', required: true },
      { key: 'related-sample', name: 'Related Sample', type: 'relation', target: 'sample' },
      { key: 'related-test-run', name: 'Related Test Run', type: 'relation', target: 'test-run' },
      {
        key: 'severity',
        name: 'Severity',
        type: 'single_select',
        options: [
          { key: 'low', label: 'Low' },
          { key: 'medium', label: 'Medium' },
          { key: 'high', label: 'High' },
          { key: 'critical', label: 'Critical' },
        ],
      },
      { key: 'status', name: 'Status', type: 'single_select', options: statusOptions },
      { key: 'root-cause', name: 'Root Cause', type: 'long_text' },
      { key: 'corrective-action', name: 'Corrective Action', type: 'long_text' },
    ],
  },
];

export class ScopedProjectRepository {
  private constructor(
    private readonly pool: Pool,
    readonly scope: ProjectScope,
  ) {}

  static async open(
    pool: Pool,
    actor: ActorSession,
    workspaceId: string,
    projectId: string,
  ): Promise<ScopedProjectRepository> {
    const result = await pool.query(
      `select 1 from projects p join workspaces w on w.id = p.workspace_id
       where p.id = $1 and p.workspace_id = $2 and w.organization_id = $3`,
      [projectId, workspaceId, actor.organizationId],
    );
    if (!result.rowCount)
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    return new ScopedProjectRepository(pool, { actor, workspaceId, projectId });
  }

  private audit(
    input: Omit<AuditInput, 'organizationId' | 'workspaceId' | 'projectId'>,
  ): AuditInput {
    return {
      ...input,
      organizationId: this.scope.actor.organizationId,
      workspaceId: this.scope.workspaceId,
      projectId: this.scope.projectId,
    };
  }

  async listObjectTypes(): Promise<ObjectTypeRow[]> {
    const result = await this.pool.query(
      `select id, project_id, name, plural_name, key, icon, description, system
       from object_types where project_id = $1 order by name, id`,
      [this.scope.projectId],
    );
    return result.rows.map(mapObjectType);
  }

  async createObjectType(input: {
    name: string;
    pluralName: string;
    key: string;
    icon?: string;
    description?: string;
    requestId: string;
  }): Promise<ObjectTypeRow> {
    return transaction(this.pool, async (client) => {
      const id = uuidv7();
      const result = await client.query(
        `insert into object_types (id, project_id, name, plural_name, key, icon, description)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, project_id, name, plural_name, key, icon, description, system`,
        [
          id,
          this.scope.projectId,
          input.name.trim(),
          input.pluralName.trim(),
          input.key,
          input.icon ?? 'table',
          input.description ?? '',
        ],
      );
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: 'schema.object_type_created',
          targetType: 'object_type',
          targetId: id,
          requestId: input.requestId,
          payload: { key: input.key },
        }),
      );
      return mapObjectType(result.rows[0]);
    });
  }

  async listFields(objectTypeId: string): Promise<FieldDefinitionRow[]> {
    const result = await this.pool.query<DbFieldRow>(
      `select id, project_id, object_type_id, name, key, description, field_type, required,
              "unique", position, config, default_value, system, projection_status, projection_version
       from field_definitions where project_id = $1 and object_type_id = $2
       order by position, id`,
      [this.scope.projectId, objectTypeId],
    );
    if (!result.rowCount) {
      const exists = await this.pool.query(
        'select 1 from object_types where project_id = $1 and id = $2',
        [this.scope.projectId, objectTypeId],
      );
      if (!exists.rowCount)
        throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');
    }
    return result.rows.map(mapField);
  }

  async createField(input: {
    objectTypeId: string;
    name: string;
    key: string;
    description?: string;
    fieldType: ConfigurableFieldType;
    required?: boolean;
    unique?: boolean;
    position?: number;
    config?: Record<string, JsonValue>;
    defaultValue?: JsonValue;
    requestId: string;
  }): Promise<FieldDefinitionRow> {
    const config = input.config ?? {};
    validateConfig(input.fieldType, config);
    if (input.unique && !uniqueAllowed(input.fieldType)) {
      throw new RepositoryError(
        'FIELD_UNIQUE_UNSUPPORTED',
        400,
        'This field type cannot be unique.',
      );
    }
    return transaction(this.pool, async (client) => {
      const objectType = await client.query(
        'select 1 from object_types where project_id = $1 and id = $2',
        [this.scope.projectId, input.objectTypeId],
      );
      if (!objectType.rowCount)
        throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');
      const recordCount = await client.query<{ count: string }>(
        'select count(*)::text as count from records where project_id = $1 and object_type_id = $2',
        [this.scope.projectId, input.objectTypeId],
      );
      if (
        input.required &&
        Number(recordCount.rows[0]?.count) > 0 &&
        input.defaultValue === undefined
      ) {
        throw new RepositoryError(
          'FIELD_DEFAULT_REQUIRED',
          409,
          'A required field added to existing records needs a default value.',
        );
      }
      const id = uuidv7();
      const field: FieldDefinitionRow = {
        id,
        projectId: this.scope.projectId,
        objectTypeId: input.objectTypeId,
        name: input.name.trim(),
        key: input.key,
        description: input.description ?? '',
        fieldType: input.fieldType,
        required: input.required ?? false,
        unique: input.unique ?? false,
        position: input.position ?? 0,
        config,
        defaultValue: input.defaultValue,
        system: false,
        projectionStatus: 'ready',
        projectionVersion: RECORD_PROJECTION_VERSION,
      };
      if (input.defaultValue !== undefined && input.fieldType !== 'relation') {
        normalizeValue(field, input.defaultValue);
      }
      if (input.fieldType === 'relation') {
        const target = await client.query(
          'select 1 from object_types where project_id = $1 and id = $2',
          [this.scope.projectId, config.targetObjectTypeId],
        );
        if (!target.rowCount)
          throw new RepositoryError(
            'RELATION_TARGET_NOT_FOUND',
            404,
            'Relation target was not found.',
          );
      }
      const result = await client.query<DbFieldRow>(
        `insert into field_definitions
          (id, project_id, object_type_id, name, key, description, field_type, required, "unique",
           position, config, default_value, projection_version)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)
         returning id, project_id, object_type_id, name, key, description, field_type, required,
                   "unique", position, config, default_value, system, projection_status, projection_version`,
        [
          id,
          this.scope.projectId,
          input.objectTypeId,
          field.name,
          input.key,
          field.description,
          input.fieldType,
          field.required,
          field.unique,
          field.position,
          JSON.stringify(config),
          input.defaultValue === undefined ? null : JSON.stringify(input.defaultValue),
          RECORD_PROJECTION_VERSION,
        ],
      );
      if (input.defaultValue !== undefined && input.fieldType !== 'relation') {
        const records = await client.query<{ id: string; values: Record<string, JsonValue> }>(
          'select id, values from records where project_id = $1 and object_type_id = $2 for update',
          [this.scope.projectId, input.objectTypeId],
        );
        for (const record of records.rows) {
          const values = {
            ...record.values,
            [field.key]: normalizeValue(field, input.defaultValue),
          };
          await client.query('update records set values = $2::jsonb where id = $1', [
            record.id,
            JSON.stringify(values),
          ]);
          await this.replaceProjection(client, record.id, field, values[field.key]!);
        }
      }
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: 'schema.field_created',
          targetType: 'field_definition',
          targetId: id,
          requestId: input.requestId,
          payload: { key: input.key, fieldType: input.fieldType },
        }),
      );
      return mapField(result.rows[0]!);
    }).catch(mapUniqueViolation);
  }

  async updateField(input: {
    objectTypeId: string;
    fieldId: string;
    name: string;
    description: string;
    required: boolean;
    unique: boolean;
    position: number;
    config: Record<string, JsonValue>;
    requestId: string;
  }): Promise<FieldDefinitionRow> {
    try {
      return await transaction(this.pool, async (client) => {
        const current = await client.query<DbFieldRow>(
          `select id, project_id, object_type_id, name, key, description, field_type, required,
                  "unique", position, config, default_value, system, projection_status, projection_version
           from field_definitions where project_id = $1 and object_type_id = $2 and id = $3 for update`,
          [this.scope.projectId, input.objectTypeId, input.fieldId],
        );
        if (!current.rows[0])
          throw new RepositoryError('FIELD_NOT_FOUND', 404, 'Field was not found.');
        const previous = mapField(current.rows[0]);
        if (previous.unique !== input.unique && previous.projectionStatus !== 'ready') {
          throw new RepositoryError(
            'FIELD_INDEX_REBUILDING',
            409,
            'Uniqueness cannot change while projection rebuilding is in progress.',
          );
        }
        validateConfig(previous.fieldType, input.config);
        if (
          ['quantity', 'measurement', 'range'].includes(previous.fieldType) &&
          (previous.config.dimension !== input.config.dimension ||
            previous.config.canonicalUnit !== input.config.canonicalUnit)
        ) {
          throw new RepositoryError(
            'FIELD_ENGINEERING_SEMANTICS_IMMUTABLE',
            409,
            'Engineering field dimension and canonical unit are immutable.',
          );
        }
        if (input.unique && !uniqueAllowed(previous.fieldType)) {
          throw new RepositoryError(
            'FIELD_UNIQUE_UNSUPPORTED',
            400,
            'This field type cannot be unique.',
          );
        }
        const next: FieldDefinitionRow = {
          ...previous,
          name: input.name.trim(),
          description: input.description,
          required: input.required,
          unique: input.unique,
          position: input.position,
          config: input.config,
        };
        const records = await client.query<{
          id: string;
          values: Record<string, JsonValue>;
        }>(
          'select id, values from records where project_id = $1 and object_type_id = $2 for update',
          [this.scope.projectId, input.objectTypeId],
        );
        if (previous.fieldType === 'relation') {
          if (
            String(previous.config.targetObjectTypeId) !== String(input.config.targetObjectTypeId)
          ) {
            const edges = await client.query(
              'select 1 from relation_edges where project_id = $1 and source_field_id = $2 limit 1',
              [this.scope.projectId, input.fieldId],
            );
            if (edges.rowCount) {
              throw new RepositoryError(
                'FIELD_CONFIG_IN_USE',
                409,
                'A relation target cannot change after the field contains data.',
              );
            }
          }
          if (input.required) {
            const missing = await client.query(
              `select 1 from records r where r.project_id = $1 and r.object_type_id = $2
               and not exists (
                 select 1 from relation_edges e where e.project_id = r.project_id
                   and e.source_record_id = r.id and e.source_field_id = $3
               ) limit 1`,
              [this.scope.projectId, input.objectTypeId, input.fieldId],
            );
            if (missing.rowCount)
              throw new RepositoryError(
                'FIELD_REQUIRED_CONFLICT',
                409,
                'Existing records do not contain this required relation.',
              );
          }
        } else {
          for (const record of records.rows) {
            const value = record.values[previous.key];
            if (value === undefined || value === null || value === '') {
              if (input.required)
                throw new RepositoryError(
                  'FIELD_REQUIRED_CONFLICT',
                  409,
                  'Existing records do not contain this required field.',
                );
              continue;
            }
            try {
              normalizeValue(next, value);
            } catch {
              throw new RepositoryError(
                'FIELD_CONFIG_IN_USE',
                409,
                'Existing values are incompatible with the proposed field configuration.',
              );
            }
          }
        }
        const updated = await client.query<DbFieldRow>(
          `update field_definitions set name = $4, description = $5, required = $6, "unique" = $7,
                  position = $8, config = $9::jsonb, updated_at = now()
           where project_id = $1 and object_type_id = $2 and id = $3
           returning id, project_id, object_type_id, name, key, description, field_type, required,
                     "unique", position, config, default_value, system, projection_status, projection_version`,
          [
            this.scope.projectId,
            input.objectTypeId,
            input.fieldId,
            next.name,
            next.description,
            next.required,
            next.unique,
            next.position,
            JSON.stringify(next.config),
          ],
        );
        if (previous.fieldType !== 'relation') {
          for (const record of records.rows) {
            const value = record.values[previous.key];
            if (value !== undefined && value !== null && value !== '') {
              await this.replaceProjection(client, record.id, next, value);
            }
          }
        }
        await appendAudit(
          client,
          this.audit({
            actorId: this.scope.actor.actorId,
            action: 'schema.field_updated',
            targetType: 'field_definition',
            targetId: input.fieldId,
            requestId: input.requestId,
            payload: { key: previous.key },
          }),
        );
        return mapField(updated.rows[0]!);
      });
    } catch (error) {
      mapUniqueViolation(error);
    }
  }

  async installTestCharacterizationTemplate(requestId: string): Promise<{
    templateKey: string;
    version: number;
    changed: boolean;
    objectTypes: ObjectTypeRow[];
  }> {
    const changed = await transaction(this.pool, async (client) => {
      const installation = await client.query<{ version: number }>(
        `select version from template_installations
         where project_id = $1 and template_key = 'test-characterization' for update`,
        [this.scope.projectId],
      );
      const currentVersion = installation.rows[0]?.version ?? 0;
      if (currentVersion >= 6) return false;

      const ids = new Map<string, string>();
      for (const object of phase2Template) {
        const existing = await client.query<{ id: string; system: boolean }>(
          'select id, system from object_types where project_id = $1 and key = $2 for update',
          [this.scope.projectId, object.key],
        );
        if (existing.rows[0] && !existing.rows[0].system) {
          throw new RepositoryError(
            'TEMPLATE_SCHEMA_CONFLICT',
            409,
            `Object type key '${object.key}' is already user-managed.`,
          );
        }
        const id = existing.rows[0]?.id ?? uuidv7();
        if (!existing.rows[0]) {
          await client.query(
            `insert into object_types
              (id, project_id, name, plural_name, key, icon, description, system)
             values ($1, $2, $3, $4, $5, $6, '', true)`,
            [id, this.scope.projectId, object.name, object.pluralName, object.key, object.icon],
          );
        }
        ids.set(object.key, id);
      }

      for (const object of phase2Template) {
        const objectTypeId = ids.get(object.key)!;
        for (const [position, field] of object.fields.entries()) {
          const existing = await client.query<{
            id: string;
            system: boolean;
            field_type: ConfigurableFieldType;
          }>(
            `select id, system, field_type from field_definitions
             where project_id = $1 and object_type_id = $2 and key = $3 for update`,
            [this.scope.projectId, objectTypeId, field.key],
          );
          if (
            existing.rows[0] &&
            (!existing.rows[0].system || existing.rows[0].field_type !== field.type)
          ) {
            throw new RepositoryError(
              'TEMPLATE_SCHEMA_CONFLICT',
              409,
              `Field key '${object.key}.${field.key}' is incompatible with the template.`,
            );
          }
          if (!existing.rows[0]) {
            const config: Record<string, JsonValue> = {};
            Object.assign(config, field.config ?? {});
            if (field.options) config.options = field.options;
            if (field.target) {
              config.targetObjectTypeId = ids.get(field.target)!;
              config.multiple = false;
            }
            await client.query(
              `insert into field_definitions
                (id, project_id, object_type_id, name, key, field_type, required, "unique",
                 position, config, system, projection_version)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, true, $11)`,
              [
                uuidv7(),
                this.scope.projectId,
                objectTypeId,
                field.name,
                field.key,
                field.type,
                field.required ?? false,
                field.unique ?? false,
                position,
                JSON.stringify(config),
                RECORD_PROJECTION_VERSION,
              ],
            );
          }
        }
      }

      if (currentVersion < 4) await installDefaultVisualizations(client, this.scope);

      await client.query(
        `insert into template_installations
          (id, project_id, template_key, version, installed_by)
         values ($1, $2, 'test-characterization', 6, $3)
         on conflict (project_id, template_key) do update
           set version = excluded.version, installed_by = excluded.installed_by, updated_at = now()`,
        [uuidv7(), this.scope.projectId, this.scope.actor.actorId],
      );
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: 'template.installed',
          targetType: 'project',
          targetId: this.scope.projectId,
          requestId,
          payload: {
            templateKey: 'test-characterization',
            version: 6,
            completedCapabilities: [
              'configurable-schema',
              'engineering-types',
              'files-and-datasets',
              'visualization',
              'work-management',
              'onboarding-and-demo',
            ],
            taskLinkEntityTypes: [
              'sample',
              'issue',
              'test_run',
              'measurement_result',
              'specification_evaluation',
              'dataset',
            ],
          },
        }),
      );
      return true;
    });
    return {
      templateKey: 'test-characterization',
      version: 6,
      changed,
      objectTypes: await this.listObjectTypes(),
    };
  }

  private async replaceProjection(
    client: PoolClient,
    recordId: string,
    field: FieldDefinitionRow,
    value: JsonValue,
  ): Promise<void> {
    await client.query('delete from record_index_values where record_id = $1 and field_id = $2', [
      recordId,
      field.id,
    ]);
    for (const item of fieldProjection(field, value)) {
      const columns: Record<ProjectionValue['valueKind'], string> = {
        text: 'text_value',
        numeric: 'numeric_value',
        boolean: 'boolean_value',
        date: 'date_value',
        datetime: 'datetime_value',
        uuid: 'uuid_value',
      };
      const column = columns[item.valueKind];
      await client.query(
        `insert into record_index_values
          (id, project_id, object_type_id, record_id, field_id, ordinal, value_kind, ${column}, unique_key, projection_version)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          uuidv7(),
          this.scope.projectId,
          field.objectTypeId,
          recordId,
          field.id,
          item.ordinal,
          item.valueKind,
          item.value,
          item.uniqueKey ?? null,
          RECORD_PROJECTION_VERSION,
        ],
      );
    }
  }

  private async fieldsForObject(
    client: PoolClient,
    objectTypeId: string,
  ): Promise<FieldDefinitionRow[]> {
    const result = await client.query<DbFieldRow>(
      `select id, project_id, object_type_id, name, key, description, field_type, required,
              "unique", position, config, default_value, system, projection_status, projection_version
       from field_definitions where project_id = $1 and object_type_id = $2 order by position, id`,
      [this.scope.projectId, objectTypeId],
    );
    return result.rows.map(mapField);
  }

  private async normalizeRecordInput(
    client: PoolClient,
    objectTypeId: string,
    suppliedValues: Record<string, JsonValue>,
    suppliedRelations: Record<string, string[]>,
    suppliedFiles: Record<string, string[]>,
    suppliedDatasets: Record<string, string[]>,
    creating: boolean,
  ): Promise<{
    fields: FieldDefinitionRow[];
    values: Record<string, JsonValue>;
    relations: Record<string, string[]>;
    fileReferences: Record<string, string[]>;
    datasetReferences: Record<string, string[]>;
  }> {
    const objectType = await client.query(
      'select 1 from object_types where project_id = $1 and id = $2',
      [this.scope.projectId, objectTypeId],
    );
    if (!objectType.rowCount)
      throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');
    const fields = await this.fieldsForObject(client, objectTypeId);
    const byKey = new Map(fields.map((field) => [field.key, field]));
    const byId = new Map(fields.map((field) => [field.id, field]));
    for (const key of Object.keys(suppliedValues)) {
      const field = byKey.get(key);
      if (!field || ['relation', 'measurement', 'file', 'dataset'].includes(field.fieldType)) {
        throw new RepositoryError('FIELD_VALIDATION_FAILED', 400, `Unknown value field '${key}'.`);
      }
    }
    for (const fieldId of Object.keys(suppliedRelations)) {
      const field = byId.get(fieldId);
      if (!field || field.fieldType !== 'relation') {
        throw new RepositoryError(
          'FIELD_VALIDATION_FAILED',
          400,
          `Unknown relation field '${fieldId}'.`,
        );
      }
    }
    for (const [kind, supplied] of [
      ['file', suppliedFiles],
      ['dataset', suppliedDatasets],
    ] as const)
      for (const fieldId of Object.keys(supplied)) {
        const field = byId.get(fieldId);
        if (!field || field.fieldType !== kind)
          throw new RepositoryError(
            'FIELD_VALIDATION_FAILED',
            400,
            `Unknown ${kind} field '${fieldId}'.`,
          );
      }

    const values: Record<string, JsonValue> = { ...suppliedValues };
    const relations: Record<string, string[]> = { ...suppliedRelations };
    const fileReferences: Record<string, string[]> = { ...suppliedFiles };
    const datasetReferences: Record<string, string[]> = { ...suppliedDatasets };
    for (const field of fields) {
      if (field.fieldType === 'relation') {
        const targets = relations[field.id] ?? [];
        if (field.required && targets.length === 0) {
          throw new RepositoryError(
            'FIELD_VALIDATION_FAILED',
            400,
            `Field '${field.key}' is required.`,
          );
        }
        if (field.config.multiple === false && targets.length > 1) {
          throw new RepositoryError(
            'FIELD_VALIDATION_FAILED',
            400,
            `Field '${field.key}' accepts only one relation.`,
          );
        }
        if (new Set(targets).size !== targets.length) {
          throw new RepositoryError(
            'FIELD_VALIDATION_FAILED',
            400,
            `Field '${field.key}' contains duplicate relations.`,
          );
        }
        if (targets.length) {
          const targetTypeId = String(field.config.targetObjectTypeId);
          const targetRows = await client.query<{ id: string }>(
            `select id from records
             where project_id = $1 and object_type_id = $2 and id = any($3::uuid[])`,
            [this.scope.projectId, targetTypeId, targets],
          );
          if (targetRows.rowCount !== targets.length) {
            throw new RepositoryError(
              'RELATION_TARGET_NOT_FOUND',
              404,
              'A relation target was not found.',
            );
          }
        }
        relations[field.id] = targets;
        continue;
      }
      if (field.fieldType === 'file' || field.fieldType === 'dataset') {
        const references =
          field.fieldType === 'file'
            ? (fileReferences[field.id] ?? [])
            : (datasetReferences[field.id] ?? []);
        if (field.required && references.length === 0)
          throw new RepositoryError(
            'FIELD_VALIDATION_FAILED',
            400,
            `Field '${field.key}' is required.`,
          );
        if (references.length > 1 || new Set(references).size !== references.length)
          throw new RepositoryError(
            'FIELD_VALIDATION_FAILED',
            400,
            `Field '${field.key}' accepts one exact reference.`,
          );
        if (references.length) {
          const resource = await client.query(
            field.fieldType === 'file'
              ? "select 1 from file_objects where project_id=$1 and id=$2 and status='available'"
              : "select 1 from datasets where project_id=$1 and id=$2 and status='ready'",
            [this.scope.projectId, references[0]],
          );
          if (!resource.rowCount)
            throw new RepositoryError(
              field.fieldType === 'file' ? 'FILE_NOT_AVAILABLE' : 'DATASET_NOT_READY',
              409,
              `Field '${field.key}' references an unavailable resource.`,
            );
        }
        if (field.fieldType === 'file') fileReferences[field.id] = references;
        else datasetReferences[field.id] = references;
        continue;
      }
      if (field.fieldType === 'measurement') continue;
      if (field.unique && field.projectionStatus !== 'ready') {
        throw new RepositoryError(
          'FIELD_INDEX_REBUILDING',
          409,
          `Unique field '${field.key}' is unavailable while projection rebuilding is in progress.`,
        );
      }
      let value = values[field.key];
      if (creating && value === undefined && field.defaultValue !== undefined)
        value = field.defaultValue;
      if (value === undefined || value === null || value === '') {
        if (field.required) {
          throw new RepositoryError(
            'FIELD_VALIDATION_FAILED',
            400,
            `Field '${field.key}' is required.`,
          );
        }
        delete values[field.key];
        continue;
      }
      try {
        values[field.key] = normalizeValue(field, value);
      } catch (error) {
        throw new RepositoryError(
          'FIELD_VALIDATION_FAILED',
          400,
          `Field '${field.key}' ${error instanceof Error ? error.message : 'is invalid'}.`,
        );
      }
      if (field.fieldType === 'user') {
        const member = await client.query(
          'select 1 from memberships where organization_id = $1 and user_id = $2',
          [this.scope.actor.organizationId, values[field.key]],
        );
        if (!member.rowCount)
          throw new RepositoryError(
            'FIELD_VALIDATION_FAILED',
            400,
            `Field '${field.key}' references an unknown user.`,
          );
      }
    }
    return { fields, values, relations, fileReferences, datasetReferences };
  }

  private async replaceRecordDerivedData(
    client: PoolClient,
    recordId: string,
    fields: FieldDefinitionRow[],
    values: Record<string, JsonValue>,
    relations: Record<string, string[]>,
    fileReferences: Record<string, string[]>,
    datasetReferences: Record<string, string[]>,
  ): Promise<void> {
    await client.query('delete from record_index_values where project_id = $1 and record_id = $2', [
      this.scope.projectId,
      recordId,
    ]);
    await client.query(
      'delete from relation_edges where project_id = $1 and source_record_id = $2',
      [this.scope.projectId, recordId],
    );
    await client.query('delete from record_file_references where project_id=$1 and record_id=$2', [
      this.scope.projectId,
      recordId,
    ]);
    await client.query(
      'delete from record_dataset_references where project_id=$1 and record_id=$2',
      [this.scope.projectId, recordId],
    );
    for (const field of fields) {
      if (field.fieldType === 'relation') {
        for (const targetRecordId of relations[field.id] ?? []) {
          await client.query(
            `insert into relation_edges
              (id, project_id, source_record_id, source_field_id, target_record_id)
             values ($1, $2, $3, $4, $5)`,
            [uuidv7(), this.scope.projectId, recordId, field.id, targetRecordId],
          );
        }
      } else if (field.fieldType === 'file') {
        for (const fileId of fileReferences[field.id] ?? [])
          await client.query(
            'insert into record_file_references (id,project_id,record_id,field_id,file_id) values ($1,$2,$3,$4,$5)',
            [uuidv7(), this.scope.projectId, recordId, field.id, fileId],
          );
      } else if (field.fieldType === 'dataset') {
        for (const datasetId of datasetReferences[field.id] ?? [])
          await client.query(
            'insert into record_dataset_references (id,project_id,record_id,field_id,dataset_id) values ($1,$2,$3,$4,$5)',
            [uuidv7(), this.scope.projectId, recordId, field.id, datasetId],
          );
      } else if (values[field.key] !== undefined) {
        await this.replaceProjection(client, recordId, field, values[field.key]!);
      }
    }
  }

  private async loadRelations(recordIds: string[]): Promise<Map<string, Record<string, string[]>>> {
    const mapped = new Map<string, Record<string, string[]>>();
    if (!recordIds.length) return mapped;
    const result = await this.pool.query<{
      source_record_id: string;
      source_field_id: string;
      target_record_id: string;
    }>(
      `select source_record_id, source_field_id, target_record_id from relation_edges
       where project_id = $1 and source_record_id = any($2::uuid[])
       order by source_field_id, target_record_id`,
      [this.scope.projectId, recordIds],
    );
    for (const row of result.rows) {
      const relations = mapped.get(row.source_record_id) ?? {};
      (relations[row.source_field_id] ??= []).push(row.target_record_id);
      mapped.set(row.source_record_id, relations);
    }
    return mapped;
  }

  private async loadResourceReferences(recordIds: string[]) {
    const files = new Map<string, Record<string, string[]>>();
    const datasets = new Map<string, Record<string, string[]>>();
    if (!recordIds.length) return { files, datasets };
    for (const [table, target, mapped] of [
      ['record_file_references', 'file_id', files],
      ['record_dataset_references', 'dataset_id', datasets],
    ] as const) {
      const result = await this.pool.query<{
        record_id: string;
        field_id: string;
        target_id: string;
      }>(
        `select record_id,field_id,${target} target_id from ${table}
         where project_id=$1 and record_id=any($2::uuid[]) order by field_id,${target}`,
        [this.scope.projectId, recordIds],
      );
      for (const row of result.rows) {
        const references = mapped.get(row.record_id) ?? {};
        (references[row.field_id] ??= []).push(row.target_id);
        mapped.set(row.record_id, references);
      }
    }
    return { files, datasets };
  }

  private async loadCurrentMeasurements(recordIds: string[]) {
    const mapped = new Map<
      string,
      Record<
        string,
        {
          resultId: string | null;
          value: string | null;
          unit: string | null;
          status: string | null;
        }
      >
    >();
    if (!recordIds.length) return mapped;
    const result = await this.pool.query<{
      record_id: string;
      field_id: string;
      result_id: string | null;
      canonical_value: string | null;
      canonical_unit: string | null;
      status: string | null;
    }>(
      `select r.id record_id,f.id field_id,mr.id result_id,mr.canonical_value,mr.canonical_unit,e.status
      from records r join field_definitions f on f.project_id=r.project_id and f.object_type_id=r.object_type_id and f.field_type='measurement'
      left join lateral (select candidate.id,candidate.canonical_value,candidate.canonical_unit from measurement_results candidate where candidate.project_id=r.project_id and candidate.record_id=r.id and candidate.field_id=f.id and not exists(select 1 from measurement_results successor where successor.project_id=candidate.project_id and successor.supersedes_result_id=candidate.id) order by candidate.measured_at desc,candidate.created_at desc,candidate.id desc limit 1) mr on true
      left join lateral (select evaluation.status from specifications s join specification_revisions revision on revision.specification_id=s.id join specification_evaluations evaluation on evaluation.specification_revision_id=revision.id and evaluation.record_id=r.id and evaluation.measurement_result_id is not distinct from mr.id where s.project_id=r.project_id and s.measurement_field_id=f.id and s.status='active' order by revision.revision_number desc limit 1) e on true
      where r.project_id=$1 and r.id=any($2::uuid[])`,
      [this.scope.projectId, recordIds],
    );
    for (const row of result.rows) {
      const measurements = mapped.get(row.record_id) ?? {};
      measurements[row.field_id] = {
        resultId: row.result_id,
        value: row.canonical_value,
        unit: row.canonical_unit,
        status: row.status,
      };
      mapped.set(row.record_id, measurements);
    }
    return mapped;
  }

  private mapRecord(
    row: {
      id: string;
      project_id: string;
      object_type_id: string;
      display_name: string;
      values: Record<string, JsonValue>;
      row_version: number;
      archived_at: Date | null;
      created_at: Date;
      updated_at: Date;
    },
    relations: Record<string, string[]> = {},
    fileReferences: Record<string, string[]> = {},
    datasetReferences: Record<string, string[]> = {},
    measurements: Record<
      string,
      { resultId: string | null; value: string | null; unit: string | null; status: string | null }
    > = {},
  ): RecordRow {
    return {
      id: row.id,
      projectId: row.project_id,
      objectTypeId: row.object_type_id,
      displayName: row.display_name,
      values: row.values,
      relations,
      fileReferences,
      datasetReferences,
      measurements,
      rowVersion: row.row_version,
      archivedAt: row.archived_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async getRecord(objectTypeId: string, recordId: string): Promise<RecordRow> {
    const result = await this.pool.query(
      `select id, project_id, object_type_id, display_name, values, row_version, archived_at,
              created_at, updated_at
       from records where project_id = $1 and object_type_id = $2 and id = $3`,
      [this.scope.projectId, objectTypeId, recordId],
    );
    if (!result.rows[0])
      throw new RepositoryError('RECORD_NOT_FOUND', 404, 'Record was not found.');
    const [relations, resources, measurements] = await Promise.all([
      this.loadRelations([recordId]),
      this.loadResourceReferences([recordId]),
      this.loadCurrentMeasurements([recordId]),
    ]);
    return this.mapRecord(
      result.rows[0],
      relations.get(recordId),
      resources.files.get(recordId),
      resources.datasets.get(recordId),
      measurements.get(recordId),
    );
  }

  async createRecord(input: {
    objectTypeId: string;
    displayName: string;
    values: Record<string, JsonValue>;
    relations?: Record<string, string[]>;
    fileReferences?: Record<string, string[]>;
    datasetReferences?: Record<string, string[]>;
    requestId: string;
  }): Promise<RecordRow> {
    try {
      const id = uuidv7();
      await transaction(this.pool, async (client) => {
        const normalized = await this.normalizeRecordInput(
          client,
          input.objectTypeId,
          input.values,
          input.relations ?? {},
          input.fileReferences ?? {},
          input.datasetReferences ?? {},
          true,
        );
        await client.query(
          `insert into records
            (id, project_id, object_type_id, display_name, values, created_by, updated_by)
           values ($1, $2, $3, $4, $5::jsonb, $6, $6)`,
          [
            id,
            this.scope.projectId,
            input.objectTypeId,
            input.displayName.trim(),
            JSON.stringify(normalized.values),
            this.scope.actor.actorId,
          ],
        );
        await this.replaceRecordDerivedData(
          client,
          id,
          normalized.fields,
          normalized.values,
          normalized.relations,
          normalized.fileReferences,
          normalized.datasetReferences,
        );
        await evaluateNewRecord(client, this.scope, id, input.objectTypeId, input.requestId);
        await appendAudit(
          client,
          this.audit({
            actorId: this.scope.actor.actorId,
            action: 'record.created',
            targetType: 'record',
            targetId: id,
            requestId: input.requestId,
            payload: { objectTypeId: input.objectTypeId },
          }),
        );
      });
      return this.getRecord(input.objectTypeId, id);
    } catch (error) {
      mapUniqueViolation(error);
    }
  }

  async updateRecord(input: {
    objectTypeId: string;
    recordId: string;
    displayName: string;
    values: Record<string, JsonValue>;
    relations?: Record<string, string[]>;
    fileReferences?: Record<string, string[]>;
    datasetReferences?: Record<string, string[]>;
    rowVersion: number;
    requestId: string;
  }): Promise<RecordRow> {
    try {
      await transaction(this.pool, async (client) => {
        const existing = await client.query<{ id: string }>(
          `select id from records where project_id = $1 and object_type_id = $2 and id = $3
             and row_version = $4 for update`,
          [this.scope.projectId, input.objectTypeId, input.recordId, input.rowVersion],
        );
        if (!existing.rowCount) {
          const found = await client.query(
            'select 1 from records where project_id = $1 and object_type_id = $2 and id = $3',
            [this.scope.projectId, input.objectTypeId, input.recordId],
          );
          throw new RepositoryError(
            found.rowCount ? 'VERSION_CONFLICT' : 'RECORD_NOT_FOUND',
            found.rowCount ? 409 : 404,
            found.rowCount ? 'The record changed; reload and retry.' : 'Record was not found.',
          );
        }
        const normalized = await this.normalizeRecordInput(
          client,
          input.objectTypeId,
          input.values,
          input.relations ?? {},
          input.fileReferences ?? {},
          input.datasetReferences ?? {},
          false,
        );
        await client.query(
          `update records set display_name = $4, values = $5::jsonb, updated_by = $6,
                  row_version = row_version + 1, updated_at = now()
           where project_id = $1 and object_type_id = $2 and id = $3`,
          [
            this.scope.projectId,
            input.objectTypeId,
            input.recordId,
            input.displayName.trim(),
            JSON.stringify(normalized.values),
            this.scope.actor.actorId,
          ],
        );
        await this.replaceRecordDerivedData(
          client,
          input.recordId,
          normalized.fields,
          normalized.values,
          normalized.relations,
          normalized.fileReferences,
          normalized.datasetReferences,
        );
        await appendAudit(
          client,
          this.audit({
            actorId: this.scope.actor.actorId,
            action: 'record.updated',
            targetType: 'record',
            targetId: input.recordId,
            requestId: input.requestId,
            payload: { rowVersion: input.rowVersion + 1 },
          }),
        );
      });
      return this.getRecord(input.objectTypeId, input.recordId);
    } catch (error) {
      mapUniqueViolation(error);
    }
  }

  async importRecordsCsv(input: {
    objectTypeId: string;
    csv: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<CsvImportResult> {
    if (Buffer.byteLength(input.csv, 'utf8') > 5 * 1024 * 1024) {
      throw new RepositoryError('CSV_TOO_LARGE', 413, 'CSV import is limited to 5 MiB.');
    }
    const rows = parseCsv(input.csv);
    if (!rows.length) throw new RepositoryError('CSV_INVALID', 400, 'CSV is empty.');
    const headers = rows[0]!.map((header) => header.trim());
    if (new Set(headers).size !== headers.length || !headers.includes('displayName')) {
      throw new RepositoryError(
        'CSV_HEADER_INVALID',
        400,
        'CSV headers must be unique and include displayName.',
      );
    }
    const requestHash = hashImport(input.csv);
    return transaction(this.pool, async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `csv:${this.scope.projectId}:${this.scope.actor.actorId}:${input.idempotencyKey}`,
      ]);
      const replay = await client.query<{ request_hash: string; result: CsvImportResult }>(
        `select request_hash, result from csv_imports
         where project_id = $1 and requested_by = $2 and idempotency_key = $3`,
        [this.scope.projectId, this.scope.actor.actorId, input.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== requestHash) {
          throw new RepositoryError(
            'IDEMPOTENCY_KEY_REUSED',
            409,
            'The idempotency key was already used with different CSV content.',
          );
        }
        return { ...replay.rows[0].result, idempotentReplay: true };
      }
      const fields = await this.fieldsForObject(client, input.objectTypeId);
      const byKey = new Map(fields.map((field) => [field.key, field]));
      for (const header of headers) {
        if (header === 'displayName') continue;
        if (!byKey.has(header)) {
          throw new RepositoryError('CSV_HEADER_INVALID', 400, `Unknown CSV field '${header}'.`);
        }
      }
      const result: CsvImportResult = {
        imported: 0,
        failed: 0,
        createdIds: [],
        errors: [],
        idempotentReplay: false,
      };
      for (let index = 1; index < rows.length; index += 1) {
        const rowNumber = index + 1;
        const row = rows[index]!;
        if (row.length > headers.length) {
          result.failed += 1;
          result.errors.push({ row: rowNumber, reason: 'Row contains more cells than headers.' });
          continue;
        }
        await client.query('savepoint csv_row');
        try {
          const cells = Object.fromEntries(
            headers.map((header, cellIndex) => [header, row[cellIndex] ?? '']),
          );
          const displayName = cells.displayName?.trim();
          if (!displayName)
            throw new RepositoryError('FIELD_VALIDATION_FAILED', 400, 'displayName is required.');
          const values: Record<string, JsonValue> = {};
          const relations: Record<string, string[]> = {};
          for (const field of fields) {
            const cell = cells[field.key];
            if (cell === undefined || cell === '') continue;
            if (field.fieldType === 'relation') {
              relations[field.id] = cell
                .split(';')
                .map((value) => value.trim())
                .filter(Boolean);
            } else {
              const value = csvValue(field, cell);
              if (value !== undefined) values[field.key] = value;
            }
          }
          const normalized = await this.normalizeRecordInput(
            client,
            input.objectTypeId,
            values,
            relations,
            {},
            {},
            true,
          );
          const recordId = uuidv7();
          await client.query(
            `insert into records
              (id, project_id, object_type_id, display_name, values, created_by, updated_by)
             values ($1, $2, $3, $4, $5::jsonb, $6, $6)`,
            [
              recordId,
              this.scope.projectId,
              input.objectTypeId,
              displayName,
              JSON.stringify(normalized.values),
              this.scope.actor.actorId,
            ],
          );
          await this.replaceRecordDerivedData(
            client,
            recordId,
            normalized.fields,
            normalized.values,
            normalized.relations,
            normalized.fileReferences,
            normalized.datasetReferences,
          );
          await evaluateNewRecord(
            client,
            this.scope,
            recordId,
            input.objectTypeId,
            input.requestId,
          );
          await appendAudit(
            client,
            this.audit({
              actorId: this.scope.actor.actorId,
              action: 'record.created',
              targetType: 'record',
              targetId: recordId,
              requestId: input.requestId,
              payload: { objectTypeId: input.objectTypeId, source: 'csv', row: rowNumber },
            }),
          );
          result.createdIds.push(recordId);
          result.imported += 1;
          await client.query('release savepoint csv_row');
        } catch (error) {
          await client.query('rollback to savepoint csv_row');
          await client.query('release savepoint csv_row');
          result.failed += 1;
          const duplicate =
            typeof error === 'object' &&
            error &&
            'constraint' in error &&
            error.constraint === 'record_index_values_field_unique_key';
          result.errors.push({
            row: rowNumber,
            reason: duplicate
              ? 'A unique field already contains this canonical value.'
              : error instanceof Error
                ? error.message
                : 'Row validation failed.',
          });
        }
      }
      await client.query(
        `insert into csv_imports
          (id, project_id, object_type_id, idempotency_key, requested_by, request_hash, result)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          uuidv7(),
          this.scope.projectId,
          input.objectTypeId,
          input.idempotencyKey,
          this.scope.actor.actorId,
          requestHash,
          JSON.stringify(result),
        ],
      );
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: 'record.csv_imported',
          targetType: 'object_type',
          targetId: input.objectTypeId,
          requestId: input.requestId,
          payload: { imported: result.imported, failed: result.failed },
        }),
      );
      return result;
    });
  }

  async exportRecordsCsv(objectTypeId: string, requestId: string): Promise<string> {
    const fields = await this.listFields(objectTypeId);
    if (
      fields.some((field) => field.fieldType !== 'relation' && field.projectionStatus !== 'ready')
    ) {
      throw new RepositoryError(
        'FIELD_INDEX_REBUILDING',
        409,
        'CSV export is unavailable while projection rebuilding is in progress.',
      );
    }
    const result = await this.pool.query<{
      id: string;
      display_name: string;
      values: Record<string, JsonValue>;
    }>(
      `select id, display_name, values from records
       where project_id = $1 and object_type_id = $2 and archived_at is null
       order by display_name, id`,
      [this.scope.projectId, objectTypeId],
    );
    const relations = await this.loadRelations(result.rows.map((row) => row.id));
    const lines = [
      ['displayName', ...fields.map((field) => field.key)].map(csvCell).join(','),
      ...result.rows.map((record) =>
        [
          record.display_name,
          ...fields.map((field) => {
            if (field.fieldType === 'relation') {
              return (relations.get(record.id)?.[field.id] ?? []).join(';');
            }
            const value = record.values[field.key];
            return Array.isArray(value) ? value.join(';') : value;
          }),
        ]
          .map(csvCell)
          .join(','),
      ),
    ];
    const client = await this.pool.connect();
    try {
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: 'record.csv_exported',
          targetType: 'object_type',
          targetId: objectTypeId,
          requestId,
          payload: { rowCount: result.rowCount ?? 0 },
        }),
      );
    } finally {
      client.release();
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  async queryRecords(objectTypeId: string, query: RecordQuery): Promise<RecordQueryResult> {
    const fields = await this.listFields(objectTypeId);
    const byId = new Map(fields.map((field) => [field.id, field]));
    const filters = query.filters ?? [];
    const sorts: RecordSort[] = query.sorts?.length
      ? query.sorts
      : [{ systemField: 'updatedAt', direction: 'desc' }];
    const usedFieldIds = new Set([
      ...filters.map((filter) => filter.fieldId),
      ...sorts.flatMap((sort) => (sort.fieldId ? [sort.fieldId] : [])),
      ...(query.groupByFieldId ? [query.groupByFieldId] : []),
    ]);
    for (const fieldId of usedFieldIds) {
      const field = byId.get(fieldId);
      if (!field) throw new RepositoryError('FIELD_NOT_FOUND', 404, 'Field was not found.');
      if (field.fieldType !== 'relation' && field.projectionStatus !== 'ready') {
        throw new RepositoryError(
          'FIELD_INDEX_REBUILDING',
          409,
          'The selected field index is unavailable while projection rebuilding is in progress.',
        );
      }
    }

    const parameters: unknown[] = [this.scope.projectId, objectTypeId];
    const bind = (value: unknown): string => {
      parameters.push(value);
      return `$${parameters.length}`;
    };
    const where = ['r.project_id = $1', 'r.object_type_id = $2'];
    if (!query.includeArchived) where.push('r.archived_at is null');

    for (const filter of filters) {
      const field = byId.get(filter.fieldId)!;
      const fieldBind = bind(field.id);
      const source = field.fieldType === 'relation' ? 'relation_edges' : 'record_index_values';
      const recordColumn = field.fieldType === 'relation' ? 'source_record_id' : 'record_id';
      const base = `select 1 from ${source} q where q.project_id = r.project_id and q.${recordColumn} = r.id and q.${field.fieldType === 'relation' ? 'source_field_id' : 'field_id'} = ${fieldBind}`;
      if (filter.operator === 'is_null') {
        where.push(`not exists (${base})`);
        continue;
      }
      if (filter.value === undefined || filter.value === null) {
        throw new RepositoryError('FIELD_VALIDATION_FAILED', 400, 'Filter value is required.');
      }
      if (filter.operator === 'in') {
        if (!Array.isArray(filter.value) || !filter.value.length) {
          throw new RepositoryError(
            'FIELD_VALIDATION_FAILED',
            400,
            'The in operator needs values.',
          );
        }
        const values = filter.value.map((value) => canonicalQueryValue(field, value));
        const valueBind = bind(values);
        const column =
          field.fieldType === 'relation' ? 'target_record_id' : projectionColumn(field);
        where.push(`exists (${base} and q.${column} = any(${valueBind}))`);
        continue;
      }
      const value = canonicalQueryValue(field, filter.value);
      const valueBind = bind(value);
      const column = field.fieldType === 'relation' ? 'target_record_id' : projectionColumn(field);
      if (filter.operator === 'contains') {
        if (!['text', 'long_text'].includes(field.fieldType)) {
          throw new RepositoryError(
            'FIELD_FILTER_UNSUPPORTED',
            400,
            'Contains is supported only for text fields.',
          );
        }
        where.push(
          `exists (${base} and position(lower(${valueBind}::text) in lower(q.${column})) > 0)`,
        );
        continue;
      }
      if (field.fieldType === 'relation' && !['eq', 'ne'].includes(filter.operator)) {
        throw new RepositoryError(
          'FIELD_FILTER_UNSUPPORTED',
          400,
          'Relation fields support equality filters only.',
        );
      }
      const operators: Record<
        Exclude<RecordFilterOperator, 'contains' | 'in' | 'is_null'>,
        string
      > = {
        eq: '=',
        ne: '<>',
        gt: '>',
        gte: '>=',
        lt: '<',
        lte: '<=',
      };
      if (filter.operator === 'ne') {
        where.push(`not exists (${base} and q.${column} = ${valueBind})`);
      } else {
        where.push(`exists (${base} and q.${column} ${operators[filter.operator]} ${valueBind})`);
      }
    }

    const filterParameters = [...parameters];
    const joins: string[] = [];
    const order: string[] = [];
    const systemColumns = {
      displayName: 'r.display_name',
      createdAt: 'r.created_at',
      updatedAt: 'r.updated_at',
    } as const;
    sorts.slice(0, 5).forEach((sort, index) => {
      const direction = sort.direction === 'asc' ? 'asc' : 'desc';
      if (sort.systemField) {
        order.push(`${systemColumns[sort.systemField]} ${direction} nulls last`);
        return;
      }
      if (!sort.fieldId) return;
      const field = byId.get(sort.fieldId)!;
      if (field.fieldType === 'multi_select' || field.fieldType === 'relation') {
        throw new RepositoryError(
          'FIELD_SORT_UNSUPPORTED',
          400,
          'Multi-value fields cannot be sorted.',
        );
      }
      const alias = `sort_${index}`;
      const fieldBind = bind(field.id);
      joins.push(
        `left join lateral (
           select q.${projectionColumn(field)} as value from record_index_values q
           where q.project_id = r.project_id and q.record_id = r.id and q.field_id = ${fieldBind}
           order by q.ordinal limit 1
         ) ${alias} on true`,
      );
      order.push(`${alias}.value ${direction} nulls last`);
    });
    order.push('r.id asc');

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 50));
    const totalResult = await this.pool.query<{ count: string }>(
      `select count(*)::text as count from records r where ${where.join(' and ')}`,
      filterParameters,
    );
    const limitBind = bind(pageSize);
    const offsetBind = bind((page - 1) * pageSize);
    const result = await this.pool.query(
      `select r.id, r.project_id, r.object_type_id, r.display_name, r.values, r.row_version,
              r.archived_at, r.created_at, r.updated_at
       from records r ${joins.join(' ')}
       where ${where.join(' and ')} order by ${order.join(', ')}
       limit ${limitBind} offset ${offsetBind}`,
      parameters,
    );
    const recordIds = result.rows.map((row) => String(row.id));
    const [relations, resources, measurements] = await Promise.all([
      this.loadRelations(recordIds),
      this.loadResourceReferences(recordIds),
      this.loadCurrentMeasurements(recordIds),
    ]);
    const response: RecordQueryResult = {
      items: result.rows.map((row) => {
        const recordId = String(row.id);
        return this.mapRecord(
          row,
          relations.get(recordId),
          resources.files.get(recordId),
          resources.datasets.get(recordId),
          measurements.get(recordId),
        );
      }),
      page,
      pageSize,
      total: Number(totalResult.rows[0]?.count ?? 0),
    };

    if (query.groupByFieldId) {
      const groupField = byId.get(query.groupByFieldId)!;
      if (groupField.fieldType === 'relation') {
        const groupedParameters = [...filterParameters, groupField.id];
        const groupFieldBind = `$${groupedParameters.length}`;
        const grouped = await this.pool.query<{ value: string | null; count: string }>(
          `select q.target_record_id::text as value, count(distinct r.id)::text as count
           from records r left join relation_edges q
             on q.project_id = r.project_id and q.source_record_id = r.id and q.source_field_id = ${groupFieldBind}
           where ${where.join(' and ')} group by q.target_record_id order by value nulls last`,
          groupedParameters,
        );
        response.groups = grouped.rows.map((row) => ({
          value: row.value,
          count: Number(row.count),
        }));
      } else {
        const groupedParameters = [...filterParameters, groupField.id];
        const groupFieldBind = `$${groupedParameters.length}`;
        const grouped = await this.pool.query<{ value: string | null; count: string }>(
          `select q.${projectionColumn(groupField)}::text as value, count(distinct r.id)::text as count
           from records r left join record_index_values q
             on q.project_id = r.project_id and q.record_id = r.id and q.field_id = ${groupFieldBind}
           where ${where.join(' and ')} group by q.${projectionColumn(groupField)} order by value nulls last`,
          groupedParameters,
        );
        response.groups = grouped.rows.map((row) => ({
          value: row.value,
          count: Number(row.count),
        }));
      }
    }
    return response;
  }

  async setRecordArchived(input: {
    objectTypeId: string;
    recordId: string;
    archived: boolean;
    reason?: string;
    requestId: string;
  }): Promise<RecordRow> {
    await transaction(this.pool, async (client) => {
      const result = await client.query(
        `update records set
           archived_at = case when $4::boolean then now() else null end,
           archived_by = case when $4::boolean then $5::uuid else null end,
           archive_reason = case when $4::boolean then $6::text else null end,
           row_version = row_version + 1, updated_by = $5, updated_at = now()
         where project_id = $1 and object_type_id = $2 and id = $3`,
        [
          this.scope.projectId,
          input.objectTypeId,
          input.recordId,
          input.archived,
          this.scope.actor.actorId,
          input.reason ?? null,
        ],
      );
      if (!result.rowCount)
        throw new RepositoryError('RECORD_NOT_FOUND', 404, 'Record was not found.');
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: input.archived ? 'record.archived' : 'record.restored',
          targetType: 'record',
          targetId: input.recordId,
          requestId: input.requestId,
          payload: input.archived ? { reason: input.reason ?? null } : {},
        }),
      );
    });
    return this.getRecord(input.objectTypeId, input.recordId);
  }
}

export function hashImport(csv: string): string {
  return createHash('sha256').update(csv, 'utf8').digest('hex');
}

function sourceDigest(
  rows: Array<{ id: string; object_type_id: string; values: Record<string, JsonValue> }>,
): string {
  const canonical = rows
    .map((row) => ({ id: row.id, objectTypeId: row.object_type_id, values: row.values }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

export async function rebuildRecordProjections(
  pool: Pool,
  projectId: string,
  requestId: string,
  fieldId?: string,
): Promise<{
  projectId: string;
  fieldCount: number;
  recordCount: number;
  projectionCount: number;
}> {
  const scope = await pool.query<{
    workspace_id: string;
    organization_id: string;
  }>(
    `select p.workspace_id, w.organization_id from projects p
     join workspaces w on w.id = p.workspace_id where p.id = $1`,
    [projectId],
  );
  if (!scope.rows[0]) throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
  const selector = fieldId ? 'and id = $2' : '';
  const selectorParams = fieldId ? [projectId, fieldId] : [projectId];
  const selected = await pool.query<DbFieldRow>(
    `select id, project_id, object_type_id, name, key, description, field_type, required,
            "unique", position, config, default_value, system, projection_status, projection_version
     from field_definitions where project_id = $1 and field_type <> 'relation' ${selector}
     order by id`,
    selectorParams,
  );
  if (fieldId && !selected.rowCount)
    throw new RepositoryError('FIELD_NOT_FOUND', 404, 'Field was not found.');
  const fields = selected.rows.map(mapField);
  const fieldIds = fields.map((field) => field.id);
  await pool.query(
    `update field_definitions set projection_status = 'rebuilding', updated_at = now()
     where project_id = $1 and id = any($2::uuid[])`,
    [projectId, fieldIds],
  );
  try {
    return await transaction(pool, async (client) => {
      const records = await client.query<{
        id: string;
        object_type_id: string;
        values: Record<string, JsonValue>;
      }>(
        `select id, object_type_id, values from records
         where project_id = $1 order by id for update`,
        [projectId],
      );
      const before = sourceDigest(records.rows);
      await client.query(
        'delete from record_index_values where project_id = $1 and field_id = any($2::uuid[])',
        [projectId, fieldIds],
      );
      let projectionCount = 0;
      for (const field of fields) {
        for (const record of records.rows) {
          if (record.object_type_id !== field.objectTypeId) continue;
          const value = record.values[field.key];
          if (value === undefined || value === null || value === '') continue;
          for (const item of fieldProjection(field, value)) {
            const columns: Record<ProjectionValue['valueKind'], string> = {
              text: 'text_value',
              numeric: 'numeric_value',
              boolean: 'boolean_value',
              date: 'date_value',
              datetime: 'datetime_value',
              uuid: 'uuid_value',
            };
            await client.query(
              `insert into record_index_values
                (id, project_id, object_type_id, record_id, field_id, ordinal, value_kind,
                 ${columns[item.valueKind]}, unique_key, projection_version)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                uuidv7(),
                projectId,
                field.objectTypeId,
                record.id,
                field.id,
                item.ordinal,
                item.valueKind,
                item.value,
                item.uniqueKey ?? null,
                RECORD_PROJECTION_VERSION,
              ],
            );
            projectionCount += 1;
          }
        }
      }
      const afterRows = await client.query<{
        id: string;
        object_type_id: string;
        values: Record<string, JsonValue>;
      }>('select id, object_type_id, values from records where project_id = $1 order by id', [
        projectId,
      ]);
      if (sourceDigest(afterRows.rows) !== before) {
        throw new RepositoryError(
          'PROJECTION_REBUILD_VERIFICATION_FAILED',
          500,
          'Record source data changed during projection rebuilding.',
        );
      }
      const verified = await client.query<{ count: string }>(
        `select count(*)::text as count from record_index_values
         where project_id = $1 and field_id = any($2::uuid[]) and projection_version = $3`,
        [projectId, fieldIds, RECORD_PROJECTION_VERSION],
      );
      if (Number(verified.rows[0]?.count) !== projectionCount) {
        throw new RepositoryError(
          'PROJECTION_REBUILD_VERIFICATION_FAILED',
          500,
          'Projection row verification failed.',
        );
      }
      await client.query(
        `update field_definitions
         set projection_status = 'ready', projection_version = $3, updated_at = now()
         where project_id = $1 and id = any($2::uuid[])`,
        [projectId, fieldIds, RECORD_PROJECTION_VERSION],
      );
      await appendAudit(client, {
        organizationId: scope.rows[0]!.organization_id,
        workspaceId: scope.rows[0]!.workspace_id,
        projectId,
        action: 'record_projection.rebuilt',
        targetType: 'project',
        targetId: projectId,
        requestId,
        payload: {
          projectionVersion: RECORD_PROJECTION_VERSION,
          fieldCount: fields.length,
          recordCount: records.rowCount,
          projectionCount,
          sourceDigest: before,
        },
      });
      return {
        projectId,
        fieldCount: fields.length,
        recordCount: records.rowCount ?? 0,
        projectionCount,
      };
    });
  } catch (error) {
    await pool.query(
      `update field_definitions set projection_status = 'failed', updated_at = now()
       where project_id = $1 and id = any($2::uuid[])`,
      [projectId, fieldIds],
    );
    mapUniqueViolation(error);
  }
}
