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

function byteBody(content: Uint8Array) {
  return { transformToByteArray: async () => content };
}
