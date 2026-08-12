import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  createRecordViewShare,
  exportPublicSharedViewCsv,
  getManagedRecordViewShare,
  getPublicSharedViewMetadata,
  queryPublicSharedViewRecords,
  recordViewShareTokenDigest,
  resolveObjectTypeIdentifier,
  resolveProjectIdentifier,
  resolvePublicRecordViewShare,
  resolveRecordViewIdentifier,
  resolveWorkspaceIdentifier,
  revokeRecordViewShare,
  submitPublicForm,
  updateRecordViewShare,
  type PublicRecordViewShareContext,
  type PublicSharedRecordQuery,
  type JsonValue,
} from '@engrove/database';
import type { Request, Response } from 'express';
import { hash, verify } from 'argon2';
import { z } from 'zod';
import { requestId, requireActor, verifiedClientIp } from './community.controller.js';
import { ApiTableResourceParams, ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const shareToken = z.string().regex(/^sv_[A-Za-z0-9_-]{43}$/);
const password = z.string().min(8).max(200);
const futureExpiry = z.iso
  .datetime({ offset: true })
  .refine((value) => new Date(value).getTime() > Date.now() + 60_000, 'Expiry must be future.');
const createShareInput = z
  .object({
    password: password.optional(),
    allowDownload: z.boolean().default(false),
    expiresAt: futureExpiry.nullable().optional(),
  })
  .strict();
const updateShareInput = z
  .object({
    rowVersion: z.number().int().positive(),
    password: password.nullable().optional(),
    allowDownload: z.boolean(),
    expiresAt: futureExpiry.nullable(),
  })
  .strict();
const revokeShareInput = z
  .object({
    rowVersion: z.number().int().positive(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
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
const publicQueryInput = z
  .object({
    filters: z.array(recordFilter).max(10).optional(),
    sorts: z.array(recordSort).max(5).optional(),
    search: z.string().trim().max(120).optional(),
    page: z.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(50),
  })
  .strict();
const unlockInput = z.object({ password }).strict();
const publicFormSubmissionInput = z
  .object({
    displayName: z.string().trim().min(1).max(500),
    values: z.record(z.string().min(1).max(120), z.unknown()),
    website: z.literal('').optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value.values).length <= 100,
    'At most 100 fields may be submitted.',
  );
const managedShareResponse = z.object({
  id,
  recordViewId: id,
  tokenPrefix: z.string(),
  passwordProtected: z.boolean(),
  allowDownload: z.boolean(),
  expiresAt: z.string().nullable(),
  rowVersion: z.number().int().positive(),
  accessCount: z.number().int().nonnegative(),
  lastAccessedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const publicFieldResponse = z.object({
  id,
  name: z.string(),
  description: z.string(),
  key: z.string(),
  fieldType: z.string(),
  required: z.boolean(),
  defaultValue: z.unknown().optional(),
  config: z.record(z.string(), z.unknown()),
});
const publicMetadataResponse = z.object({
  requiresPassword: z.boolean(),
  view: z
    .object({
      name: z.string(),
      tableName: z.string(),
      viewType: z.enum(['grid', 'form', 'gallery', 'kanban', 'calendar']),
      rowDensity: z.enum(['compact', 'comfortable']),
      fields: z.array(publicFieldResponse).max(200),
      fieldWidths: z.record(id, z.number()),
      groupFieldId: id.nullable(),
      dateFieldId: id.nullable(),
      allowDownload: z.boolean(),
      expiresAt: z.string().nullable(),
    })
    .optional(),
});
const publicPageResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      values: z.record(z.string(), z.unknown()),
      updatedAt: z.string(),
    }),
  ),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  groups: z.array(z.object({ value: z.string().nullable(), count: z.number() })).optional(),
});
const publicFormSubmissionResponse = z.object({
  recordId: id,
  submittedAt: z.string(),
  idempotentReplay: z.boolean(),
});

function passwordOptions(runtime: Runtime) {
  return {
    type: 2 as const,
    memoryCost: runtime.config.ARGON2_MEMORY_KIB,
    timeCost: runtime.config.ARGON2_ITERATIONS,
    parallelism: runtime.config.ARGON2_PARALLELISM,
  };
}

function accessHeader(headers: Record<string, string | string[] | undefined>): string | undefined {
  const value = headers['x-engrove-share-access'];
  return Array.isArray(value) ? value[0] : value;
}

async function shareUnlocked(
  runtime: Runtime,
  context: PublicRecordViewShareContext,
  accessToken: string | undefined,
): Promise<boolean> {
  if (!context.passwordHash) return true;
  if (!accessToken || !/^sa_[A-Za-z0-9_-]{43}$/.test(accessToken)) return false;
  if (runtime.redis.status === 'wait') await runtime.redis.connect();
  return (
    (await runtime.redis.get(`engrove:share-access:${recordViewShareTokenDigest(accessToken)}`)) ===
    context.id
  );
}

async function requireShareUnlocked(
  runtime: Runtime,
  context: PublicRecordViewShareContext,
  accessToken: string | undefined,
): Promise<void> {
  if (!(await shareUnlocked(runtime, context, accessToken)))
    throw new HttpException({ code: 'SHARED_VIEW_PASSWORD_REQUIRED' }, 401);
}

const unlockRateLimitScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
`;

async function enforceUnlockRateLimit(
  runtime: Runtime,
  request: Request,
  shareId: string,
): Promise<void> {
  if (runtime.redis.status === 'wait') await runtime.redis.connect();
  const identity = createHash('sha256')
    .update(`${shareId}:${verifiedClientIp(request)}`)
    .digest('hex');
  const result = (await runtime.redis.eval(
    unlockRateLimitScript,
    1,
    `engrove:share-unlock:${identity}`,
    900,
  )) as [number | string, number | string];
  if (Number(result[0]) > 10)
    throw new HttpException(
      { code: 'RATE_LIMITED', retryAfterSeconds: Math.max(1, Number(result[1])) },
      429,
    );
}

async function enforceSubmissionRateLimit(
  runtime: Runtime,
  request: Request,
  shareId: string,
): Promise<void> {
  if (runtime.redis.status === 'wait') await runtime.redis.connect();
  const identity = createHmac('sha256', runtime.config.INTERNAL_SERVICE_SECRET)
    .update(`${shareId}:${verifiedClientIp(request)}`)
    .digest('hex');
  const result = (await runtime.redis.eval(
    unlockRateLimitScript,
    1,
    `engrove:public-form:${identity}`,
    3600,
  )) as [number | string, number | string];
  if (Number(result[0]) > 20)
    throw new HttpException(
      { code: 'RATE_LIMITED', retryAfterSeconds: Math.max(1, Number(result[1])) },
      429,
    );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

async function managedIdentifiers(
  runtime: Runtime,
  workspaceId: string,
  projectId: string,
  objectTypeId: string,
  viewId: string,
) {
  const resolvedWorkspaceId = await resolveWorkspaceIdentifier(runtime.pool, workspaceId);
  const resolvedProjectId = await resolveProjectIdentifier(runtime.pool, projectId);
  const resolvedObjectTypeId = await resolveObjectTypeIdentifier(runtime.pool, objectTypeId);
  const resolvedViewId = await resolveRecordViewIdentifier(runtime.pool, viewId);
  return {
    workspaceId: resolvedWorkspaceId,
    projectId: resolvedProjectId,
    objectTypeId: resolvedObjectTypeId,
    recordViewId: resolvedViewId,
  };
}

@ApiTags('Shared views')
@Controller(
  'api/v1/workspaces/:workspaceId/projects/:projectId/object-types/:objectTypeId/views/:viewId/share',
)
export class RecordViewShareManagementController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiTableResourceParams()
  @ApiOkResponse({ schema: openApiSchema(z.object({ share: managedShareResponse.nullable() })) })
  @Get()
  async get(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('viewId') viewId: string,
  ) {
    const actor = await requireActor(this.runtime, request, 'view.share');
    const identifiers = await managedIdentifiers(
      this.runtime,
      workspaceId,
      projectId,
      objectTypeId,
      viewId,
    );
    return {
      share: await getManagedRecordViewShare(
        this.runtime.pool,
        actor,
        identifiers.workspaceId,
        identifiers.projectId,
        identifiers.objectTypeId,
        identifiers.recordViewId,
      ),
    };
  }

  @ApiTableResourceParams()
  @ApiZodBody(createShareInput, 'Enable or rotate a one-time-copy public share link.')
  @ApiCreatedResponse({
    schema: openApiSchema(managedShareResponse.extend({ url: z.string().url() })),
  })
  @Post()
  async create(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('viewId') viewId: string,
    @Body() unparsed: unknown,
  ) {
    const body = createShareInput.parse(unparsed);
    const actor = await requireActor(this.runtime, request, 'view.share', true);
    const identifiers = await managedIdentifiers(
      this.runtime,
      workspaceId,
      projectId,
      objectTypeId,
      viewId,
    );
    const created = await createRecordViewShare(this.runtime.pool, actor, {
      ...identifiers,
      ...(body.password
        ? { passwordHash: await hash(body.password, passwordOptions(this.runtime)) }
        : {}),
      allowDownload: body.allowDownload,
      ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
      requestId: requestId(request),
    });
    const { token, ...share } = created;
    return {
      ...share,
      url: `${this.runtime.config.ENGROVE_PUBLIC_URL.replace(/\/$/, '')}/share/${token}`,
    };
  }

  @ApiTableResourceParams()
  @ApiZodBody(updateShareInput, 'Update password, download, or expiry without rotating the link.')
  @ApiOkResponse({ schema: openApiSchema(managedShareResponse) })
  @Patch()
  async update(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('viewId') viewId: string,
    @Body() unparsed: unknown,
  ) {
    const body = updateShareInput.parse(unparsed);
    const actor = await requireActor(this.runtime, request, 'view.share', true);
    const identifiers = await managedIdentifiers(
      this.runtime,
      workspaceId,
      projectId,
      objectTypeId,
      viewId,
    );
    return updateRecordViewShare(this.runtime.pool, actor, {
      ...identifiers,
      rowVersion: body.rowVersion,
      ...(body.password === undefined
        ? {}
        : {
            passwordHash:
              body.password === null
                ? null
                : await hash(body.password, passwordOptions(this.runtime)),
          }),
      allowDownload: body.allowDownload,
      ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
      requestId: requestId(request),
    });
  }

  @ApiTableResourceParams()
  @ApiZodBody(revokeShareInput, 'Immediately revoke the active public link.')
  @ApiOkResponse({ schema: openApiSchema(z.object({ revoked: z.literal(true) })) })
  @HttpCode(200)
  @Post('revoke')
  async revoke(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('viewId') viewId: string,
    @Body() unparsed: unknown,
  ) {
    const body = revokeShareInput.parse(unparsed);
    const actor = await requireActor(this.runtime, request, 'view.share', true);
    const identifiers = await managedIdentifiers(
      this.runtime,
      workspaceId,
      projectId,
      objectTypeId,
      viewId,
    );
    await revokeRecordViewShare(this.runtime.pool, actor, {
      ...identifiers,
      rowVersion: body.rowVersion,
      ...(body.reason ? { reason: body.reason } : {}),
      requestId: requestId(request),
    });
    return { revoked: true as const };
  }
}

@ApiTags('Public shared views')
@Controller('api/v1/shared-views/:shareToken')
export class PublicRecordViewShareController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiHeader({ name: 'x-engrove-share-access', required: false })
  @ApiOkResponse({ schema: openApiSchema(publicMetadataResponse) })
  @Get()
  async metadata(
    @Param('shareToken') unparsedToken: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('cache-control', 'private, no-store');
    const token = shareToken.parse(unparsedToken);
    const context = await resolvePublicRecordViewShare(this.runtime.pool, token);
    return getPublicSharedViewMetadata(
      this.runtime.pool,
      context,
      await shareUnlocked(this.runtime, context, accessHeader(headers)),
    );
  }

  @ApiZodBody(unlockInput, 'Unlock a password-protected share for 30 minutes.')
  @ApiOkResponse({
    schema: openApiSchema(z.object({ accessToken: z.string(), expiresInSeconds: z.literal(1800) })),
  })
  @HttpCode(200)
  @Post('unlock')
  async unlock(
    @Req() request: Request,
    @Param('shareToken') unparsedToken: string,
    @Body() unparsed: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('cache-control', 'private, no-store');
    const token = shareToken.parse(unparsedToken);
    const body = unlockInput.parse(unparsed);
    const context = await resolvePublicRecordViewShare(this.runtime.pool, token);
    await enforceUnlockRateLimit(this.runtime, request, context.id);
    if (!context.passwordHash || !(await verify(context.passwordHash, body.password)))
      throw new HttpException({ code: 'SHARED_VIEW_PASSWORD_INVALID' }, 401);
    const accessToken = `sa_${randomBytes(32).toString('base64url')}`;
    await this.runtime.redis.set(
      `engrove:share-access:${recordViewShareTokenDigest(accessToken)}`,
      context.id,
      'EX',
      1800,
    );
    return { accessToken, expiresInSeconds: 1800 as const };
  }

  @ApiHeader({ name: 'x-engrove-share-access', required: false })
  @ApiZodBody(publicQueryInput, 'Apply transient visible-field filters and sorts.')
  @ApiOkResponse({ schema: openApiSchema(publicPageResponse) })
  @HttpCode(200)
  @Post('query')
  async query(
    @Param('shareToken') unparsedToken: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() unparsed: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('cache-control', 'private, no-store');
    const token = shareToken.parse(unparsedToken);
    const body = publicQueryInput.parse(unparsed);
    const context = await resolvePublicRecordViewShare(this.runtime.pool, token);
    await requireShareUnlocked(this.runtime, context, accessHeader(headers));
    return queryPublicSharedViewRecords(
      this.runtime.pool,
      context,
      body as PublicSharedRecordQuery,
    );
  }

  @ApiHeader({ name: 'x-engrove-share-access', required: false })
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiZodBody(
    publicFormSubmissionInput,
    'Submit a public form. The website field is a bot trap and must remain empty.',
  )
  @ApiCreatedResponse({ schema: openApiSchema(publicFormSubmissionResponse) })
  @Post('submit')
  async submit(
    @Req() request: Request,
    @Param('shareToken') unparsedToken: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() unparsed: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('cache-control', 'private, no-store');
    const token = shareToken.parse(unparsedToken);
    const body = publicFormSubmissionInput.parse(unparsed);
    const context = await resolvePublicRecordViewShare(this.runtime.pool, token);
    await requireShareUnlocked(this.runtime, context, accessHeader(headers));
    await enforceSubmissionRateLimit(this.runtime, request, context.id);
    const rawIdempotencyKey = headers['idempotency-key'];
    const idempotencyKey = Array.isArray(rawIdempotencyKey)
      ? rawIdempotencyKey[0]
      : rawIdempotencyKey;
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200)
      throw new HttpException({ code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
    const submission = {
      displayName: body.displayName,
      values: body.values as Record<string, JsonValue>,
    };
    return submitPublicForm(this.runtime.pool, context, {
      ...submission,
      idempotencyHash: createHash('sha256').update(idempotencyKey, 'utf8').digest('hex'),
      requestHash: createHash('sha256').update(canonicalJson(submission), 'utf8').digest('hex'),
      networkFingerprint: createHmac('sha256', this.runtime.config.INTERNAL_SERVICE_SECRET)
        .update(verifiedClientIp(request))
        .digest('hex'),
      requestId: requestId(request),
    });
  }

  @ApiHeader({ name: 'x-engrove-share-access', required: false })
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @Get('export.csv')
  async exportCsv(
    @Param('shareToken') unparsedToken: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = shareToken.parse(unparsedToken);
    const context = await resolvePublicRecordViewShare(this.runtime.pool, token);
    await requireShareUnlocked(this.runtime, context, accessHeader(headers));
    const csv = await exportPublicSharedViewCsv(this.runtime.pool, context);
    response
      .type('text/csv')
      .setHeader('content-disposition', 'attachment; filename="engrove-shared-view.csv"')
      .setHeader('cache-control', 'private, no-store');
    return csv;
  }
}
