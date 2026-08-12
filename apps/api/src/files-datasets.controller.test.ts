import { createHash } from 'node:crypto';
import type * as DatabaseModule from '@engrove/database';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

const community = vi.hoisted(() => ({
  requestId: vi.fn(() => 'request-1'),
  requireActor: vi.fn(async () => ({
    actorId: 'actor-1',
    organizationId: 'organization-1',
    role: 'owner',
  })),
}));

const database = vi.hoisted(() => ({
  open: vi.fn(),
  resolveProjectIdentifier: vi.fn(async () => 'project-1'),
  resolveWorkspaceIdentifier: vi.fn(async () => 'workspace-1'),
}));
const aws = vi.hoisted(() => ({
  getSignedUrl: vi.fn(async () => 'https://uploads.example.test/signed'),
}));

vi.mock('./community.controller.js', () => community);
vi.mock('@aws-sdk/s3-request-presigner', () => aws);
vi.mock('@engrove/database', async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseModule>();
  return {
    ...actual,
    resolveProjectIdentifier: database.resolveProjectIdentifier,
    resolveWorkspaceIdentifier: database.resolveWorkspaceIdentifier,
    ScopedFileDatasetRepository: { open: database.open },
  };
});

import { FilesDatasetsController } from './files-datasets.controller.js';

afterEach(() => vi.clearAllMocks());

describe('FilesDatasetsController finalization', () => {
  it('keeps a committed file successful when staging cleanup is temporarily unavailable', async () => {
    const content = new TextEncoder().encode('verified file');
    const checksum = createHash('sha256').update(content).digest('hex');
    const file = { id: 'file-1', status: 'available' };
    const repo = {
      beginFinalization: vi.fn(async () => ({
        idempotent: false,
        file_id: 'file-1',
        staging_object_key: 'staging/project-1/upload-1/source',
        final_object_key: 'committed/project-1/files/file-1/source',
        expected_size_bytes: content.byteLength,
        expected_checksum: checksum,
        content_type: 'text/plain',
      })),
      completeFinalization: vi.fn(async () => file),
      failFinalization: vi.fn(),
    };
    database.open.mockResolvedValue(repo);
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Body: byteBody(content) })
      .mockResolvedValueOnce({ VersionId: 'version-1' })
      .mockResolvedValueOnce({ Body: byteBody(content) })
      .mockRejectedValueOnce(new Error('object storage cleanup unavailable'));
    const runtime = {
      pool: {},
      config: { S3_BUCKET: 'engrove' },
      s3: { send },
    } as never;
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(
      new FilesDatasetsController(runtime).complete(
        {} as never,
        'workspace-public-id',
        'project-public-id',
        '019fbcf9-e020-71da-935a-6a6a728b3790',
      ),
    ).resolves.toBe(file);
    expect(repo.completeFinalization).toHaveBeenCalledOnce();
    expect(repo.failFinalization).not.toHaveBeenCalled();
  });
});

describe('FilesDatasetsController storage identity and cleanup', () => {
  it('issues an inline preview URL only for supported image content types', async () => {
    const imageFile = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3790',
      final_object_key: 'committed/project-1/files/image/source',
      storage_version_id: 'version-1',
      original_name: 'inspection.png',
      content_type: 'image/png',
      size_bytes: '42',
    };
    const repo = {
      getAvailableFile: vi.fn(async () => imageFile),
    };
    database.open.mockResolvedValue(repo);
    const runtime = {
      pool: {},
      config: { S3_BUCKET: 'engrove' },
      s3Public: {},
    } as never;

    await expect(
      new FilesDatasetsController(runtime).imagePreview(
        {} as never,
        'workspace-public-id',
        'project-public-id',
        '019fbcf9-e020-71da-935a-6a6a728b3790',
      ),
    ).resolves.toMatchObject({
      url: 'https://uploads.example.test/signed',
      file: {
        originalName: 'inspection.png',
        contentType: 'image/png',
        sizeBytes: 42,
      },
    });
    const signedUrlCalls = aws.getSignedUrl.mock.calls as unknown as Array<
      [unknown, { input: Record<string, unknown> }]
    >;
    const command = signedUrlCalls.at(-1)![1];
    expect(command.input.ResponseContentDisposition).toContain('inline;');
    expect(command.input.ResponseContentType).toBe('image/png');

    repo.getAvailableFile.mockResolvedValueOnce({ ...imageFile, content_type: 'image/svg+xml' });
    await expect(
      new FilesDatasetsController(runtime).imagePreview(
        {} as never,
        'workspace-public-id',
        'project-public-id',
        '019fbcf9-e020-71da-935a-6a6a728b3790',
      ),
    ).rejects.toMatchObject({ code: 'FILE_PREVIEW_UNSUPPORTED', status: 415 });
  });

  it('uses the canonical project UUID for newly issued storage keys', async () => {
    const canonicalProjectId = '019fbcf9-e020-71da-935a-6a6a728b3704';
    const repo = {
      canonicalProjectId,
      issueUpload: vi.fn(async (input) => ({
        uploadId: input.uploadId,
        fileId: input.fileId,
        stagingObjectKey: input.stagingObjectKey,
      })),
    };
    database.open.mockResolvedValue(repo);
    const runtime = {
      pool: {},
      config: { S3_BUCKET: 'engrove' },
      s3Public: {},
    } as never;

    await new FilesDatasetsController(runtime).issue(
      {} as never,
      'workspace-public-id',
      'project-public-id',
      {
        seriesName: 'Series',
        originalName: 'data.csv',
        contentType: 'text/csv',
        sizeBytes: 12,
        checksum: 'a'.repeat(64),
      },
    );

    expect(repo.issueUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        stagingObjectKey: expect.stringMatching(`^staging/${canonicalProjectId}/`),
        finalObjectKey: expect.stringMatching(`^committed/${canonicalProjectId}/files/`),
      }),
    );
    expect(database.open).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      'workspace-1',
      'project-1',
      { allowSystem: false },
    );
  });

  it('allows supported image uploads to target a workspace data project', async () => {
    const repo = {
      canonicalProjectId: '019fbcf9-e020-71da-935a-6a6a728b3704',
      issueUpload: vi.fn(async (input) => ({ uploadId: input.uploadId, fileId: input.fileId })),
    };
    database.open.mockResolvedValue(repo);
    const runtime = {
      pool: {},
      config: { S3_BUCKET: 'engrove' },
      s3Public: {},
    } as never;

    await new FilesDatasetsController(runtime).issue(
      {} as never,
      'workspace-public-id',
      'project-public-id',
      {
        seriesName: 'Cell image',
        originalName: 'inspection.webp',
        contentType: 'image/webp',
        sizeBytes: 12,
        checksum: 'a'.repeat(64),
      },
    );

    expect(database.open).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      'workspace-1',
      'project-1',
      { allowSystem: true },
    );
  });

  it('lists legacy prefixes but revalidates and skips a newly protected object before deletion', async () => {
    const canonicalProjectId = '019fbcf9-e020-71da-935a-6a6a728b3704';
    const legacyProjectId = 'p1234567890abcd';
    const candidateKey = `committed/${canonicalProjectId}/orphan`;
    const repo = {
      storageCleanupProtection: vi.fn(async () => ({
        storageProjectIds: [canonicalProjectId, legacyProjectId],
        activeStagingKeys: [],
        eligibleStagingKeys: [],
        protectedCommittedKeys: [],
      })),
      storageCleanupCandidateDeletable: vi.fn(async () => false),
      auditStorageCleanup: vi.fn(),
    };
    database.open.mockResolvedValue(repo);
    const send = vi.fn(
      async (command: { constructor: { name: string }; input: { Prefix?: string } }) => {
        if (command.constructor.name !== 'ListObjectVersionsCommand')
          throw new Error('An object protected during revalidation must not be deleted.');
        return command.input.Prefix === `committed/${canonicalProjectId}/`
          ? {
              Versions: [
                {
                  Key: candidateKey,
                  VersionId: 'version-1',
                  LastModified: new Date(Date.now() - 60_000),
                },
              ],
            }
          : { Versions: [] };
      },
    );
    const runtime = {
      pool: {},
      config: { S3_BUCKET: 'engrove' },
      s3: { send },
    } as never;

    const report = await new FilesDatasetsController(runtime).cleanupExecute(
      {} as never,
      'workspace-public-id',
      legacyProjectId,
      { confirmation: 'DELETE_UNREFERENCED_OBJECTS', graceSeconds: 0 },
    );

    expect(report).toMatchObject({ deleted: 0 });
    expect(report.candidates).toHaveLength(1);
    expect(repo.storageCleanupCandidateDeletable).toHaveBeenCalledWith(
      candidateKey,
      'unreferenced-committed',
      0,
    );
    expect(send.mock.calls.map(([command]) => command.input.Prefix)).toEqual([
      `staging/${canonicalProjectId}/`,
      `committed/${canonicalProjectId}/`,
      `staging/${legacyProjectId}/`,
      `committed/${legacyProjectId}/`,
    ]);
  });
});

describe('FilesDatasetsController dataset catalog', () => {
  it('passes a bounded normalized list contract to the scoped repository', async () => {
    const page = {
      items: [{ id: 'dataset-1', name: 'Thermal sweep' }],
      pageInfo: { limit: 25, offset: 25, total: 26, hasNext: false },
    };
    const repo = { listDatasetPage: vi.fn(async () => page) };
    database.open.mockResolvedValue(repo);
    const runtime = { pool: {}, config: {}, s3: {} } as never;

    await expect(
      new FilesDatasetsController(runtime).datasets(
        {} as never,
        'workspace-public-id',
        'project-public-id',
        'false',
        ' Thermal ',
        '25',
        '25',
      ),
    ).resolves.toEqual(page);
    expect(repo.listDatasetPage).toHaveBeenCalledWith({
      includeArchived: false,
      query: 'Thermal',
      limit: 25,
      offset: 25,
    });
  });
});

describe('FilesDatasetsController bounded operational catalogs', () => {
  it('normalizes file search, lifecycle, status, and page controls', async () => {
    const page = {
      items: [{ id: 'file-1', original_name: 'report.pdf' }],
      pageInfo: { limit: 25, offset: 50, total: 51, hasNext: false },
    };
    const repo = { listFilePage: vi.fn(async () => page) };
    database.open.mockResolvedValue(repo);
    const runtime = { pool: {}, config: {}, s3: {} } as never;

    await expect(
      new FilesDatasetsController(runtime).files(
        {} as never,
        'workspace-public-id',
        'project-public-id',
        'true',
        undefined,
        ' Report ',
        'available',
        '25',
        '50',
      ),
    ).resolves.toEqual(page);
    expect(repo.listFilePage).toHaveBeenCalledWith({
      archiveState: 'all',
      query: 'Report',
      status: 'available',
      limit: 25,
      offset: 50,
    });
  });

  it('normalizes background-job search, status, and page controls', async () => {
    const page = {
      items: [{ id: 'job-1', job_type: 'dataset.process' }],
      pageInfo: { limit: 20, offset: 20, total: 21, hasNext: false },
    };
    const repo = { listJobPage: vi.fn(async () => page) };
    database.open.mockResolvedValue(repo);
    const runtime = { pool: {}, config: {}, s3: {} } as never;

    await expect(
      new FilesDatasetsController(runtime).jobs(
        {} as never,
        'workspace-public-id',
        'project-public-id',
        'failed',
        ' Dataset ',
        '20',
        '20',
      ),
    ).resolves.toEqual(page);
    expect(repo.listJobPage).toHaveBeenCalledWith({
      status: 'failed',
      query: 'Dataset',
      limit: 20,
      offset: 20,
    });
  });
});

function byteBody(content: Uint8Array) {
  return { transformToByteArray: async () => content };
}
