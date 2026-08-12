import { createHash, randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  RepositoryError,
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedFileDatasetRepository,
} from '@engrove/database';
import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { requestId, requireActor } from './community.controller.js';
import { ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);
const fileStatus = z.enum(['pending_upload', 'verifying', 'available', 'failed']);
const archiveState = z.enum(['active', 'archived', 'all']);
const fileListInput = z
  .object({
    includeArchived: z.enum(['true', 'false']).optional(),
    archiveState: archiveState.optional(),
    query: z.string().trim().max(120).default(''),
    status: z.union([z.literal('all'), fileStatus]).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .transform(({ includeArchived, archiveState: requestedState, ...input }) => ({
    ...input,
    archiveState: requestedState ?? (includeArchived === 'true' ? ('all' as const) : 'active'),
  }));
const datasetListInput = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  query: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const artifactResponse = z
  .object({
    id,
    artifact_kind: z.string(),
    content_type: z.string(),
    size_bytes: z.number().nonnegative(),
    checksum: z.string(),
  })
  .loose();
const datasetResponse = z
  .object({
    id,
    name: z.string(),
    dataset_type: z.enum(['tabular', 'xy']),
    status: z.enum(['pending', 'processing', 'ready', 'failed']),
    schema: z.record(z.string(), z.unknown()),
    archived_at: z.string().nullable(),
    artifacts: z.array(artifactResponse),
  })
  .loose();
const pageInfoResponse = z.object({
  limit: z.number().int(),
  offset: z.number().int(),
  total: z.number().int(),
  hasNext: z.boolean(),
});
const fileObjectResponse = z
  .object({
    id,
    file_series_id: id,
    version_number: z.number().int().positive(),
    previous_file_id: id.nullable(),
    original_name: z.string(),
    content_type: z.string(),
    size_bytes: z.number().nonnegative(),
    checksum_algorithm: z.string(),
    checksum: z.string(),
    status: fileStatus,
    failure_code: z.string().nullable(),
    created_at: z.string(),
    available_at: z.string().nullable(),
    archived_at: z.string().nullable(),
  })
  .loose();
const fileListItemResponse = fileObjectResponse.extend({ series_name: z.string() });
const jobStatus = z.enum(['queued', 'running', 'succeeded', 'failed']);
const jobListInput = z.object({
  status: z.union([z.literal('all'), jobStatus]).default('all'),
  query: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const jobListItemResponse = z
  .object({
    id,
    job_type: z.string(),
    entity_type: z.string(),
    entity_id: id,
    status: jobStatus,
    attempt_count: z.number().int().nonnegative(),
    max_attempts: z.number().int().positive(),
    progress: z.number().int().min(0).max(100),
    scheduled_at: z.string(),
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    error_code: z.string().nullable(),
    retryable: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
    attempts: z.array(z.record(z.string(), z.unknown())),
  })
  .loose();
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const uploadIssueInput = z
  .object({
    seriesId: id.optional(),
    seriesName: z.string().trim().min(1).max(160),
    originalName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(160),
    sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
    checksum: sha256,
  })
  .strict();
const uploadIssueResponse = z.object({
  uploadId: id,
  fileId: id,
  seriesId: id,
  version: z.number().int().positive(),
  stagingObjectKey: z.string(),
  expiresAt: z.iso.datetime(),
  uploadUrl: z.url(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  maxSizeBytes: z.number().int().positive(),
});
const signedDownloadResponse = z.object({
  url: z.url(),
  expiresIn: z.number().int().positive(),
});
const imagePreviewResponse = signedDownloadResponse.extend({
  file: z.object({
    id,
    originalName: z.string(),
    contentType: z.string(),
    sizeBytes: z.number().nonnegative(),
  }),
});
const archiveInput = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
const datasetCreateInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    sourceFileId: id.optional(),
    sourceDatasetId: id.optional(),
    datasetType: z.enum(['tabular', 'xy']),
    parameters: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const datasetCreateResponse = z.object({
  dataset: datasetResponse,
  jobId: id.optional(),
  idempotent: z.boolean(),
});
const datasetPreviewResponse = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
});
const datasetRetryResponse = z.object({ id, jobId: id });
const cleanupCandidateResponse = z.object({
  key: z.string(),
  versionId: z.string().nullable(),
  reason: z.enum(['eligible-staging', 'unreferenced-committed']),
  lastModified: z.iso.datetime(),
});
const cleanupResponse = z.object({
  mode: z.enum(['execute', 'dry-run']),
  graceSeconds: z.number().int().nonnegative(),
  candidates: z.array(cleanupCandidateResponse),
  deleted: z.number().int().nonnegative(),
});
const cleanupExecuteInput = z
  .object({
    confirmation: z.literal('DELETE_UNREFERENCED_OBJECTS'),
    graceSeconds: z.number().int().min(0).max(2_592_000).default(86_400),
  })
  .strict();
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
async function repository(
  runtime: Runtime,
  request: Request,
  workspaceId: string,
  projectId: string,
  action:
    | 'file.upload'
    | 'file.read'
    | 'file.archive'
    | 'file.restore'
    | 'dataset.upload'
    | 'dataset.read'
    | 'dataset.archive'
    | 'dataset.restore'
    | 'job.read'
    | 'job.retry'
    | 'storage.cleanup',
  csrf = false,
  allowSystem = false,
) {
  const actor = await requireActor(runtime, request, action, csrf);
  return ScopedFileDatasetRepository.open(
    runtime.pool,
    actor,
    await resolveWorkspaceIdentifier(runtime.pool, workspaceId),
    await resolveProjectIdentifier(runtime.pool, projectId),
    { allowSystem },
  );
}
const cleanName = (name: string) =>
  Array.from(name.normalize('NFC'))
    .map((character) =>
      character.charCodeAt(0) < 32 || character === '/' || character === '\\' ? '_' : character,
    )
    .join('')
    .slice(0, 255);
async function bytes(body: unknown): Promise<Uint8Array> {
  if (!body || typeof body !== 'object' || !('transformToByteArray' in body))
    throw new Error('OBJECT_BODY_UNAVAILABLE');
  return (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
}

async function cleanup(
  runtime: Runtime,
  repo: ScopedFileDatasetRepository,
  graceSeconds: number,
  execute: boolean,
) {
  const protection = await repo.storageCleanupProtection(graceSeconds);
  const active = new Set(protection.activeStagingKeys);
  const eligible = new Set(protection.eligibleStagingKeys);
  const committed = new Set(protection.protectedCommittedKeys);
  const cutoff = Date.now() - graceSeconds * 1_000;
  const candidates: Array<{
    key: string;
    versionId: string | null;
    reason: 'eligible-staging' | 'unreferenced-committed';
    lastModified: string;
  }> = [];
  const prefixes = new Set(
    protection.storageProjectIds.flatMap((storageProjectId) => [
      `staging/${storageProjectId}/`,
      `committed/${storageProjectId}/`,
    ]),
  );
  for (const prefix of prefixes) {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    do {
      const page = await runtime.s3.send(
        new ListObjectVersionsCommand({
          Bucket: runtime.config.S3_BUCKET,
          Prefix: prefix,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }),
      );
      for (const version of page.Versions ?? []) {
        if (!version.Key || !version.LastModified || version.LastModified.getTime() > cutoff)
          continue;
        const reason = version.Key.startsWith('staging/')
          ? eligible.has(version.Key) && !active.has(version.Key)
            ? 'eligible-staging'
            : null
          : committed.has(version.Key)
            ? null
            : 'unreferenced-committed';
        if (reason)
          candidates.push({
            key: version.Key,
            versionId: version.VersionId ?? null,
            reason,
            lastModified: version.LastModified.toISOString(),
          });
      }
      keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
    } while (keyMarker);
  }
  let deleted = 0;
  if (execute)
    for (const candidate of candidates) {
      if (
        !(await repo.storageCleanupCandidateDeletable(
          candidate.key,
          candidate.reason,
          graceSeconds,
        ))
      )
        continue;
      await runtime.s3.send(
        new DeleteObjectCommand({
          Bucket: runtime.config.S3_BUCKET,
          Key: candidate.key,
          VersionId: candidate.versionId ?? undefined,
        }),
      );
      deleted += 1;
    }
  return {
    mode: execute ? 'execute' : 'dry-run',
    graceSeconds,
    candidates,
    deleted,
  };
}

@ApiTags('FilesDatasets')
@Controller('api/v1/workspaces/:workspaceId/projects/:projectId')
export class FilesDatasetsController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  private readonly logger = new Logger(FilesDatasetsController.name);

  @ApiCreatedResponse({ schema: openApiSchema(uploadIssueResponse) })
  @ApiZodBody(uploadIssueInput, 'Issue a direct, checksum-verified object-storage upload.', {
    seriesName: 'Force curve raw data',
    originalName: 'force-run-001.csv',
    contentType: 'text/csv',
    sizeBytes: 48231,
    checksum: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  })
  @Post('file-upload-sessions')
  async issue(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const body = uploadIssueInput.parse(raw);
    const runtime = this.runtime;
    const repo = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'file.upload',
      true,
      SUPPORTED_IMAGE_TYPES.has(body.contentType),
    );
    const uploadId = uuidv7();
    const fileId = uuidv7();
    const stagingObjectKey = `staging/${repo.canonicalProjectId}/${uploadId}/${randomUUID()}`;
    const finalObjectKey = `committed/${repo.canonicalProjectId}/files/${fileId}/${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const issued = await repo.issueUpload({
      ...body,
      fileId,
      uploadId,
      originalName: cleanName(body.originalName),
      stagingObjectKey,
      finalObjectKey,
      expiresAt,
      requestId: requestId(request),
    });
    const command = new PutObjectCommand({
      Bucket: runtime.config.S3_BUCKET,
      Key: stagingObjectKey,
      ContentType: body.contentType,
    });
    const uploadUrl = await getSignedUrl(runtime.s3Public, command, { expiresIn: 15 * 60 });
    return {
      ...issued,
      uploadUrl,
      method: 'PUT',
      headers: {
        'content-type': body.contentType,
      },
      maxSizeBytes: MAX_FILE_BYTES,
    };
  }

  @ApiCreatedResponse({ schema: openApiSchema(fileObjectResponse) })
  @Post('file-upload-sessions/:uploadId/complete')
  async complete(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('uploadId') uploadId: string,
  ) {
    const repo = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'file.upload',
      true,
      true,
    );
    const session = await repo.beginFinalization(id.parse(uploadId));
    if (session.idempotent) return repo.getAvailableFile(session.file_id);
    const runtime = this.runtime;
    try {
      const staged = await runtime.s3.send(
        new GetObjectCommand({ Bucket: runtime.config.S3_BUCKET, Key: session.staging_object_key }),
      );
      const stagedBytes = await bytes(staged.Body);
      const checksum = createHash('sha256').update(stagedBytes).digest('hex');
      if (stagedBytes.byteLength !== Number(session.expected_size_bytes))
        throw new Error('FILE_SIZE_MISMATCH');
      if (checksum !== String(session.expected_checksum).toLowerCase())
        throw new Error('FILE_CHECKSUM_MISMATCH');
      const stored = await runtime.s3.send(
        new PutObjectCommand({
          Bucket: runtime.config.S3_BUCKET,
          Key: session.final_object_key,
          Body: stagedBytes,
          ContentType: session.content_type,
          Metadata: { sha256: checksum },
        }),
      );
      const final = await runtime.s3.send(
        new GetObjectCommand({
          Bucket: runtime.config.S3_BUCKET,
          Key: session.final_object_key,
          VersionId: stored.VersionId,
        }),
      );
      const finalBytes = await bytes(final.Body);
      if (createHash('sha256').update(finalBytes).digest('hex') !== checksum)
        throw new Error('FINAL_CHECKSUM_MISMATCH');
      const file = await repo.completeFinalization(
        uploadId,
        stored.VersionId ?? null,
        requestId(request),
      );
      try {
        await runtime.s3.send(
          new DeleteObjectCommand({
            Bucket: runtime.config.S3_BUCKET,
            Key: session.staging_object_key,
          }),
        );
      } catch (error) {
        this.logger.warn(
          `Staging object cleanup deferred after successful file finalization projectId=${projectId} uploadId=${uploadId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return file;
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z_]+$/.test(error.message)
          ? error.message
          : 'FILE_FINALIZATION_FAILED';
      await repo.failFinalization(uploadId, code, requestId(request));
      throw new RepositoryError(
        code,
        ['FILE_SIZE_MISMATCH', 'FILE_CHECKSUM_MISMATCH'].includes(code) ? 400 : 500,
        'File finalization failed verification.',
      );
    }
  }

  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean, deprecated: true })
  @ApiQuery({ name: 'archiveState', required: false, enum: archiveState.options })
  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'status', required: false, enum: ['all', ...fileStatus.options] })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({
    schema: openApiSchema(
      z.object({ items: z.array(fileListItemResponse).max(100), pageInfo: pageInfoResponse }),
    ),
  })
  @Get('files')
  async files(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('archiveState') requestedArchiveState?: string,
    @Query('query') query?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const input = fileListInput.parse({
      includeArchived,
      archiveState: requestedArchiveState,
      query,
      status,
      limit,
      offset,
    });
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'file.read')
    ).listFilePage(input);
  }
  @ApiOkResponse({ schema: openApiSchema(signedDownloadResponse) })
  @Get('files/:fileId/download')
  async download(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
  ) {
    const file = await (
      await repository(this.runtime, request, workspaceId, projectId, 'file.read')
    ).getAvailableFile(id.parse(fileId));
    const runtime = this.runtime;
    return {
      url: await getSignedUrl(
        runtime.s3Public,
        new GetObjectCommand({
          Bucket: runtime.config.S3_BUCKET,
          Key: file.final_object_key,
          VersionId: file.storage_version_id ?? undefined,
          ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
        }),
        { expiresIn: 300 },
      ),
      expiresIn: 300,
    };
  }
  @ApiOkResponse({ schema: openApiSchema(imagePreviewResponse) })
  @Get('files/:fileId/preview')
  async imagePreview(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
  ) {
    const file = await (
      await repository(this.runtime, request, workspaceId, projectId, 'file.read', false, true)
    ).getAvailableFile(id.parse(fileId));
    if (!SUPPORTED_IMAGE_TYPES.has(file.content_type)) {
      throw new RepositoryError(
        'FILE_PREVIEW_UNSUPPORTED',
        415,
        'Only supported image files can be previewed.',
      );
    }
    const runtime = this.runtime;
    return {
      url: await getSignedUrl(
        runtime.s3Public,
        new GetObjectCommand({
          Bucket: runtime.config.S3_BUCKET,
          Key: file.final_object_key,
          VersionId: file.storage_version_id ?? undefined,
          ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
          ResponseContentType: file.content_type,
        }),
        { expiresIn: 300 },
      ),
      expiresIn: 300,
      file: {
        id: file.id,
        originalName: file.original_name,
        contentType: file.content_type,
        sizeBytes: Number(file.size_bytes),
      },
    };
  }
  @ApiOkResponse({ schema: openApiSchema(fileObjectResponse) })
  @ApiZodBody(archiveInput, 'Archive a file version while preserving exact references.', {
    reason: 'Superseded by the approved rerun',
  })
  @Patch('files/:fileId/archive')
  async archiveFile(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
    @Body() raw: unknown,
  ) {
    const body = archiveInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'file.archive', true)
    ).setFileArchived(id.parse(fileId), true, body.reason, requestId(request));
  }
  @ApiCreatedResponse({ schema: openApiSchema(fileObjectResponse) })
  @Post('files/:fileId/restore')
  async restoreFile(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'file.restore', true)
    ).setFileArchived(id.parse(fileId), false, '', requestId(request));
  }

  @ApiCreatedResponse({ schema: openApiSchema(datasetCreateResponse) })
  @ApiZodBody(datasetCreateInput, 'Create an immutable dataset processing request.', {
    name: 'Force run 001',
    sourceFileId: '019fbcf9-e020-71da-935a-6a6a728b3790',
    datasetType: 'tabular',
    parameters: { delimiter: ',', headerRow: 1 },
  })
  @Post('datasets')
  async createDataset(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const body = datasetCreateInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'dataset.upload', true)
    ).createDataset({ ...body, requestId: requestId(request) });
  }
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean, example: false })
  @ApiQuery({ name: 'query', required: false, type: String, example: 'thermal' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiOkResponse({
    schema: openApiSchema(
      z.object({
        items: z.array(datasetResponse).max(100),
        pageInfo: pageInfoResponse,
      }),
    ),
  })
  @Get('datasets')
  async datasets(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const input = datasetListInput.parse({ includeArchived, query, limit, offset });
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'dataset.read')
    ).listDatasetPage(input);
  }
  @ApiOkResponse({ schema: openApiSchema(datasetResponse) })
  @Get('datasets/:datasetId')
  async dataset(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('datasetId') datasetId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'dataset.read')
    ).getDataset(id.parse(datasetId));
  }
  @ApiOkResponse({ schema: openApiSchema(datasetPreviewResponse) })
  @Get('datasets/:datasetId/preview')
  async preview(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('datasetId') datasetId: string,
  ) {
    const dataset = await (
      await repository(this.runtime, request, workspaceId, projectId, 'dataset.read')
    ).getDataset(id.parse(datasetId));
    if (dataset.status !== 'ready')
      throw new RepositoryError('DATASET_NOT_READY', 409, 'Dataset is not ready.');
    const artifact = dataset.artifacts.find(
      (candidate: { artifact_kind: string }) => candidate.artifact_kind === 'preview',
    );
    if (!artifact)
      throw new RepositoryError('DATASET_PREVIEW_NOT_FOUND', 404, 'Dataset preview was not found.');
    const runtime = this.runtime;
    const object = await runtime.s3.send(
      new GetObjectCommand({
        Bucket: runtime.config.S3_BUCKET,
        Key: artifact.object_key,
        VersionId: artifact.storage_version_id ?? undefined,
      }),
    );
    return { items: JSON.parse(Buffer.from(await bytes(object.Body)).toString('utf8')) };
  }
  @ApiOkResponse({ schema: openApiSchema(datasetResponse) })
  @ApiZodBody(archiveInput, 'Archive an immutable dataset without deleting its lineage.', {
    reason: 'Superseded by the corrected source file',
  })
  @Patch('datasets/:datasetId/archive')
  async archiveDataset(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('datasetId') datasetId: string,
    @Body() raw: unknown,
  ) {
    const body = archiveInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'dataset.archive', true)
    ).setDatasetArchived(id.parse(datasetId), true, body.reason, requestId(request));
  }
  @ApiCreatedResponse({ schema: openApiSchema(datasetResponse) })
  @Post('datasets/:datasetId/restore')
  async restoreDataset(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('datasetId') datasetId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'dataset.restore', true)
    ).setDatasetArchived(id.parse(datasetId), false, '', requestId(request));
  }
  @ApiCreatedResponse({ schema: openApiSchema(datasetRetryResponse) })
  @Post('datasets/:datasetId/retry')
  async retryDataset(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('datasetId') datasetId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'job.retry', true)
    ).retryDataset(id.parse(datasetId), requestId(request));
  }

  @ApiQuery({ name: 'status', required: false, enum: ['all', ...jobStatus.options] })
  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({
    schema: openApiSchema(
      z.object({ items: z.array(jobListItemResponse).max(100), pageInfo: pageInfoResponse }),
    ),
  })
  @Get('background-jobs')
  async jobs(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const input = jobListInput.parse({ status, query, limit, offset });
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'job.read')
    ).listJobPage(input);
  }

  @ApiQuery({ name: 'graceSeconds', required: false, type: Number, minimum: 0, maximum: 2_592_000 })
  @ApiOkResponse({ schema: openApiSchema(cleanupResponse) })
  @Get('storage-cleanup')
  async cleanupDryRun(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('graceSeconds') rawGrace?: string,
  ) {
    const graceSeconds = z.coerce
      .number()
      .int()
      .min(0)
      .max(2_592_000)
      .default(86_400)
      .parse(rawGrace);
    const repo = await repository(this.runtime, request, workspaceId, projectId, 'storage.cleanup');
    const report = await cleanup(this.runtime, repo, graceSeconds, false);
    await repo.auditStorageCleanup(requestId(request), 'dry-run', report.candidates.length, 0);
    return report;
  }

  @ApiCreatedResponse({ schema: openApiSchema(cleanupResponse) })
  @ApiZodBody(cleanupExecuteInput, 'Delete only revalidated unreferenced object versions.', {
    confirmation: 'DELETE_UNREFERENCED_OBJECTS',
    graceSeconds: 86400,
  })
  @Post('storage-cleanup')
  async cleanupExecute(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const body = cleanupExecuteInput.parse(raw);
    const repo = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'storage.cleanup',
      true,
    );
    const report = await cleanup(this.runtime, repo, body.graceSeconds, true);
    await repo.auditStorageCleanup(
      requestId(request),
      'execute',
      report.candidates.length,
      report.deleted,
    );
    return report;
  }
}
