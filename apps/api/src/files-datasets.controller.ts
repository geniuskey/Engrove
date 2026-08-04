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
import type { Request } from 'express';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { requestId, requireActor } from './community.controller.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);
const MAX_FILE_BYTES = 100 * 1024 * 1024;
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
) {
  const actor = await requireActor(runtime, request, action, csrf);
  return ScopedFileDatasetRepository.open(
    runtime.pool,
    actor,
    await resolveWorkspaceIdentifier(runtime.pool, workspaceId),
    await resolveProjectIdentifier(runtime.pool, projectId),
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

@Controller('api/v1/workspaces/:workspaceId/projects/:projectId')
export class FilesDatasetsController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  private readonly logger = new Logger(FilesDatasetsController.name);

  @Post('file-upload-sessions')
  async issue(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const body = z
      .object({
        seriesId: id.optional(),
        seriesName: z.string().trim().min(1).max(160),
        originalName: z.string().trim().min(1).max(255),
        contentType: z.string().trim().min(1).max(160),
        sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
        checksum: sha256,
      })
      .parse(raw);
    const runtime = this.runtime;
    const repo = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'file.upload',
      true,
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

  @Get('files') async files(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return {
      items: await (
        await repository(this.runtime, request, workspaceId, projectId, 'file.read')
      ).listFiles(includeArchived === 'true'),
    };
  }
  @Get('files/:fileId/download') async download(
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
  @Patch('files/:fileId/archive') async archiveFile(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
    @Body() raw: unknown,
  ) {
    const body = z.object({ reason: z.string().trim().min(1).max(2000) }).parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'file.archive', true)
    ).setFileArchived(id.parse(fileId), true, body.reason, requestId(request));
  }
  @Post('files/:fileId/restore') async restoreFile(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'file.restore', true)
    ).setFileArchived(id.parse(fileId), false, '', requestId(request));
  }

  @Post('datasets') async createDataset(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const body = z
      .object({
        name: z.string().trim().min(1).max(160),
        sourceFileId: id.optional(),
        sourceDatasetId: id.optional(),
        datasetType: z.enum(['tabular', 'xy']),
        parameters: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'dataset.upload', true)
    ).createDataset({ ...body, requestId: requestId(request) });
  }
  @Get('datasets') async datasets(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return {
      items: await (
        await repository(this.runtime, request, workspaceId, projectId, 'dataset.read')
      ).listDatasets(includeArchived === 'true'),
    };
  }
  @Get('datasets/:datasetId') async dataset(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('datasetId') datasetId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'dataset.read')
    ).getDataset(id.parse(datasetId));
  }
  @Get('datasets/:datasetId/preview') async preview(
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
  @Patch('datasets/:datasetId/archive') async archiveDataset(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('datasetId') datasetId: string,
    @Body() raw: unknown,
  ) {
    const body = z.object({ reason: z.string().trim().min(1).max(2000) }).parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'dataset.archive', true)
    ).setDatasetArchived(id.parse(datasetId), true, body.reason, requestId(request));
  }
  @Post('datasets/:datasetId/restore') async restoreDataset(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('datasetId') datasetId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'dataset.restore', true)
    ).setDatasetArchived(id.parse(datasetId), false, '', requestId(request));
  }
  @Post('datasets/:datasetId/retry') async retryDataset(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('datasetId') datasetId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'job.retry', true)
    ).retryDataset(id.parse(datasetId), requestId(request));
  }

  @Get('background-jobs') async jobs(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
  ) {
    return {
      items: await (
        await repository(this.runtime, request, workspaceId, projectId, 'job.read')
      ).listJobs(),
    };
  }

  @Get('storage-cleanup') async cleanupDryRun(
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

  @Post('storage-cleanup') async cleanupExecute(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const body = z
      .object({
        confirmation: z.literal('DELETE_UNREFERENCED_OBJECTS'),
        graceSeconds: z.number().int().min(0).max(2_592_000).default(86_400),
      })
      .parse(raw);
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
