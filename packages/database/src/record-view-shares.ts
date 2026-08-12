import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  ScopedProjectRepository,
  type FieldDefinitionRow,
  type JsonValue,
  type RecordFilter,
  type RecordQuery,
  type RecordSort,
  type RecordViewConfig,
  type RecordViewType,
} from './configurable-data.js';
import { appendAudit, type ActorSession } from './community.js';
import { RepositoryError } from './errors.js';

const MAX_PUBLIC_EXPORT_ROWS = 10_000;

export interface ManagedRecordViewShare {
  id: string;
  recordViewId: string;
  tokenPrefix: string;
  passwordProtected: boolean;
  allowDownload: boolean;
  expiresAt: string | null;
  rowVersion: number;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedRecordViewShare extends ManagedRecordViewShare {
  token: string;
}

export interface PublicSharedViewField {
  id: string;
  name: string;
  description: string;
  key: string;
  fieldType: FieldDefinitionRow['fieldType'];
  required: boolean;
  defaultValue?: JsonValue;
  config: Record<string, JsonValue>;
}

export interface PublicSharedViewMetadata {
  requiresPassword: boolean;
  view?: {
    name: string;
    tableName: string;
    viewType: RecordViewType;
    rowDensity: 'compact' | 'comfortable';
    fields: PublicSharedViewField[];
    fieldWidths: Record<string, number>;
    groupFieldId: string | null;
    dateFieldId: string | null;
    allowDownload: boolean;
    expiresAt: string | null;
  };
}

export interface PublicSharedRecord {
  id: string;
  displayName: string;
  values: Record<string, JsonValue>;
  updatedAt: string;
}

export interface PublicSharedRecordPage {
  items: PublicSharedRecord[];
  page: number;
  pageSize: number;
  total: number;
  groups?: Array<{ value: string | null; count: number }>;
}

export interface PublicSharedRecordQuery {
  filters?: RecordFilter[];
  sorts?: RecordSort[];
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface PublicFormSubmission {
  displayName: string;
  values: Record<string, JsonValue>;
  idempotencyHash: string;
  requestHash: string;
  networkFingerprint: string;
  requestId: string;
}

export interface PublicFormSubmissionResult {
  recordId: string;
  submittedAt: string;
  idempotentReplay: boolean;
}

const publicFormInputTypes = new Set<FieldDefinitionRow['fieldType']>([
  'text',
  'long_text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'single_select',
  'multi_select',
  'quantity',
  'range',
]);

interface DbManagedShare {
  id: string;
  record_view_id: string;
  token_prefix: string;
  password_hash: string | null;
  allow_download: boolean;
  expires_at: Date | null;
  row_version: number;
  access_count: string | number;
  last_accessed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PublicRecordViewShareContext {
  id: string;
  organizationId: string;
  workspaceId: string;
  projectId: string;
  objectTypeId: string;
  recordViewId: string;
  createdBy: string;
  passwordHash: string | null;
  allowDownload: boolean;
  expiresAt: Date | null;
  viewName: string;
  viewType: RecordViewType;
  viewConfig: RecordViewConfig;
  tableName: string;
}

interface DbPublicShare {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  object_type_id: string;
  record_view_id: string;
  created_by: string;
  password_hash: string | null;
  allow_download: boolean;
  expires_at: Date | null;
  view_name: string;
  view_type: RecordViewType;
  view_config: RecordViewConfig;
  table_name: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function mapManagedShare(row: DbManagedShare): ManagedRecordViewShare {
  return {
    id: row.id,
    recordViewId: row.record_view_id,
    tokenPrefix: row.token_prefix,
    passwordProtected: Boolean(row.password_hash),
    allowDownload: row.allow_download,
    expiresAt: iso(row.expires_at),
    rowVersion: row.row_version,
    accessCount: Number(row.access_count),
    lastAccessedAt: iso(row.last_accessed_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
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

async function assertManagedView(
  client: PoolClient,
  actor: ActorSession,
  workspaceId: string,
  projectId: string,
  objectTypeId: string,
  recordViewId: string,
): Promise<RecordViewType> {
  const result = await client.query<{ view_type: RecordViewType; config: RecordViewConfig }>(
    `select rv.view_type,rv.config from record_views rv
     join projects p on p.id=rv.project_id
     join workspaces w on w.id=p.workspace_id
     where w.organization_id=$1 and w.id=$2 and p.id=$3 and rv.object_type_id=$4
       and rv.id=$5 and rv.archived_at is null
       and project_visible_to(p.id,w.id,w.organization_id,$6,$7) for update`,
    [
      actor.organizationId,
      workspaceId,
      projectId,
      objectTypeId,
      recordViewId,
      actor.actorId,
      actor.role,
    ],
  );
  if (!result.rows[0])
    throw new RepositoryError('RECORD_VIEW_NOT_FOUND', 404, 'Record view was not found.');
  if (result.rows[0].view_type === 'form') {
    const fields = await client.query<{
      id: string;
      name: string;
      field_type: FieldDefinitionRow['fieldType'];
    }>(
      `select id,name,key,field_type,"required",config,default_value
       from field_definitions where project_id=$1 and object_type_id=$2 order by position,id`,
      [projectId, objectTypeId],
    );
    const visibleIds = new Set(result.rows[0].config.visibleFieldIds ?? []);
    const visible = visibleIds.size
      ? fields.rows.filter((field) => visibleIds.has(field.id))
      : fields.rows;
    const unsupported = visible.find((field) => !publicFormInputTypes.has(field.field_type));
    if (unsupported)
      throw new RepositoryError(
        'PUBLIC_FORM_FIELD_UNSUPPORTED',
        400,
        `Remove '${unsupported.name}' from the form before sharing it publicly; ${unsupported.field_type} fields are not accepted from anonymous submitters.`,
      );
  }
  return result.rows[0].view_type;
}

const managedShareColumns = `id,record_view_id,token_prefix,password_hash,allow_download,expires_at,
  row_version,access_count,last_accessed_at,created_at,updated_at`;

export async function getManagedRecordViewShare(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
  projectId: string,
  objectTypeId: string,
  recordViewId: string,
): Promise<ManagedRecordViewShare | null> {
  const result = await pool.query<DbManagedShare>(
    `select ${managedShareColumns} from record_view_shares s
     where s.project_id=$1 and s.record_view_id=$2 and s.revoked_at is null
       and exists (
         select 1 from record_views rv join projects p on p.id=rv.project_id
         join workspaces w on w.id=p.workspace_id
         where rv.id=s.record_view_id and rv.object_type_id=$3 and rv.archived_at is null
           and w.id=$4 and w.organization_id=$5
           and project_visible_to(p.id,w.id,w.organization_id,$6,$7)
       )`,
    [
      projectId,
      recordViewId,
      objectTypeId,
      workspaceId,
      actor.organizationId,
      actor.actorId,
      actor.role,
    ],
  );
  return result.rows[0] ? mapManagedShare(result.rows[0]) : null;
}

export async function createRecordViewShare(
  pool: Pool,
  actor: ActorSession,
  input: {
    workspaceId: string;
    projectId: string;
    objectTypeId: string;
    recordViewId: string;
    passwordHash?: string;
    allowDownload: boolean;
    expiresAt?: Date;
    requestId: string;
  },
): Promise<CreatedRecordViewShare> {
  const token = `sv_${randomBytes(32).toString('base64url')}`;
  const tokenPrefix = token.slice(0, 15);
  return transaction(pool, async (client) => {
    const viewType = await assertManagedView(
      client,
      actor,
      input.workspaceId,
      input.projectId,
      input.objectTypeId,
      input.recordViewId,
    );
    const current = await client.query<{ password_hash: string | null }>(
      `select password_hash from record_view_shares
       where project_id=$1 and record_view_id=$2 and revoked_at is null for update`,
      [input.projectId, input.recordViewId],
    );
    const passwordHash = input.passwordHash ?? current.rows[0]?.password_hash ?? null;
    await client.query(
      `update record_view_shares set revoked_at=now(),revoked_by=$3,revoked_reason='rotated',
         updated_by=$3,updated_at=now(),row_version=row_version+1
       where project_id=$1 and record_view_id=$2 and revoked_at is null`,
      [input.projectId, input.recordViewId, actor.actorId],
    );
    const id = uuidv7();
    const result = await client.query<DbManagedShare>(
      `insert into record_view_shares
        (id,project_id,record_view_id,token_prefix,token_hash,password_hash,allow_download,
         expires_at,created_by,updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       returning ${managedShareColumns}`,
      [
        id,
        input.projectId,
        input.recordViewId,
        tokenPrefix,
        digest(token),
        passwordHash,
        viewType === 'form' ? false : input.allowDownload,
        input.expiresAt ?? null,
        actor.actorId,
      ],
    );
    await appendAudit(client, {
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: actor.actorId,
      action: 'record_view.share_created',
      targetType: 'record_view_share',
      targetId: id,
      requestId: input.requestId,
      payload: {
        recordViewId: input.recordViewId,
        passwordProtected: Boolean(passwordHash),
        allowDownload: viewType === 'form' ? false : input.allowDownload,
        expiresAt: input.expiresAt?.toISOString() ?? null,
        tokenPrefix,
      },
    });
    return { ...mapManagedShare(result.rows[0]!), token };
  });
}

export async function updateRecordViewShare(
  pool: Pool,
  actor: ActorSession,
  input: {
    workspaceId: string;
    projectId: string;
    objectTypeId: string;
    recordViewId: string;
    rowVersion: number;
    passwordHash?: string | null;
    allowDownload: boolean;
    expiresAt?: Date;
    requestId: string;
  },
): Promise<ManagedRecordViewShare> {
  return transaction(pool, async (client) => {
    const viewType = await assertManagedView(
      client,
      actor,
      input.workspaceId,
      input.projectId,
      input.objectTypeId,
      input.recordViewId,
    );
    const result = await client.query<DbManagedShare>(
      `update record_view_shares set
         password_hash=case when $6::boolean then $7::text else password_hash end,
         allow_download=$4,expires_at=$5,row_version=row_version+1,
         updated_by=$8,updated_at=now()
       where project_id=$1 and record_view_id=$2 and row_version=$3 and revoked_at is null
       returning ${managedShareColumns}`,
      [
        input.projectId,
        input.recordViewId,
        input.rowVersion,
        viewType === 'form' ? false : input.allowDownload,
        input.expiresAt ?? null,
        input.passwordHash !== undefined,
        input.passwordHash ?? null,
        actor.actorId,
      ],
    );
    if (!result.rows[0]) {
      const exists = await client.query(
        `select 1 from record_view_shares
         where project_id=$1 and record_view_id=$2 and revoked_at is null`,
        [input.projectId, input.recordViewId],
      );
      throw new RepositoryError(
        exists.rowCount ? 'VERSION_CONFLICT' : 'RECORD_VIEW_SHARE_NOT_FOUND',
        exists.rowCount ? 409 : 404,
        exists.rowCount ? 'The share settings changed since they were loaded.' : 'Share not found.',
      );
    }
    const updated = mapManagedShare(result.rows[0]);
    await appendAudit(client, {
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: actor.actorId,
      action: 'record_view.share_updated',
      targetType: 'record_view_share',
      targetId: updated.id,
      requestId: input.requestId,
      payload: {
        recordViewId: input.recordViewId,
        passwordChanged: input.passwordHash !== undefined,
        passwordProtected: updated.passwordProtected,
        allowDownload: updated.allowDownload,
        expiresAt: updated.expiresAt,
        rowVersion: updated.rowVersion,
      },
    });
    return updated;
  });
}

export async function revokeRecordViewShare(
  pool: Pool,
  actor: ActorSession,
  input: {
    workspaceId: string;
    projectId: string;
    objectTypeId: string;
    recordViewId: string;
    rowVersion: number;
    reason?: string;
    requestId: string;
  },
): Promise<void> {
  await transaction(pool, async (client) => {
    await assertManagedView(
      client,
      actor,
      input.workspaceId,
      input.projectId,
      input.objectTypeId,
      input.recordViewId,
    );
    const result = await client.query<{ id: string }>(
      `update record_view_shares set revoked_at=now(),revoked_by=$4,revoked_reason=$5,
         row_version=row_version+1,updated_by=$4,updated_at=now()
       where project_id=$1 and record_view_id=$2 and row_version=$3 and revoked_at is null
       returning id`,
      [
        input.projectId,
        input.recordViewId,
        input.rowVersion,
        actor.actorId,
        input.reason?.trim() || null,
      ],
    );
    if (!result.rows[0])
      throw new RepositoryError('RECORD_VIEW_SHARE_NOT_FOUND', 404, 'Active share was not found.');
    await appendAudit(client, {
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: actor.actorId,
      action: 'record_view.share_revoked',
      targetType: 'record_view_share',
      targetId: result.rows[0].id,
      requestId: input.requestId,
      payload: { recordViewId: input.recordViewId, reason: input.reason?.trim() || null },
    });
  });
}

export async function resolvePublicRecordViewShare(
  pool: Pool,
  token: string,
): Promise<PublicRecordViewShareContext> {
  const result = await pool.query<DbPublicShare>(
    `select s.id,w.organization_id,w.id workspace_id,s.project_id,rv.object_type_id,
            s.record_view_id,s.created_by,s.password_hash,s.allow_download,s.expires_at,
            rv.name view_name,rv.view_type,rv.config view_config,ot.plural_name table_name
     from record_view_shares s
     join record_views rv on rv.project_id=s.project_id and rv.id=s.record_view_id
     join object_types ot on ot.project_id=rv.project_id and ot.id=rv.object_type_id
     join projects p on p.id=s.project_id
     join workspaces w on w.id=p.workspace_id
     where s.token_hash=$1 and s.revoked_at is null and rv.archived_at is null
       and (s.expires_at is null or s.expires_at>now())`,
    [digest(token)],
  );
  const row = result.rows[0];
  if (!row) throw new RepositoryError('SHARED_VIEW_NOT_FOUND', 404, 'Shared view was not found.');
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    objectTypeId: row.object_type_id,
    recordViewId: row.record_view_id,
    createdBy: row.created_by,
    passwordHash: row.password_hash,
    allowDownload: row.allow_download,
    expiresAt: row.expires_at,
    viewName: row.view_name,
    viewType: row.view_type,
    viewConfig: row.view_config,
    tableName: row.table_name,
  };
}

function publicActor(context: PublicRecordViewShareContext): ActorSession {
  return {
    sessionId: `public-share:${context.id}`,
    actorId: context.createdBy,
    organizationId: context.organizationId,
    role: 'viewer',
    email: '',
    displayName: 'Public shared view',
    csrfTokenHash: '',
  };
}

async function shareRepository(
  pool: Pool,
  context: PublicRecordViewShareContext,
): Promise<ScopedProjectRepository> {
  return ScopedProjectRepository.open(
    pool,
    publicActor(context),
    context.workspaceId,
    context.projectId,
  );
}

function visibleFields(
  fields: FieldDefinitionRow[],
  config: RecordViewConfig,
): FieldDefinitionRow[] {
  if (!config.visibleFieldIds.length) return fields;
  const visible = new Set(config.visibleFieldIds);
  return fields.filter((field) => visible.has(field.id));
}

function publicFieldConfig(field: FieldDefinitionRow): Record<string, JsonValue> {
  const allowed = new Set([
    'options',
    'dimension',
    'canonicalUnit',
    'allowedUnits',
    'displayPrecision',
    'xLabel',
    'xUnit',
    'yLabel',
    'yUnit',
    'firstRowHeader',
    'mediaKind',
  ]);
  return Object.fromEntries(Object.entries(field.config).filter(([key]) => allowed.has(key)));
}

export async function getPublicSharedViewMetadata(
  pool: Pool,
  context: PublicRecordViewShareContext,
  unlocked: boolean,
): Promise<PublicSharedViewMetadata> {
  const requiresPassword = Boolean(context.passwordHash);
  if (requiresPassword && !unlocked) return { requiresPassword };
  const fields = visibleFields(
    await (await shareRepository(pool, context)).listFields(context.objectTypeId),
    context.viewConfig,
  );
  if (context.viewType === 'form') {
    const unsupported = fields.find((field) => !publicFormInputTypes.has(field.fieldType));
    if (unsupported)
      throw new RepositoryError(
        'PUBLIC_FORM_FIELD_UNSUPPORTED',
        409,
        `The shared form contains an unsupported field: '${unsupported.name}'.`,
      );
  }
  const visibleIds = new Set(fields.map((field) => field.id));
  return {
    requiresPassword,
    view: {
      name: context.viewName,
      tableName: context.tableName,
      viewType: context.viewType,
      rowDensity: context.viewConfig.rowDensity,
      fields: fields.map((field) => ({
        id: field.id,
        name: field.name,
        description: field.description,
        key: field.key,
        fieldType: field.fieldType,
        required: field.required,
        ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
        config: publicFieldConfig(field),
      })),
      fieldWidths: Object.fromEntries(
        Object.entries(context.viewConfig.fieldWidths).filter(([fieldId]) =>
          visibleIds.has(fieldId),
        ),
      ),
      groupFieldId: visibleIds.has(context.viewConfig.viewOptions?.groupFieldId ?? '')
        ? (context.viewConfig.viewOptions?.groupFieldId ?? null)
        : null,
      dateFieldId: visibleIds.has(context.viewConfig.viewOptions?.dateFieldId ?? '')
        ? (context.viewConfig.viewOptions?.dateFieldId ?? null)
        : null,
      allowDownload: context.allowDownload,
      expiresAt: iso(context.expiresAt),
    },
  };
}

function publicRecordId(shareId: string, recordId: string): string {
  return `r_${digest(`${shareId}:${recordId}`).slice(0, 24)}`;
}

function validateTransientQuery(
  query: PublicSharedRecordQuery,
  fields: FieldDefinitionRow[],
): void {
  const visibleIds = new Set(fields.map((field) => field.id));
  const inaccessible = [
    ...(query.filters ?? []).map((filter) => filter.fieldId),
    ...(query.sorts ?? []).flatMap((sort) => (sort.fieldId ? [sort.fieldId] : [])),
  ].find((fieldId) => !visibleIds.has(fieldId));
  if (inaccessible)
    throw new RepositoryError(
      'SHARED_VIEW_FIELD_NOT_VISIBLE',
      400,
      'Public filters and sorts may use visible fields only.',
    );
}

export async function queryPublicSharedViewRecords(
  pool: Pool,
  context: PublicRecordViewShareContext,
  query: PublicSharedRecordQuery,
  maximumPageSize = 100,
): Promise<PublicSharedRecordPage> {
  if (context.viewType === 'form')
    throw new RepositoryError(
      'SHARED_VIEW_QUERY_UNSUPPORTED',
      405,
      'Public form links accept submissions and cannot be queried.',
    );
  const repository = await shareRepository(pool, context);
  const fields = visibleFields(
    await repository.listFields(context.objectTypeId),
    context.viewConfig,
  );
  validateTransientQuery(query, fields);
  const pageSize = Math.min(maximumPageSize, Math.max(1, query.pageSize ?? 50));
  const recordQuery: RecordQuery = {
    fields: fields.map((field) => field.key),
    filters: [...context.viewConfig.filters, ...(query.filters ?? [])],
    sorts: query.sorts?.length ? query.sorts : context.viewConfig.sorts,
    ...(query.search?.trim() ? { search: query.search.trim() } : {}),
    ...(context.viewConfig.viewOptions?.contextProjectId !== undefined
      ? { contextProjectId: context.viewConfig.viewOptions.contextProjectId }
      : {}),
    ...(context.viewType === 'kanban' && context.viewConfig.viewOptions?.groupFieldId
      ? { groupByFieldId: context.viewConfig.viewOptions.groupFieldId }
      : {}),
    page: Math.max(1, query.page ?? 1),
    pageSize,
    archiveState: 'active',
  };
  const result = await repository.queryRecords(context.objectTypeId, recordQuery);
  const relationIds = new Set(
    result.items.flatMap((item) => Object.values(item.relations).flatMap((ids) => ids)),
  );
  const userIds = new Set<string>();
  const byId = new Map(fields.map((field) => [field.id, field]));
  for (const item of result.items) {
    for (const field of fields) {
      if (field.fieldType !== 'user') continue;
      const value = item.values[field.key];
      if (typeof value === 'string') userIds.add(value);
    }
  }
  const [relationLabels, userLabels] = await Promise.all([
    relationIds.size
      ? pool.query<{ id: string; display_name: string }>(
          `select id,display_name from records where project_id=$1 and id=any($2::uuid[])`,
          [context.projectId, [...relationIds]],
        )
      : Promise.resolve({ rows: [] as Array<{ id: string; display_name: string }> }),
    userIds.size
      ? pool.query<{ id: string; display_name: string }>(
          `select id,display_name from users where id=any($1::uuid[]) and disabled_at is null`,
          [[...userIds]],
        )
      : Promise.resolve({ rows: [] as Array<{ id: string; display_name: string }> }),
  ]);
  const relationName = new Map(relationLabels.rows.map((row) => [row.id, row.display_name]));
  const userName = new Map(userLabels.rows.map((row) => [row.id, row.display_name]));
  const visibleKeys = new Set(fields.map((field) => field.key));
  const items = result.items.map((item) => {
    const values = Object.fromEntries(
      Object.entries(item.values).filter(([key]) => visibleKeys.has(key)),
    ) as Record<string, JsonValue>;
    for (const [fieldId, ids] of Object.entries(item.relations)) {
      const field = byId.get(fieldId);
      if (field) values[field.key] = ids.map((id) => relationName.get(id) ?? 'Unavailable');
    }
    for (const [fieldId, measurement] of Object.entries(item.measurements)) {
      const field = byId.get(fieldId);
      if (field)
        values[field.key] = {
          value: measurement.value,
          unit: measurement.unit,
          status: measurement.status,
        };
    }
    for (const field of fields) {
      if (field.fieldType === 'user' && typeof values[field.key] === 'string')
        values[field.key] = userName.get(String(values[field.key])) ?? 'Unavailable';
      if (field.fieldType === 'file' || field.fieldType === 'dataset') values[field.key] = null;
    }
    return {
      id: publicRecordId(context.id, item.id),
      displayName: item.displayName,
      values,
      updatedAt: item.updatedAt,
    };
  });
  await pool.query(
    `update record_view_shares set access_count=access_count+1,last_accessed_at=now()
     where id=$1 and revoked_at is null`,
    [context.id],
  );
  return {
    items,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    ...(result.groups ? { groups: result.groups } : {}),
  };
}

export async function submitPublicForm(
  pool: Pool,
  context: PublicRecordViewShareContext,
  input: PublicFormSubmission,
): Promise<PublicFormSubmissionResult> {
  if (context.viewType !== 'form')
    throw new RepositoryError(
      'SHARED_VIEW_SUBMISSION_UNSUPPORTED',
      405,
      'Only shared form views accept submissions.',
    );
  const repository = await shareRepository(pool, context);
  const fields = visibleFields(
    await repository.listFields(context.objectTypeId),
    context.viewConfig,
  );
  const unsupported = fields.find((field) => !publicFormInputTypes.has(field.fieldType));
  if (unsupported)
    throw new RepositoryError(
      'PUBLIC_FORM_FIELD_UNSUPPORTED',
      409,
      `The shared form contains an unsupported field: '${unsupported.name}'.`,
    );
  const allowedKeys = new Set(fields.map((field) => field.key));
  const unknownKey = Object.keys(input.values).find((key) => !allowedKeys.has(key));
  if (unknownKey)
    throw new RepositoryError(
      'PUBLIC_FORM_FIELD_NOT_VISIBLE',
      400,
      `Field '${unknownKey}' is not available in this public form.`,
    );
  return repository.submitPublicForm({
    objectTypeId: context.objectTypeId,
    displayName: input.displayName,
    values: input.values,
    requestId: input.requestId,
    shareId: context.id,
    recordViewId: context.recordViewId,
    idempotencyHash: input.idempotencyHash,
    requestHash: input.requestHash,
    networkFingerprint: input.networkFingerprint,
  });
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

export async function exportPublicSharedViewCsv(
  pool: Pool,
  context: PublicRecordViewShareContext,
): Promise<string> {
  if (context.viewType === 'form')
    throw new RepositoryError(
      'SHARED_VIEW_EXPORT_UNSUPPORTED',
      405,
      'Public form submissions cannot be exported from the public link.',
    );
  if (!context.allowDownload)
    throw new RepositoryError('SHARED_VIEW_DOWNLOAD_DISABLED', 403, 'Download is disabled.');
  const metadata = await getPublicSharedViewMetadata(pool, context, true);
  const fields = metadata.view?.fields ?? [];
  const first = await queryPublicSharedViewRecords(pool, context, { page: 1, pageSize: 500 }, 500);
  if (first.total > MAX_PUBLIC_EXPORT_ROWS)
    throw new RepositoryError(
      'SHARED_VIEW_EXPORT_TOO_LARGE',
      413,
      `Shared view exports are limited to ${MAX_PUBLIC_EXPORT_ROWS} records.`,
    );
  const items = [...first.items];
  const pages = Math.ceil(first.total / first.pageSize);
  for (let page = 2; page <= pages; page += 1) {
    const next = await queryPublicSharedViewRecords(pool, context, { page, pageSize: 500 }, 500);
    items.push(...next.items);
  }
  const lines = [
    ['displayName', ...fields.map((field) => field.name)].map(csvCell).join(','),
    ...items.map((item) =>
      [item.displayName, ...fields.map((field) => item.values[field.key])].map(csvCell).join(','),
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export function recordViewShareTokenDigest(token: string): string {
  return digest(token);
}
