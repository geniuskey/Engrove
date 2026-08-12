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
import { evaluateFormula, formulaReferences, type FormulaValue } from './calculated-fields.js';
import { generateTablePublicId, generateViewPublicId } from './public-ids.js';

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
  'spectral_data',
  'tabular_data',
  'formula',
  'lookup',
  'rollup',
  'file',
  'dataset',
] as const;

export type ConfigurableFieldType = (typeof configurableFieldTypes)[number];
const calculatedFieldTypes: ConfigurableFieldType[] = ['formula', 'lookup', 'rollup'];
const supportedImageTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const uuidValuePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ProjectionStatus = 'ready' | 'rebuilding' | 'failed';
export type TablePermissionMode =
  'everyone' | 'editors' | 'engineers' | 'administrators' | 'specific' | 'nobody';
export type TablePermissionAction = 'visibility' | 'create' | 'update' | 'archive';
export interface TablePermissionSubjects {
  userIds: string[];
  groupIds: string[];
}
export interface TablePermissionConfiguration {
  modes: Record<TablePermissionAction, TablePermissionMode>;
  subjects: Record<TablePermissionAction, TablePermissionSubjects>;
  subjectDirectory: {
    members: Array<{ id: string; displayName: string; email: string }>;
    groups: Array<{ id: string; name: string }>;
  };
  rowVersion: number;
}
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ProjectScope {
  actor: ActorSession;
  workspaceId: string;
  projectId: string;
  system: boolean;
}

async function appendRecordWebhookEvent(
  client: PoolClient,
  scope: ProjectScope,
  eventType: 'record.created' | 'record.updated' | 'record.archived' | 'record.restored',
  objectTypeId: string,
  recordId: string,
  data: Record<string, unknown>,
  actorId: string | null = scope.actor.actorId,
): Promise<void> {
  const eventId = uuidv7();
  await client.query(
    `insert into outbox_events (id,project_id,event_type,entity_type,entity_id,payload)
     values ($1,$2,$3,'record',$4,$5::jsonb)`,
    [
      eventId,
      scope.projectId,
      eventType,
      recordId,
      JSON.stringify({
        version: 1,
        id: eventId,
        type: eventType,
        occurredAt: new Date().toISOString(),
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        objectTypeId,
        recordId,
        actorId,
        data,
      }),
    ],
  );
}

export interface ObjectTypeRow {
  id: string;
  publicId: string;
  projectId: string;
  name: string;
  pluralName: string;
  key: string;
  icon: string;
  description: string;
  system: boolean;
  recordPermissions: {
    canCreate: boolean;
    canUpdate: boolean;
    canArchive: boolean;
  };
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
  contextProjectId: string | null;
  objectTypeId: string;
  displayName: string;
  values: Record<string, JsonValue>;
  relations: Record<string, string[]>;
  relationLabels: Record<string, RecordReferenceRow[]>;
  referenceLabels: Record<string, RecordReferenceRow[]>;
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

export interface RecordReferenceRow {
  id: string;
  displayName: string;
  archivedAt: string | null;
}

export interface RecordReferencePage {
  items: RecordReferenceRow[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
}

export interface RecordCreateInput {
  objectTypeId: string;
  contextProjectId?: string | null;
  displayName: string;
  values: Record<string, JsonValue>;
  relations?: Record<string, string[]>;
  fileReferences?: Record<string, string[]>;
  datasetReferences?: Record<string, string[]>;
  requestId: string;
}

export interface PublicFormRecordSubmitInput extends RecordCreateInput {
  shareId: string;
  recordViewId: string;
  idempotencyHash: string;
  requestHash: string;
  networkFingerprint: string;
}

export interface PublicFormRecordSubmitResult {
  recordId: string;
  submittedAt: string;
  idempotentReplay: boolean;
}

export interface RecordUpdateInput extends RecordCreateInput {
  recordId: string;
  rowVersion: number;
}

export interface RecordBulkCreateResult {
  created: Array<{ id: string; rowVersion: number }>;
  idempotentReplay: boolean;
}

export interface RecordBulkUpdateResult {
  updated: Array<{ id: string; rowVersion: number }>;
}

export interface RecordBulkFieldChange {
  fieldKey: string;
  operation: 'set' | 'clear';
  value?: JsonValue;
}

export interface RecordBulkLifecycleResult {
  updated: Array<{ id: string; rowVersion: number }>;
  archived: boolean;
}

export interface RecordHistoryRow {
  id: string;
  action: string;
  actorName: string | null;
  createdAt: string;
  rowVersion: number | null;
  undoable: boolean;
}

export interface RecordCommentRow {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  mentionedUserIds: string[];
  mentionedUsers: Array<{ id: string; displayName: string }>;
  rowVersion: number;
  editedAt: string | null;
  createdAt: string;
}

export interface RecordCommentPage {
  items: RecordCommentRow[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
}

interface RecordSnapshot {
  displayName: string;
  contextProjectId: string | null;
  values: Record<string, JsonValue>;
  relations: Record<string, string[]>;
  fileReferences: Record<string, string[]>;
  datasetReferences: Record<string, string[]>;
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
  fields?: string[];
  filters?: RecordFilter[];
  sorts?: RecordSort[];
  search?: string;
  contextProjectId?: string | null;
  groupByFieldId?: string;
  groupings?: RecordGrouping[];
  summaries?: RecordSummaryRequest[];
  page?: number;
  pageSize?: number;
  includeArchived?: boolean;
  archiveState?: 'active' | 'archived' | 'all';
}

export interface RecordQueryResult {
  items: RecordRow[];
  page: number;
  pageSize: number;
  total: number;
  groups?: Array<{ value: string | null; count: number }>;
  groupHierarchy?: RecordGroupResult[];
  summaries?: RecordSummaryResult[];
}

export const RECORD_EXPORT_MAX_ROWS = 1_000_000;

export type RecordExportStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'expired';

export interface RecordExportJob {
  id: string;
  objectTypeId: string;
  status: RecordExportStatus;
  progress: number;
  rowCount: number | null;
  fieldCount: number | null;
  sizeBytes: number | null;
  fileName: string;
  errorCode: string | null;
  retryable: boolean;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  downloadReady: boolean;
}

export interface RecordExportArtifact {
  objectKey: string;
  storageVersionId: string | null;
  checksum: string;
  sizeBytes: number;
  rowCount: number;
  fieldCount: number;
  fileName: string;
  expiresAt: string;
  deletedAt?: string;
}

export interface RecordExportPayload {
  requestedBy: string;
  requestHash: string;
  fileName: string;
  query: RecordQuery;
}

interface RecordExportDatabaseRow {
  id: string;
  entity_id: string;
  payload: RecordExportPayload;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;
  error_code: string | null;
  retryable: boolean;
  created_at: Date;
  completed_at: Date | null;
  result_checkpoint: { artifact?: RecordExportArtifact };
}

function recordExportJob(row: RecordExportDatabaseRow): RecordExportJob {
  const artifact = row.result_checkpoint?.artifact;
  const expired = Boolean(
    row.status === 'succeeded' &&
    artifact &&
    (artifact.deletedAt || new Date(artifact.expiresAt).getTime() <= Date.now()),
  );
  return {
    id: row.id,
    objectTypeId: row.entity_id,
    status: expired ? 'expired' : row.status,
    progress: Number(row.progress),
    rowCount: artifact?.rowCount ?? null,
    fieldCount: artifact?.fieldCount ?? null,
    sizeBytes: artifact?.sizeBytes ?? null,
    fileName: artifact?.fileName ?? row.payload.fileName,
    errorCode: row.error_code,
    retryable: row.retryable,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    expiresAt: artifact?.expiresAt ?? null,
    downloadReady: row.status === 'succeeded' && !expired,
  };
}

export interface RecordGrouping {
  fieldId: string;
  direction: 'asc' | 'desc';
  enabled: boolean;
}

export interface RecordGroupResult {
  level: number;
  fieldId: string;
  path: Array<{ fieldId: string; value: string | null }>;
  count: number;
  summaries?: RecordSummaryResult[];
}

export type RecordSummaryOperation = 'count' | 'sum' | 'average' | 'min' | 'max';

export interface RecordSummaryRequest {
  fieldId: string;
  operation: RecordSummaryOperation;
}

export interface RecordSummaryResult extends RecordSummaryRequest {
  value: string | null;
  unit: string | null;
}

export interface RecordViewConfig {
  visibleFieldIds: string[];
  fieldWidths: Record<string, number>;
  systemFieldWidths?: Partial<Record<'displayName' | 'contextProject' | 'updatedAt', number>>;
  filters: RecordFilter[];
  sorts: RecordSort[];
  rowDensity: 'compact' | 'comfortable';
  pageSize: 25 | 50 | 100 | 250 | 500;
  groupings?: RecordGrouping[];
  summaries?: RecordSummaryRequest[];
  viewOptions?: {
    groupFieldId?: string;
    dateFieldId?: string;
    contextProjectId?: string | null;
  };
}

export type RecordViewType = 'grid' | 'form' | 'gallery' | 'kanban' | 'calendar';
export type RecordViewPermissionType = 'collaborative' | 'personal' | 'locked';

export interface RecordViewRow {
  id: string;
  publicId: string;
  projectId: string;
  objectTypeId: string;
  name: string;
  viewType: RecordViewType;
  permissionType: RecordViewPermissionType;
  ownerId: string | null;
  lockReason: string | null;
  config: RecordViewConfig;
  rowVersion: number;
  createdBy: string;
  updatedBy: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordViewPage {
  items: RecordViewRow[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
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

interface DbRecordViewRow {
  id: string;
  public_id: string;
  project_id: string;
  object_type_id: string;
  name: string;
  view_type: RecordViewType;
  permission_type: RecordViewPermissionType;
  owner_id: string | null;
  lock_reason: string | null;
  config: RecordViewConfig;
  row_version: number;
  created_by: string;
  updated_by: string;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
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
    publicId: String(row.public_id),
    projectId: String(row.project_id),
    name: String(row.name),
    pluralName: String(row.plural_name),
    key: String(row.key),
    icon: String(row.icon),
    description: String(row.description),
    system: Boolean(row.system),
    recordPermissions: {
      canCreate: row.can_create === undefined ? true : Boolean(row.can_create),
      canUpdate: row.can_update === undefined ? true : Boolean(row.can_update),
      canArchive: row.can_archive === undefined ? true : Boolean(row.can_archive),
    },
  };
}

function mapRecordComment(row: {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  mentioned_users: unknown;
  row_version: number;
  edited_at: Date | null;
  created_at: Date;
}): RecordCommentRow {
  const mentionedUsers = Array.isArray(row.mentioned_users)
    ? row.mentioned_users.flatMap((mention) => {
        if (
          !mention ||
          typeof mention !== 'object' ||
          typeof (mention as { id?: unknown }).id !== 'string' ||
          typeof (mention as { displayName?: unknown }).displayName !== 'string'
        )
          return [];
        return [
          {
            id: (mention as { id: string }).id,
            displayName: (mention as { displayName: string }).displayName,
          },
        ];
      })
    : [];
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.body,
    mentionedUserIds: mentionedUsers.map((mention) => mention.id),
    mentionedUsers,
    rowVersion: row.row_version,
    editedAt: row.edited_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
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

function mapRecordView(row: DbRecordViewRow): RecordViewRow {
  return {
    id: row.id,
    publicId: row.public_id,
    projectId: row.project_id,
    objectTypeId: row.object_type_id,
    name: row.name,
    viewType: row.view_type,
    permissionType: row.permission_type,
    ownerId: row.owner_id,
    lockReason: row.lock_reason,
    config: row.config,
    rowVersion: row.row_version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    archivedAt: row.archived_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
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

function normalizeSpectralData(value: JsonValue): JsonValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('must be a spectral data object');
  }
  const x = value.x;
  const series = value.series;
  if (!Array.isArray(x) || x.length === 0 || x.length > 100_000) {
    throw new Error('must contain between 1 and 100,000 x-axis values');
  }
  if (x.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error('x-axis values must be finite numbers');
  }
  if (!Array.isArray(series) || series.length === 0 || series.length > 64) {
    throw new Error('must contain between 1 and 64 signal series');
  }
  const names = new Set<string>();
  const normalizedSeries = series.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`series ${index + 1} must be an object`);
    }
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const values = candidate.values;
    if (!name) throw new Error(`series ${index + 1} requires a name`);
    if (names.has(name)) throw new Error('series names must be unique');
    names.add(name);
    if (!Array.isArray(values) || values.length !== x.length) {
      throw new Error(`series '${name}' must contain ${x.length} values`);
    }
    if (values.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
      throw new Error(`series '${name}' values must be finite numbers`);
    }
    return { name, values };
  });
  return { x, series: normalizedSeries };
}

function normalizeTabularData(value: JsonValue): JsonValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('must be a data table object');
  }
  const columns = value.columns;
  const rows = value.rows;
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > 256) {
    throw new Error('must contain between 1 and 256 columns');
  }
  if (columns.some((column) => typeof column !== 'string' || !column.trim())) {
    throw new Error('column names must be non-empty text');
  }
  if (!Array.isArray(rows) || rows.length > 50_000 || rows.length * columns.length > 500_000) {
    throw new Error('table data is limited to 50,000 rows and 500,000 cells');
  }
  const normalizedRows = rows.map((candidate, index) => {
    if (!Array.isArray(candidate) || candidate.length !== columns.length) {
      throw new Error(`row ${index + 1} must contain ${columns.length} cells`);
    }
    if (
      candidate.some(
        (cell) =>
          cell !== null &&
          typeof cell !== 'string' &&
          typeof cell !== 'number' &&
          typeof cell !== 'boolean',
      )
    ) {
      throw new Error(`row ${index + 1} contains a non-scalar cell`);
    }
    return candidate;
  });
  return { columns: columns.map((column) => String(column).trim()), rows: normalizedRows };
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
    case 'spectral_data':
      normalizeSpectralData(value);
      return [];
    case 'tabular_data':
      normalizeTabularData(value);
      return [];
    case 'formula':
    case 'lookup':
    case 'rollup':
      throw new Error('is calculated and read-only');
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
  if (field.fieldType === 'spectral_data') return normalizeSpectralData(value);
  if (field.fieldType === 'tabular_data') return normalizeTabularData(value);
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

function hasRecordValue(value: JsonValue | undefined): value is JsonValue {
  return (
    value !== undefined &&
    value !== null &&
    value !== '' &&
    (!Array.isArray(value) || value.length > 0)
  );
}

function formulaValue(value: JsonValue | undefined): FormulaValue {
  if (value === undefined || value === null || typeof value !== 'object') return value ?? null;
  if (Array.isArray(value)) return value.map(formulaValue);
  if (typeof value.canonicalValue === 'string') return value.canonicalValue;
  if (typeof value.value === 'string') return value.value;
  return JSON.stringify(value);
}

function rollupNumber(value: JsonValue | undefined): number | undefined {
  const candidate = formulaValue(value);
  if (
    Array.isArray(candidate) ||
    candidate === null ||
    candidate === '' ||
    typeof candidate === 'boolean'
  )
    return undefined;
  const number = Number(candidate);
  return Number.isFinite(number) ? number : undefined;
}

function validateConfig(type: ConfigurableFieldType, config: Record<string, JsonValue>): void {
  if (type === 'file' && config.mediaKind !== undefined && config.mediaKind !== 'image') {
    throw new RepositoryError(
      'FIELD_CONFIG_INVALID',
      400,
      'File mediaKind must be image when provided.',
    );
  }
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
  if (type === 'spectral_data') {
    for (const key of ['xLabel', 'xUnit', 'yLabel', 'yUnit']) {
      const value = config[key];
      if (value !== undefined && typeof value !== 'string') {
        throw new RepositoryError(
          'FIELD_CONFIG_INVALID',
          400,
          'Spectral axis labels and units must be text.',
        );
      }
    }
  }
  if (
    type === 'tabular_data' &&
    config.firstRowHeader !== undefined &&
    typeof config.firstRowHeader !== 'boolean'
  ) {
    throw new RepositoryError(
      'FIELD_CONFIG_INVALID',
      400,
      'Data table firstRowHeader must be true or false.',
    );
  }
  if (type === 'formula') {
    const expression = config.expression;
    if (typeof expression !== 'string' || !expression.trim() || expression.length > 2_000) {
      throw new RepositoryError(
        'FIELD_CONFIG_INVALID',
        400,
        'Formula fields require an expression of at most 2,000 characters.',
      );
    }
    try {
      evaluateFormula(expression, {});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Formula is invalid.';
      if (!/not numeric|divide by zero/i.test(message)) {
        throw new RepositoryError('FIELD_CONFIG_INVALID', 400, message);
      }
    }
  }
  if (type === 'lookup') {
    if (
      typeof config.relationFieldId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(config.relationFieldId) ||
      typeof config.targetFieldId !== 'string' ||
      (config.targetFieldId !== 'displayName' && !/^[0-9a-f-]{36}$/i.test(config.targetFieldId))
    ) {
      throw new RepositoryError(
        'FIELD_CONFIG_INVALID',
        400,
        'Lookup fields require a relation field and target field.',
      );
    }
  }
  if (type === 'rollup') {
    const aggregations = ['count', 'sum', 'average', 'min', 'max'];
    if (
      typeof config.relationFieldId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(config.relationFieldId) ||
      typeof config.targetFieldId !== 'string' ||
      (config.targetFieldId !== 'displayName' && !/^[0-9a-f-]{36}$/i.test(config.targetFieldId)) ||
      typeof config.aggregation !== 'string' ||
      !aggregations.includes(config.aggregation)
    ) {
      throw new RepositoryError(
        'FIELD_CONFIG_INVALID',
        400,
        'Rollup fields require a relation, target field, and aggregation.',
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
    case 'spectral_data':
    case 'tabular_data':
    case 'file':
    case 'dataset':
    case 'formula':
    case 'lookup':
    case 'rollup':
      throw new RepositoryError('FIELD_SORT_UNSUPPORTED', 400, 'This field type cannot be sorted.');
  }
}

function summaryOperationAllowed(
  fieldType: ConfigurableFieldType,
  operation: RecordSummaryOperation,
): boolean {
  if (operation === 'count') {
    return [
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
    ].includes(fieldType);
  }
  if (['sum', 'average'].includes(operation)) {
    return ['integer', 'decimal', 'quantity', 'measurement'].includes(fieldType);
  }
  return ['integer', 'decimal', 'quantity', 'measurement', 'date', 'datetime'].includes(fieldType);
}

function recordSummaryResult(
  field: FieldDefinitionRow,
  summary: RecordSummaryRequest,
  rawValue: string | null,
): RecordSummaryResult {
  let value = rawValue;
  if (
    value !== null &&
    summary.operation !== 'count' &&
    ['integer', 'decimal', 'quantity', 'measurement'].includes(field.fieldType)
  ) {
    value = canonicalDecimal(value);
  }
  return {
    ...summary,
    value,
    unit:
      field.fieldType === 'quantity' || field.fieldType === 'measurement'
        ? String(field.config.canonicalUnit)
        : null,
  };
}

function fieldTypeCanGroup(fieldType: ConfigurableFieldType): boolean {
  return ['text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'single_select'].includes(
    fieldType,
  );
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
    case 'spectral_data':
    case 'tabular_data':
      try {
        return JSON.parse(cell) as JsonValue;
      } catch {
        return cell;
      }
    case 'formula':
    case 'lookup':
    case 'rollup':
      return undefined;
    default:
      return cell;
  }
}

export interface CsvImportResult {
  imported: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  createdIds: string[];
  updatedIds: string[];
  errors: Array<{ row: number; field?: string; reason: string }>;
  errorsTruncated: boolean;
  idempotentReplay: boolean;
}

export type CsvImportDuplicateStrategy = 'allow' | 'skip' | 'update';
export interface CsvImportMapping {
  sourceHeader: string;
  targetFieldKey: string | null;
}
export interface CsvImportPreview {
  headers: string[];
  totalRows: number;
  sampleRows: Array<Record<string, string>>;
  targetFields: Array<{
    key: string;
    name: string;
    fieldType: ConfigurableFieldType | 'display_name';
    required: boolean;
    unique: boolean;
    supported: boolean;
  }>;
  suggestedMappings: CsvImportMapping[];
}

const csvImportUnsupportedFieldTypes = new Set<ConfigurableFieldType>([
  'measurement',
  'file',
  'dataset',
  'formula',
  'lookup',
  'rollup',
]);

function csvHeaderIdentity(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, '');
}

function validatedCsvRows(csv: string): { headers: string[]; rows: string[][] } {
  if (Buffer.byteLength(csv, 'utf8') > 5 * 1024 * 1024)
    throw new RepositoryError('CSV_TOO_LARGE', 413, 'CSV import is limited to 5 MiB.');
  const rows = parseCsv(csv);
  if (!rows.length) throw new RepositoryError('CSV_INVALID', 400, 'CSV is empty.');
  if (rows.length > 20_001)
    throw new RepositoryError(
      'CSV_ROW_LIMIT_EXCEEDED',
      413,
      'CSV import is limited to 20,000 data rows.',
    );
  const headers = rows[0]!.map((header) => header.trim());
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length)
    throw new RepositoryError(
      'CSV_HEADER_INVALID',
      400,
      'CSV headers must be non-empty and unique.',
    );
  return { headers, rows };
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

function mapRecordViewUniqueViolation(error: unknown): never {
  if (
    typeof error === 'object' &&
    error &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'record_views_active_object_name_key'
  ) {
    throw new RepositoryError(
      'RECORD_VIEW_NAME_CONFLICT',
      409,
      'An active view already uses this name.',
    );
  }
  throw error;
}

function mapObjectTypeUniqueViolation(error: unknown): never {
  if (
    typeof error === 'object' &&
    error &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'object_types_project_key_key'
  ) {
    throw new RepositoryError(
      'OBJECT_TYPE_KEY_CONFLICT',
      409,
      'Another table already uses this key.',
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
    const result = await pool.query<{ system: boolean }>(
      `select p.system from projects p join workspaces w on w.id = p.workspace_id
       where p.id = $1 and p.workspace_id = $2 and w.organization_id = $3
         and project_visible_to(p.id,$2,$3,$4,$5)`,
      [projectId, workspaceId, actor.organizationId, actor.actorId, actor.role],
    );
    if (!result.rowCount)
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    return new ScopedProjectRepository(pool, {
      actor,
      workspaceId,
      projectId,
      system: result.rows[0]!.system,
    });
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

  private isRecordViewAdministrator(): boolean {
    return ['owner', 'admin', 'engineer'].includes(this.scope.actor.role);
  }

  private assertRecordViewWritable(
    view: Pick<DbRecordViewRow, 'permission_type' | 'owner_id'>,
    allowAdministrativeArchive = false,
  ): void {
    if (view.permission_type === 'locked') {
      if (allowAdministrativeArchive && this.isRecordViewAdministrator()) return;
      throw new RepositoryError(
        'RECORD_VIEW_LOCKED',
        403,
        'Unlock this view before changing its saved configuration.',
      );
    }
    if (
      view.permission_type === 'personal' &&
      view.owner_id !== this.scope.actor.actorId &&
      !this.isRecordViewAdministrator()
    ) {
      throw new RepositoryError(
        'RECORD_VIEW_PERSONAL',
        403,
        'Only the personal view owner can change this saved configuration.',
      );
    }
  }

  private tablePermissionExpression(
    tableAlias: string,
    modeColumn: string,
    action: TablePermissionAction,
    roleParameter: string,
    actorParameter: string,
    organizationParameter: string,
    administrativeVisibilityBypass = false,
  ): string {
    return `(
      ${administrativeVisibilityBypass ? `${roleParameter}::text in ('owner','admin') or` : ''}
      ${tableAlias}.${modeColumn}='everyone'
      or (${tableAlias}.${modeColumn}='editors' and ${roleParameter}::text in ('owner','admin','engineer','contributor'))
      or (${tableAlias}.${modeColumn}='engineers' and ${roleParameter}::text in ('owner','admin','engineer'))
      or (${tableAlias}.${modeColumn}='administrators' and ${roleParameter}::text in ('owner','admin'))
      or (${tableAlias}.${modeColumn}='specific' and exists (
        select 1 from object_type_permission_subjects permission
        left join member_groups permission_group
          on permission_group.organization_id=permission.organization_id
         and permission_group.id=permission.group_id and permission_group.archived_at is null
        left join member_group_memberships permission_membership
          on permission_membership.organization_id=permission.organization_id
         and permission_membership.group_id=permission.group_id
         and permission_membership.user_id=${actorParameter}::uuid
        where permission.project_id=${tableAlias}.project_id
          and permission.object_type_id=${tableAlias}.id
          and permission.organization_id=${organizationParameter}::uuid
          and permission.action='${action}'
          and (permission.user_id=${actorParameter}::uuid
            or (permission_group.id is not null and permission_membership.user_id is not null))
      ))
    )`;
  }

  private async assertObjectTypePermission(
    objectTypeId: string,
    action: TablePermissionAction,
    executor: Pick<Pool, 'query'> | Pick<PoolClient, 'query'> = this.pool,
  ): Promise<void> {
    const visibility = this.tablePermissionExpression(
      'o',
      'visibility_mode',
      'visibility',
      '$3',
      '$4',
      '$5',
      true,
    );
    const modeColumn =
      action === 'create'
        ? 'create_mode'
        : action === 'update'
          ? 'update_mode'
          : action === 'archive'
            ? 'archive_mode'
            : 'visibility_mode';
    const allowed = this.tablePermissionExpression(
      'o',
      modeColumn,
      action,
      '$3',
      '$4',
      '$5',
      action === 'visibility',
    );
    const result = await executor.query<{ visible: boolean; allowed: boolean }>(
      `select ${visibility} visible,${allowed} allowed
       from object_types o where o.project_id=$1 and o.id=$2`,
      [
        this.scope.projectId,
        objectTypeId,
        this.scope.actor.role,
        this.scope.actor.actorId,
        this.scope.actor.organizationId,
      ],
    );
    const permission = result.rows[0];
    if (!permission?.visible)
      throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');
    if (!permission.allowed)
      throw new RepositoryError(
        'TABLE_ACTION_FORBIDDEN',
        403,
        `This table does not allow ${action} for the current member.`,
      );
  }

  private async assertPublicFormCreatePermission(objectTypeId: string): Promise<void> {
    const membership = await this.pool.query<{ role: ActorSession['role'] }>(
      'select role from memberships where organization_id=$1 and user_id=$2',
      [this.scope.actor.organizationId, this.scope.actor.actorId],
    );
    const allowed = this.tablePermissionExpression('o', 'create_mode', 'create', '$3', '$4', '$5');
    const result = await this.pool.query<{ allowed: boolean }>(
      `select ${allowed} allowed from object_types o where o.project_id=$1 and o.id=$2`,
      [
        this.scope.projectId,
        objectTypeId,
        membership.rows[0]?.role ?? 'viewer',
        this.scope.actor.actorId,
        this.scope.actor.organizationId,
      ],
    );
    if (!result.rows[0])
      throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');
    if (!result.rows[0].allowed)
      throw new RepositoryError(
        'PUBLIC_FORM_TABLE_CREATE_FORBIDDEN',
        403,
        'This table no longer accepts record creation through shared forms.',
      );
  }

  private objectTypeSelectPermissions(tableAlias: string, parameterOffset = 2): string {
    const role = `$${parameterOffset}`;
    const actor = `$${parameterOffset + 1}`;
    const organization = `$${parameterOffset + 2}`;
    return `${this.tablePermissionExpression(tableAlias, 'create_mode', 'create', role, actor, organization)} can_create,
      ${this.tablePermissionExpression(tableAlias, 'update_mode', 'update', role, actor, organization)} can_update,
      ${this.tablePermissionExpression(tableAlias, 'archive_mode', 'archive', role, actor, organization)} can_archive`;
  }

  async listObjectTypes(): Promise<ObjectTypeRow[]> {
    const visibility = this.tablePermissionExpression(
      'o',
      'visibility_mode',
      'visibility',
      '$2',
      '$3',
      '$4',
      true,
    );
    const result = await this.pool.query(
      `select o.id,o.public_id,o.project_id,o.name,o.plural_name,o.key,o.icon,o.description,o.system,
        ${this.objectTypeSelectPermissions('o')}
       from object_types o where o.project_id=$1 and ${visibility} order by o.name,o.id`,
      [
        this.scope.projectId,
        this.scope.actor.role,
        this.scope.actor.actorId,
        this.scope.actor.organizationId,
      ],
    );
    return result.rows.map(mapObjectType);
  }

  async listObjectTypePage(options: { query: string; limit: number; offset: number }): Promise<{
    items: ObjectTypeRow[];
    pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  }> {
    const query = options.query.trim().toLocaleLowerCase();
    const parameters = [
      this.scope.projectId,
      this.scope.actor.role,
      this.scope.actor.actorId,
      this.scope.actor.organizationId,
      query,
      options.limit,
      options.offset,
    ];
    const visibility = this.tablePermissionExpression(
      'o',
      'visibility_mode',
      'visibility',
      '$2',
      '$3',
      '$4',
      true,
    );
    const predicate = `o.project_id=$1 and ${visibility}
      and ($5='' or position($5 in lower(o.name||' '||o.plural_name||' '||o.key||' '||o.description))>0)`;
    const [items, count] = await Promise.all([
      this.pool.query(
        `select o.id,o.public_id,o.project_id,o.name,o.plural_name,o.key,o.icon,o.description,o.system,
          ${this.objectTypeSelectPermissions('o')}
         from object_types o where ${predicate}
         order by o.name,o.id limit $6 offset $7`,
        parameters,
      ),
      this.pool.query<{ count: string }>(
        `select count(*)::text count from object_types o where ${predicate}`,
        parameters.slice(0, 5),
      ),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    return {
      items: items.rows.map(mapObjectType),
      pageInfo: {
        limit: options.limit,
        offset: options.offset,
        total,
        hasNext: options.offset + items.rows.length < total,
      },
    };
  }

  async getObjectType(objectTypeId: string): Promise<ObjectTypeRow> {
    await this.assertObjectTypePermission(objectTypeId, 'visibility');
    const result = await this.pool.query(
      `select o.id,o.public_id,o.project_id,o.name,o.plural_name,o.key,o.icon,o.description,o.system,
        ${this.objectTypeSelectPermissions('o', 3)}
       from object_types o where o.project_id=$1 and o.id=$2`,
      [
        this.scope.projectId,
        objectTypeId,
        this.scope.actor.role,
        this.scope.actor.actorId,
        this.scope.actor.organizationId,
      ],
    );
    if (!result.rows[0])
      throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');
    return mapObjectType(result.rows[0]);
  }

  async getSchemaCatalog(options: { query: string; limit: number; offset: number }): Promise<{
    tables: Array<ObjectTypeRow & { fields: FieldDefinitionRow[] }>;
    pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  }> {
    const page = await this.listObjectTypePage(options);
    if (!page.items.length) return { tables: [], pageInfo: page.pageInfo };
    const fieldRows = await this.pool.query<DbFieldRow>(
      `select id, project_id, object_type_id, name, key, description, field_type, required,
              "unique", position, config, default_value, system, projection_status, projection_version
       from field_definitions where project_id=$1 and object_type_id=any($2::uuid[])
       order by object_type_id,position,id`,
      [this.scope.projectId, page.items.map((table) => table.id)],
    );
    const fieldsByTable = new Map<string, FieldDefinitionRow[]>();
    for (const field of fieldRows.rows.map(mapField)) {
      const fields = fieldsByTable.get(field.objectTypeId) ?? [];
      fields.push(field);
      fieldsByTable.set(field.objectTypeId, fields);
    }
    return {
      tables: page.items.map((table) => ({
        ...table,
        fields: fieldsByTable.get(table.id) ?? [],
      })),
      pageInfo: page.pageInfo,
    };
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
        `insert into object_types (id, public_id, project_id, name, plural_name, key, icon, description)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id, public_id, project_id, name, plural_name, key, icon, description, system`,
        [
          id,
          generateTablePublicId(),
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
    }).catch(mapObjectTypeUniqueViolation);
  }

  async updateObjectType(input: {
    objectTypeId: string;
    name: string;
    pluralName: string;
    key: string;
    description: string;
    requestId: string;
  }): Promise<ObjectTypeRow> {
    return transaction(this.pool, async (client) => {
      const previous = await client.query<{
        name: string;
        plural_name: string;
        key: string;
        description: string;
        system: boolean;
      }>(
        `select name, plural_name, key, description, system from object_types
         where project_id = $1 and id = $2 for update`,
        [this.scope.projectId, input.objectTypeId],
      );
      const current = previous.rows[0];
      if (!current)
        throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');
      if (current.system && current.key !== input.key) {
        throw new RepositoryError(
          'OBJECT_TYPE_KEY_PROTECTED',
          409,
          'The key of a system table cannot be changed.',
        );
      }
      const result = await client.query(
        `update object_types set name = $3, plural_name = $4, key = $5,
             description = $6, updated_at = now()
         where project_id = $1 and id = $2
         returning id, public_id, project_id, name, plural_name, key, icon, description, system`,
        [
          this.scope.projectId,
          input.objectTypeId,
          input.name.trim(),
          input.pluralName.trim(),
          input.key,
          input.description,
        ],
      );
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: 'schema.object_type_updated',
          targetType: 'object_type',
          targetId: input.objectTypeId,
          requestId: input.requestId,
          payload: {
            from: current,
            to: {
              name: input.name.trim(),
              pluralName: input.pluralName.trim(),
              key: input.key,
              description: input.description,
            },
          },
        }),
      );
      return mapObjectType(result.rows[0]);
    }).catch(mapObjectTypeUniqueViolation);
  }

  async getObjectTypePermissions(objectTypeId: string): Promise<TablePermissionConfiguration> {
    const table = await this.pool.query<{
      visibility_mode: TablePermissionMode;
      create_mode: TablePermissionMode;
      update_mode: TablePermissionMode;
      archive_mode: TablePermissionMode;
      permission_row_version: number;
    }>(
      `select visibility_mode,create_mode,update_mode,archive_mode,permission_row_version
       from object_types where project_id=$1 and id=$2`,
      [this.scope.projectId, objectTypeId],
    );
    if (!table.rows[0])
      throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');
    const subjects = await this.pool.query<{
      action: TablePermissionAction;
      user_id: string | null;
      group_id: string | null;
      user_name: string | null;
      user_email: string | null;
      group_name: string | null;
    }>(
      `select permission.action,permission.user_id,permission.group_id,
        member.display_name user_name,member.email user_email,member_group.name group_name
       from object_type_permission_subjects permission
       left join users member on member.id=permission.user_id
       left join member_groups member_group on member_group.id=permission.group_id
       where permission.project_id=$1 and permission.object_type_id=$2
       order by permission.action,permission.user_id nulls last,permission.group_id nulls last`,
      [this.scope.projectId, objectTypeId],
    );
    const configured: Record<TablePermissionAction, TablePermissionSubjects> = {
      visibility: { userIds: [], groupIds: [] },
      create: { userIds: [], groupIds: [] },
      update: { userIds: [], groupIds: [] },
      archive: { userIds: [], groupIds: [] },
    };
    const memberDirectory = new Map<string, { id: string; displayName: string; email: string }>();
    const groupDirectory = new Map<string, { id: string; name: string }>();
    for (const subject of subjects.rows) {
      if (subject.user_id) configured[subject.action].userIds.push(subject.user_id);
      if (subject.group_id) configured[subject.action].groupIds.push(subject.group_id);
      if (subject.user_id)
        memberDirectory.set(subject.user_id, {
          id: subject.user_id,
          displayName: subject.user_name ?? 'Unavailable member',
          email: subject.user_email ?? '',
        });
      if (subject.group_id)
        groupDirectory.set(subject.group_id, {
          id: subject.group_id,
          name: subject.group_name ?? 'Unavailable group',
        });
    }
    const current = table.rows[0];
    return {
      modes: {
        visibility: current.visibility_mode,
        create: current.create_mode,
        update: current.update_mode,
        archive: current.archive_mode,
      },
      subjects: configured,
      subjectDirectory: {
        members: [...memberDirectory.values()],
        groups: [...groupDirectory.values()],
      },
      rowVersion: current.permission_row_version,
    };
  }

  async updateObjectTypePermissions(input: {
    objectTypeId: string;
    modes: Record<TablePermissionAction, TablePermissionMode>;
    subjects: Record<TablePermissionAction, TablePermissionSubjects>;
    rowVersion: number;
    requestId: string;
  }): Promise<TablePermissionConfiguration> {
    const actions: TablePermissionAction[] = ['visibility', 'create', 'update', 'archive'];
    for (const action of actions) {
      const userIds = input.subjects[action].userIds;
      const groupIds = input.subjects[action].groupIds;
      if (new Set(userIds).size !== userIds.length || new Set(groupIds).size !== groupIds.length)
        throw new RepositoryError(
          'TABLE_PERMISSION_SUBJECT_DUPLICATE',
          400,
          'A member or group can appear only once per table action.',
        );
      if (userIds.length > 100 || groupIds.length > 100)
        throw new RepositoryError(
          'TABLE_PERMISSION_SUBJECT_LIMIT',
          400,
          'Each table action supports at most 100 members and 100 groups.',
        );
      if (input.modes[action] === 'specific' && userIds.length + groupIds.length === 0)
        throw new RepositoryError(
          'TABLE_PERMISSION_SUBJECT_REQUIRED',
          400,
          'Specific access requires at least one member or group.',
        );
    }
    await transaction(this.pool, async (client) => {
      const current = await client.query<{
        visibility_mode: TablePermissionMode;
        create_mode: TablePermissionMode;
        update_mode: TablePermissionMode;
        archive_mode: TablePermissionMode;
      }>(
        `select visibility_mode,create_mode,update_mode,archive_mode from object_types
         where project_id=$1 and id=$2 and permission_row_version=$3 for update`,
        [this.scope.projectId, input.objectTypeId, input.rowVersion],
      );
      if (!current.rows[0]) {
        const exists = await client.query(
          'select 1 from object_types where project_id=$1 and id=$2',
          [this.scope.projectId, input.objectTypeId],
        );
        throw new RepositoryError(
          exists.rowCount ? 'TABLE_PERMISSION_VERSION_CONFLICT' : 'OBJECT_TYPE_NOT_FOUND',
          exists.rowCount ? 409 : 404,
          exists.rowCount
            ? 'Table permissions changed; reload and retry.'
            : 'Object type was not found.',
        );
      }
      const allUserIds = [...new Set(actions.flatMap((action) => input.subjects[action].userIds))];
      const allGroupIds = [
        ...new Set(actions.flatMap((action) => input.subjects[action].groupIds)),
      ];
      if (allUserIds.length) {
        const members = await client.query<{ id: string }>(
          `select m.user_id id from memberships m join users u on u.id=m.user_id
           where m.organization_id=$1 and m.user_id=any($2::uuid[]) and u.disabled_at is null`,
          [this.scope.actor.organizationId, allUserIds],
        );
        if (members.rowCount !== allUserIds.length)
          throw new RepositoryError(
            'TABLE_PERMISSION_MEMBER_INVALID',
            400,
            'Every selected member must be active in this organization.',
          );
      }
      if (allGroupIds.length) {
        const groups = await client.query<{ id: string }>(
          `select id from member_groups where organization_id=$1 and id=any($2::uuid[])
           and archived_at is null`,
          [this.scope.actor.organizationId, allGroupIds],
        );
        if (groups.rowCount !== allGroupIds.length)
          throw new RepositoryError(
            'TABLE_PERMISSION_GROUP_INVALID',
            400,
            'Every selected group must be active in this organization.',
          );
      }
      await client.query(
        `update object_types set visibility_mode=$4,create_mode=$5,update_mode=$6,archive_mode=$7,
          permission_row_version=permission_row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and permission_row_version=$3`,
        [
          this.scope.projectId,
          input.objectTypeId,
          input.rowVersion,
          input.modes.visibility,
          input.modes.create,
          input.modes.update,
          input.modes.archive,
        ],
      );
      await client.query(
        'delete from object_type_permission_subjects where project_id=$1 and object_type_id=$2',
        [this.scope.projectId, input.objectTypeId],
      );
      for (const action of actions) {
        if (input.modes[action] !== 'specific') continue;
        for (const userId of input.subjects[action].userIds)
          await client.query(
            `insert into object_type_permission_subjects
             (id,project_id,object_type_id,organization_id,action,user_id,created_by)
             values ($1,$2,$3,$4,$5,$6,$7)`,
            [
              uuidv7(),
              this.scope.projectId,
              input.objectTypeId,
              this.scope.actor.organizationId,
              action,
              userId,
              this.scope.actor.actorId,
            ],
          );
        for (const groupId of input.subjects[action].groupIds)
          await client.query(
            `insert into object_type_permission_subjects
             (id,project_id,object_type_id,organization_id,action,group_id,created_by)
             values ($1,$2,$3,$4,$5,$6,$7)`,
            [
              uuidv7(),
              this.scope.projectId,
              input.objectTypeId,
              this.scope.actor.organizationId,
              action,
              groupId,
              this.scope.actor.actorId,
            ],
          );
      }
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: 'schema.object_type_permissions_updated',
          targetType: 'object_type',
          targetId: input.objectTypeId,
          requestId: input.requestId,
          payload: {
            from: current.rows[0],
            to: input.modes,
            subjectCounts: Object.fromEntries(
              actions.map((action) => [
                action,
                input.subjects[action].userIds.length + input.subjects[action].groupIds.length,
              ]),
            ),
            rowVersion: input.rowVersion + 1,
          },
        }),
      );
    });
    return this.getObjectTypePermissions(input.objectTypeId);
  }

  private async validateRecordViewConfig(
    client: PoolClient,
    objectTypeId: string,
    viewType: RecordViewType,
    config: RecordViewConfig,
  ): Promise<void> {
    const objectType = await client.query(
      'select 1 from object_types where project_id = $1 and id = $2',
      [this.scope.projectId, objectTypeId],
    );
    if (!objectType.rowCount)
      throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');

    const referencedFieldIds = new Set([
      ...config.visibleFieldIds,
      ...Object.keys(config.fieldWidths),
      ...config.filters.map((filter) => filter.fieldId),
      ...config.sorts.flatMap((sort) => (sort.fieldId ? [sort.fieldId] : [])),
      ...(config.groupings ?? []).map((grouping) => grouping.fieldId),
      ...(config.summaries ?? []).map((summary) => summary.fieldId),
      ...(config.viewOptions?.groupFieldId ? [config.viewOptions.groupFieldId] : []),
      ...(config.viewOptions?.dateFieldId ? [config.viewOptions.dateFieldId] : []),
    ]);
    const fields = await client.query<{ id: string; field_type: ConfigurableFieldType }>(
      `select id, field_type from field_definitions
       where project_id = $1 and object_type_id = $2 and id = any($3::uuid[])`,
      [this.scope.projectId, objectTypeId, [...referencedFieldIds]],
    );
    if (fields.rowCount !== referencedFieldIds.size) {
      throw new RepositoryError(
        'RECORD_VIEW_FIELD_NOT_FOUND',
        400,
        'The view references a field that does not belong to this table.',
      );
    }
    const byId = new Map(fields.rows.map((field) => [field.id, field.field_type]));
    const groupings = config.groupings ?? [];
    if (
      groupings.length > 3 ||
      new Set(groupings.map((grouping) => grouping.fieldId)).size !== groupings.length ||
      (viewType !== 'grid' && groupings.length > 0) ||
      groupings.some((grouping) => !fieldTypeCanGroup(byId.get(grouping.fieldId)!))
    ) {
      throw new RepositoryError(
        'RECORD_VIEW_CONFIG_INVALID',
        400,
        'Grid views support up to three unique groupable fields.',
      );
    }
    for (const summary of config.summaries ?? []) {
      const fieldType = byId.get(summary.fieldId);
      if (!fieldType || !summaryOperationAllowed(fieldType, summary.operation)) {
        throw new RepositoryError(
          'RECORD_VIEW_CONFIG_INVALID',
          400,
          'A saved field summary is incompatible with its field type.',
        );
      }
    }
    const groupFieldId = config.viewOptions?.groupFieldId;
    if (viewType === 'kanban' && (!groupFieldId || byId.get(groupFieldId) !== 'single_select')) {
      throw new RepositoryError(
        'RECORD_VIEW_CONFIG_INVALID',
        400,
        'Kanban views require a single-select grouping field.',
      );
    }
    const dateFieldId = config.viewOptions?.dateFieldId;
    if (
      viewType === 'calendar' &&
      (!dateFieldId || !['date', 'datetime'].includes(byId.get(dateFieldId) ?? ''))
    ) {
      throw new RepositoryError(
        'RECORD_VIEW_CONFIG_INVALID',
        400,
        'Calendar views require a date or datetime field.',
      );
    }
    if (config.viewOptions?.contextProjectId) {
      await this.validateContextProject(client, config.viewOptions.contextProjectId);
    }
    if (viewType === 'form') {
      const hiddenRequired = await client.query<{ name: string }>(
        `select name from field_definitions
         where project_id = $1 and object_type_id = $2 and required = true
           and field_type <> 'measurement'
           and (default_value is null or default_value in ('null'::jsonb, '""'::jsonb, '[]'::jsonb)
             or field_type in ('relation', 'file', 'dataset'))
           and not (id = any($3::uuid[]))
         order by position, id limit 1`,
        [this.scope.projectId, objectTypeId, config.visibleFieldIds],
      );
      if (hiddenRequired.rows[0]) {
        throw new RepositoryError(
          'RECORD_VIEW_CONFIG_INVALID',
          400,
          `Form views must include required field '${hiddenRequired.rows[0].name}'.`,
        );
      }
    }
  }

  async getRecordView(objectTypeId: string, viewId: string): Promise<RecordViewRow> {
    await this.assertObjectTypePermission(objectTypeId, 'visibility');
    const result = await this.pool.query<DbRecordViewRow>(
      `select id, public_id, project_id, object_type_id, name, view_type, permission_type,
              owner_id, lock_reason, config, row_version,
              created_by, updated_by, archived_at, created_at, updated_at
       from record_views
       where project_id = $1 and object_type_id = $2 and id = $3 and archived_at is null`,
      [this.scope.projectId, objectTypeId, viewId],
    );
    if (!result.rows[0])
      throw new RepositoryError('RECORD_VIEW_NOT_FOUND', 404, 'Record view was not found.');
    return mapRecordView(result.rows[0]);
  }

  async listRecordViewPage(
    objectTypeId: string,
    options: { query?: string; limit?: number; offset?: number; includeArchived?: boolean } = {},
  ): Promise<RecordViewPage> {
    await this.assertObjectTypePermission(objectTypeId, 'visibility');
    const query = (options.query ?? '').trim().normalize('NFKC').toLocaleLowerCase();
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);
    const includeArchived = options.includeArchived ?? false;
    const parameters = [this.scope.projectId, objectTypeId, query, includeArchived];
    const predicate = `project_id = $1 and object_type_id = $2
      and ($4::boolean or archived_at is null)
      and ($3 = '' or position($3 in lower(name)) > 0)`;
    const [result, count] = await Promise.all([
      this.pool.query<DbRecordViewRow>(
        `select id, public_id, project_id, object_type_id, name, view_type, permission_type,
                owner_id, lock_reason, config, row_version,
                created_by, updated_by, archived_at, created_at, updated_at
         from record_views where ${predicate}
         order by lower(name), id limit $5 offset $6`,
        [...parameters, limit, offset],
      ),
      this.pool.query<{ count: string }>(
        `select count(*)::text count from record_views where ${predicate}`,
        parameters,
      ),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    if (!total) {
      const exists = await this.pool.query(
        'select 1 from object_types where project_id = $1 and id = $2',
        [this.scope.projectId, objectTypeId],
      );
      if (!exists.rowCount)
        throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');
    }
    const items = result.rows.map(mapRecordView);
    return {
      items,
      pageInfo: { limit, offset, total, hasNext: offset + items.length < total },
    };
  }

  async createRecordView(input: {
    objectTypeId: string;
    name: string;
    viewType: RecordViewType;
    permissionType?: RecordViewPermissionType;
    lockReason?: string;
    config: RecordViewConfig;
    requestId: string;
  }): Promise<RecordViewRow> {
    await this.assertObjectTypePermission(input.objectTypeId, 'visibility');
    try {
      return await transaction(this.pool, async (client) => {
        await this.validateRecordViewConfig(
          client,
          input.objectTypeId,
          input.viewType,
          input.config,
        );
        const permissionType = input.permissionType ?? 'collaborative';
        if (permissionType === 'locked' && !this.isRecordViewAdministrator()) {
          throw new RepositoryError(
            'RECORD_VIEW_PERMISSION_DENIED',
            403,
            'Only an Engineer or administrator can create a locked view.',
          );
        }
        const id = uuidv7();
        const result = await client.query<DbRecordViewRow>(
          `insert into record_views
            (id, public_id, project_id, object_type_id, name, view_type, permission_type, owner_id,
             lock_reason, config, created_by, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $11)
           returning id, public_id, project_id, object_type_id, name, view_type, permission_type,
                     owner_id, lock_reason, config, row_version,
                     created_by, updated_by, archived_at, created_at, updated_at`,
          [
            id,
            generateViewPublicId(),
            this.scope.projectId,
            input.objectTypeId,
            input.name.trim(),
            input.viewType,
            permissionType,
            permissionType === 'personal' ? this.scope.actor.actorId : null,
            permissionType === 'locked' ? input.lockReason?.trim() || null : null,
            JSON.stringify(input.config),
            this.scope.actor.actorId,
          ],
        );
        await appendAudit(
          client,
          this.audit({
            actorId: this.scope.actor.actorId,
            action: 'record_view.created',
            targetType: 'record_view',
            targetId: id,
            requestId: input.requestId,
            payload: {
              objectTypeId: input.objectTypeId,
              name: input.name.trim(),
              viewType: input.viewType,
              permissionType,
            },
          }),
        );
        return mapRecordView(result.rows[0]!);
      });
    } catch (error) {
      return mapRecordViewUniqueViolation(error);
    }
  }

  async updateRecordView(input: {
    objectTypeId: string;
    viewId: string;
    name: string;
    viewType: RecordViewType;
    config: RecordViewConfig;
    rowVersion: number;
    requestId: string;
  }): Promise<RecordViewRow> {
    await this.assertObjectTypePermission(input.objectTypeId, 'visibility');
    try {
      return await transaction(this.pool, async (client) => {
        const current = await client.query<Pick<DbRecordViewRow, 'permission_type' | 'owner_id'>>(
          `select permission_type,owner_id from record_views
           where project_id=$1 and object_type_id=$2 and id=$3 and archived_at is null for update`,
          [this.scope.projectId, input.objectTypeId, input.viewId],
        );
        if (!current.rows[0])
          throw new RepositoryError('RECORD_VIEW_NOT_FOUND', 404, 'Record view was not found.');
        this.assertRecordViewWritable(current.rows[0]);
        await this.validateRecordViewConfig(
          client,
          input.objectTypeId,
          input.viewType,
          input.config,
        );
        const result = await client.query<DbRecordViewRow>(
          `update record_views set
             name = $4, view_type = $5, config = $6::jsonb, row_version = row_version + 1,
             updated_by = $7, updated_at = now()
           where project_id = $1 and object_type_id = $2 and id = $3
             and row_version = $8 and archived_at is null
           returning id, public_id, project_id, object_type_id, name, view_type, permission_type,
                     owner_id, lock_reason, config, row_version,
                     created_by, updated_by, archived_at, created_at, updated_at`,
          [
            this.scope.projectId,
            input.objectTypeId,
            input.viewId,
            input.name.trim(),
            input.viewType,
            JSON.stringify(input.config),
            this.scope.actor.actorId,
            input.rowVersion,
          ],
        );
        if (!result.rows[0]) {
          const exists = await client.query(
            `select 1 from record_views
             where project_id = $1 and object_type_id = $2 and id = $3 and archived_at is null`,
            [this.scope.projectId, input.objectTypeId, input.viewId],
          );
          throw new RepositoryError(
            exists.rowCount ? 'VERSION_CONFLICT' : 'RECORD_VIEW_NOT_FOUND',
            exists.rowCount ? 409 : 404,
            exists.rowCount
              ? 'The view changed since it was loaded.'
              : 'Record view was not found.',
          );
        }
        await appendAudit(
          client,
          this.audit({
            actorId: this.scope.actor.actorId,
            action: 'record_view.updated',
            targetType: 'record_view',
            targetId: input.viewId,
            requestId: input.requestId,
            payload: {
              name: input.name.trim(),
              viewType: input.viewType,
              rowVersion: result.rows[0].row_version,
            },
          }),
        );
        return mapRecordView(result.rows[0]);
      });
    } catch (error) {
      return mapRecordViewUniqueViolation(error);
    }
  }

  async setRecordViewArchived(input: {
    objectTypeId: string;
    viewId: string;
    archived: boolean;
    rowVersion: number;
    reason?: string;
    requestId: string;
  }): Promise<RecordViewRow> {
    await this.assertObjectTypePermission(input.objectTypeId, 'visibility');
    try {
      return await transaction(this.pool, async (client) => {
        const current = await client.query<Pick<DbRecordViewRow, 'permission_type' | 'owner_id'>>(
          `select permission_type,owner_id from record_views
           where project_id=$1 and object_type_id=$2 and id=$3 for update`,
          [this.scope.projectId, input.objectTypeId, input.viewId],
        );
        if (!current.rows[0])
          throw new RepositoryError('RECORD_VIEW_NOT_FOUND', 404, 'Record view was not found.');
        this.assertRecordViewWritable(current.rows[0], true);
        const result = await client.query<DbRecordViewRow>(
          `update record_views set
             archived_at = case when $4::boolean then now() else null end,
             archived_by = case when $4::boolean then $5::uuid else null end,
             archive_reason = case when $4::boolean then $6::text else null end,
             row_version = row_version + 1, updated_by = $5, updated_at = now()
           where project_id = $1 and object_type_id = $2 and id = $3 and row_version = $7
             and (($4::boolean and archived_at is null) or (not $4::boolean and archived_at is not null))
           returning id, public_id, project_id, object_type_id, name, view_type, permission_type,
                     owner_id, lock_reason, config, row_version,
                     created_by, updated_by, archived_at, created_at, updated_at`,
          [
            this.scope.projectId,
            input.objectTypeId,
            input.viewId,
            input.archived,
            this.scope.actor.actorId,
            input.reason ?? null,
            input.rowVersion,
          ],
        );
        if (!result.rows[0]) {
          const exists = await client.query(
            'select 1 from record_views where project_id = $1 and object_type_id = $2 and id = $3',
            [this.scope.projectId, input.objectTypeId, input.viewId],
          );
          throw new RepositoryError(
            exists.rowCount ? 'VERSION_CONFLICT' : 'RECORD_VIEW_NOT_FOUND',
            exists.rowCount ? 409 : 404,
            exists.rowCount
              ? 'The view changed since it was loaded.'
              : 'Record view was not found.',
          );
        }
        await appendAudit(
          client,
          this.audit({
            actorId: this.scope.actor.actorId,
            action: input.archived ? 'record_view.archived' : 'record_view.restored',
            targetType: 'record_view',
            targetId: input.viewId,
            requestId: input.requestId,
            payload: input.archived ? { reason: input.reason ?? null } : {},
          }),
        );
        return mapRecordView(result.rows[0]);
      });
    } catch (error) {
      return mapRecordViewUniqueViolation(error);
    }
  }

  async setRecordViewPermission(input: {
    objectTypeId: string;
    viewId: string;
    permissionType: RecordViewPermissionType;
    lockReason?: string;
    rowVersion: number;
    requestId: string;
  }): Promise<RecordViewRow> {
    await this.assertObjectTypePermission(input.objectTypeId, 'visibility');
    return transaction(this.pool, async (client) => {
      const current = await client.query<DbRecordViewRow>(
        `select id, public_id, project_id, object_type_id, name, view_type, permission_type,
                owner_id, lock_reason, config, row_version, created_by, updated_by, archived_at,
                created_at, updated_at
         from record_views where project_id=$1 and object_type_id=$2 and id=$3
           and archived_at is null for update`,
        [this.scope.projectId, input.objectTypeId, input.viewId],
      );
      const view = current.rows[0];
      if (!view)
        throw new RepositoryError('RECORD_VIEW_NOT_FOUND', 404, 'Record view was not found.');
      if (view.row_version !== input.rowVersion)
        throw new RepositoryError('VERSION_CONFLICT', 409, 'The view changed since it was loaded.');

      const administrator = this.isRecordViewAdministrator();
      const ownsPersonalView =
        view.permission_type === 'personal' && view.owner_id === this.scope.actor.actorId;
      const contributorTransition =
        (view.permission_type === 'collaborative' &&
          view.created_by === this.scope.actor.actorId &&
          input.permissionType === 'personal') ||
        (ownsPersonalView && input.permissionType === 'collaborative');
      if (!administrator && !contributorTransition) {
        throw new RepositoryError(
          'RECORD_VIEW_PERMISSION_DENIED',
          403,
          'You cannot change this view permission mode.',
        );
      }
      if (input.permissionType === view.permission_type) return mapRecordView(view);

      const result = await client.query<DbRecordViewRow>(
        `update record_views set permission_type=$4,
           owner_id=case when $4='personal' then $5::uuid else null end,
           lock_reason=case when $4='locked' then $6::text else null end,
           row_version=row_version+1,updated_by=$5,updated_at=now()
         where project_id=$1 and object_type_id=$2 and id=$3 and row_version=$7
         returning id, public_id, project_id, object_type_id, name, view_type, permission_type,
                   owner_id, lock_reason, config, row_version, created_by, updated_by, archived_at,
                   created_at, updated_at`,
        [
          this.scope.projectId,
          input.objectTypeId,
          input.viewId,
          input.permissionType,
          this.scope.actor.actorId,
          input.permissionType === 'locked' ? input.lockReason?.trim() || null : null,
          input.rowVersion,
        ],
      );
      const updated = result.rows[0];
      if (!updated)
        throw new RepositoryError('VERSION_CONFLICT', 409, 'The view changed since it was loaded.');
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: 'record_view.permission_changed',
          targetType: 'record_view',
          targetId: input.viewId,
          requestId: input.requestId,
          payload: {
            from: view.permission_type,
            to: input.permissionType,
            ownerId: updated.owner_id,
            lockReason: updated.lock_reason,
            rowVersion: updated.row_version,
          },
        }),
      );
      return mapRecordView(updated);
    });
  }

  async listFields(objectTypeId: string): Promise<FieldDefinitionRow[]> {
    await this.assertObjectTypePermission(objectTypeId, 'visibility');
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

  async reorderFields(input: {
    objectTypeId: string;
    fieldIds: string[];
    requestId: string;
  }): Promise<FieldDefinitionRow[]> {
    await this.assertObjectTypePermission(input.objectTypeId, 'visibility');
    return transaction(this.pool, async (client) => {
      const objectType = await client.query(
        'select 1 from object_types where project_id = $1 and id = $2 for update',
        [this.scope.projectId, input.objectTypeId],
      );
      if (!objectType.rowCount) {
        throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');
      }
      const current = await client.query<{ id: string }>(
        `select id from field_definitions
         where project_id = $1 and object_type_id = $2 order by position, id for update`,
        [this.scope.projectId, input.objectTypeId],
      );
      const requested = new Set(input.fieldIds);
      if (
        requested.size !== input.fieldIds.length ||
        current.rows.length !== input.fieldIds.length ||
        current.rows.some((field) => !requested.has(field.id))
      ) {
        throw new RepositoryError(
          'FIELD_ORDER_INVALID',
          409,
          'Field order must include every field exactly once.',
        );
      }
      await client.query(
        `update field_definitions as field
         set position = (ordering.ordinality - 1)::integer, updated_at = now()
         from unnest($3::uuid[]) with ordinality as ordering(id, ordinality)
         where field.project_id = $1 and field.object_type_id = $2 and field.id = ordering.id`,
        [this.scope.projectId, input.objectTypeId, input.fieldIds],
      );
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: 'schema.fields_reordered',
          targetType: 'object_type',
          targetId: input.objectTypeId,
          requestId: input.requestId,
          payload: { fieldIds: input.fieldIds },
        }),
      );
      const updated = await client.query<DbFieldRow>(
        `select id, project_id, object_type_id, name, key, description, field_type, required,
                "unique", position, config, default_value, system, projection_status, projection_version
         from field_definitions where project_id = $1 and object_type_id = $2
         order by position, id`,
        [this.scope.projectId, input.objectTypeId],
      );
      return updated.rows.map(mapField);
    });
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
    await this.assertObjectTypePermission(input.objectTypeId, 'visibility');
    if (
      this.scope.system &&
      (['measurement', 'dataset'].includes(input.fieldType) ||
        (input.fieldType === 'file' && input.config?.mediaKind !== 'image'))
    ) {
      throw new RepositoryError(
        'WORKSPACE_FIELD_TYPE_UNSUPPORTED',
        400,
        'Workspace tables only support image-configured file fields.',
      );
    }
    if (
      input.defaultValue !== undefined &&
      ['relation', 'measurement', 'file', 'dataset', ...calculatedFieldTypes].includes(
        input.fieldType,
      )
    ) {
      throw new RepositoryError(
        'FIELD_DEFAULT_UNSUPPORTED',
        400,
        'Calculated and reference fields cannot have default values.',
      );
    }
    if (input.defaultValue !== undefined && !hasRecordValue(input.defaultValue)) {
      throw new RepositoryError(
        'FIELD_DEFAULT_INVALID',
        400,
        'A field default must contain a value.',
      );
    }
    const config = input.config ?? {};
    validateConfig(input.fieldType, config);
    if (calculatedFieldTypes.includes(input.fieldType) && (input.required || input.unique)) {
      throw new RepositoryError(
        'FIELD_CALCULATED_READ_ONLY',
        400,
        'Calculated fields cannot be required or unique.',
      );
    }
    if (input.unique && !uniqueAllowed(input.fieldType)) {
      throw new RepositoryError(
        'FIELD_UNIQUE_UNSUPPORTED',
        400,
        'This field type cannot be unique.',
      );
    }
    return transaction(this.pool, async (client) => {
      const objectType = await client.query(
        'select 1 from object_types where project_id = $1 and id = $2 for update',
        [this.scope.projectId, input.objectTypeId],
      );
      if (!objectType.rowCount)
        throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');
      await this.validateCalculatedFieldConfig(client, input.objectTypeId, input.fieldType, config);
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
    await this.assertObjectTypePermission(input.objectTypeId, 'visibility');
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
        await this.validateCalculatedFieldConfig(
          client,
          input.objectTypeId,
          previous.fieldType,
          input.config,
          input.fieldId,
        );
        if (calculatedFieldTypes.includes(previous.fieldType) && (input.required || input.unique)) {
          throw new RepositoryError(
            'FIELD_CALCULATED_READ_ONLY',
            400,
            'Calculated fields cannot be required or unique.',
          );
        }
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
        } else if (!calculatedFieldTypes.includes(previous.fieldType)) {
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
        if (
          previous.fieldType !== 'relation' &&
          !calculatedFieldTypes.includes(previous.fieldType)
        ) {
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
    if (this.scope.system) {
      throw new RepositoryError(
        'WORKSPACE_TEMPLATE_UNSUPPORTED',
        400,
        'The engineering template can only be installed in an ordinary project.',
      );
    }
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
              (id, public_id, project_id, name, plural_name, key, icon, description, system)
             values ($1, $2, $3, $4, $5, $6, $7, '', true)`,
            [
              id,
              generateTablePublicId(),
              this.scope.projectId,
              object.name,
              object.pluralName,
              object.key,
              object.icon,
            ],
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

  private async validateContextProject(
    client: PoolClient,
    contextProjectId: string | null,
  ): Promise<void> {
    if (!contextProjectId) return;
    const result = await client.query(
      `select 1 from projects
       where id = $1 and workspace_id = $2 and system = false`,
      [contextProjectId, this.scope.workspaceId],
    );
    if (!result.rowCount) {
      throw new RepositoryError(
        'PROJECT_NOT_FOUND',
        404,
        'Linked project was not found in this workspace.',
      );
    }
  }

  private async validateCalculatedFieldConfig(
    client: PoolClient,
    objectTypeId: string,
    type: ConfigurableFieldType,
    config: Record<string, JsonValue>,
    fieldId?: string,
  ): Promise<void> {
    if (type === 'formula') {
      const references = formulaReferences(String(config.expression));
      if (!references.length) return;
      const result = await client.query<{ id: string; key: string }>(
        `select id,key from field_definitions
         where project_id=$1 and object_type_id=$2 and key=any($3::text[])`,
        [this.scope.projectId, objectTypeId, references],
      );
      if (
        result.rows.length !== references.length ||
        (fieldId && result.rows.some((field) => field.id === fieldId))
      ) {
        throw new RepositoryError(
          'FIELD_CONFIG_INVALID',
          400,
          'Formula references must point to other fields in this table.',
        );
      }
      return;
    }
    if (type !== 'lookup' && type !== 'rollup') return;
    const relation = await client.query<{ config: Record<string, JsonValue> }>(
      `select config from field_definitions
       where project_id=$1 and object_type_id=$2 and id=$3 and field_type='relation'`,
      [this.scope.projectId, objectTypeId, config.relationFieldId],
    );
    if (!relation.rows[0]) {
      throw new RepositoryError(
        'FIELD_CONFIG_INVALID',
        400,
        'Calculated field relation must belong to this table.',
      );
    }
    if (config.targetFieldId === 'displayName') return;
    const target = await client.query<{ field_type: ConfigurableFieldType }>(
      `select field_type from field_definitions
       where project_id=$1 and object_type_id=$2 and id=$3`,
      [this.scope.projectId, relation.rows[0].config.targetObjectTypeId, config.targetFieldId],
    );
    if (!target.rows[0] || calculatedFieldTypes.includes(target.rows[0].field_type)) {
      throw new RepositoryError(
        'FIELD_CONFIG_INVALID',
        400,
        'Calculated target must be a stored field in the related table.',
      );
    }
    if (
      type === 'rollup' &&
      config.aggregation !== 'count' &&
      !['integer', 'decimal', 'quantity'].includes(target.rows[0].field_type)
    ) {
      throw new RepositoryError(
        'FIELD_CONFIG_INVALID',
        400,
        'Numeric rollups require an integer, decimal, or quantity target field.',
      );
    }
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
      if (
        !field ||
        ['relation', 'measurement', 'file', 'dataset', ...calculatedFieldTypes].includes(
          field.fieldType,
        )
      ) {
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
          const resource = await client.query<{ content_type?: string }>(
            field.fieldType === 'file'
              ? "select content_type from file_objects where project_id=$1 and id=$2 and status='available'"
              : "select 1 from datasets where project_id=$1 and id=$2 and status='ready'",
            [this.scope.projectId, references[0]],
          );
          if (!resource.rowCount)
            throw new RepositoryError(
              field.fieldType === 'file' ? 'FILE_NOT_AVAILABLE' : 'DATASET_NOT_READY',
              409,
              `Field '${field.key}' references an unavailable resource.`,
            );
          if (
            field.fieldType === 'file' &&
            field.config.mediaKind === 'image' &&
            !supportedImageTypes.has(resource.rows[0]?.content_type ?? '')
          ) {
            throw new RepositoryError(
              'FIELD_VALIDATION_FAILED',
              400,
              `Field '${field.key}' only accepts supported image files.`,
            );
          }
        }
        if (field.fieldType === 'file') fileReferences[field.id] = references;
        else datasetReferences[field.id] = references;
        continue;
      }
      if (field.fieldType === 'measurement' || calculatedFieldTypes.includes(field.fieldType))
        continue;
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
      if (!hasRecordValue(value)) {
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
      } else if (
        !calculatedFieldTypes.includes(field.fieldType) &&
        values[field.key] !== undefined
      ) {
        await this.replaceProjection(client, recordId, field, values[field.key]!);
      }
    }
  }

  private async hydrateCalculatedValues(
    records: RecordRow[],
    fields: FieldDefinitionRow[],
  ): Promise<RecordRow[]> {
    if (!records.length) return records;
    const calculated = fields.filter((field) => calculatedFieldTypes.includes(field.fieldType));
    for (const field of calculated.filter((candidate) => candidate.fieldType !== 'formula')) {
      const relationFieldId = String(field.config.relationFieldId);
      const targetIds = [
        ...new Set(records.flatMap((record) => record.relations[relationFieldId] ?? [])),
      ];
      if (!targetIds.length) {
        for (const record of records)
          record.values[field.key] = field.fieldType === 'rollup' ? 0 : [];
        continue;
      }
      const targetFieldId = String(field.config.targetFieldId);
      let targetKey: string | undefined;
      if (targetFieldId !== 'displayName') {
        const targetField = await this.pool.query<{ key: string }>(
          'select key from field_definitions where project_id=$1 and id=$2',
          [this.scope.projectId, targetFieldId],
        );
        targetKey = targetField.rows[0]?.key;
      }
      const targets = await this.pool.query<{
        id: string;
        display_name: string;
        values: Record<string, JsonValue>;
      }>(
        `select id,display_name,values from records
         where project_id=$1 and id=any($2::uuid[]) and archived_at is null`,
        [this.scope.projectId, targetIds],
      );
      const byId = new Map(
        targets.rows.map((target) => [
          target.id,
          targetFieldId === 'displayName' ? target.display_name : target.values[targetKey!],
        ]),
      );
      for (const record of records) {
        const values = (record.relations[relationFieldId] ?? []).flatMap((id) => {
          const value = byId.get(id);
          return value === undefined ? [] : [value];
        });
        if (field.fieldType === 'lookup') {
          record.values[field.key] = values.length === 1 ? values[0]! : values;
          continue;
        }
        const aggregation = String(field.config.aggregation);
        if (aggregation === 'count') {
          record.values[field.key] = values.length;
          continue;
        }
        const numbers = values.flatMap((value) => {
          const number = rollupNumber(value);
          return number === undefined ? [] : [number];
        });
        record.values[field.key] = !numbers.length
          ? null
          : aggregation === 'sum'
            ? numbers.reduce((total, value) => total + value, 0)
            : aggregation === 'average'
              ? numbers.reduce((total, value) => total + value, 0) / numbers.length
              : aggregation === 'min'
                ? Math.min(...numbers)
                : Math.max(...numbers);
      }
    }
    const formulas = calculated.filter((field) => field.fieldType === 'formula');
    for (let pass = 0; pass < formulas.length; pass += 1) {
      for (const record of records) {
        const inputs = Object.fromEntries(
          Object.entries(record.values).map(([key, value]) => [key, formulaValue(value)]),
        );
        for (const field of formulas) {
          try {
            record.values[field.key] = evaluateFormula(String(field.config.expression), inputs);
            inputs[field.key] = formulaValue(record.values[field.key]);
          } catch (error) {
            record.values[field.key] = `#ERROR! ${
              error instanceof Error ? error.message : 'Formula could not be evaluated.'
            }`;
          }
        }
      }
    }
    return records;
  }

  private async loadRelations(
    recordIds: string[],
    fieldIds?: string[],
  ): Promise<Map<string, Record<string, string[]>>> {
    const mapped = new Map<string, Record<string, string[]>>();
    if (!recordIds.length) return mapped;
    const result = await this.pool.query<{
      source_record_id: string;
      source_field_id: string;
      target_record_id: string;
    }>(
      `select source_record_id, source_field_id, target_record_id from relation_edges
       where project_id = $1 and source_record_id = any($2::uuid[])
         ${fieldIds ? 'and source_field_id = any($3::uuid[])' : ''}
       order by source_field_id, target_record_id`,
      fieldIds ? [this.scope.projectId, recordIds, fieldIds] : [this.scope.projectId, recordIds],
    );
    for (const row of result.rows) {
      const relations = mapped.get(row.source_record_id) ?? {};
      (relations[row.source_field_id] ??= []).push(row.target_record_id);
      mapped.set(row.source_record_id, relations);
    }
    return mapped;
  }

  private async loadRelationLabels(
    relations: Map<string, Record<string, string[]>>,
  ): Promise<Map<string, Record<string, RecordReferenceRow[]>>> {
    const targetIds = [
      ...new Set(
        [...relations.values()].flatMap((fields) => Object.values(fields).flatMap((ids) => ids)),
      ),
    ];
    const labels = new Map<string, RecordReferenceRow>();
    if (targetIds.length) {
      const result = await this.pool.query<{
        id: string;
        display_name: string;
        archived_at: Date | null;
      }>(
        `select id,display_name,archived_at from records
         where project_id=$1 and id=any($2::uuid[])`,
        [this.scope.projectId, targetIds],
      );
      for (const row of result.rows)
        labels.set(row.id, {
          id: row.id,
          displayName: row.display_name,
          archivedAt: row.archived_at?.toISOString() ?? null,
        });
    }
    return new Map(
      [...relations.entries()].map(([recordId, fields]) => [
        recordId,
        Object.fromEntries(
          Object.entries(fields).map(([fieldId, ids]) => [
            fieldId,
            ids.map((id) => labels.get(id)).filter((item) => item !== undefined),
          ]),
        ),
      ]),
    );
  }

  private async loadResourceReferences(recordIds: string[], fieldIds?: string[]) {
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
         where project_id=$1 and record_id=any($2::uuid[])
           ${fieldIds ? 'and field_id=any($3::uuid[])' : ''}
         order by field_id,${target}`,
        fieldIds ? [this.scope.projectId, recordIds, fieldIds] : [this.scope.projectId, recordIds],
      );
      for (const row of result.rows) {
        const references = mapped.get(row.record_id) ?? {};
        (references[row.field_id] ??= []).push(row.target_id);
        mapped.set(row.record_id, references);
      }
    }
    return { files, datasets };
  }

  private async loadReferenceLabels(
    rows: Array<{ id: string; values: Record<string, JsonValue> }>,
    fields: FieldDefinitionRow[],
    resources: {
      files: Map<string, Record<string, string[]>>;
      datasets: Map<string, Record<string, string[]>>;
    },
  ): Promise<Map<string, Record<string, RecordReferenceRow[]>>> {
    const userFields = fields.filter((field) => field.fieldType === 'user');
    const userIds = [
      ...new Set(
        rows.flatMap((row) =>
          userFields.flatMap((field) => {
            const value = row.values[field.key];
            return typeof value === 'string' ? [value] : [];
          }),
        ),
      ),
    ];
    const fileIds = [
      ...new Set(
        [...resources.files.values()].flatMap((references) => Object.values(references).flat()),
      ),
    ];
    const datasetIds = [
      ...new Set(
        [...resources.datasets.values()].flatMap((references) => Object.values(references).flat()),
      ),
    ];
    const [users, files, datasets] = await Promise.all([
      userIds.length
        ? this.pool.query<{ id: string; display_name: string; disabled_at: Date | null }>(
            `select u.id,u.display_name,u.disabled_at
             from memberships m join users u on u.id=m.user_id
             where m.organization_id=$1 and u.id=any($2::uuid[])`,
            [this.scope.actor.organizationId, userIds],
          )
        : Promise.resolve({ rows: [] }),
      fileIds.length
        ? this.pool.query<{
            id: string;
            series_name: string;
            version_number: number;
            original_name: string;
            archived_at: Date | null;
          }>(
            `select f.id,s.name series_name,f.version_number,f.original_name,f.archived_at
             from file_objects f
             join file_series s on s.id=f.file_series_id and s.project_id=f.project_id
             where f.project_id=$1 and f.id=any($2::uuid[])`,
            [this.scope.projectId, fileIds],
          )
        : Promise.resolve({ rows: [] }),
      datasetIds.length
        ? this.pool.query<{
            id: string;
            name: string;
            dataset_type: string;
            archived_at: Date | null;
          }>(
            `select id,name,dataset_type,archived_at from datasets
             where project_id=$1 and id=any($2::uuid[])`,
            [this.scope.projectId, datasetIds],
          )
        : Promise.resolve({ rows: [] }),
    ]);
    const userLabels = new Map(
      users.rows.map((row) => [
        row.id,
        {
          id: row.id,
          displayName: row.display_name,
          archivedAt: row.disabled_at?.toISOString() ?? null,
        } satisfies RecordReferenceRow,
      ]),
    );
    const fileLabels = new Map(
      files.rows.map((row) => [
        row.id,
        {
          id: row.id,
          displayName: `${row.series_name} · v${row.version_number} · ${row.original_name}`,
          archivedAt: row.archived_at?.toISOString() ?? null,
        } satisfies RecordReferenceRow,
      ]),
    );
    const datasetLabels = new Map(
      datasets.rows.map((row) => [
        row.id,
        {
          id: row.id,
          displayName: `${row.name} · ${row.dataset_type}`,
          archivedAt: row.archived_at?.toISOString() ?? null,
        } satisfies RecordReferenceRow,
      ]),
    );
    return new Map(
      rows.map((row) => {
        const labels: Record<string, RecordReferenceRow[]> = {};
        for (const field of userFields) {
          const value = row.values[field.key];
          const label = typeof value === 'string' ? userLabels.get(value) : undefined;
          if (label) labels[field.id] = [label];
        }
        for (const [fieldId, ids] of Object.entries(resources.files.get(row.id) ?? {}))
          labels[fieldId] = ids
            .map((id) => fileLabels.get(id))
            .filter((item) => item !== undefined);
        for (const [fieldId, ids] of Object.entries(resources.datasets.get(row.id) ?? {}))
          labels[fieldId] = ids
            .map((id) => datasetLabels.get(id))
            .filter((item) => item !== undefined);
        return [row.id, labels];
      }),
    );
  }

  private async loadCurrentMeasurements(recordIds: string[], fieldIds?: string[]) {
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
      where r.project_id=$1 and r.id=any($2::uuid[])
        ${fieldIds ? 'and f.id=any($3::uuid[])' : ''}`,
      fieldIds ? [this.scope.projectId, recordIds, fieldIds] : [this.scope.projectId, recordIds],
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
      context_project_id?: string | null;
      object_type_id: string;
      display_name: string;
      values: Record<string, JsonValue>;
      row_version: number;
      archived_at: Date | null;
      created_at: Date;
      updated_at: Date;
    },
    relations: Record<string, string[]> = {},
    relationLabels: Record<string, RecordReferenceRow[]> = {},
    referenceLabels: Record<string, RecordReferenceRow[]> = {},
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
      contextProjectId: row.context_project_id ?? null,
      objectTypeId: row.object_type_id,
      displayName: row.display_name,
      values: row.values,
      relations,
      relationLabels,
      referenceLabels,
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
    await this.assertObjectTypePermission(objectTypeId, 'visibility');
    const result = await this.pool.query(
      `select id, project_id, context_project_id, object_type_id, display_name, values, row_version, archived_at,
              created_at, updated_at
       from records where project_id = $1 and object_type_id = $2 and id = $3`,
      [this.scope.projectId, objectTypeId, recordId],
    );
    if (!result.rows[0])
      throw new RepositoryError('RECORD_NOT_FOUND', 404, 'Record was not found.');
    const [fields, relations, resources, measurements] = await Promise.all([
      this.listFields(objectTypeId),
      this.loadRelations([recordId]),
      this.loadResourceReferences([recordId]),
      this.loadCurrentMeasurements([recordId]),
    ]);
    const [relationLabels, referenceLabels] = await Promise.all([
      this.loadRelationLabels(relations),
      this.loadReferenceLabels(result.rows, fields, resources),
    ]);
    const mapped = this.mapRecord(
      result.rows[0],
      relations.get(recordId),
      relationLabels.get(recordId),
      referenceLabels.get(recordId),
      resources.files.get(recordId),
      resources.datasets.get(recordId),
      measurements.get(recordId),
    );
    return (await this.hydrateCalculatedValues([mapped], fields))[0]!;
  }

  async listRecordReferencePage(
    objectTypeId: string,
    options: { query: string; ids?: string[]; limit: number; offset: number },
  ): Promise<RecordReferencePage> {
    await this.getObjectType(objectTypeId);
    const query = options.query.trim().toLowerCase();
    const ids = [...new Set(options.ids ?? [])];
    const limit = Math.min(100, Math.max(1, options.limit));
    const offset = Math.max(0, options.offset);
    if (ids.length > 100)
      throw new RepositoryError(
        'RECORD_REFERENCE_LIMIT_EXCEEDED',
        400,
        'At most 100 existing relation references may be resolved at once.',
      );
    const parameters: unknown[] = [this.scope.projectId, objectTypeId];
    const predicate = ids.length
      ? `project_id=$1 and object_type_id=$2 and id=any($3::uuid[])`
      : `project_id=$1 and object_type_id=$2 and archived_at is null
         and ($3='' or position($3 in lower(display_name))>0 or id::text=$3)`;
    parameters.push(ids.length ? ids : query);
    const ordering = ids.length ? 'array_position($3::uuid[],id)' : 'updated_at desc,id desc';
    const [items, count] = await Promise.all([
      this.pool.query<{ id: string; display_name: string; archived_at: Date | null }>(
        `select id,display_name,archived_at from records where ${predicate}
         order by ${ordering} limit $4 offset $5`,
        [...parameters, limit, offset],
      ),
      this.pool.query<{ count: string }>(
        `select count(*)::text count from records where ${predicate}`,
        parameters,
      ),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    return {
      items: items.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        archivedAt: row.archived_at?.toISOString() ?? null,
      })),
      pageInfo: {
        limit,
        offset,
        total,
        hasNext: offset + items.rows.length < total,
      },
    };
  }

  private async createRecordWithClient(
    client: PoolClient,
    input: RecordCreateInput,
    id: string,
    publicForm?: { shareId: string; recordViewId: string },
  ): Promise<void> {
    await this.validateContextProject(client, input.contextProjectId ?? null);
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
        (id, project_id, context_project_id, object_type_id, display_name, values, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
      [
        id,
        this.scope.projectId,
        input.contextProjectId ?? null,
        input.objectTypeId,
        input.displayName.trim(),
        JSON.stringify(normalized.values),
        publicForm ? null : this.scope.actor.actorId,
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
    await evaluateNewRecord(
      client,
      this.scope,
      id,
      input.objectTypeId,
      input.requestId,
      publicForm ? null : this.scope.actor.actorId,
    );
    await appendAudit(
      client,
      this.audit({
        ...(publicForm ? {} : { actorId: this.scope.actor.actorId }),
        action: publicForm ? 'record.public_form_submitted' : 'record.created',
        targetType: 'record',
        targetId: id,
        requestId: input.requestId,
        payload: {
          objectTypeId: input.objectTypeId,
          contextProjectId: input.contextProjectId ?? null,
          ...(publicForm
            ? { shareId: publicForm.shareId, recordViewId: publicForm.recordViewId }
            : {}),
        },
      }),
    );
    await appendRecordWebhookEvent(
      client,
      this.scope,
      'record.created',
      input.objectTypeId,
      id,
      {
        displayName: input.displayName.trim(),
        contextProjectId: input.contextProjectId ?? null,
        values: normalized.values,
        ...(publicForm
          ? {
              source: 'public_form',
              shareId: publicForm.shareId,
              recordViewId: publicForm.recordViewId,
            }
          : {}),
      },
      publicForm ? null : this.scope.actor.actorId,
    );
  }

  async createRecord(input: RecordCreateInput): Promise<RecordRow> {
    await this.assertObjectTypePermission(input.objectTypeId, 'create');
    try {
      const id = uuidv7();
      await transaction(this.pool, (client) => this.createRecordWithClient(client, input, id));
      return this.getRecord(input.objectTypeId, id);
    } catch (error) {
      mapUniqueViolation(error);
    }
  }

  async submitPublicForm(
    input: PublicFormRecordSubmitInput,
  ): Promise<PublicFormRecordSubmitResult> {
    await this.assertPublicFormCreatePermission(input.objectTypeId);
    const existing = await this.pool.query<{
      record_id: string;
      request_hash: string;
      created_at: Date;
    }>(
      `select record_id,request_hash,created_at from public_form_submissions
       where share_id=$1 and idempotency_hash=$2`,
      [input.shareId, input.idempotencyHash],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== input.requestHash)
        throw new RepositoryError(
          'IDEMPOTENCY_CONFLICT',
          409,
          'This idempotency key was already used with a different form submission.',
        );
      return {
        recordId: existing.rows[0].record_id,
        submittedAt: existing.rows[0].created_at.toISOString(),
        idempotentReplay: true,
      };
    }
    const recordId = uuidv7();
    const submissionId = uuidv7();
    try {
      return await transaction(this.pool, async (client) => {
        await this.createRecordWithClient(client, input, recordId, {
          shareId: input.shareId,
          recordViewId: input.recordViewId,
        });
        const result = await client.query<{ created_at: Date }>(
          `insert into public_form_submissions
            (id,share_id,record_id,idempotency_hash,request_hash,network_fingerprint)
           values ($1,$2,$3,$4,$5,$6) returning created_at`,
          [
            submissionId,
            input.shareId,
            recordId,
            input.idempotencyHash,
            input.requestHash,
            input.networkFingerprint,
          ],
        );
        await client.query(
          `update record_view_shares set access_count=access_count+1,last_accessed_at=now()
           where id=$1 and revoked_at is null`,
          [input.shareId],
        );
        return {
          recordId,
          submittedAt: result.rows[0]!.created_at.toISOString(),
          idempotentReplay: false,
        };
      });
    } catch (error) {
      const raced = await this.pool.query<{
        record_id: string;
        request_hash: string;
        created_at: Date;
      }>(
        `select record_id,request_hash,created_at from public_form_submissions
         where share_id=$1 and idempotency_hash=$2`,
        [input.shareId, input.idempotencyHash],
      );
      if (raced.rows[0]) {
        if (raced.rows[0].request_hash !== input.requestHash)
          throw new RepositoryError(
            'IDEMPOTENCY_CONFLICT',
            409,
            'This idempotency key was already used with a different form submission.',
          );
        return {
          recordId: raced.rows[0].record_id,
          submittedAt: raced.rows[0].created_at.toISOString(),
          idempotentReplay: true,
        };
      }
      mapUniqueViolation(error);
    }
  }

  async createRecordsBulk(input: {
    objectTypeId: string;
    items: Array<Omit<RecordCreateInput, 'objectTypeId' | 'requestId'>>;
    idempotencyKey: string;
    requestId: string;
  }): Promise<RecordBulkCreateResult> {
    await this.assertObjectTypePermission(input.objectTypeId, 'create');
    if (!input.items.length || input.items.length > 100) {
      throw new RepositoryError(
        'RECORD_BATCH_SIZE_INVALID',
        400,
        'Bulk record requests must contain between 1 and 100 items.',
      );
    }
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ objectTypeId: input.objectTypeId, items: input.items }), 'utf8')
      .digest('hex');
    try {
      return await transaction(this.pool, async (client) => {
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [
          `record-batch:${this.scope.projectId}:${input.objectTypeId}:${this.scope.actor.actorId}:${input.idempotencyKey}`,
        ]);
        const replay = await client.query<{
          request_hash: string;
          result: RecordBulkCreateResult;
        }>(
          `select request_hash,result from record_batch_requests
           where project_id=$1 and object_type_id=$2 and requested_by=$3 and idempotency_key=$4`,
          [
            this.scope.projectId,
            input.objectTypeId,
            this.scope.actor.actorId,
            input.idempotencyKey,
          ],
        );
        if (replay.rows[0]) {
          if (replay.rows[0].request_hash !== requestHash) {
            throw new RepositoryError(
              'IDEMPOTENCY_KEY_REUSED',
              409,
              'The idempotency key was already used with a different record batch.',
            );
          }
          return { ...replay.rows[0].result, idempotentReplay: true };
        }

        const created: Array<{ id: string; rowVersion: number }> = [];
        for (const item of input.items) {
          const id = uuidv7();
          await this.createRecordWithClient(
            client,
            { ...item, objectTypeId: input.objectTypeId, requestId: input.requestId },
            id,
          );
          created.push({ id, rowVersion: 1 });
        }
        const result: RecordBulkCreateResult = { created, idempotentReplay: false };
        await client.query(
          `insert into record_batch_requests
            (id,project_id,object_type_id,idempotency_key,requested_by,request_hash,result)
           values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
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
        return result;
      });
    } catch (error) {
      mapUniqueViolation(error);
    }
  }

  private async updateRecordWithClient(
    client: PoolClient,
    input: RecordUpdateInput,
  ): Promise<{ id: string; rowVersion: number }> {
    if (input.contextProjectId !== undefined)
      await this.validateContextProject(client, input.contextProjectId);
    const existing = await client.query<{
      id: string;
      display_name: string;
      context_project_id: string | null;
      values: Record<string, JsonValue>;
      archived_at: Date | null;
    }>(
      `select id,display_name,context_project_id,values,archived_at from records
       where project_id = $1 and object_type_id = $2 and id = $3
         and row_version = $4 and archived_at is null for update`,
      [this.scope.projectId, input.objectTypeId, input.recordId, input.rowVersion],
    );
    if (!existing.rowCount) {
      const found = await client.query<{ archived_at: Date | null }>(
        'select archived_at from records where project_id = $1 and object_type_id = $2 and id = $3',
        [this.scope.projectId, input.objectTypeId, input.recordId],
      );
      if (found.rows[0]?.archived_at) {
        throw new RepositoryError(
          'RECORD_ARCHIVED',
          409,
          'Archived records are read-only until restored.',
        );
      }
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
    const relationRows = await client.query<{ field_id: string; target_record_id: string }>(
      'select source_field_id field_id,target_record_id from relation_edges where project_id=$1 and source_record_id=$2',
      [this.scope.projectId, input.recordId],
    );
    const fileRows = await client.query<{ field_id: string; file_id: string }>(
      'select field_id,file_id from record_file_references where project_id=$1 and record_id=$2',
      [this.scope.projectId, input.recordId],
    );
    const datasetRows = await client.query<{ field_id: string; dataset_id: string }>(
      'select field_id,dataset_id from record_dataset_references where project_id=$1 and record_id=$2',
      [this.scope.projectId, input.recordId],
    );
    const collect = <T extends { field_id: string }>(rows: T[], value: (row: T) => string) => {
      const mapped: Record<string, string[]> = {};
      for (const row of rows) (mapped[row.field_id] ??= []).push(value(row));
      return mapped;
    };
    const previous = existing.rows[0]!;
    const before: RecordSnapshot = {
      displayName: previous.display_name,
      contextProjectId: previous.context_project_id,
      values: previous.values,
      relations: collect(relationRows.rows, (row) => row.target_record_id),
      fileReferences: collect(fileRows.rows, (row) => row.file_id),
      datasetReferences: collect(datasetRows.rows, (row) => row.dataset_id),
    };
    await client.query(
      `update records set display_name = $4, values = $5::jsonb, updated_by = $6,
              context_project_id = case when $7::boolean then $8::uuid else context_project_id end,
              row_version = row_version + 1, updated_at = now()
       where project_id = $1 and object_type_id = $2 and id = $3`,
      [
        this.scope.projectId,
        input.objectTypeId,
        input.recordId,
        input.displayName.trim(),
        JSON.stringify(normalized.values),
        this.scope.actor.actorId,
        input.contextProjectId !== undefined,
        input.contextProjectId ?? null,
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
        payload: {
          rowVersion: input.rowVersion + 1,
          before,
          after: {
            displayName: input.displayName.trim(),
            contextProjectId:
              input.contextProjectId !== undefined
                ? input.contextProjectId
                : previous.context_project_id,
            values: normalized.values,
            relations: normalized.relations,
            fileReferences: normalized.fileReferences,
            datasetReferences: normalized.datasetReferences,
          } satisfies RecordSnapshot,
          ...(input.contextProjectId !== undefined
            ? { contextProjectId: input.contextProjectId }
            : {}),
        },
      }),
    );
    await appendRecordWebhookEvent(
      client,
      this.scope,
      'record.updated',
      input.objectTypeId,
      input.recordId,
      {
        displayName: input.displayName.trim(),
        contextProjectId:
          input.contextProjectId !== undefined
            ? input.contextProjectId
            : previous.context_project_id,
        values: normalized.values,
        rowVersion: input.rowVersion + 1,
      },
    );
    return { id: input.recordId, rowVersion: input.rowVersion + 1 };
  }

  async updateRecord(input: RecordUpdateInput): Promise<RecordRow> {
    await this.assertObjectTypePermission(input.objectTypeId, 'update');
    try {
      await transaction(this.pool, (client) => this.updateRecordWithClient(client, input));
      return this.getRecord(input.objectTypeId, input.recordId);
    } catch (error) {
      mapUniqueViolation(error);
    }
  }

  async updateRecordsBulk(input: {
    objectTypeId: string;
    items: Array<Omit<RecordUpdateInput, 'objectTypeId' | 'requestId'>>;
    requestId: string;
  }): Promise<RecordBulkUpdateResult> {
    await this.assertObjectTypePermission(input.objectTypeId, 'update');
    if (!input.items.length || input.items.length > 100) {
      throw new RepositoryError(
        'RECORD_BATCH_SIZE_INVALID',
        400,
        'Bulk record requests must contain between 1 and 100 items.',
      );
    }
    if (new Set(input.items.map((item) => item.recordId)).size !== input.items.length) {
      throw new RepositoryError(
        'RECORD_BATCH_DUPLICATE_ID',
        400,
        'A record can appear only once in a bulk update.',
      );
    }
    try {
      const updated = await transaction(this.pool, async (client) => {
        const ordered = [...input.items].sort((left, right) =>
          left.recordId.localeCompare(right.recordId),
        );
        const results: Array<{ id: string; rowVersion: number }> = [];
        for (const item of ordered) {
          results.push(
            await this.updateRecordWithClient(client, {
              ...item,
              objectTypeId: input.objectTypeId,
              requestId: input.requestId,
            }),
          );
        }
        return results;
      });
      const byId = new Map(updated.map((item) => [item.id, item]));
      return { updated: input.items.map((item) => byId.get(item.recordId)!) };
    } catch (error) {
      mapUniqueViolation(error);
    }
  }

  async updateRecordFieldsBulk(input: {
    objectTypeId: string;
    records: Array<{ recordId: string; rowVersion: number }>;
    changes: RecordBulkFieldChange[];
    requestId: string;
  }): Promise<RecordBulkUpdateResult> {
    await this.assertObjectTypePermission(input.objectTypeId, 'update');
    if (!input.records.length || input.records.length > 100) {
      throw new RepositoryError(
        'RECORD_BATCH_SIZE_INVALID',
        400,
        'Bulk record requests must contain between 1 and 100 records.',
      );
    }
    if (new Set(input.records.map((record) => record.recordId)).size !== input.records.length) {
      throw new RepositoryError(
        'RECORD_BATCH_DUPLICATE_ID',
        400,
        'A record can appear only once in a bulk update.',
      );
    }
    if (!input.changes.length || input.changes.length > 20) {
      throw new RepositoryError(
        'RECORD_BULK_CHANGES_INVALID',
        400,
        'Bulk record updates must contain between 1 and 20 field changes.',
      );
    }
    if (new Set(input.changes.map((change) => change.fieldKey)).size !== input.changes.length) {
      throw new RepositoryError(
        'RECORD_BULK_FIELD_DUPLICATE',
        400,
        'A field can appear only once in a bulk update.',
      );
    }
    try {
      const updated = await transaction(this.pool, async (client) => {
        const fields = await this.fieldsForObject(client, input.objectTypeId);
        const byKey = new Map(fields.map((field) => [field.key, field]));
        for (const change of input.changes) {
          const field = byKey.get(change.fieldKey);
          if (!field)
            throw new RepositoryError('FIELD_NOT_FOUND', 404, 'A bulk update field was not found.');
          if (['measurement', ...calculatedFieldTypes].includes(field.fieldType)) {
            throw new RepositoryError(
              'FIELD_READ_ONLY',
              409,
              `Field '${field.key}' is calculated or append-only and cannot be bulk updated.`,
            );
          }
          if (change.operation === 'set' && change.value === undefined) {
            throw new RepositoryError(
              'RECORD_BULK_VALUE_REQUIRED',
              400,
              `Field '${field.key}' requires a value for the set operation.`,
            );
          }
          if (
            change.operation === 'set' &&
            ['relation', 'file', 'dataset'].includes(field.fieldType) &&
            (!Array.isArray(change.value) ||
              change.value.length > 100 ||
              change.value.some(
                (value) => typeof value !== 'string' || !uuidValuePattern.test(value),
              ))
          ) {
            throw new RepositoryError(
              'FIELD_VALIDATION_FAILED',
              400,
              `Field '${field.key}' requires a bounded array of record or resource UUIDs.`,
            );
          }
        }
        const ordered = [...input.records].sort((left, right) =>
          left.recordId.localeCompare(right.recordId),
        );
        const results: Array<{ id: string; rowVersion: number }> = [];
        for (const record of ordered) {
          const current = await client.query<{
            display_name: string;
            values: Record<string, JsonValue>;
          }>(
            `select display_name,values from records
             where project_id=$1 and object_type_id=$2 and id=$3`,
            [this.scope.projectId, input.objectTypeId, record.recordId],
          );
          if (!current.rows[0])
            throw new RepositoryError('RECORD_NOT_FOUND', 404, 'Record was not found.');
          const relationRows = await client.query<{
            field_id: string;
            target_record_id: string;
          }>(
            `select source_field_id field_id,target_record_id from relation_edges
             where project_id=$1 and source_record_id=$2`,
            [this.scope.projectId, record.recordId],
          );
          const fileRows = await client.query<{ field_id: string; file_id: string }>(
            `select field_id,file_id from record_file_references
             where project_id=$1 and record_id=$2`,
            [this.scope.projectId, record.recordId],
          );
          const datasetRows = await client.query<{ field_id: string; dataset_id: string }>(
            `select field_id,dataset_id from record_dataset_references
             where project_id=$1 and record_id=$2`,
            [this.scope.projectId, record.recordId],
          );
          const collect = <T extends { field_id: string }>(
            rows: T[],
            value: (row: T) => string,
          ) => {
            const mapped: Record<string, string[]> = {};
            for (const row of rows) (mapped[row.field_id] ??= []).push(value(row));
            return mapped;
          };
          const values = { ...current.rows[0].values };
          const relations = collect(relationRows.rows, (row) => row.target_record_id);
          const fileReferences = collect(fileRows.rows, (row) => row.file_id);
          const datasetReferences = collect(datasetRows.rows, (row) => row.dataset_id);
          for (const change of input.changes) {
            const field = byKey.get(change.fieldKey)!;
            const target =
              field.fieldType === 'relation'
                ? relations
                : field.fieldType === 'file'
                  ? fileReferences
                  : field.fieldType === 'dataset'
                    ? datasetReferences
                    : values;
            const targetKey = ['relation', 'file', 'dataset'].includes(field.fieldType)
              ? field.id
              : field.key;
            if (change.operation === 'clear') delete target[targetKey];
            else
              target[targetKey] = ['relation', 'file', 'dataset'].includes(field.fieldType)
                ? (change.value as string[])
                : change.value!;
          }
          results.push(
            await this.updateRecordWithClient(client, {
              objectTypeId: input.objectTypeId,
              recordId: record.recordId,
              rowVersion: record.rowVersion,
              displayName: current.rows[0].display_name,
              values,
              relations,
              fileReferences,
              datasetReferences,
              requestId: input.requestId,
            }),
          );
        }
        return results;
      });
      const byId = new Map(updated.map((item) => [item.id, item]));
      return { updated: input.records.map((record) => byId.get(record.recordId)!) };
    } catch (error) {
      mapUniqueViolation(error);
    }
  }

  private async getRecordComment(
    objectTypeId: string,
    recordId: string,
    commentId: string,
  ): Promise<RecordCommentRow> {
    const result = await this.pool.query<{
      id: string;
      author_id: string;
      author_name: string;
      body: string;
      mentioned_users: unknown;
      row_version: number;
      edited_at: Date | null;
      created_at: Date;
    }>(
      `select c.id,c.author_id,u.display_name author_name,c.body,c.row_version,c.edited_at,c.created_at,
        coalesce((select jsonb_agg(jsonb_build_object('id',mu.id,'displayName',mu.display_name)
          order by lower(mu.display_name),mu.id) from record_comment_mentions m
          join users mu on mu.id=m.user_id where m.comment_id=c.id),'[]'::jsonb) mentioned_users
       from record_comments c join users u on u.id=c.author_id
       where c.project_id=$1 and c.object_type_id=$2 and c.record_id=$3 and c.id=$4`,
      [this.scope.projectId, objectTypeId, recordId, commentId],
    );
    if (!result.rows[0])
      throw new RepositoryError('RECORD_COMMENT_NOT_FOUND', 404, 'Record comment was not found.');
    return mapRecordComment(result.rows[0]);
  }

  async listRecordCommentPage(
    objectTypeId: string,
    recordId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<RecordCommentPage> {
    await this.getRecord(objectTypeId, recordId);
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const offset = Math.min(1_000_000, Math.max(0, options.offset ?? 0));
    const [result, count] = await Promise.all([
      this.pool.query<{
        id: string;
        author_id: string;
        author_name: string;
        body: string;
        mentioned_users: unknown;
        row_version: number;
        edited_at: Date | null;
        created_at: Date;
      }>(
        `select c.id,c.author_id,u.display_name author_name,c.body,c.row_version,c.edited_at,c.created_at,
          coalesce((select jsonb_agg(jsonb_build_object('id',mu.id,'displayName',mu.display_name)
            order by lower(mu.display_name),mu.id) from record_comment_mentions m
            join users mu on mu.id=m.user_id where m.comment_id=c.id),'[]'::jsonb) mentioned_users
         from record_comments c join users u on u.id=c.author_id
         where c.project_id=$1 and c.object_type_id=$2 and c.record_id=$3
         order by c.created_at desc,c.id desc limit $4 offset $5`,
        [this.scope.projectId, objectTypeId, recordId, limit, offset],
      ),
      this.pool.query<{ count: string }>(
        `select count(*)::text count from record_comments
         where project_id=$1 and object_type_id=$2 and record_id=$3`,
        [this.scope.projectId, objectTypeId, recordId],
      ),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    return {
      items: result.rows.map(mapRecordComment),
      pageInfo: { limit, offset, total, hasNext: offset + result.rows.length < total },
    };
  }

  async addRecordComment(input: {
    objectTypeId: string;
    recordId: string;
    body: string;
    mentionedUserIds?: string[];
    requestId: string;
  }): Promise<RecordCommentRow> {
    await this.assertObjectTypePermission(input.objectTypeId, 'visibility');
    const commentId = uuidv7();
    await transaction(this.pool, async (client) => {
      const record = await client.query(
        `select 1 from records
         where project_id=$1 and object_type_id=$2 and id=$3 and archived_at is null for share`,
        [this.scope.projectId, input.objectTypeId, input.recordId],
      );
      if (!record.rowCount)
        throw new RepositoryError(
          'RECORD_NOT_ACTIVE',
          409,
          'Comments can be added only to an active record.',
        );
      await client.query(
        `insert into record_comments
         (id,project_id,object_type_id,record_id,author_id,body)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          commentId,
          this.scope.projectId,
          input.objectTypeId,
          input.recordId,
          this.scope.actor.actorId,
          input.body.trim(),
        ],
      );
      const mentionedUsers = await this.recordCommentMentionedUsers(
        client,
        input.mentionedUserIds ?? [],
      );
      for (const mention of mentionedUsers)
        await client.query(
          `insert into record_comment_mentions (comment_id,user_id) values ($1,$2)`,
          [commentId, mention.id],
        );
      await this.notifyRecordMentions(
        client,
        input.objectTypeId,
        input.recordId,
        commentId,
        mentionedUsers.map((mention) => mention.id),
      );
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: 'record.comment_added',
          targetType: 'record',
          targetId: input.recordId,
          requestId: input.requestId,
          payload: { commentId, mentionedUsers },
        }),
      );
    });
    return this.getRecordComment(input.objectTypeId, input.recordId, commentId);
  }

  async updateRecordComment(input: {
    objectTypeId: string;
    recordId: string;
    commentId: string;
    body: string;
    mentionedUserIds?: string[];
    rowVersion: number;
    requestId: string;
  }): Promise<RecordCommentRow> {
    await this.assertObjectTypePermission(input.objectTypeId, 'visibility');
    await transaction(this.pool, async (client) => {
      const found = await client.query<{
        author_id: string;
        body: string;
        row_version: number;
      }>(
        `select c.author_id,c.body,c.row_version
         from record_comments c join records r
           on r.project_id=c.project_id and r.id=c.record_id
         where c.project_id=$1 and c.object_type_id=$2 and c.record_id=$3 and c.id=$4
           and r.archived_at is null for update of c`,
        [this.scope.projectId, input.objectTypeId, input.recordId, input.commentId],
      );
      const current = found.rows[0];
      if (!current)
        throw new RepositoryError('RECORD_COMMENT_NOT_FOUND', 404, 'Record comment was not found.');
      if (current.author_id !== this.scope.actor.actorId)
        throw new RepositoryError(
          'RECORD_COMMENT_EDIT_FORBIDDEN',
          403,
          'Only the comment author can edit this comment.',
        );
      if (current.row_version !== input.rowVersion)
        throw new RepositoryError(
          'RECORD_COMMENT_VERSION_CONFLICT',
          409,
          'The comment changed after it was loaded. Refresh and try again.',
        );
      const body = input.body.trim();
      const previousMentions = (
        await client.query<{ id: string; display_name: string }>(
          `select m.user_id id,u.display_name from record_comment_mentions m
           join users u on u.id=m.user_id where m.comment_id=$1
           order by lower(u.display_name),m.user_id`,
          [input.commentId],
        )
      ).rows.map((mention) => ({ id: mention.id, displayName: mention.display_name }));
      const mentionedUsers =
        input.mentionedUserIds === undefined
          ? previousMentions
          : await this.recordCommentMentionedUsers(client, input.mentionedUserIds);
      const previousMentionIds = previousMentions.map((mention) => mention.id).sort();
      const mentionedUserIds = mentionedUsers.map((mention) => mention.id).sort();
      const mentionsChanged =
        previousMentionIds.length !== mentionedUserIds.length ||
        previousMentionIds.some((id, index) => id !== mentionedUserIds[index]);
      if (current.body === body && !mentionsChanged)
        throw new RepositoryError(
          'RECORD_COMMENT_NO_CHANGES',
          400,
          'The comment has no changes to save.',
        );
      await client.query(
        `update record_comments set body=$5,row_version=row_version+1,edited_at=now(),updated_at=now()
         where project_id=$1 and object_type_id=$2 and record_id=$3 and id=$4`,
        [this.scope.projectId, input.objectTypeId, input.recordId, input.commentId, body],
      );
      if (mentionsChanged) {
        await client.query('delete from record_comment_mentions where comment_id=$1', [
          input.commentId,
        ]);
        for (const mention of mentionedUsers)
          await client.query(
            `insert into record_comment_mentions (comment_id,user_id) values ($1,$2)`,
            [input.commentId, mention.id],
          );
        const previousSet = new Set(previousMentionIds);
        await this.notifyRecordMentions(
          client,
          input.objectTypeId,
          input.recordId,
          input.commentId,
          mentionedUserIds.filter((id) => !previousSet.has(id)),
        );
      }
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: 'record.comment_edited',
          targetType: 'record',
          targetId: input.recordId,
          requestId: input.requestId,
          payload: {
            commentId: input.commentId,
            fromRowVersion: current.row_version,
            toRowVersion: current.row_version + 1,
            previousBody: current.body,
            body,
            previousMentions,
            mentionedUsers,
          },
        }),
      );
    });
    return this.getRecordComment(input.objectTypeId, input.recordId, input.commentId);
  }

  private async recordCommentMentionedUsers(client: PoolClient, userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds)];
    if (!uniqueUserIds.length) return [];
    const members = await client.query<{ id: string; display_name: string }>(
      `select m.user_id id,u.display_name from memberships m join users u on u.id=m.user_id
       where m.organization_id=$1 and m.user_id=any($2::uuid[]) and u.disabled_at is null
         and project_visible_to($3,$4,$1,m.user_id,m.role::text)
       order by lower(u.display_name),m.user_id`,
      [
        this.scope.actor.organizationId,
        uniqueUserIds,
        this.scope.projectId,
        this.scope.workspaceId,
      ],
    );
    if (members.rowCount !== uniqueUserIds.length)
      throw new RepositoryError(
        'RECORD_COMMENT_MENTION_INVALID',
        400,
        'A mentioned user is not an active organization member.',
      );
    return members.rows.map((member) => ({ id: member.id, displayName: member.display_name }));
  }

  private async notifyRecordMentions(
    client: PoolClient,
    objectTypeId: string,
    recordId: string,
    commentId: string,
    userIds: string[],
  ) {
    const recipientIds = [...new Set(userIds)].filter((id) => id !== this.scope.actor.actorId);
    if (!recipientIds.length) return;
    const disabled = await client.query<{ user_id: string }>(
      `select user_id from user_notification_preferences
       where organization_id=$1 and user_id=any($2::uuid[]) and notify_mentioned=false`,
      [this.scope.actor.organizationId, recipientIds],
    );
    const disabledIds = new Set(disabled.rows.map((row) => row.user_id));
    const eventId = uuidv7();
    for (const recipientId of recipientIds) {
      if (disabledIds.has(recipientId)) continue;
      await client.query(
        `insert into notifications
         (id,event_id,organization_id,workspace_id,project_id,object_type_id,record_id,
          recipient_id,actor_id,type,payload)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'record.mentioned',$10::jsonb)
         on conflict (event_id,recipient_id) do nothing`,
        [
          uuidv7(),
          eventId,
          this.scope.actor.organizationId,
          this.scope.workspaceId,
          this.scope.projectId,
          objectTypeId,
          recordId,
          recipientId,
          this.scope.actor.actorId,
          JSON.stringify({ commentId }),
        ],
      );
    }
  }

  async listRecordHistoryPage(
    objectTypeId: string,
    recordId: string,
    options: { limit: number; offset: number },
  ): Promise<{
    items: RecordHistoryRow[];
    pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  }> {
    await this.getRecord(objectTypeId, recordId);
    const [result, count] = await Promise.all([
      this.pool.query<{
        id: string;
        action: string;
        actor_name: string | null;
        created_at: Date;
        payload: { rowVersion?: unknown; before?: unknown };
      }>(
        `select a.id,a.action,u.display_name actor_name,a.created_at,a.payload
         from audit_events a left join users u on u.id=a.actor_id
         where a.project_id=$1 and a.target_type='record' and a.target_id=$2
         order by a.created_at desc,a.id desc limit $3 offset $4`,
        [this.scope.projectId, recordId, options.limit, options.offset],
      ),
      this.pool.query<{ count: string }>(
        `select count(*)::text count from audit_events
         where project_id=$1 and target_type='record' and target_id=$2`,
        [this.scope.projectId, recordId],
      ),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        action: row.action,
        actorName: row.actor_name,
        createdAt: row.created_at.toISOString(),
        rowVersion: typeof row.payload.rowVersion === 'number' ? row.payload.rowVersion : null,
        undoable: row.action === 'record.updated' && Boolean(row.payload.before),
      })),
      pageInfo: {
        limit: options.limit,
        offset: options.offset,
        total,
        hasNext: options.offset + result.rows.length < total,
      },
    };
  }

  async undoRecordChange(input: {
    objectTypeId: string;
    recordId: string;
    eventId: string;
    rowVersion: number;
    requestId: string;
  }): Promise<RecordRow> {
    await this.assertObjectTypePermission(input.objectTypeId, 'update');
    await transaction(this.pool, async (client) => {
      const event = await client.query<{ payload: { before?: RecordSnapshot } }>(
        `select payload from audit_events
         where id=$1 and project_id=$2 and target_type='record' and target_id=$3
           and action='record.updated'`,
        [input.eventId, this.scope.projectId, input.recordId],
      );
      const snapshot = event.rows[0]?.payload.before;
      if (!snapshot)
        throw new RepositoryError(
          'HISTORY_NOT_UNDOABLE',
          409,
          'This history entry cannot be undone.',
        );
      const current = await client.query<{ row_version: number }>(
        `select row_version from records where project_id=$1 and object_type_id=$2 and id=$3 for update`,
        [this.scope.projectId, input.objectTypeId, input.recordId],
      );
      if (!current.rows[0])
        throw new RepositoryError('RECORD_NOT_FOUND', 404, 'Record was not found.');
      if (current.rows[0].row_version !== input.rowVersion)
        throw new RepositoryError('VERSION_CONFLICT', 409, 'The record changed; reload and retry.');
      await this.validateContextProject(client, snapshot.contextProjectId);
      const normalized = await this.normalizeRecordInput(
        client,
        input.objectTypeId,
        snapshot.values,
        snapshot.relations,
        snapshot.fileReferences,
        snapshot.datasetReferences,
        false,
      );
      await client.query(
        `update records set display_name=$4,context_project_id=$5,values=$6::jsonb,
           row_version=row_version+1,updated_by=$7,updated_at=now()
         where project_id=$1 and object_type_id=$2 and id=$3`,
        [
          this.scope.projectId,
          input.objectTypeId,
          input.recordId,
          snapshot.displayName,
          snapshot.contextProjectId,
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
          action: 'record.undo_applied',
          targetType: 'record',
          targetId: input.recordId,
          requestId: input.requestId,
          payload: { sourceEventId: input.eventId, rowVersion: input.rowVersion + 1 },
        }),
      );
    });
    return this.getRecord(input.objectTypeId, input.recordId);
  }

  async previewRecordsCsv(input: { objectTypeId: string; csv: string }): Promise<CsvImportPreview> {
    await this.assertObjectTypePermission(input.objectTypeId, 'create');
    const { headers, rows } = validatedCsvRows(input.csv);
    const fields = await this.listFields(input.objectTypeId);
    const targetFields: CsvImportPreview['targetFields'] = [
      {
        key: 'displayName',
        name: 'Record name',
        fieldType: 'display_name',
        required: true,
        unique: false,
        supported: true,
      },
      ...fields.map((field) => ({
        key: field.key,
        name: field.name,
        fieldType: field.fieldType,
        required: field.required,
        unique: field.unique,
        supported: !csvImportUnsupportedFieldTypes.has(field.fieldType),
      })),
    ];
    const targetsByIdentity = new Map<string, Array<(typeof targetFields)[number]>>();
    for (const target of targetFields) {
      for (const identity of new Set([
        csvHeaderIdentity(target.key),
        csvHeaderIdentity(target.name),
      ])) {
        const current = targetsByIdentity.get(identity) ?? [];
        current.push(target);
        targetsByIdentity.set(identity, current);
      }
    }
    return {
      headers,
      totalRows: rows.length - 1,
      sampleRows: rows
        .slice(1, 4)
        .map((row) =>
          Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])),
        ),
      targetFields,
      suggestedMappings: headers.map((sourceHeader) => {
        const matches = (targetsByIdentity.get(csvHeaderIdentity(sourceHeader)) ?? []).filter(
          (field) => field.supported,
        );
        return {
          sourceHeader,
          targetFieldKey: matches.length === 1 ? matches[0]!.key : null,
        };
      }),
    };
  }

  private async csvImportFieldValue(
    client: PoolClient,
    field: FieldDefinitionRow,
    cell: string,
  ): Promise<{ value?: JsonValue; relationIds?: string[] }> {
    if (cell === '') return field.fieldType === 'relation' ? { relationIds: [] } : {};
    if (csvImportUnsupportedFieldTypes.has(field.fieldType))
      throw new RepositoryError(
        'CSV_FIELD_UNSUPPORTED',
        400,
        `Field '${field.key}' cannot be populated through CSV import.`,
      );
    if (field.fieldType === 'relation') {
      const targetObjectTypeId = String(field.config.targetObjectTypeId);
      const relationIds: string[] = [];
      for (const label of cell
        .split(';')
        .map((value) => value.trim())
        .filter(Boolean)) {
        const relation = await client.query<{ id: string }>(
          uuidValuePattern.test(label)
            ? `select id from records where project_id=$1 and object_type_id=$2 and id=$3
               and archived_at is null limit 2`
            : `select id from records where project_id=$1 and object_type_id=$2
               and lower(display_name)=lower($3) and archived_at is null order by id limit 2`,
          [this.scope.projectId, targetObjectTypeId, label],
        );
        if (relation.rows.length !== 1)
          throw new RepositoryError(
            relation.rows.length ? 'CSV_RELATION_AMBIGUOUS' : 'RELATION_TARGET_NOT_FOUND',
            400,
            relation.rows.length
              ? `Field '${field.key}' matches more than one record named '${label}'.`
              : `Field '${field.key}' could not find record '${label}'.`,
          );
        relationIds.push(relation.rows[0]!.id);
      }
      return { relationIds };
    }
    if (field.fieldType === 'user') {
      const member = await client.query<{ id: string }>(
        uuidValuePattern.test(cell)
          ? `select u.id from memberships m join users u on u.id=m.user_id
             where m.organization_id=$1 and u.id=$2 and u.disabled_at is null`
          : `select u.id from memberships m join users u on u.id=m.user_id
             where m.organization_id=$1 and lower(u.email)=lower($2) and u.disabled_at is null`,
        [this.scope.actor.organizationId, cell],
      );
      if (member.rows.length !== 1)
        throw new RepositoryError(
          'CSV_MEMBER_NOT_FOUND',
          400,
          `Field '${field.key}' could not find active member '${cell}'.`,
        );
      return { value: member.rows[0]!.id };
    }
    const value = csvValue(field, cell);
    return value === undefined ? {} : { value };
  }

  private async recordReferenceState(
    client: PoolClient,
    recordId: string,
  ): Promise<{
    relations: Record<string, string[]>;
    fileReferences: Record<string, string[]>;
    datasetReferences: Record<string, string[]>;
  }> {
    const [relations, files, datasets] = await Promise.all([
      client.query<{ field_id: string; value_id: string }>(
        'select source_field_id field_id,target_record_id value_id from relation_edges where project_id=$1 and source_record_id=$2',
        [this.scope.projectId, recordId],
      ),
      client.query<{ field_id: string; value_id: string }>(
        'select field_id,file_id value_id from record_file_references where project_id=$1 and record_id=$2',
        [this.scope.projectId, recordId],
      ),
      client.query<{ field_id: string; value_id: string }>(
        'select field_id,dataset_id value_id from record_dataset_references where project_id=$1 and record_id=$2',
        [this.scope.projectId, recordId],
      ),
    ]);
    const collect = (rows: Array<{ field_id: string; value_id: string }>) => {
      const mapped: Record<string, string[]> = {};
      for (const row of rows) (mapped[row.field_id] ??= []).push(row.value_id);
      return mapped;
    };
    return {
      relations: collect(relations.rows),
      fileReferences: collect(files.rows),
      datasetReferences: collect(datasets.rows),
    };
  }

  async importRecordsCsv(input: {
    objectTypeId: string;
    csv: string;
    mappings?: CsvImportMapping[];
    duplicateStrategy?: CsvImportDuplicateStrategy;
    uniqueFieldKey?: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<CsvImportResult> {
    await this.assertObjectTypePermission(input.objectTypeId, 'create');
    const duplicateStrategy = input.duplicateStrategy ?? 'allow';
    if (duplicateStrategy === 'update')
      await this.assertObjectTypePermission(input.objectTypeId, 'update');
    const { headers, rows } = validatedCsvRows(input.csv);
    const requestedMappings =
      input.mappings ??
      headers.map((sourceHeader) => ({ sourceHeader, targetFieldKey: sourceHeader }));
    const requestHash =
      input.mappings === undefined && duplicateStrategy === 'allow' && !input.uniqueFieldKey
        ? hashImport(input.csv)
        : hashImport(
            JSON.stringify({
              csv: input.csv,
              mappings: [...requestedMappings].sort((left, right) =>
                left.sourceHeader.localeCompare(right.sourceHeader),
              ),
              duplicateStrategy,
              uniqueFieldKey: input.uniqueFieldKey ?? null,
            }),
          );
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
        const previous = replay.rows[0].result;
        return {
          ...previous,
          created: previous.created ?? previous.imported,
          updated: previous.updated ?? 0,
          skipped: previous.skipped ?? 0,
          updatedIds: previous.updatedIds ?? [],
          errorsTruncated: previous.errorsTruncated ?? false,
          idempotentReplay: true,
        };
      }
      const fields = await this.fieldsForObject(client, input.objectTypeId);
      const byKey = new Map(fields.map((field) => [field.key, field]));
      if (
        !requestedMappings.length ||
        new Set(requestedMappings.map((mapping) => mapping.sourceHeader)).size !==
          requestedMappings.length ||
        requestedMappings.some((mapping) => !headers.includes(mapping.sourceHeader))
      ) {
        throw new RepositoryError(
          'CSV_MAPPING_INVALID',
          400,
          'Every mapped source header must exist and may appear only once.',
        );
      }
      const mappedTargets = requestedMappings.flatMap((mapping) =>
        mapping.targetFieldKey ? [mapping.targetFieldKey] : [],
      );
      if (new Set(mappedTargets).size !== mappedTargets.length)
        throw new RepositoryError(
          'CSV_MAPPING_INVALID',
          400,
          'A destination field may be mapped only once.',
        );
      for (const target of mappedTargets) {
        const field = byKey.get(target);
        if (
          target !== 'displayName' &&
          (!field || csvImportUnsupportedFieldTypes.has(field.fieldType))
        )
          throw new RepositoryError(
            'CSV_MAPPING_INVALID',
            400,
            `Destination field '${target}' is missing or does not support CSV import.`,
          );
      }
      if (!mappedTargets.includes('displayName'))
        throw new RepositoryError(
          'CSV_MAPPING_INVALID',
          400,
          'Map one source column to the record name.',
        );
      const uniqueField = input.uniqueFieldKey ? byKey.get(input.uniqueFieldKey) : undefined;
      if (
        duplicateStrategy !== 'allow' &&
        (!uniqueField ||
          !uniqueField.unique ||
          !mappedTargets.includes(uniqueField.key) ||
          uniqueField.fieldType === 'relation' ||
          csvImportUnsupportedFieldTypes.has(uniqueField.fieldType))
      )
        throw new RepositoryError(
          'CSV_UNIQUE_FIELD_REQUIRED',
          400,
          'Skip and update strategies require one mapped, supported unique field.',
        );
      const result: CsvImportResult = {
        imported: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        createdIds: [],
        updatedIds: [],
        errors: [],
        errorsTruncated: false,
        idempotentReplay: false,
      };
      for (let index = 1; index < rows.length; index += 1) {
        const rowNumber = index + 1;
        const row = rows[index]!;
        if (row.length > headers.length) {
          result.failed += 1;
          if (result.errors.length < 200)
            result.errors.push({ row: rowNumber, reason: 'Row contains more cells than headers.' });
          else result.errorsTruncated = true;
          continue;
        }
        await client.query('savepoint csv_row');
        try {
          const sourceCells = Object.fromEntries(
            headers.map((header, cellIndex) => [header, row[cellIndex] ?? '']),
          );
          const cells = Object.fromEntries(
            requestedMappings.flatMap((mapping) =>
              mapping.targetFieldKey
                ? [[mapping.targetFieldKey, sourceCells[mapping.sourceHeader] ?? '']]
                : [],
            ),
          );
          const displayName = cells.displayName?.trim();
          if (!displayName)
            throw new RepositoryError('FIELD_VALIDATION_FAILED', 400, 'displayName is required.');
          const values: Record<string, JsonValue> = {};
          const relations: Record<string, string[]> = {};
          const mappedFields = fields.filter((field) => cells[field.key] !== undefined);
          for (const field of mappedFields) {
            const parsed = await this.csvImportFieldValue(client, field, cells[field.key]!);
            if (parsed.relationIds !== undefined) relations[field.id] = parsed.relationIds;
            if (parsed.value !== undefined) values[field.key] = parsed.value;
          }
          let existing:
            | {
                id: string;
                row_version: number;
                display_name: string;
                values: Record<string, JsonValue>;
                archived_at: Date | null;
              }
            | undefined;
          if (uniqueField) {
            const uniqueValue = values[uniqueField.key];
            if (uniqueValue === undefined)
              throw new RepositoryError(
                'CSV_UNIQUE_VALUE_REQUIRED',
                400,
                `Unique field '${uniqueField.key}' is empty.`,
              );
            const uniqueKey = fieldProjection(
              uniqueField,
              normalizeValue(uniqueField, uniqueValue),
            )[0]?.uniqueKey;
            if (!uniqueKey)
              throw new RepositoryError(
                'CSV_UNIQUE_VALUE_REQUIRED',
                400,
                `Unique field '${uniqueField.key}' has no comparable value.`,
              );
            const match = await client.query<{
              id: string;
              row_version: number;
              display_name: string;
              values: Record<string, JsonValue>;
              archived_at: Date | null;
            }>(
              `select r.id,r.row_version,r.display_name,r.values,r.archived_at
               from record_index_values value
               join records r on r.project_id=value.project_id and r.id=value.record_id
               where value.project_id=$1 and value.field_id=$2 and value.unique_key=$3
               for update of r`,
              [this.scope.projectId, uniqueField.id, uniqueKey],
            );
            existing = match.rows[0];
          }
          if (existing && duplicateStrategy === 'skip') {
            result.skipped += 1;
            await client.query('release savepoint csv_row');
            continue;
          }
          if (existing && duplicateStrategy === 'update') {
            if (existing.archived_at)
              throw new RepositoryError(
                'RECORD_ARCHIVED',
                409,
                'A matching archived record must be restored before it can be updated.',
              );
            const references = await this.recordReferenceState(client, existing.id);
            const mergedValues = { ...existing.values };
            for (const field of mappedFields) {
              if (field.fieldType === 'relation') continue;
              if (values[field.key] === undefined) delete mergedValues[field.key];
              else mergedValues[field.key] = values[field.key]!;
            }
            const mergedRelations = { ...references.relations };
            for (const field of mappedFields.filter((field) => field.fieldType === 'relation'))
              mergedRelations[field.id] = relations[field.id] ?? [];
            const updated = await this.updateRecordWithClient(client, {
              objectTypeId: input.objectTypeId,
              recordId: existing.id,
              displayName,
              values: mergedValues,
              relations: mergedRelations,
              fileReferences: references.fileReferences,
              datasetReferences: references.datasetReferences,
              rowVersion: existing.row_version,
              requestId: input.requestId,
            });
            await appendAudit(
              client,
              this.audit({
                actorId: this.scope.actor.actorId,
                action: 'record.csv_row_updated',
                targetType: 'record',
                targetId: existing.id,
                requestId: input.requestId,
                payload: { objectTypeId: input.objectTypeId, row: rowNumber },
              }),
            );
            result.updatedIds.push(updated.id);
            result.updated += 1;
            result.imported += 1;
            await client.query('release savepoint csv_row');
            continue;
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
          await appendRecordWebhookEvent(
            client,
            this.scope,
            'record.created',
            input.objectTypeId,
            recordId,
            {
              displayName,
              contextProjectId: null,
              values: normalized.values,
              source: 'csv',
            },
          );
          result.createdIds.push(recordId);
          result.created += 1;
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
          if (result.errors.length < 200)
            result.errors.push({
              row: rowNumber,
              reason: duplicate
                ? 'A unique field already contains this canonical value.'
                : error instanceof Error
                  ? error.message
                  : 'Row validation failed.',
            });
          else result.errorsTruncated = true;
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
          payload: {
            imported: result.imported,
            created: result.created,
            updated: result.updated,
            skipped: result.skipped,
            failed: result.failed,
            duplicateStrategy,
            uniqueFieldKey: uniqueField?.key ?? null,
          },
        }),
      );
      return result;
    });
  }

  async exportRecordsCsv(
    objectTypeId: string,
    requestId: string,
    query: RecordQuery = {},
  ): Promise<string> {
    const chunks: string[] = [];
    const result = await this.writeRecordsCsv(objectTypeId, query, (chunk) => {
      chunks.push(chunk);
    });
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
          payload: {
            rowCount: result.rowCount,
            fieldCount: result.fieldCount,
            archiveState: query.archiveState ?? 'active',
            scoped: Boolean(
              query.filters?.length || query.search || query.contextProjectId !== undefined,
            ),
          },
        }),
      );
    } finally {
      client.release();
    }
    return chunks.join('');
  }

  async writeRecordsCsv(
    objectTypeId: string,
    query: RecordQuery,
    write: (chunk: string) => void | Promise<void>,
  ): Promise<{ rowCount: number; fieldCount: number }> {
    const fields = await this.listFields(objectTypeId);
    const byKey = new Map(fields.map((field) => [field.key, field]));
    const selectedFields = query.fields?.map((fieldKey) => byKey.get(fieldKey));
    if (selectedFields?.some((field) => !field))
      throw new RepositoryError('FIELD_NOT_FOUND', 404, 'An export field was not found.');
    const exportFields = (selectedFields as FieldDefinitionRow[] | undefined) ?? fields;
    if (
      exportFields.some(
        (field) => field.fieldType !== 'relation' && field.projectionStatus !== 'ready',
      )
    ) {
      throw new RepositoryError(
        'FIELD_INDEX_REBUILDING',
        409,
        'CSV export is unavailable while projection rebuilding is in progress.',
      );
    }
    await write(
      `${['displayName', ...exportFields.map((field) => field.key)].map(csvCell).join(',')}\r\n`,
    );
    let rowCount = 0;
    let page = 1;
    let total: number;
    do {
      const result = await this.queryRecords(objectTypeId, {
        ...(query.filters ? { filters: query.filters } : {}),
        ...(query.sorts ? { sorts: query.sorts } : {}),
        ...(query.search ? { search: query.search } : {}),
        ...(query.contextProjectId !== undefined
          ? { contextProjectId: query.contextProjectId }
          : {}),
        ...(query.archiveState ? { archiveState: query.archiveState } : {}),
        page,
        pageSize: 500,
      });
      total = result.total;
      if (total > RECORD_EXPORT_MAX_ROWS) {
        throw new RepositoryError(
          'RECORD_EXPORT_TOO_LARGE',
          413,
          `CSV exports support at most ${RECORD_EXPORT_MAX_ROWS.toLocaleString('en-US')} matching records.`,
        );
      }
      for (const record of result.items) {
        await write(
          `${[
            record.displayName,
            ...exportFields.map((field) => {
              if (field.fieldType === 'relation') {
                return (record.relations[field.id] ?? []).join(';');
              }
              if (field.fieldType === 'file')
                return (record.fileReferences[field.id] ?? []).join(';');
              if (field.fieldType === 'dataset')
                return (record.datasetReferences[field.id] ?? []).join(';');
              if (field.fieldType === 'measurement') return record.measurements[field.id];
              const value = record.values[field.key];
              return Array.isArray(value) ? value.join(';') : value;
            }),
          ]
            .map(csvCell)
            .join(',')}\r\n`,
        );
      }
      rowCount += result.items.length;
      page += 1;
      if (!result.items.length) break;
    } while (rowCount < total);
    return { rowCount, fieldCount: exportFields.length };
  }

  async requestRecordExport(
    objectTypeId: string,
    requestId: string,
    idempotencyKey: string,
    query: RecordQuery,
  ): Promise<RecordExportJob> {
    const preview = await this.queryRecords(objectTypeId, { ...query, page: 1, pageSize: 1 });
    if (preview.total > RECORD_EXPORT_MAX_ROWS) {
      throw new RepositoryError(
        'RECORD_EXPORT_TOO_LARGE',
        413,
        `CSV exports support at most ${RECORD_EXPORT_MAX_ROWS.toLocaleString('en-US')} matching records.`,
      );
    }
    const objectType = await this.getObjectType(objectTypeId);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ objectTypeId, query }), 'utf8')
      .digest('hex');
    const fingerprint = createHash('sha256')
      .update(`record-export:${this.scope.actor.actorId}:${objectTypeId}:${idempotencyKey}`, 'utf8')
      .digest('hex');
    const jobId = uuidv7();
    const payload: RecordExportPayload = {
      requestedBy: this.scope.actor.actorId,
      requestHash,
      fileName: `${objectType.key}.csv`,
      query,
    };
    return transaction(this.pool, async (client) => {
      const inserted = await client.query<RecordExportDatabaseRow>(
        `insert into background_jobs
          (id,project_id,job_type,entity_type,entity_id,input_fingerprint,payload,max_attempts)
         values ($1,$2,'record.export.csv','object_type',$3,$4,$5::jsonb,3)
         on conflict (project_id,input_fingerprint) do nothing returning *, '{}'::jsonb result_checkpoint`,
        [jobId, this.scope.projectId, objectTypeId, fingerprint, JSON.stringify(payload)],
      );
      if (!inserted.rows[0]) {
        const existing = await client.query<RecordExportDatabaseRow>(
          `select j.*,coalesce(a.result_checkpoint,'{}'::jsonb) result_checkpoint
           from background_jobs j
           left join lateral (
             select result_checkpoint from background_job_attempts
             where project_id=j.project_id and job_id=j.id order by attempt_number desc limit 1
           ) a on true
           where j.project_id=$1 and j.input_fingerprint=$2 and j.job_type='record.export.csv'`,
          [this.scope.projectId, fingerprint],
        );
        const row = existing.rows[0];
        if (!row || row.payload.requestHash !== requestHash) {
          throw new RepositoryError(
            'IDEMPOTENCY_KEY_REUSED',
            409,
            'The idempotency key was already used with a different export scope.',
          );
        }
        return recordExportJob(row);
      }
      await client.query(
        `insert into outbox_events
          (id,project_id,event_type,entity_type,entity_id,payload)
         values ($1,$2,'record.export_requested','object_type',$3,$4::jsonb)`,
        [uuidv7(), this.scope.projectId, objectTypeId, JSON.stringify({ jobId })],
      );
      await appendAudit(
        client,
        this.audit({
          actorId: this.scope.actor.actorId,
          action: 'record.csv_export_requested',
          targetType: 'object_type',
          targetId: objectTypeId,
          requestId,
          payload: {
            jobId,
            estimatedRowCount: preview.total,
            fieldCount: query.fields?.length ?? null,
            archiveState: query.archiveState ?? 'active',
            scoped: Boolean(
              query.filters?.length || query.search || query.contextProjectId !== undefined,
            ),
          },
        }),
      );
      return recordExportJob(inserted.rows[0]);
    });
  }

  async listRecordExports(
    objectTypeId: string,
    input: { limit: number; offset: number },
  ): Promise<{
    items: RecordExportJob[];
    pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  }> {
    await this.assertObjectTypePermission(objectTypeId, 'visibility');
    const parameters = [
      this.scope.projectId,
      objectTypeId,
      this.scope.actor.actorId,
      input.limit,
      input.offset,
    ];
    const predicate = `j.project_id=$1 and j.entity_id=$2 and j.job_type='record.export.csv'
      and j.entity_type='object_type' and j.payload->>'requestedBy'=$3`;
    const [items, count] = await Promise.all([
      this.pool.query<RecordExportDatabaseRow>(
        `select j.*,coalesce(a.result_checkpoint,'{}'::jsonb) result_checkpoint
         from background_jobs j
         left join lateral (
           select result_checkpoint from background_job_attempts
           where project_id=j.project_id and job_id=j.id order by attempt_number desc limit 1
         ) a on true
         where ${predicate}
         order by j.created_at desc,j.id desc limit $4 offset $5`,
        parameters,
      ),
      this.pool.query<{ total: number }>(
        `select count(*)::int total from background_jobs j where ${predicate}`,
        parameters.slice(0, 3),
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: items.rows.map(recordExportJob),
      pageInfo: {
        limit: input.limit,
        offset: input.offset,
        total,
        hasNext: input.offset + items.rows.length < total,
      },
    };
  }

  async getRecordExport(objectTypeId: string, exportId: string): Promise<RecordExportJob> {
    await this.assertObjectTypePermission(objectTypeId, 'visibility');
    const row = await this.recordExportRow(objectTypeId, exportId);
    return recordExportJob(row);
  }

  async getRecordExportArtifact(
    objectTypeId: string,
    exportId: string,
  ): Promise<RecordExportArtifact> {
    await this.assertObjectTypePermission(objectTypeId, 'visibility');
    const row = await this.recordExportRow(objectTypeId, exportId);
    const job = recordExportJob(row);
    if (job.status === 'expired')
      throw new RepositoryError('RECORD_EXPORT_EXPIRED', 410, 'The export has expired.');
    if (!job.downloadReady || !row.result_checkpoint.artifact) {
      throw new RepositoryError(
        'RECORD_EXPORT_NOT_READY',
        409,
        row.status === 'failed' ? 'The export failed.' : 'The export is still being prepared.',
      );
    }
    return row.result_checkpoint.artifact;
  }

  private async recordExportRow(
    objectTypeId: string,
    exportId: string,
  ): Promise<RecordExportDatabaseRow> {
    const result = await this.pool.query<RecordExportDatabaseRow>(
      `select j.*,coalesce(a.result_checkpoint,'{}'::jsonb) result_checkpoint
       from background_jobs j
       left join lateral (
         select result_checkpoint from background_job_attempts
         where project_id=j.project_id and job_id=j.id order by attempt_number desc limit 1
       ) a on true
       where j.project_id=$1 and j.entity_id=$2 and j.id=$3 and j.job_type='record.export.csv'
         and j.entity_type='object_type' and j.payload->>'requestedBy'=$4`,
      [this.scope.projectId, objectTypeId, exportId, this.scope.actor.actorId],
    );
    if (!result.rows[0])
      throw new RepositoryError('RECORD_EXPORT_NOT_FOUND', 404, 'Record export was not found.');
    return result.rows[0];
  }

  async queryRecords(objectTypeId: string, query: RecordQuery): Promise<RecordQueryResult> {
    const fields = await this.listFields(objectTypeId);
    const byId = new Map(fields.map((field) => [field.id, field]));
    const byKey = new Map(fields.map((field) => [field.key, field]));
    const selectedFields = query.fields?.map((fieldKey) => byKey.get(fieldKey));
    if (selectedFields?.some((field) => !field))
      throw new RepositoryError('FIELD_NOT_FOUND', 404, 'A selected field was not found.');
    const selected = selectedFields as FieldDefinitionRow[] | undefined;
    const hydrationFieldIds = new Set(selected?.map((field) => field.id));
    const valueKeys = new Set(selected?.map((field) => field.key));
    const visitFormulaDependencies = (field: FieldDefinitionRow) => {
      if (field.fieldType !== 'formula') return;
      for (const dependencyKey of formulaReferences(String(field.config.expression))) {
        const dependency = byKey.get(dependencyKey);
        if (!dependency || hydrationFieldIds.has(dependency.id)) continue;
        hydrationFieldIds.add(dependency.id);
        valueKeys.add(dependency.key);
        visitFormulaDependencies(dependency);
      }
    };
    for (const field of selected ?? []) visitFormulaDependencies(field);
    const hydrationFields = selected
      ? fields.filter((field) => hydrationFieldIds.has(field.id))
      : fields;
    const filters = query.filters ?? [];
    const sorts: RecordSort[] = query.sorts?.length
      ? query.sorts
      : [{ systemField: 'updatedAt', direction: 'desc' }];
    const configuredGroupings = query.groupings ?? [];
    if (
      configuredGroupings.length > 3 ||
      new Set(configuredGroupings.map((grouping) => grouping.fieldId)).size !==
        configuredGroupings.length
    ) {
      throw new RepositoryError(
        'FIELD_GROUPING_INVALID',
        400,
        'Record queries support up to three unique grouping fields.',
      );
    }
    const groupings = configuredGroupings.filter((grouping) => grouping.enabled);
    const usedFieldIds = new Set([
      ...filters.map((filter) => filter.fieldId),
      ...sorts.flatMap((sort) => (sort.fieldId ? [sort.fieldId] : [])),
      ...groupings.map((grouping) => grouping.fieldId),
      ...(query.groupByFieldId ? [query.groupByFieldId] : []),
      ...(query.summaries ?? []).map((summary) => summary.fieldId),
    ]);
    for (const fieldId of usedFieldIds) {
      const field = byId.get(fieldId);
      if (!field) throw new RepositoryError('FIELD_NOT_FOUND', 404, 'Field was not found.');
      if (
        groupings.some((grouping) => grouping.fieldId === fieldId) &&
        !fieldTypeCanGroup(field.fieldType)
      ) {
        throw new RepositoryError(
          'FIELD_GROUPING_UNSUPPORTED',
          400,
          `The '${field.key}' field cannot be used for grid grouping.`,
        );
      }
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
    const archiveState = query.archiveState ?? (query.includeArchived ? 'all' : 'active');
    if (archiveState === 'active') where.push('r.archived_at is null');
    if (archiveState === 'archived') where.push('r.archived_at is not null');
    if (query.contextProjectId !== undefined) {
      if (query.contextProjectId === null) where.push('r.context_project_id is null');
      else where.push(`r.context_project_id = ${bind(query.contextProjectId)}`);
    }
    const search = query.search?.trim();
    if (search) {
      const escaped = search.replace(/[\\%_]/g, '\\$&');
      const searchBind = bind(`%${escaped}%`);
      where.push(
        `(r.display_name ilike ${searchBind} escape '\\'
          or exists (
            select 1 from jsonb_each(r.values) record_value
            where (${selected ? `record_value.key=any(${bind([...valueKeys])}::text[]) and ` : ''}
              record_value.value::text ilike ${searchBind} escape '\\')
          )
          ${
            selected
              ? ''
              : `or exists (
            select 1 from projects context_project
            where context_project.id = r.context_project_id
              and context_project.name ilike ${searchBind} escape '\\'
          )`
          })`,
      );
    }

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
    groupings.forEach((grouping, index) => {
      const field = byId.get(grouping.fieldId)!;
      const alias = `group_${index}`;
      const fieldBind = bind(field.id);
      joins.push(
        `left join lateral (
           select q.${projectionColumn(field)} as value from record_index_values q
           where q.project_id = r.project_id and q.record_id = r.id and q.field_id = ${fieldBind}
           order by q.ordinal limit 1
         ) ${alias} on true`,
      );
      order.push(`${alias}.value ${grouping.direction} nulls last`);
    });
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
    const pageSize = Math.min(500, Math.max(1, query.pageSize ?? 50));
    const totalResult = await this.pool.query<{ count: string }>(
      `select count(*)::text as count from records r where ${where.join(' and ')}`,
      filterParameters,
    );
    const limitBind = bind(pageSize);
    const offsetBind = bind((page - 1) * pageSize);
    const valuesExpression = selected
      ? `coalesce((select jsonb_object_agg(entry.key,entry.value)
          from jsonb_each(r.values) entry where entry.key=any(${bind([...valueKeys])}::text[])), '{}'::jsonb)`
      : 'r.values';
    const result = await this.pool.query(
      `select r.id, r.project_id, r.context_project_id, r.object_type_id, r.display_name, ${valuesExpression} values, r.row_version,
              r.archived_at, r.created_at, r.updated_at
       from records r ${joins.join(' ')}
       where ${where.join(' and ')} order by ${order.join(', ')}
       limit ${limitBind} offset ${offsetBind}`,
      parameters,
    );
    const recordIds = result.rows.map((row) => String(row.id));
    const selectedRelationFieldIds = selected
      ? [
          ...selected.filter((field) => field.fieldType === 'relation').map((field) => field.id),
          ...hydrationFields
            .filter((field) => field.fieldType === 'lookup' || field.fieldType === 'rollup')
            .map((field) => String(field.config.relationFieldId)),
        ]
      : undefined;
    const selectedResourceFieldIds = selected
      ?.filter((field) => field.fieldType === 'file' || field.fieldType === 'dataset')
      .map((field) => field.id);
    const selectedMeasurementFieldIds = selected
      ?.filter((field) => field.fieldType === 'measurement')
      .map((field) => field.id);
    const [relations, resources, measurements] = await Promise.all([
      this.loadRelations(recordIds, selectedRelationFieldIds),
      this.loadResourceReferences(recordIds, selectedResourceFieldIds),
      this.loadCurrentMeasurements(recordIds, selectedMeasurementFieldIds),
    ]);
    const [relationLabels, referenceLabels] = await Promise.all([
      this.loadRelationLabels(relations),
      this.loadReferenceLabels(result.rows, selected ?? fields, resources),
    ]);
    const response: RecordQueryResult = {
      items: await this.hydrateCalculatedValues(
        result.rows.map((row) => {
          const recordId = String(row.id);
          return this.mapRecord(
            row,
            relations.get(recordId),
            relationLabels.get(recordId),
            referenceLabels.get(recordId),
            resources.files.get(recordId),
            resources.datasets.get(recordId),
            measurements.get(recordId),
          );
        }),
        hydrationFields,
      ).then((items) => {
        if (!selected) return items;
        const selectedKeys = new Set(selected.map((field) => field.key));
        const selectedIds = new Set(selected.map((field) => field.id));
        const pick = <T>(values: Record<string, T>) =>
          Object.fromEntries(
            Object.entries(values).filter(([fieldId]) => selectedIds.has(fieldId)),
          );
        return items.map((item) => ({
          ...item,
          values: Object.fromEntries(
            Object.entries(item.values).filter(([fieldKey]) => selectedKeys.has(fieldKey)),
          ),
          relations: pick(item.relations),
          relationLabels: pick(item.relationLabels),
          referenceLabels: pick(item.referenceLabels),
          fileReferences: pick(item.fileReferences),
          datasetReferences: pick(item.datasetReferences),
          measurements: pick(item.measurements),
        }));
      }),
      page,
      pageSize,
      total: Number(totalResult.rows[0]?.count ?? 0),
    };

    if (query.summaries?.length) {
      response.summaries = await this.summarizeRecords(
        byId,
        query.summaries,
        where,
        filterParameters,
      );
    }

    if (groupings.length) {
      response.groupHierarchy = await this.groupRecords(
        byId,
        groupings,
        query.summaries ?? [],
        where,
        filterParameters,
      );
    }

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

  private async groupRecords(
    fieldsById: Map<string, FieldDefinitionRow>,
    groupings: RecordGrouping[],
    summaries: RecordSummaryRequest[],
    where: string[],
    filterParameters: unknown[],
  ): Promise<RecordGroupResult[]> {
    const parameters = [...filterParameters];
    const definitions = groupings.map((grouping, index) => {
      const field = fieldsById.get(grouping.fieldId)!;
      parameters.push(field.id);
      return {
        alias: `group_value_${index}`,
        fieldBind: `$${parameters.length}`,
        field,
        grouping,
      };
    });
    const groupJoins = definitions.map(
      ({ alias, fieldBind, field }) => `left join lateral (
        select q.${projectionColumn(field)}::text value from record_index_values q
        where q.project_id=r.project_id and q.record_id=r.id and q.field_id=${fieldBind}
        order by q.ordinal limit 1
      ) ${alias} on true`,
    );
    const projectedGroupValues = definitions.map(
      ({ alias }, index) => `${alias}.value group_value_${index}`,
    );
    const summaryDefinitions = summaries.map((summary, index) => {
      const field = fieldsById.get(summary.fieldId)!;
      if (!summaryOperationAllowed(field.fieldType, summary.operation)) {
        throw new RepositoryError(
          'FIELD_SUMMARY_UNSUPPORTED',
          400,
          `The ${summary.operation} summary is not supported for '${field.key}'.`,
        );
      }
      parameters.push(field.id);
      const fieldBind = `$${parameters.length}`;
      const sourceAlias = `summary_source_${index}`;
      let join: string;
      if (field.fieldType === 'relation') {
        join = `left join lateral (
          select edge.source_record_id::text value from relation_edges edge
          where edge.project_id=r.project_id and edge.source_record_id=r.id
            and edge.source_field_id=${fieldBind}
          limit 1
        ) ${sourceAlias} on true`;
      } else if (field.fieldType === 'measurement') {
        join = `left join lateral (
          select candidate.canonical_value value from measurement_results candidate
          where candidate.project_id=r.project_id and candidate.record_id=r.id
            and candidate.field_id=${fieldBind}
            and not exists (
              select 1 from measurement_results successor
              where successor.project_id=candidate.project_id
                and successor.supersedes_result_id=candidate.id
            )
          order by candidate.measured_at desc,candidate.created_at desc,candidate.id desc limit 1
        ) ${sourceAlias} on true`;
      } else {
        join = `left join lateral (
          select q.${projectionColumn(field)} value from record_index_values q
          where q.project_id=r.project_id and q.record_id=r.id and q.field_id=${fieldBind}
          order by q.ordinal limit 1
        ) ${sourceAlias} on true`;
      }
      const aggregate = summary.operation === 'average' ? 'avg' : summary.operation;
      const valueColumn = `summary_value_${index}`;
      return {
        field,
        summary,
        join,
        projection: `${sourceAlias}.value ${valueColumn}`,
        aggregate:
          summary.operation === 'count'
            ? `count(${valueColumn})::text`
            : `${aggregate}(${valueColumn})::text`,
      };
    });
    const summaryValues = summaryDefinitions.length
      ? `jsonb_build_array(${summaryDefinitions
          .map(
            (definition, index) =>
              `jsonb_build_object('summaryIndex',${index},'value',${definition.aggregate})`,
          )
          .join(',')})`
      : `'[]'::jsonb`;
    const levels = definitions.map((definition, level) => {
      const path = definitions
        .slice(0, level + 1)
        .map(
          (candidate, index) =>
            `jsonb_build_object('fieldId',${candidate.fieldBind}::text,'value',group_value_${index})`,
        )
        .join(',');
      const groupColumns = definitions
        .slice(0, level + 1)
        .map((_, index) => `group_value_${index}`)
        .join(',');
      return `select ${level + 1}::int level,${definition.fieldBind}::text field_id,
        jsonb_build_array(${path}) path,count(*)::text count,${summaryValues} summary_values
        from grouped_records group by ${groupColumns}`;
    });
    const result = await this.pool.query<{
      level: number;
      field_id: string;
      path: Array<{ fieldId: string; value: string | null }>;
      count: string;
      summary_values: Array<{ summaryIndex: number; value: string | null }>;
    }>(
      `with filtered_records as materialized (
         select r.* from records r where ${where.join(' and ')}
       ), grouped_records as materialized (
         select r.id,${[...projectedGroupValues, ...summaryDefinitions.map((item) => item.projection)].join(',')}
         from filtered_records r ${[...groupJoins, ...summaryDefinitions.map((item) => item.join)].join(' ')}
       )
       ${levels.join(' union all ')}
       order by level,path`,
      parameters,
    );
    return result.rows.map((row) => ({
      level: row.level,
      fieldId: row.field_id,
      path: row.path,
      count: Number(row.count),
      ...(summaryDefinitions.length
        ? {
            summaries: summaryDefinitions.map(({ field, summary }, index) =>
              recordSummaryResult(
                field,
                summary,
                row.summary_values.find((candidate) => candidate.summaryIndex === index)?.value ??
                  null,
              ),
            ),
          }
        : {}),
    }));
  }

  private async summarizeRecords(
    fieldsById: Map<string, FieldDefinitionRow>,
    summaries: RecordSummaryRequest[],
    where: string[],
    filterParameters: unknown[],
  ): Promise<RecordSummaryResult[]> {
    const parameters = [...filterParameters];
    const definitions = summaries.map((summary, index) => {
      const field = fieldsById.get(summary.fieldId)!;
      if (!summaryOperationAllowed(field.fieldType, summary.operation)) {
        throw new RepositoryError(
          'FIELD_SUMMARY_UNSUPPORTED',
          400,
          `The ${summary.operation} summary is not supported for '${field.key}'.`,
        );
      }
      parameters.push(field.id);
      const fieldBind = `$${parameters.length}`;
      let expression: string;
      let join: string;
      if (field.fieldType === 'relation') {
        expression = 'count(distinct r.id)::text';
        join = `join relation_edges summary_value
          on summary_value.project_id=r.project_id and summary_value.source_record_id=r.id
          and summary_value.source_field_id=${fieldBind}`;
      } else if (field.fieldType === 'measurement') {
        const aggregate = summary.operation === 'average' ? 'avg' : summary.operation;
        expression =
          summary.operation === 'count'
            ? 'count(summary_value.id)::text'
            : `${aggregate}(summary_value.canonical_value)::text`;
        join = `left join lateral (
          select candidate.id,candidate.canonical_value from measurement_results candidate
          where candidate.project_id=r.project_id and candidate.record_id=r.id
            and candidate.field_id=${fieldBind}
            and not exists (
              select 1 from measurement_results successor
              where successor.project_id=candidate.project_id
                and successor.supersedes_result_id=candidate.id
            )
          order by candidate.measured_at desc,candidate.created_at desc,candidate.id desc limit 1
        ) summary_value on true`;
      } else {
        const aggregate = summary.operation === 'average' ? 'avg' : summary.operation;
        const column = projectionColumn(field);
        expression =
          summary.operation === 'count'
            ? 'count(distinct summary_value.record_id)::text'
            : `${aggregate}(summary_value.${column})::text`;
        join = `left join record_index_values summary_value
          on summary_value.project_id=r.project_id and summary_value.record_id=r.id
          and summary_value.field_id=${fieldBind}`;
      }
      return {
        field,
        summary,
        sql: `select ${index}::int summary_index,${expression} value
          from filtered_records r ${join}`,
      };
    });
    const result = await this.pool.query<{ summary_index: number; value: string | null }>(
      `with filtered_records as materialized (
         select r.* from records r where ${where.join(' and ')}
       )
       ${definitions.map((definition) => definition.sql).join(' union all ')}
       order by summary_index`,
      parameters,
    );
    const values = new Map(result.rows.map((row) => [row.summary_index, row.value]));
    return definitions.map(({ field, summary }, index) =>
      recordSummaryResult(field, summary, values.get(index) ?? null),
    );
  }

  private async setRecordArchivedWithClient(
    client: PoolClient,
    input: {
      objectTypeId: string;
      recordId: string;
      archived: boolean;
      reason?: string;
      requestId: string;
    },
  ): Promise<{ id: string; rowVersion: number }> {
    const result = await client.query<{ row_version: number }>(
      `update records set
         archived_at = case when $4::boolean then now() else null end,
         archived_by = case when $4::boolean then $5::uuid else null end,
         archive_reason = case when $4::boolean then $6::text else null end,
         row_version = row_version + 1, updated_by = $5, updated_at = now()
       where project_id = $1 and object_type_id = $2 and id = $3
         and (($4::boolean and archived_at is null) or (not $4::boolean and archived_at is not null))
       returning row_version`,
      [
        this.scope.projectId,
        input.objectTypeId,
        input.recordId,
        input.archived,
        this.scope.actor.actorId,
        input.reason ?? null,
      ],
    );
    if (!result.rows[0]) {
      const found = await client.query(
        'select 1 from records where project_id=$1 and object_type_id=$2 and id=$3',
        [this.scope.projectId, input.objectTypeId, input.recordId],
      );
      throw new RepositoryError(
        found.rowCount ? 'RECORD_STATE_CONFLICT' : 'RECORD_NOT_FOUND',
        found.rowCount ? 409 : 404,
        found.rowCount
          ? `The record is already ${input.archived ? 'archived' : 'active'}.`
          : 'Record was not found.',
      );
    }
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
    await appendRecordWebhookEvent(
      client,
      this.scope,
      input.archived ? 'record.archived' : 'record.restored',
      input.objectTypeId,
      input.recordId,
      input.archived ? { reason: input.reason ?? null } : {},
    );
    return { id: input.recordId, rowVersion: result.rows[0].row_version };
  }

  async setRecordArchived(input: {
    objectTypeId: string;
    recordId: string;
    archived: boolean;
    reason?: string;
    requestId: string;
  }): Promise<RecordRow> {
    await this.assertObjectTypePermission(input.objectTypeId, 'archive');
    await transaction(this.pool, (client) => this.setRecordArchivedWithClient(client, input));
    return this.getRecord(input.objectTypeId, input.recordId);
  }

  async setRecordsArchivedBulk(input: {
    objectTypeId: string;
    recordIds: string[];
    archived: boolean;
    reason?: string;
    requestId: string;
  }): Promise<RecordBulkLifecycleResult> {
    await this.assertObjectTypePermission(input.objectTypeId, 'archive');
    if (!input.recordIds.length || input.recordIds.length > 100) {
      throw new RepositoryError(
        'RECORD_BATCH_SIZE_INVALID',
        400,
        'Bulk record requests must contain between 1 and 100 items.',
      );
    }
    if (new Set(input.recordIds).size !== input.recordIds.length) {
      throw new RepositoryError(
        'RECORD_BATCH_DUPLICATE_ID',
        400,
        'A record can appear only once in a bulk lifecycle request.',
      );
    }
    const updated = await transaction(this.pool, async (client) => {
      const results: Array<{ id: string; rowVersion: number }> = [];
      for (const recordId of [...input.recordIds].sort()) {
        results.push(
          await this.setRecordArchivedWithClient(client, {
            objectTypeId: input.objectTypeId,
            recordId,
            archived: input.archived,
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
            requestId: input.requestId,
          }),
        );
      }
      return results;
    });
    const byId = new Map(updated.map((item) => [item.id, item]));
    return {
      updated: input.recordIds.map((recordId) => byId.get(recordId)!),
      archived: input.archived,
    };
  }
}

export interface ClaimedRecordExportJob {
  id: string;
  project_id: string;
  entity_id: string;
  payload: RecordExportPayload;
  attempt_count: number;
  max_attempts: number;
  attemptNumber: number;
  attemptId: string;
}

async function lockActiveRecordExportJob(
  client: PoolClient,
  input: {
    jobId: string;
    attemptId: string;
    workerId: string;
    objectTypeId: string;
    projectId: string;
  },
) {
  const active = await client.query(
    `select 1 from background_jobs j
     join background_job_attempts a on a.project_id=j.project_id and a.job_id=j.id
     where j.id=$1 and a.id=$2 and j.job_type='record.export.csv'
       and j.entity_type='object_type' and j.entity_id=$3 and j.project_id=$4
       and j.status='running' and j.lease_owner=$5 and j.lease_expires_at>now()
       and a.status='running' and a.worker_identity=$5
     for update of j,a`,
    [input.jobId, input.attemptId, input.objectTypeId, input.projectId, input.workerId],
  );
  if (!active.rowCount)
    throw new RepositoryError(
      'JOB_LEASE_LOST',
      409,
      'The record export job lease is no longer owned by this attempt.',
    );
}

export async function claimRecordExportJob(
  pool: Pool,
  workerId: string,
  leaseSeconds = 60,
): Promise<ClaimedRecordExportJob | null> {
  return transaction(pool, async (client) => {
    await client.query(
      `update background_job_attempts a
       set status='failed',completed_at=now(),error_code='JOB_LEASE_EXPIRED',retryable=true
       from background_jobs j
       where a.job_id=j.id and a.status='running' and j.status='running'
         and j.job_type='record.export.csv' and j.lease_expires_at<now()`,
    );
    await client.query(
      `update background_jobs set status='queued',lease_owner=null,lease_expires_at=null,updated_at=now()
       where job_type='record.export.csv' and status='running' and lease_expires_at<now()`,
    );
    const job = await client.query<Omit<ClaimedRecordExportJob, 'attemptId' | 'attemptNumber'>>(
      `select * from background_jobs
       where job_type='record.export.csv' and entity_type='object_type'
         and status='queued' and scheduled_at<=now()
       order by scheduled_at,id for update skip locked limit 1`,
    );
    const row = job.rows[0];
    if (!row) return null;
    const attemptNumber = Number(row.attempt_count) + 1;
    await client.query(
      `update background_jobs set status='running',attempt_count=$2,lease_owner=$3,
         lease_expires_at=now()+($4||' seconds')::interval,
         started_at=coalesce(started_at,now()),progress=1,updated_at=now() where id=$1`,
      [row.id, attemptNumber, workerId, leaseSeconds],
    );
    const attemptId = uuidv7();
    await client.query(
      `insert into background_job_attempts
        (id,project_id,job_id,attempt_number,worker_identity,progress)
       values ($1,$2,$3,$4,$5,1)`,
      [attemptId, row.project_id, row.id, attemptNumber, workerId],
    );
    return { ...row, attemptId, attemptNumber };
  });
}

export async function completeRecordExportJob(
  pool: Pool,
  input: {
    jobId: string;
    attemptId: string;
    workerId: string;
    projectId: string;
    objectTypeId: string;
    requestedBy: string;
    artifact: RecordExportArtifact;
  },
): Promise<void> {
  await transaction(pool, async (client) => {
    await lockActiveRecordExportJob(client, input);
    const checkpoint = JSON.stringify({ artifact: input.artifact });
    await client.query(
      `update background_job_attempts set status='succeeded',progress=100,completed_at=now(),
         heartbeat_at=now(),result_checkpoint=$2::jsonb
       where id=$1 and status='running'`,
      [input.attemptId, checkpoint],
    );
    await client.query(
      `update background_jobs set status='succeeded',progress=100,completed_at=now(),
         lease_owner=null,lease_expires_at=null,updated_at=now()
       where id=$1 and status='running'`,
      [input.jobId],
    );
    await client.query(
      `insert into outbox_events
        (id,project_id,event_type,entity_type,entity_id,payload)
       values ($1,$2,'record.export_completed','object_type',$3,$4::jsonb)`,
      [uuidv7(), input.projectId, input.objectTypeId, JSON.stringify({ jobId: input.jobId })],
    );
    await client.query(
      `insert into audit_events
        (id,organization_id,workspace_id,project_id,actor_id,action,target_type,target_id,request_id,payload)
       select $1,w.organization_id,p.workspace_id,p.id,$2,'record.csv_exported','object_type',$3,$4,$5::jsonb
       from projects p join workspaces w on w.id=p.workspace_id where p.id=$6`,
      [
        uuidv7(),
        input.requestedBy,
        input.objectTypeId,
        `job:${input.jobId}`,
        JSON.stringify({
          jobId: input.jobId,
          rowCount: input.artifact.rowCount,
          fieldCount: input.artifact.fieldCount,
          sizeBytes: input.artifact.sizeBytes,
          expiresAt: input.artifact.expiresAt,
        }),
        input.projectId,
      ],
    );
  });
}

export async function failRecordExportJob(
  pool: Pool,
  input: {
    jobId: string;
    attemptId: string;
    workerId: string;
    projectId: string;
    objectTypeId: string;
    requestedBy: string;
    attemptNumber: number;
    maxAttempts: number;
    code: string;
    retryable: boolean;
  },
): Promise<void> {
  await transaction(pool, async (client) => {
    await lockActiveRecordExportJob(client, input);
    const retry = input.retryable && input.attemptNumber < input.maxAttempts;
    await client.query(
      `update background_job_attempts set status='failed',completed_at=now(),heartbeat_at=now(),
         error_code=$2,retryable=$3 where id=$1 and status='running'`,
      [input.attemptId, input.code, input.retryable],
    );
    await client.query(
      `update background_jobs set status=$2::job_status,
         scheduled_at=case when $2::job_status='queued' then now()+(least(30,power(2,$3))||' seconds')::interval else scheduled_at end,
         error_code=$4,retryable=$5,lease_owner=null,lease_expires_at=null,
         completed_at=case when $2::job_status='failed' then now() else null end,updated_at=now()
       where id=$1`,
      [input.jobId, retry ? 'queued' : 'failed', input.attemptNumber, input.code, input.retryable],
    );
    if (!retry) {
      await client.query(
        `insert into outbox_events
          (id,project_id,event_type,entity_type,entity_id,payload)
         values ($1,$2,'record.export_failed','object_type',$3,$4::jsonb)`,
        [
          uuidv7(),
          input.projectId,
          input.objectTypeId,
          JSON.stringify({ jobId: input.jobId, code: input.code }),
        ],
      );
      await client.query(
        `insert into audit_events
          (id,organization_id,workspace_id,project_id,actor_id,action,target_type,target_id,request_id,payload)
         select $1,w.organization_id,p.workspace_id,p.id,$2,'record.csv_export_failed','object_type',$3,$4,$5::jsonb
         from projects p join workspaces w on w.id=p.workspace_id where p.id=$6`,
        [
          uuidv7(),
          input.requestedBy,
          input.objectTypeId,
          `job:${input.jobId}`,
          JSON.stringify({ jobId: input.jobId, code: input.code }),
          input.projectId,
        ],
      );
    }
  });
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
