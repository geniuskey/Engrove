import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ApiCreatedResponse,
  ApiAcceptedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  configurableFieldTypes,
  resolveObjectTypeIdentifier,
  resolveProjectIdentifier,
  resolveRecordViewIdentifier,
  resolveWorkspaceIdentifier,
  ScopedProjectRepository,
  type JsonValue,
  type RecordQuery,
  type RecordViewConfig,
  type RecordViewPermissionType,
  type RecordViewType,
} from '@engrove/database';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import { ApiTableResourceParams, ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,63}$/);
const jsonObject = z.record(z.string(), z.unknown());
const relationMap = z.record(z.string().uuid(), z.array(z.string().uuid()).max(100));
const fieldType = z.enum(configurableFieldTypes);
const csvTargetFieldKey = z.union([key, z.literal('displayName')]);
const recordViewType = z.enum(['grid', 'form', 'gallery', 'kanban', 'calendar']);
const recordViewPermissionType = z.enum(['collaborative', 'personal', 'locked']);
const recordFilter = z.object({
  fieldId: id,
  operator: z.enum(['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'is_null']),
  value: z.unknown().optional(),
});
const recordSort = z
  .object({
    fieldId: id.optional(),
    systemField: z.enum(['displayName', 'createdAt', 'updatedAt']).optional(),
    direction: z.enum(['asc', 'desc']),
  })
  .refine((sort) => Number(Boolean(sort.fieldId)) + Number(Boolean(sort.systemField)) === 1);
const recordSummary = z.object({
  fieldId: id,
  operation: z.enum(['count', 'sum', 'average', 'min', 'max']),
});
const recordSummaries = z
  .array(recordSummary)
  .max(50)
  .refine(
    (summaries) => new Set(summaries.map((summary) => summary.fieldId)).size === summaries.length,
    {
      message: 'A field can have only one summary.',
    },
  );
const recordGrouping = z.object({
  fieldId: id,
  direction: z.enum(['asc', 'desc']),
  enabled: z.boolean().default(true),
});
const recordGroupings = z
  .array(recordGrouping)
  .max(3)
  .refine(
    (groupings) => new Set(groupings.map((grouping) => grouping.fieldId)).size === groupings.length,
    { message: 'Grouping fields must be unique.' },
  );
const recordViewConfig = z
  .object({
    visibleFieldIds: z
      .array(id)
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length),
    fieldWidths: z
      .record(id, z.number().int().min(80).max(800))
      .refine((widths) => Object.keys(widths).length <= 200),
    systemFieldWidths: z
      .record(
        z.enum(['displayName', 'contextProject', 'updatedAt']),
        z.number().int().min(80).max(800),
      )
      .optional(),
    filters: z.array(recordFilter).max(20),
    sorts: z.array(recordSort).max(5),
    rowDensity: z.enum(['compact', 'comfortable']),
    pageSize: z.union([
      z.literal(25),
      z.literal(50),
      z.literal(100),
      z.literal(250),
      z.literal(500),
    ]),
    groupings: recordGroupings.optional(),
    summaries: recordSummaries.optional(),
    viewOptions: z
      .object({
        groupFieldId: id.optional(),
        dateFieldId: id.optional(),
        contextProjectId: id.nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const createObjectTypeInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    pluralName: z.string().trim().min(1).max(120),
    key,
    icon: z.string().trim().min(1).max(64).optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();
const updateObjectTypeInput = createObjectTypeInput
  .omit({ icon: true })
  .extend({ description: z.string().max(2000) })
  .strict();
const objectTypeListInput = z.object({
  query: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const pageInfoResponse = z.object({
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean(),
});
const recordHistoryListInput = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const recordCommentListInput = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const recordReferenceListInput = z.object({
  query: z.string().trim().max(120).default(''),
  ids: z.array(id).max(100).default([]),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const recordViewListInput = z.object({
  query: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const createFieldInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    key,
    description: z.string().max(2000).optional(),
    fieldType,
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    position: z.number().int().min(0).max(10_000).optional(),
    config: jsonObject.optional(),
    defaultValue: z.unknown().optional(),
  })
  .strict();
const reorderFieldsInput = z
  .object({
    fieldIds: z
      .array(id)
      .min(1)
      .max(1_000)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Field IDs must be unique.',
      }),
  })
  .strict();
const updateFieldInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000),
    required: z.boolean(),
    unique: z.boolean(),
    position: z.number().int().min(0).max(10_000),
    config: jsonObject,
  })
  .strict();
const createViewInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    viewType: recordViewType.default('grid'),
    permissionType: recordViewPermissionType.default('collaborative'),
    lockReason: z.string().trim().max(500).optional(),
    config: recordViewConfig,
  })
  .strict();
const updateViewInput = createViewInput
  .omit({ permissionType: true, lockReason: true })
  .extend({ viewType: recordViewType, rowVersion: z.number().int().positive() })
  .strict();
const updateViewPermissionInput = z
  .object({
    permissionType: recordViewPermissionType,
    lockReason: z.string().trim().max(500).optional(),
    rowVersion: z.number().int().positive(),
  })
  .strict();
const archiveViewInput = z
  .object({
    rowVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
const recordQueryInput = z.object({
  fields: z
    .array(key)
    .min(1)
    .max(200)
    .refine((keys) => new Set(keys).size === keys.length, {
      message: 'Selected field keys must be unique.',
    })
    .optional(),
  filters: z.array(recordFilter).max(20).optional(),
  sorts: z.array(recordSort).max(5).optional(),
  search: z.string().trim().max(200).optional(),
  contextProjectId: id.nullable().optional(),
  groupByFieldId: id.optional(),
  groupings: recordGroupings.optional(),
  summaries: recordSummaries.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
  includeArchived: z.boolean().optional(),
  archiveState: z.enum(['active', 'archived', 'all']).optional(),
});
const recordExportInput = z
  .object({
    fieldKeys: z
      .array(key)
      .max(200)
      .refine((keys) => new Set(keys).size === keys.length, {
        message: 'Export field keys must be unique.',
      })
      .optional(),
    filters: recordQueryInput.shape.filters,
    sorts: recordQueryInput.shape.sorts,
    search: recordQueryInput.shape.search,
    contextProjectId: recordQueryInput.shape.contextProjectId,
    archiveState: recordQueryInput.shape.archiveState,
  })
  .strict();
const recordExportListInput = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const createRecordInput = z.object({
  displayName: z.string().trim().min(1).max(240),
  contextProjectId: id.nullable().optional(),
  values: jsonObject,
  relations: relationMap.optional(),
  fileReferences: relationMap.optional(),
  datasetReferences: relationMap.optional(),
});
const updateRecordInput = createRecordInput.extend({ rowVersion: z.number().int().positive() });
const bulkCreateRecordsInput = z
  .object({ items: z.array(createRecordInput).min(1).max(100) })
  .strict();
const bulkUpdateRecordsInput = z
  .object({
    items: z
      .array(updateRecordInput.extend({ id }))
      .min(1)
      .max(100)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
        message: 'A record can appear only once in a bulk update.',
      }),
  })
  .strict();
const bulkUpdateRecordFieldsInput = z
  .object({
    records: z
      .array(z.object({ id, rowVersion: z.number().int().positive() }).strict())
      .min(1)
      .max(100)
      .refine((records) => new Set(records.map((record) => record.id)).size === records.length, {
        message: 'A record can appear only once in a bulk update.',
      }),
    changes: z
      .array(
        z
          .object({
            fieldKey: key,
            operation: z.enum(['set', 'clear']),
            value: z.unknown().optional(),
          })
          .strict()
          .superRefine((change, context) => {
            if (change.operation === 'set' && change.value === undefined)
              context.addIssue({
                code: 'custom',
                message: 'A set operation requires a value.',
                path: ['value'],
              });
            if (change.operation === 'clear' && change.value !== undefined)
              context.addIssue({
                code: 'custom',
                message: 'A clear operation cannot include a value.',
                path: ['value'],
              });
          }),
      )
      .min(1)
      .max(20)
      .refine(
        (changes) => new Set(changes.map((change) => change.fieldKey)).size === changes.length,
        { message: 'A field can appear only once in a bulk update.' },
      ),
  })
  .strict();
const bulkCreateRecordsResponse = z.object({
  created: z.array(z.object({ id, rowVersion: z.number().int().positive() })),
  idempotentReplay: z.boolean(),
});
const bulkUpdateRecordsResponse = z.object({
  updated: z.array(z.object({ id, rowVersion: z.number().int().positive() })),
});
const bulkArchiveRecordsInput = z
  .object({
    ids: z
      .array(id)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'A record can appear only once in a bulk lifecycle request.',
      }),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
const bulkRestoreRecordsInput = bulkArchiveRecordsInput.omit({ reason: true });
const bulkLifecycleRecordsResponse = z.object({
  updated: z.array(z.object({ id, rowVersion: z.number().int().positive() })),
  archived: z.boolean(),
});
const csvImportMapping = z
  .object({
    sourceHeader: z.string().trim().min(1).max(200),
    targetFieldKey: csvTargetFieldKey.nullable(),
  })
  .strict();
const previewCsvInput = z.object({ csv: z.string().min(1) }).strict();
const importCsvInput = z
  .object({
    csv: z.string().min(1),
    mappings: z.array(csvImportMapping).min(1).max(500).optional(),
    duplicateStrategy: z.enum(['allow', 'skip', 'update']).default('allow'),
    uniqueFieldKey: key.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.duplicateStrategy !== 'allow' && !value.uniqueFieldKey)
      context.addIssue({
        code: 'custom',
        path: ['uniqueFieldKey'],
        message: 'A unique match field is required for skip or update.',
      });
  });
const undoRecordChangeInput = z.object({ rowVersion: z.number().int().positive() }).strict();
const recordCommentMentionIds = z
  .array(id)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'A user can be mentioned only once.',
  });
const createRecordCommentInput = z
  .object({
    body: z.string().trim().min(1).max(10_000),
    mentionedUserIds: recordCommentMentionIds.default([]),
  })
  .strict();
const updateRecordCommentInput = createRecordCommentInput
  .extend({
    mentionedUserIds: recordCommentMentionIds.optional(),
    rowVersion: z.number().int().positive(),
  })
  .strict();
const archiveRecordInput = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
const recordReferenceResponse = z.object({
  id,
  displayName: z.string(),
  archivedAt: z.string().nullable(),
});
const recordResponse = z
  .object({
    id,
    projectId: id,
    objectTypeId: id,
    contextProjectId: id.nullable(),
    displayName: z.string(),
    values: jsonObject,
    relations: relationMap,
    relationLabels: z.record(id, z.array(recordReferenceResponse).max(100)),
    referenceLabels: z.record(id, z.array(recordReferenceResponse).max(100)),
    fileReferences: relationMap,
    datasetReferences: relationMap,
    measurements: z.record(
      z.string().uuid(),
      z.object({
        resultId: id.nullable(),
        value: z.string().nullable(),
        unit: z.string().nullable(),
        status: z.string().nullable(),
      }),
    ),
    rowVersion: z.number().int().positive(),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();
const objectTypeResponse = z.object({
  id,
  publicId: z.string(),
  projectId: id,
  name: z.string(),
  pluralName: z.string(),
  key,
  icon: z.string(),
  description: z.string(),
  system: z.boolean(),
  recordPermissions: z.object({
    canCreate: z.boolean(),
    canUpdate: z.boolean(),
    canArchive: z.boolean(),
  }),
});
const tablePermissionMode = z.enum([
  'everyone',
  'editors',
  'engineers',
  'administrators',
  'specific',
  'nobody',
]);
const tablePermissionAction = z.enum(['visibility', 'create', 'update', 'archive']);
const tablePermissionSubjects = z
  .object({
    userIds: z.array(id).max(100),
    groupIds: z.array(id).max(100),
  })
  .strict();
const tablePermissionModes = z
  .object({
    visibility: tablePermissionMode,
    create: tablePermissionMode,
    update: tablePermissionMode,
    archive: tablePermissionMode,
  })
  .strict();
const tablePermissionSubjectMap = z
  .object({
    visibility: tablePermissionSubjects,
    create: tablePermissionSubjects,
    update: tablePermissionSubjects,
    archive: tablePermissionSubjects,
  })
  .strict();
const tablePermissionConfiguration = z.object({
  modes: tablePermissionModes,
  subjects: tablePermissionSubjectMap,
  subjectDirectory: z.object({
    members: z.array(z.object({ id, displayName: z.string(), email: z.string() })),
    groups: z.array(z.object({ id, name: z.string() })),
  }),
  rowVersion: z.number().int().positive(),
});
const updateTablePermissionsInput = tablePermissionConfiguration
  .pick({ modes: true, subjects: true, rowVersion: true })
  .superRefine((value, context) => {
    for (const action of tablePermissionAction.options) {
      const subjects = value.subjects[action];
      if (new Set(subjects.userIds).size !== subjects.userIds.length)
        context.addIssue({
          code: 'custom',
          path: ['subjects', action, 'userIds'],
          message: 'Duplicate member.',
        });
      if (new Set(subjects.groupIds).size !== subjects.groupIds.length)
        context.addIssue({
          code: 'custom',
          path: ['subjects', action, 'groupIds'],
          message: 'Duplicate group.',
        });
      if (
        value.modes[action] === 'specific' &&
        !subjects.userIds.length &&
        !subjects.groupIds.length
      )
        context.addIssue({
          code: 'custom',
          path: ['subjects', action],
          message: 'Specific access requires a member or group.',
        });
    }
  });
const fieldResponse = z.object({
  id,
  projectId: id,
  objectTypeId: id,
  name: z.string(),
  key,
  description: z.string(),
  fieldType,
  required: z.boolean(),
  unique: z.boolean(),
  position: z.number().int().nonnegative(),
  config: jsonObject,
  defaultValue: z.unknown().optional(),
  system: z.boolean(),
  projectionStatus: z.enum(['ready', 'rebuilding', 'failed']),
  projectionVersion: z.number().int().positive(),
});
const recordViewResponse = z.object({
  id,
  publicId: z.string(),
  projectId: id,
  objectTypeId: id,
  name: z.string(),
  viewType: recordViewType,
  permissionType: recordViewPermissionType,
  ownerId: id.nullable(),
  lockReason: z.string().nullable(),
  config: recordViewConfig,
  rowVersion: z.number().int().positive(),
  createdBy: id,
  updatedBy: id,
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const recordHistoryResponse = z.object({
  id,
  action: z.string(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
  rowVersion: z.number().int().positive().nullable(),
  undoable: z.boolean(),
});
const recordCommentResponse = z.object({
  id,
  authorId: id,
  authorName: z.string(),
  body: z.string(),
  mentionedUserIds: recordCommentMentionIds,
  mentionedUsers: z.array(z.object({ id, displayName: z.string() })).max(50),
  rowVersion: z.number().int().positive(),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
});
const csvImportResponse = z.object({
  imported: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  createdIds: z.array(id),
  updatedIds: z.array(id),
  errors: z.array(
    z.object({
      row: z.number().int().positive(),
      field: z.string().optional(),
      reason: z.string(),
    }),
  ),
  errorsTruncated: z.boolean(),
  idempotentReplay: z.boolean(),
});
const csvImportPreviewResponse = z.object({
  headers: z.array(z.string()).max(500),
  totalRows: z.number().int().nonnegative(),
  sampleRows: z.array(z.record(z.string(), z.string())).max(3),
  targetFields: z.array(
    z.object({
      key: csvTargetFieldKey,
      name: z.string(),
      fieldType: z.enum([...configurableFieldTypes, 'display_name']),
      required: z.boolean(),
      unique: z.boolean(),
      supported: z.boolean(),
    }),
  ),
  suggestedMappings: z.array(csvImportMapping),
});
const templateInstallResponse = z.object({
  templateKey: z.literal('test-characterization'),
  version: z.number().int().positive(),
  changed: z.boolean(),
  objectTypes: z.array(objectTypeResponse),
});
const schemaCatalogResponse = z.object({
  workspaceId: id,
  projectId: id,
  tables: z.array(objectTypeResponse.extend({ fields: z.array(fieldResponse) })).max(100),
  pageInfo: pageInfoResponse,
});
const recordExportJobResponse = z.object({
  id,
  objectTypeId: id,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'expired']),
  progress: z.number().int().min(0).max(100),
  rowCount: z.number().int().nonnegative().nullable(),
  fieldCount: z.number().int().nonnegative().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  fileName: z.string(),
  errorCode: z.string().nullable(),
  retryable: z.boolean(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  downloadReady: z.boolean(),
});
const recordExportPageResponse = z.object({
  items: z.array(recordExportJobResponse).max(50),
  pageInfo: pageInfoResponse,
});
const signedRecordExportResponse = z.object({
  url: z.string().url(),
  expiresIn: z.literal(300),
  fileName: z.string(),
});

async function repository(
  runtime: Runtime,
  request: Request,
  workspaceId: string,
  projectId: string,
  action:
    | 'schema.read'
    | 'schema.manage'
    | 'table.permission.manage'
    | 'view.manage'
    | 'record.read'
    | 'record.create'
    | 'record.comment'
    | 'record.update'
    | 'record.archive'
    | 'record.restore'
    | 'export.execute',
  csrf = false,
): Promise<ScopedProjectRepository> {
  const actor = await requireActor(runtime, request, action, csrf);
  return ScopedProjectRepository.open(
    runtime.pool,
    actor,
    await resolveWorkspaceIdentifier(runtime.pool, workspaceId),
    await resolveProjectIdentifier(runtime.pool, projectId),
  );
}

@ApiTags('Programmable data')
@Controller('api/v1/workspaces/:workspaceId/projects/:projectId')
export class ConfigurableDataController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0, maximum: 1_000_000 })
  @ApiOkResponse({ schema: openApiSchema(schemaCatalogResponse) })
  @Get('schema')
  async schemaCatalog(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query() raw: unknown,
  ) {
    const input = objectTypeListInput.parse(raw);
    const scoped = await repository(this.runtime, request, workspaceId, projectId, 'schema.read');
    const catalog = await scoped.getSchemaCatalog(input);
    return {
      workspaceId: scoped.scope.workspaceId,
      projectId: scoped.scope.projectId,
      ...catalog,
    };
  }

  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiOkResponse({
    schema: openApiSchema(
      z.object({
        items: z.array(objectTypeResponse).max(100),
        pageInfo: pageInfoResponse,
      }),
    ),
  })
  @Get('object-types')
  async objectTypes(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const input = objectTypeListInput.parse({ query, limit, offset });
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'schema.read')
    ).listObjectTypePage(input);
  }

  @ApiOkResponse({ schema: openApiSchema(objectTypeResponse) })
  @Get('object-types/:objectTypeId')
  async objectType(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'schema.read')
    ).getObjectType(await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId));
  }

  @ApiZodBody(createObjectTypeInput, 'Create a configurable table in this project.', {
    name: 'Sample',
    pluralName: 'Samples',
    key: 'sample',
  })
  @ApiCreatedResponse({ schema: openApiSchema(objectTypeResponse) })
  @Post('object-types')
  async createObjectType(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() unparsed: unknown,
  ) {
    const body = createObjectTypeInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'schema.manage', true)
    ).createObjectType({
      name: body.name,
      pluralName: body.pluralName,
      key: body.key,
      icon: body.icon ?? 'table',
      description: body.description ?? '',
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(updateObjectTypeInput, 'Replace the editable table metadata.')
  @ApiOkResponse({ schema: openApiSchema(objectTypeResponse) })
  @Patch('object-types/:objectTypeId')
  async updateObjectType(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = updateObjectTypeInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'schema.manage', true)
    ).updateObjectType({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      name: body.name,
      pluralName: body.pluralName,
      key: body.key,
      description: body.description,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiOkResponse({ schema: openApiSchema(tablePermissionConfiguration) })
  @Get('object-types/:objectTypeId/permissions')
  async objectTypePermissions(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'table.permission.manage')
    ).getObjectTypePermissions(await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId));
  }

  @ApiTableResourceParams()
  @ApiZodBody(
    updateTablePermissionsInput,
    'Replace table visibility and record-action policies using optimistic concurrency.',
  )
  @ApiOkResponse({ schema: openApiSchema(tablePermissionConfiguration) })
  @Patch('object-types/:objectTypeId/permissions')
  async updateObjectTypePermissions(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = updateTablePermissionsInput.parse(unparsed);
    return (
      await repository(
        this.runtime,
        request,
        workspaceId,
        projectId,
        'table.permission.manage',
        true,
      )
    ).updateObjectTypePermissions({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      modes: body.modes,
      subjects: body.subjects,
      rowVersion: body.rowVersion,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiOkResponse({ schema: openApiSchema(z.object({ items: z.array(fieldResponse) })) })
  @Get('object-types/:objectTypeId/fields')
  async fields(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
  ) {
    return {
      items: await (
        await repository(this.runtime, request, workspaceId, projectId, 'schema.read')
      ).listFields(await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId)),
    };
  }

  @ApiTableResourceParams()
  @ApiZodBody(createFieldInput, 'Create a typed field in the table.', {
    name: 'Serial number',
    key: 'serial-number',
    fieldType: 'text',
    required: true,
  })
  @ApiCreatedResponse({ schema: openApiSchema(fieldResponse) })
  @Post('object-types/:objectTypeId/fields')
  async createField(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = createFieldInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'schema.manage', true)
    ).createField({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      name: body.name,
      key: body.key,
      description: body.description ?? '',
      fieldType: body.fieldType,
      required: body.required ?? false,
      unique: body.unique ?? false,
      position: body.position ?? 0,
      config: (body.config ?? {}) as Record<string, JsonValue>,
      ...(body.defaultValue === undefined ? {} : { defaultValue: body.defaultValue as JsonValue }),
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(
    reorderFieldsInput,
    'Replace the complete field order. Every active field ID must appear exactly once.',
  )
  @ApiOkResponse({ schema: openApiSchema(z.object({ items: z.array(fieldResponse) })) })
  @Patch('object-types/:objectTypeId/fields-order')
  async reorderFields(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = reorderFieldsInput.parse(unparsed);
    return {
      items: await (
        await repository(this.runtime, request, workspaceId, projectId, 'schema.manage', true)
      ).reorderFields({
        objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
        fieldIds: body.fieldIds,
        requestId: requestId(request),
      }),
    };
  }

  @ApiTableResourceParams()
  @ApiZodBody(updateFieldInput, 'Replace editable field settings while preserving its stable key.')
  @ApiOkResponse({ schema: openApiSchema(fieldResponse) })
  @Patch('object-types/:objectTypeId/fields/:fieldId')
  async updateField(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('fieldId') fieldId: string,
    @Body() unparsed: unknown,
  ) {
    const body = updateFieldInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'schema.manage', true)
    ).updateField({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      fieldId: id.parse(fieldId),
      ...body,
      config: body.config as Record<string, JsonValue>,
      requestId: requestId(request),
    });
  }

  @ApiCreatedResponse({ schema: openApiSchema(templateInstallResponse) })
  @Post('templates/test-characterization/install')
  async installTemplate(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'schema.manage', true)
    ).installTestCharacterizationTemplate(requestId(request));
  }

  @ApiTableResourceParams()
  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiOkResponse({
    schema: openApiSchema(
      z.object({ items: z.array(recordViewResponse).max(100), pageInfo: pageInfoResponse }),
    ),
  })
  @Get('object-types/:objectTypeId/views')
  async views(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const input = recordViewListInput.parse({ query, limit, offset });
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'schema.read')
    ).listRecordViewPage(await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId), input);
  }

  @ApiTableResourceParams()
  @ApiOkResponse({ schema: openApiSchema(recordViewResponse) })
  @Get('object-types/:objectTypeId/views/:viewId')
  async view(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('viewId') viewId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'schema.read')
    ).getRecordView(
      await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      await resolveRecordViewIdentifier(this.runtime.pool, viewId),
    );
  }

  @ApiTableResourceParams()
  @ApiZodBody(createViewInput, 'Create a saved table view with bounded filters and layout.', {
    name: 'Ready samples',
    viewType: 'grid',
    config: {
      visibleFieldIds: [],
      fieldWidths: {},
      filters: [],
      sorts: [],
      rowDensity: 'compact',
      pageSize: 50,
    },
  })
  @ApiCreatedResponse({ schema: openApiSchema(recordViewResponse) })
  @Post('object-types/:objectTypeId/views')
  async createView(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = createViewInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'view.manage', true)
    ).createRecordView({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      name: body.name,
      viewType: body.viewType as RecordViewType,
      permissionType: body.permissionType as RecordViewPermissionType,
      ...(body.lockReason === undefined ? {} : { lockReason: body.lockReason }),
      config: body.config as RecordViewConfig,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(updateViewInput, 'Replace a saved view using its last-read row version.')
  @ApiOkResponse({ schema: openApiSchema(recordViewResponse) })
  @Patch('object-types/:objectTypeId/views/:viewId')
  async updateView(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('viewId') viewId: string,
    @Body() unparsed: unknown,
  ) {
    const body = updateViewInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'view.manage', true)
    ).updateRecordView({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      viewId: await resolveRecordViewIdentifier(this.runtime.pool, viewId),
      name: body.name,
      viewType: body.viewType as RecordViewType,
      config: body.config as RecordViewConfig,
      rowVersion: body.rowVersion,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(
    updateViewPermissionInput,
    'Change a view between collaborative, personal, and locked modes using optimistic concurrency.',
  )
  @ApiOkResponse({ schema: openApiSchema(recordViewResponse) })
  @Patch('object-types/:objectTypeId/views/:viewId/permission')
  async updateViewPermission(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('viewId') viewId: string,
    @Body() unparsed: unknown,
  ) {
    const body = updateViewPermissionInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'view.manage', true)
    ).setRecordViewPermission({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      viewId: await resolveRecordViewIdentifier(this.runtime.pool, viewId),
      permissionType: body.permissionType as RecordViewPermissionType,
      ...(body.lockReason === undefined ? {} : { lockReason: body.lockReason }),
      rowVersion: body.rowVersion,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(archiveViewInput, 'Archive a saved view using optimistic concurrency.')
  @ApiCreatedResponse({ schema: openApiSchema(recordViewResponse) })
  @Post('object-types/:objectTypeId/views/:viewId/archive')
  async archiveView(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('viewId') viewId: string,
    @Body() unparsed: unknown,
  ) {
    const body = archiveViewInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'view.manage', true)
    ).setRecordViewArchived({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      viewId: await resolveRecordViewIdentifier(this.runtime.pool, viewId),
      archived: true,
      rowVersion: body.rowVersion,
      reason: body.reason,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(
    recordQueryInput,
    'Bounded typed filters, sorts, search, grouping with per-group summaries, full-filter field summaries, pagination, and optional field-key projection.',
    {
      fields: ['serial-number', 'status'],
      groupings: [
        {
          fieldId: '019fbcf9-e020-71da-935a-6a6a728b3794',
          direction: 'asc',
          enabled: true,
        },
      ],
      summaries: [
        {
          fieldId: '019fbcf9-e020-71da-935a-6a6a728b3795',
          operation: 'average',
        },
      ],
      page: 1,
      pageSize: 50,
    },
  )
  @ApiOkResponse({
    schema: openApiSchema(
      z.object({
        items: z.array(recordResponse),
        page: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        total: z.number().int().nonnegative(),
        groups: z.array(z.record(z.string(), z.unknown())).optional(),
        groupHierarchy: z
          .array(
            z.object({
              level: z.number().int().min(1).max(3),
              fieldId: id,
              path: z.array(z.object({ fieldId: id, value: z.string().nullable() })).max(3),
              count: z.number().int().nonnegative(),
              summaries: z
                .array(
                  recordSummary.extend({
                    value: z.string().nullable(),
                    unit: z.string().nullable(),
                  }),
                )
                .optional(),
            }),
          )
          .optional(),
        summaries: z
          .array(
            recordSummary.extend({
              value: z.string().nullable(),
              unit: z.string().nullable(),
            }),
          )
          .optional(),
      }),
    ),
  })
  @HttpCode(200)
  @Post('object-types/:objectTypeId/records/query')
  async queryRecords(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = recordQueryInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.read')
    ).queryRecords(
      await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      body as RecordQuery,
    );
  }

  @ApiZodBody(
    recordExportInput,
    'Export every record in an explicit filtered scope with selected fields.',
    {
      fieldKeys: ['serial-number', 'status'],
      filters: [
        {
          fieldId: '019fbcf9-e020-71da-935a-6a6a728b3794',
          operator: 'eq',
          value: 'ready',
        },
      ],
      sorts: [{ systemField: 'displayName', direction: 'asc' }],
      archiveState: 'active',
    },
  )
  @ApiProduces('text/csv')
  @ApiTableResourceParams()
  @ApiOkResponse({
    description:
      'RFC 4180-style CSV export of the complete filtered record scope and requested fields.',
    schema: { type: 'string', format: 'binary' },
  })
  @HttpCode(200)
  @Post('object-types/:objectTypeId/records/export.csv')
  async exportRecordScopeCsv(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = recordExportInput.parse(unparsed);
    const csv = await (
      await repository(this.runtime, request, workspaceId, projectId, 'export.execute', true)
    ).exportRecordsCsv(
      await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      requestId(request),
      {
        ...(body.fieldKeys ? { fields: body.fieldKeys } : {}),
        ...(body.filters ? { filters: body.filters } : {}),
        ...(body.sorts ? { sorts: body.sorts } : {}),
        ...(body.search ? { search: body.search } : {}),
        ...(body.contextProjectId !== undefined ? { contextProjectId: body.contextProjectId } : {}),
        ...(body.archiveState ? { archiveState: body.archiveState } : {}),
      } as RecordQuery,
    );
    response
      .type('text/csv')
      .setHeader('content-disposition', 'attachment; filename="engrove-records.csv"');
    return csv;
  }

  @ApiZodBody(
    recordExportInput,
    'Queue a private, six-hour CSV artifact for the complete filtered record scope.',
    {
      fieldKeys: ['serial-number', 'status'],
      filters: [],
      sorts: [{ systemField: 'displayName', direction: 'asc' }],
      archiveState: 'active',
    },
  )
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiTableResourceParams()
  @ApiAcceptedResponse({ schema: openApiSchema(recordExportJobResponse) })
  @HttpCode(202)
  @Post('object-types/:objectTypeId/records/exports')
  async requestRecordExport(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() unparsed: unknown,
  ) {
    const body = recordExportInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'export.execute', true)
    ).requestRecordExport(
      await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      requestId(request),
      z.string().min(8).max(200).parse(idempotencyKey),
      {
        ...(body.fieldKeys ? { fields: body.fieldKeys } : {}),
        ...(body.filters ? { filters: body.filters } : {}),
        ...(body.sorts ? { sorts: body.sorts } : {}),
        ...(body.search ? { search: body.search } : {}),
        ...(body.contextProjectId !== undefined ? { contextProjectId: body.contextProjectId } : {}),
        ...(body.archiveState ? { archiveState: body.archiveState } : {}),
      } as RecordQuery,
    );
  }

  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiTableResourceParams()
  @ApiOkResponse({ schema: openApiSchema(recordExportPageResponse) })
  @Get('object-types/:objectTypeId/records/exports')
  async recordExports(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const input = recordExportListInput.parse({ limit, offset });
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'export.execute')
    ).listRecordExports(await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId), input);
  }

  @ApiTableResourceParams()
  @ApiOkResponse({ schema: openApiSchema(recordExportJobResponse) })
  @Get('object-types/:objectTypeId/records/exports/:exportId')
  async recordExport(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('exportId') exportId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'export.execute')
    ).getRecordExport(
      await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      id.parse(exportId),
    );
  }

  @ApiTableResourceParams()
  @ApiOkResponse({ schema: openApiSchema(signedRecordExportResponse) })
  @Get('object-types/:objectTypeId/records/exports/:exportId/download')
  async downloadRecordExport(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('exportId') exportId: string,
  ) {
    const artifact = await (
      await repository(this.runtime, request, workspaceId, projectId, 'export.execute')
    ).getRecordExportArtifact(
      await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      id.parse(exportId),
    );
    return {
      url: await getSignedUrl(
        this.runtime.s3Public,
        new GetObjectCommand({
          Bucket: this.runtime.config.S3_BUCKET,
          Key: artifact.objectKey,
          VersionId: artifact.storageVersionId ?? undefined,
          ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`,
          ResponseContentType: 'text/csv',
        }),
        { expiresIn: 300 },
      ),
      expiresIn: 300,
      fileName: artifact.fileName,
    };
  }

  @ApiTableResourceParams()
  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({
    name: 'ids',
    required: false,
    type: String,
    description: 'Comma-separated record UUIDs to resolve, including archived existing links.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({
    schema: openApiSchema(
      z.object({ items: z.array(recordReferenceResponse).max(100), pageInfo: pageInfoResponse }),
    ),
  })
  @Get('object-types/:objectTypeId/record-references')
  async recordReferences(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Query('query') query?: string,
    @Query('ids') rawIds?: string | string[],
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const ids = (Array.isArray(rawIds) ? rawIds : rawIds ? [rawIds] : []).flatMap((value) =>
      value
        .split(',')
        .map((candidate) => candidate.trim())
        .filter(Boolean),
    );
    const input = recordReferenceListInput.parse({ query, ids, limit, offset });
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.read')
    ).listRecordReferencePage(
      await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      input,
    );
  }

  @ApiTableResourceParams()
  @ApiOkResponse({ schema: openApiSchema(recordResponse) })
  @Get('object-types/:objectTypeId/records/:recordId')
  async record(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.read')
    ).getRecord(
      await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      id.parse(recordId),
    );
  }

  @ApiTableResourceParams()
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({
    schema: openApiSchema(
      z.object({
        items: z.array(recordCommentResponse).max(100),
        pageInfo: pageInfoResponse,
      }),
    ),
  })
  @Get('object-types/:objectTypeId/records/:recordId/comments')
  async recordComments(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.read')
    ).listRecordCommentPage(
      await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      id.parse(recordId),
      recordCommentListInput.parse({ limit, offset }),
    );
  }

  @ApiTableResourceParams()
  @ApiZodBody(createRecordCommentInput, 'Add an auditable comment to an active record.')
  @ApiCreatedResponse({ schema: openApiSchema(recordCommentResponse) })
  @Post('object-types/:objectTypeId/records/:recordId/comments')
  async createRecordComment(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
    @Body() unparsed: unknown,
  ) {
    const body = createRecordCommentInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.comment', true)
    ).addRecordComment({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      recordId: id.parse(recordId),
      body: body.body,
      mentionedUserIds: body.mentionedUserIds,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(
    updateRecordCommentInput,
    'Replace an authored comment using its last-read row version.',
  )
  @ApiOkResponse({ schema: openApiSchema(recordCommentResponse) })
  @Patch('object-types/:objectTypeId/records/:recordId/comments/:commentId')
  async updateRecordComment(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
    @Param('commentId') commentId: string,
    @Body() unparsed: unknown,
  ) {
    const body = updateRecordCommentInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.comment', true)
    ).updateRecordComment({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      recordId: id.parse(recordId),
      commentId: id.parse(commentId),
      body: body.body,
      ...(body.mentionedUserIds !== undefined ? { mentionedUserIds: body.mentionedUserIds } : {}),
      rowVersion: body.rowVersion,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({
    schema: openApiSchema(
      z.object({
        items: z.array(recordHistoryResponse).max(100),
        pageInfo: pageInfoResponse,
      }),
    ),
  })
  @Get('object-types/:objectTypeId/records/:recordId/history')
  async recordHistory(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.read')
    ).listRecordHistoryPage(
      await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      id.parse(recordId),
      recordHistoryListInput.parse({ limit, offset }),
    );
  }

  @ApiTableResourceParams()
  @ApiZodBody(
    undoRecordChangeInput,
    'Restore the selected history snapshot if the record is unchanged.',
  )
  @ApiCreatedResponse({ schema: openApiSchema(recordResponse) })
  @Post('object-types/:objectTypeId/records/:recordId/history/:eventId/undo')
  async undoRecordChange(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
    @Param('eventId') eventId: string,
    @Body() unparsed: unknown,
  ) {
    const body = undoRecordChangeInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.update', true)
    ).undoRecordChange({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      recordId: id.parse(recordId),
      eventId: id.parse(eventId),
      rowVersion: body.rowVersion,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(
    bulkArchiveRecordsInput,
    'Archive 1–100 active records atomically while preserving audit and webhook events.',
  )
  @ApiOkResponse({ schema: openApiSchema(bulkLifecycleRecordsResponse) })
  @Post('object-types/:objectTypeId/records/bulk/archive')
  async archiveRecordsBulk(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = bulkArchiveRecordsInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.archive', true)
    ).setRecordsArchivedBulk({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      recordIds: body.ids,
      archived: true,
      reason: body.reason,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(
    bulkRestoreRecordsInput,
    'Restore 1–100 archived records atomically while preserving audit and webhook events.',
  )
  @ApiOkResponse({ schema: openApiSchema(bulkLifecycleRecordsResponse) })
  @Post('object-types/:objectTypeId/records/bulk/restore')
  async restoreRecordsBulk(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = bulkRestoreRecordsInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.restore', true)
    ).setRecordsArchivedBulk({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      recordIds: body.ids,
      archived: false,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiHeader({
    name: 'idempotency-key',
    required: true,
    description:
      'Caller-generated key (8–200 characters). Retrying the same batch returns the original IDs.',
  })
  @ApiZodBody(
    bulkCreateRecordsInput,
    'Create 1–100 records atomically. Any invalid item rolls back the complete batch.',
    { items: [{ displayName: 'Sample 001', values: { serial: 'SN-001' } }] },
  )
  @ApiCreatedResponse({ schema: openApiSchema(bulkCreateRecordsResponse) })
  @Post('object-types/:objectTypeId/records/bulk')
  async createRecordsBulk(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() unparsed: unknown,
  ) {
    const body = bulkCreateRecordsInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.create', true)
    ).createRecordsBulk({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      items: body.items.map((item) => ({
        ...(item.contextProjectId !== undefined ? { contextProjectId: item.contextProjectId } : {}),
        displayName: item.displayName,
        values: item.values as Record<string, JsonValue>,
        relations: item.relations ?? {},
        fileReferences: item.fileReferences ?? {},
        datasetReferences: item.datasetReferences ?? {},
      })),
      idempotencyKey: z.string().min(8).max(200).parse(idempotencyKey),
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(
    bulkUpdateRecordsInput,
    'Replace the editable state of 1–100 records atomically using optimistic row versions.',
  )
  @ApiOkResponse({ schema: openApiSchema(bulkUpdateRecordsResponse) })
  @Patch('object-types/:objectTypeId/records/bulk')
  async updateRecordsBulk(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = bulkUpdateRecordsInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.update', true)
    ).updateRecordsBulk({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      items: body.items.map((item) => ({
        recordId: item.id,
        ...(item.contextProjectId !== undefined ? { contextProjectId: item.contextProjectId } : {}),
        displayName: item.displayName,
        values: item.values as Record<string, JsonValue>,
        relations: item.relations ?? {},
        fileReferences: item.fileReferences ?? {},
        datasetReferences: item.datasetReferences ?? {},
        rowVersion: item.rowVersion,
      })),
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(
    bulkUpdateRecordFieldsInput,
    'Atomically set or clear up to 20 fields across 1–100 records while preserving every unmentioned field.',
    {
      records: [{ id: '019fbcf9-e020-71da-935a-6a6a728b3795', rowVersion: 3 }],
      changes: [{ fieldKey: 'status', operation: 'set', value: 'approved' }],
    },
  )
  @ApiOkResponse({ schema: openApiSchema(bulkUpdateRecordsResponse) })
  @Patch('object-types/:objectTypeId/records/bulk/fields')
  async updateRecordFieldsBulk(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = bulkUpdateRecordFieldsInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.update', true)
    ).updateRecordFieldsBulk({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      records: body.records.map((record) => ({
        recordId: record.id,
        rowVersion: record.rowVersion,
      })),
      changes: body.changes.map((change) => ({
        fieldKey: change.fieldKey,
        operation: change.operation,
        ...(change.value !== undefined ? { value: change.value as JsonValue } : {}),
      })),
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(
    createRecordInput,
    'Typed field values and optional relation/reference maps. Use stable field keys from the table API panel.',
    { displayName: 'Sample 001', values: { serial: 'SN-001' } },
  )
  @ApiCreatedResponse({ schema: openApiSchema(recordResponse) })
  @Post('object-types/:objectTypeId/records')
  async createRecord(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = createRecordInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.create', true)
    ).createRecord({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      ...(body.contextProjectId !== undefined ? { contextProjectId: body.contextProjectId } : {}),
      displayName: body.displayName,
      values: body.values as Record<string, JsonValue>,
      relations: body.relations ?? {},
      fileReferences: body.fileReferences ?? {},
      datasetReferences: body.datasetReferences ?? {},
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(updateRecordInput, 'Complete editable record state with the last-read rowVersion.')
  @ApiOkResponse({ schema: openApiSchema(recordResponse) })
  @Patch('object-types/:objectTypeId/records/:recordId')
  async updateRecord(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
    @Body() unparsed: unknown,
  ) {
    const body = updateRecordInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.update', true)
    ).updateRecord({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      recordId: id.parse(recordId),
      ...(body.contextProjectId !== undefined ? { contextProjectId: body.contextProjectId } : {}),
      displayName: body.displayName,
      values: body.values as Record<string, JsonValue>,
      relations: body.relations ?? {},
      fileReferences: body.fileReferences ?? {},
      datasetReferences: body.datasetReferences ?? {},
      rowVersion: body.rowVersion,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(archiveRecordInput, 'Archive one record while retaining history and references.')
  @ApiCreatedResponse({ schema: openApiSchema(recordResponse) })
  @Post('object-types/:objectTypeId/records/:recordId/archive')
  async archiveRecord(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
    @Body() unparsed: unknown,
  ) {
    const body = archiveRecordInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.archive', true)
    ).setRecordArchived({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      recordId: id.parse(recordId),
      archived: true,
      reason: body.reason,
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiCreatedResponse({ schema: openApiSchema(recordResponse) })
  @Post('object-types/:objectTypeId/records/:recordId/restore')
  async restoreRecord(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.restore', true)
    ).setRecordArchived({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      recordId: id.parse(recordId),
      archived: false,
      requestId: requestId(request),
    });
  }

  @ApiZodBody(previewCsvInput)
  @ApiOkResponse({ schema: openApiSchema(csvImportPreviewResponse) })
  @Post('object-types/:objectTypeId/records/import-csv/preview')
  async previewCsv(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = previewCsvInput.parse(unparsed);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'record.create', true)
    ).previewRecordsCsv({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      csv: body.csv,
    });
  }

  @ApiHeader({
    name: 'idempotency-key',
    required: true,
    description: 'Caller-generated key (8–200 characters) used to safely retry the import.',
  })
  @ApiZodBody(importCsvInput)
  @ApiCreatedResponse({ schema: openApiSchema(csvImportResponse) })
  @Post('object-types/:objectTypeId/records/import-csv')
  async importCsv(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() unparsed: unknown,
  ) {
    const body = importCsvInput.parse(unparsed);
    const resolvedObjectTypeId = await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId);
    const scopedRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'record.create',
      true,
    );
    if (body.duplicateStrategy === 'update')
      await repository(this.runtime, request, workspaceId, projectId, 'record.update', true);
    return scopedRepository.importRecordsCsv({
      objectTypeId: resolvedObjectTypeId,
      csv: body.csv,
      duplicateStrategy: body.duplicateStrategy,
      ...(body.mappings ? { mappings: body.mappings } : {}),
      ...(body.uniqueFieldKey ? { uniqueFieldKey: body.uniqueFieldKey } : {}),
      idempotencyKey: z.string().min(8).max(200).parse(idempotencyKey),
      requestId: requestId(request),
    });
  }

  @ApiProduces('text/csv')
  @ApiTableResourceParams()
  @ApiOkResponse({
    description: 'RFC 4180-style CSV export of the active records.',
    schema: { type: 'string', format: 'binary' },
  })
  @Get('object-types/:objectTypeId/export.csv')
  async exportCsv(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
  ) {
    const csv = await (
      await repository(this.runtime, request, workspaceId, projectId, 'export.execute')
    ).exportRecordsCsv(
      await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      requestId(request),
      {
        sorts: [{ systemField: 'displayName', direction: 'asc' }],
        archiveState: 'active',
      },
    );
    response
      .type('text/csv')
      .setHeader('content-disposition', 'attachment; filename="engrove-records.csv"');
    return csv;
  }
}
