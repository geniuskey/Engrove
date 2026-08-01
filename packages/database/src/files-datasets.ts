import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  REGISTRY_DIGEST,
  REGISTRY_VERSION,
  assertCompatibleUnit,
  type Dimension,
} from '@engrove/units';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';

const registryVersion = `${REGISTRY_VERSION}+sha256:${REGISTRY_DIGEST}`;
async function tx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
const stable = (value: unknown): unknown =>
  value && typeof value === 'object'
    ? Array.isArray(value)
      ? value.map(stable)
      : Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, stable(item)]),
        )
    : value;
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
const numeric = (value: unknown) => (value === null || value === undefined ? value : Number(value));
const fileRow = <T extends Record<string, unknown>>(row: T) => ({
  ...row,
  size_bytes: numeric(row.size_bytes),
});
const artifactRow = <T extends Record<string, unknown>>(row: T) => ({
  ...row,
  size_bytes: numeric(row.size_bytes),
});
const datasetRow = <T extends Record<string, unknown>>(row: T) => ({
  ...row,
  row_count: numeric(row.row_count),
  artifacts: Array.isArray(row.artifacts)
    ? row.artifacts.map((artifact) => artifactRow(artifact as Record<string, unknown>))
    : [],
});

export class ScopedFileDatasetRepository {
  private constructor(
    private readonly pool: Pool,
    private readonly actor: ActorSession,
    private readonly workspaceId: string,
    private readonly projectId: string,
  ) {}
  static async open(pool: Pool, actor: ActorSession, workspaceId: string, projectId: string) {
    const found = await pool.query(
      'select 1 from projects p join workspaces w on w.id=p.workspace_id where p.id=$1 and p.workspace_id=$2 and w.organization_id=$3',
      [projectId, workspaceId, actor.organizationId],
    );
    if (!found.rowCount)
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    return new ScopedFileDatasetRepository(pool, actor, workspaceId, projectId);
  }
  private audit(
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    payload: Record<string, unknown> = {},
  ) {
    return {
      organizationId: this.actor.organizationId,
      workspaceId: this.workspaceId,
      projectId: this.projectId,
      actorId: this.actor.actorId,
      action,
      targetType,
      targetId,
      requestId,
      payload,
    };
  }

  async issueUpload(input: {
    fileId: string;
    uploadId: string;
    seriesId?: string | undefined;
    seriesName: string;
    originalName: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
    stagingObjectKey: string;
    finalObjectKey: string;
    expiresAt: Date;
    requestId: string;
  }) {
    return tx(this.pool, async (client) => {
      let seriesId = input.seriesId;
      let series;
      if (seriesId) {
        const found = await client.query<{ latest_version_number: number; name: string }>(
          'select latest_version_number,name from file_series where project_id=$1 and id=$2 and archived_at is null for update',
          [this.projectId, seriesId],
        );
        series = found.rows[0];
        if (!series)
          throw new RepositoryError('FILE_SERIES_NOT_FOUND', 404, 'File series was not found.');
      } else {
        seriesId = uuidv7();
        series = { latest_version_number: 0, name: input.seriesName.trim() };
        await client.query(
          'insert into file_series (id,project_id,name,created_by) values ($1,$2,$3,$4)',
          [seriesId, this.projectId, series.name, this.actor.actorId],
        );
      }
      const version = series.latest_version_number + 1;
      const previous =
        version > 1
          ? await client.query<{ id: string }>(
              'select id from file_objects where project_id=$1 and file_series_id=$2 and version_number=$3',
              [this.projectId, seriesId, version - 1],
            )
          : null;
      const fileId = input.fileId;
      const uploadId = input.uploadId;
      await client.query(
        `insert into file_objects (id,project_id,file_series_id,version_number,previous_file_id,final_object_key,original_name,content_type,size_bytes,checksum,uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          fileId,
          this.projectId,
          seriesId,
          version,
          previous?.rows[0]?.id ?? null,
          input.finalObjectKey,
          input.originalName,
          input.contentType,
          input.sizeBytes,
          input.checksum,
          this.actor.actorId,
        ],
      );
      await client.query(
        `insert into file_upload_sessions (id,project_id,file_id,staging_object_key,expected_size_bytes,expected_checksum,expires_at,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          uploadId,
          this.projectId,
          fileId,
          input.stagingObjectKey,
          input.sizeBytes,
          input.checksum,
          input.expiresAt,
          this.actor.actorId,
        ],
      );
      await client.query(
        'update file_series set latest_version_number=$3,updated_at=now() where project_id=$1 and id=$2',
        [this.projectId, seriesId, version],
      );
      await appendAudit(
        client,
        this.audit('file.upload_issued', 'file_object', fileId, input.requestId, {
          seriesId,
          version,
          uploadId,
        }),
      );
      return {
        uploadId,
        fileId,
        seriesId,
        version,
        stagingObjectKey: input.stagingObjectKey,
        expiresAt: input.expiresAt.toISOString(),
      };
    });
  }

  async beginFinalization(uploadId: string) {
    return tx(this.pool, async (client) => {
      const result = await client.query(
        `select s.*,f.final_object_key,f.content_type,f.status file_status from file_upload_sessions s join file_objects f on f.project_id=s.project_id and f.id=s.file_id where s.project_id=$1 and s.id=$2 for update of s,f`,
        [this.projectId, uploadId],
      );
      const row = result.rows[0];
      if (!row) throw new RepositoryError('UPLOAD_NOT_FOUND', 404, 'Upload session was not found.');
      if (row.status === 'finalized' && row.file_status === 'available')
        return { ...row, idempotent: true };
      if (row.expires_at < new Date())
        throw new RepositoryError('UPLOAD_EXPIRED', 409, 'Upload session expired.');
      if (!['issued', 'verifying'].includes(row.status))
        throw new RepositoryError('UPLOAD_STATE_CONFLICT', 409, 'Upload cannot be finalized.');
      await client.query(
        "update file_upload_sessions set status='verifying' where project_id=$1 and id=$2",
        [this.projectId, uploadId],
      );
      await client.query(
        "update file_objects set status='verifying' where project_id=$1 and id=$2",
        [this.projectId, row.file_id],
      );
      return { ...row, idempotent: false };
    });
  }
  async completeFinalization(uploadId: string, storageVersionId: string | null, requestId: string) {
    return tx(this.pool, async (client) => {
      const session = await client.query<{ file_id: string }>(
        "update file_upload_sessions set status='finalized',completed_at=coalesce(completed_at,now()) where project_id=$1 and id=$2 and status in ('verifying','finalized') returning file_id",
        [this.projectId, uploadId],
      );
      if (!session.rows[0])
        throw new RepositoryError('UPLOAD_STATE_CONFLICT', 409, 'Upload cannot be completed.');
      const file = await client.query(
        "update file_objects set status='available',storage_version_id=coalesce(storage_version_id,$3),available_at=coalesce(available_at,now()) where project_id=$1 and id=$2 and status in ('verifying','available') returning *",
        [this.projectId, session.rows[0].file_id, storageVersionId],
      );
      await appendAudit(
        client,
        this.audit('file.finalized', 'file_object', session.rows[0].file_id, requestId, {
          uploadId,
        }),
      );
      return fileRow(file.rows[0]);
    });
  }
  async failFinalization(uploadId: string, code: string, requestId: string) {
    return tx(this.pool, async (client) => {
      const session = await client.query<{ file_id: string }>(
        "update file_upload_sessions set status='failed',failure_code=$3 where project_id=$1 and id=$2 and status<>'finalized' returning file_id",
        [this.projectId, uploadId, code],
      );
      if (session.rows[0])
        await client.query(
          "update file_objects set status='failed',failure_code=$3 where project_id=$1 and id=$2 and status<>'available'",
          [this.projectId, session.rows[0].file_id, code],
        );
      await appendAudit(
        client,
        this.audit('file.finalization_failed', 'file_upload_session', uploadId, requestId, {
          code,
        }),
      );
    });
  }
  async listFiles(includeArchived = false) {
    const result = await this.pool.query(
      `select f.*,s.name series_name from file_objects f join file_series s on s.id=f.file_series_id and s.project_id=f.project_id where f.project_id=$1 and ($2::boolean or f.archived_at is null) order by f.created_at desc,f.id`,
      [this.projectId, includeArchived],
    );
    return result.rows.map(fileRow);
  }
  async getAvailableFile(fileId: string) {
    const result = await this.pool.query(
      "select * from file_objects where project_id=$1 and id=$2 and status='available'",
      [this.projectId, fileId],
    );
    if (!result.rows[0])
      throw new RepositoryError('FILE_NOT_AVAILABLE', 404, 'Available file was not found.');
    return fileRow(result.rows[0]);
  }
  async setFileArchived(fileId: string, archived: boolean, reason: string, requestId: string) {
    return tx(this.pool, async (client) => {
      const result = await client.query(
        `update file_objects set archived_at=${archived ? 'now()' : 'null'},archived_by=${archived ? '$3' : 'null'},archive_reason=${archived ? '$4' : 'null'} where project_id=$1 and id=$2 and archived_at is ${archived ? 'null' : 'not null'} returning *`,
        archived
          ? [this.projectId, fileId, this.actor.actorId, reason.trim()]
          : [this.projectId, fileId],
      );
      if (!result.rows[0])
        throw new RepositoryError(
          'FILE_STATE_CONFLICT',
          409,
          'File is already in the requested state.',
        );
      await appendAudit(
        client,
        this.audit(archived ? 'file.archived' : 'file.restored', 'file_object', fileId, requestId, {
          reason: archived ? reason.trim() : null,
        }),
      );
      return fileRow(result.rows[0]);
    });
  }

  async createDataset(input: {
    name: string;
    sourceFileId?: string | undefined;
    sourceDatasetId?: string | undefined;
    datasetType: 'tabular' | 'xy';
    parameters: Record<string, unknown>;
    requestId: string;
  }) {
    return tx(this.pool, async (client) => {
      if (Boolean(input.sourceFileId) === Boolean(input.sourceDatasetId))
        throw new RepositoryError(
          'DATASET_SOURCE_INVALID',
          400,
          'Exactly one dataset source is required.',
        );
      let sourceVersion: string | null = null;
      if (input.sourceFileId) {
        const file = await client.query<{ storage_version_id: string | null }>(
          "select storage_version_id from file_objects where project_id=$1 and id=$2 and status='available'",
          [this.projectId, input.sourceFileId],
        );
        if (!file.rows[0])
          throw new RepositoryError('FILE_NOT_AVAILABLE', 404, 'Source file is not available.');
        sourceVersion = file.rows[0].storage_version_id;
      } else {
        const source = await client.query<{ schema: Record<string, unknown> }>(
          "select schema from datasets where project_id=$1 and id=$2 and status='ready' and archived_at is null",
          [this.projectId, input.sourceDatasetId],
        );
        if (!source.rows[0])
          throw new RepositoryError('DATASET_NOT_READY', 409, 'Source dataset is not ready.');
        if (input.datasetType !== 'xy')
          throw new RepositoryError(
            'DATASET_TRANSFORMATION_INVALID',
            400,
            'Derived MVP datasets must be XY.',
          );
        const columns = (source.rows[0].schema.columns ?? []) as Array<{ id: string }>;
        for (const key of ['xColumnId', 'yColumnId'])
          if (!columns.some((column) => column.id === input.parameters[key]))
            throw new RepositoryError(
              'DATASET_COLUMN_NOT_FOUND',
              400,
              `Dataset ${key} is invalid.`,
            );
        for (const axis of ['x', 'y'])
          if (input.parameters[`${axis}Unit`] && input.parameters[`${axis}Dimension`])
            assertCompatibleUnit(
              String(input.parameters[`${axis}Unit`]),
              String(input.parameters[`${axis}Dimension`]) as Dimension,
            );
      }
      const transformationName =
        input.datasetType === 'tabular' ? 'csv.parse' : 'dataset.select_xy';
      const transformationVersion = '1';
      const inputFingerprint = hash({
        sourceFileId: input.sourceFileId ?? null,
        sourceDatasetId: input.sourceDatasetId ?? null,
        sourceVersion,
        datasetType: input.datasetType,
        transformationName,
        transformationVersion,
        parameters: stable(input.parameters),
        unitRegistryVersion: registryVersion,
      });
      const existing = await client.query(
        'select * from datasets where project_id=$1 and input_fingerprint=$2',
        [this.projectId, inputFingerprint],
      );
      if (existing.rows[0]) return { dataset: datasetRow(existing.rows[0]), idempotent: true };
      const id = uuidv7();
      const jobId = uuidv7();
      await client.query(
        `insert into datasets (id,project_id,source_file_id,source_dataset_id,dataset_type,name,transformation_name,transformation_version,parameters,input_fingerprint,unit_registry_version,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)`,
        [
          id,
          this.projectId,
          input.sourceFileId ?? null,
          input.sourceDatasetId ?? null,
          input.datasetType,
          input.name.trim(),
          transformationName,
          transformationVersion,
          JSON.stringify(stable(input.parameters)),
          inputFingerprint,
          registryVersion,
          this.actor.actorId,
        ],
      );
      await client.query(
        `insert into background_jobs (id,project_id,job_type,entity_type,entity_id,input_fingerprint,payload) values ($1,$2,'dataset.process','dataset',$3,$4,$5::jsonb)`,
        [jobId, this.projectId, id, `job:${inputFingerprint}`, JSON.stringify({ datasetId: id })],
      );
      await client.query(
        `insert into outbox_events (id,project_id,event_type,entity_type,entity_id,payload) values ($1,$2,'dataset.parse_requested','dataset',$3,$4::jsonb)`,
        [uuidv7(), this.projectId, id, JSON.stringify({ jobId })],
      );
      await appendAudit(
        client,
        this.audit('dataset.parse_requested', 'dataset', id, input.requestId, {
          jobId,
          inputFingerprint,
        }),
      );
      const dataset = await client.query('select * from datasets where id=$1', [id]);
      return { dataset: datasetRow(dataset.rows[0]), jobId, idempotent: false };
    });
  }
  async listDatasets(includeArchived = false) {
    const result = await this.pool.query(
      `select d.*,coalesce(json_agg(a order by a.artifact_kind) filter(where a.id is not null),'[]') artifacts from datasets d left join dataset_artifacts a on a.dataset_id=d.id and a.project_id=d.project_id where d.project_id=$1 and ($2::boolean or d.archived_at is null) group by d.id order by d.created_at desc,d.id`,
      [this.projectId, includeArchived],
    );
    return result.rows.map(datasetRow);
  }
  async getDataset(id: string) {
    const result = await this.pool.query('select * from datasets where project_id=$1 and id=$2', [
      this.projectId,
      id,
    ]);
    if (!result.rows[0])
      throw new RepositoryError('DATASET_NOT_FOUND', 404, 'Dataset was not found.');
    const artifacts = await this.pool.query(
      'select * from dataset_artifacts where project_id=$1 and dataset_id=$2 order by artifact_kind',
      [this.projectId, id],
    );
    return datasetRow({ ...result.rows[0], artifacts: artifacts.rows });
  }
  async setDatasetArchived(id: string, archived: boolean, reason: string, requestId: string) {
    return tx(this.pool, async (client) => {
      const result = await client.query(
        `update datasets set archived_at=${archived ? 'now()' : 'null'},archived_by=${archived ? '$3' : 'null'},archive_reason=${archived ? '$4' : 'null'},updated_at=now() where project_id=$1 and id=$2 and archived_at is ${archived ? 'null' : 'not null'} returning *`,
        archived ? [this.projectId, id, this.actor.actorId, reason.trim()] : [this.projectId, id],
      );
      if (!result.rows[0])
        throw new RepositoryError(
          'DATASET_STATE_CONFLICT',
          409,
          'Dataset is already in the requested state.',
        );
      await appendAudit(
        client,
        this.audit(archived ? 'dataset.archived' : 'dataset.restored', 'dataset', id, requestId, {
          reason: archived ? reason.trim() : null,
        }),
      );
      return datasetRow(result.rows[0]);
    });
  }
  async retryDataset(id: string, requestId: string) {
    return tx(this.pool, async (client) => {
      const dataset = await client.query(
        "update datasets set status='pending',failure_code=null,failure_details='{}',updated_at=now() where project_id=$1 and id=$2 and status='failed' returning input_fingerprint",
        [this.projectId, id],
      );
      if (!dataset.rows[0])
        throw new RepositoryError(
          'DATASET_RETRY_CONFLICT',
          409,
          'Only a failed dataset can be retried.',
        );
      const job = await client.query(
        "update background_jobs set status='queued',scheduled_at=now(),completed_at=null,error_code=null,error_details='{}',retryable=true,updated_at=now() where project_id=$1 and entity_id=$2 and status='failed' returning id",
        [this.projectId, id],
      );
      if (!job.rows[0])
        throw new RepositoryError('JOB_RETRY_CONFLICT', 409, 'Failed job was not found.');
      await client.query(
        `insert into outbox_events (id,project_id,event_type,entity_type,entity_id,payload) values ($1,$2,'job.retry_scheduled','dataset',$3,$4::jsonb)`,
        [uuidv7(), this.projectId, id, JSON.stringify({ jobId: job.rows[0].id })],
      );
      await appendAudit(
        client,
        this.audit('job.retry_scheduled', 'dataset', id, requestId, { jobId: job.rows[0].id }),
      );
      return { id, jobId: job.rows[0].id };
    });
  }

  async listJobs() {
    const result = await this.pool.query(
      `select j.*,coalesce(json_agg(a order by a.attempt_number) filter(where a.id is not null),'[]') attempts
       from background_jobs j left join background_job_attempts a on a.job_id=j.id and a.project_id=j.project_id
       where j.project_id=$1 group by j.id order by j.created_at desc,j.id`,
      [this.projectId],
    );
    return result.rows;
  }

  async storageCleanupProtection(graceSeconds: number) {
    return tx(this.pool, async (client) => {
      await client.query(
        "update file_upload_sessions set status='expired',failure_code='UPLOAD_EXPIRED' where project_id=$1 and status='issued' and expires_at<now()",
        [this.projectId],
      );
      const [active, eligible, committed, checkpoints] = await Promise.all([
        client.query<{ staging_object_key: string }>(
          "select staging_object_key from file_upload_sessions where project_id=$1 and status in ('issued','verifying')",
          [this.projectId],
        ),
        client.query<{ staging_object_key: string }>(
          `select staging_object_key from file_upload_sessions where project_id=$1 and status in ('finalized','failed','expired')
           and created_at<now()-($2||' seconds')::interval`,
          [this.projectId, graceSeconds],
        ),
        client.query<{ object_key: string }>(
          `select final_object_key object_key from file_objects where project_id=$1 and status='available'
           union all select object_key from dataset_artifacts where project_id=$1`,
          [this.projectId],
        ),
        client.query<{ result_checkpoint: { artifacts?: Array<{ objectKey?: string }> } }>(
          `select a.result_checkpoint from background_job_attempts a join background_jobs j on j.id=a.job_id
           where j.project_id=$1 and j.status='running' and a.status='running'`,
          [this.projectId],
        ),
      ]);
      return {
        activeStagingKeys: active.rows.map((row) => row.staging_object_key),
        eligibleStagingKeys: eligible.rows.map((row) => row.staging_object_key),
        protectedCommittedKeys: [
          ...committed.rows.map((row) => row.object_key),
          ...checkpoints.rows.flatMap((row) =>
            (row.result_checkpoint.artifacts ?? []).flatMap((artifact) =>
              artifact.objectKey ? [artifact.objectKey] : [],
            ),
          ),
        ],
      };
    });
  }

  async auditStorageCleanup(
    requestId: string,
    mode: 'dry-run' | 'execute',
    candidates: number,
    deleted: number,
  ) {
    await tx(this.pool, (client) =>
      appendAudit(
        client,
        this.audit('storage.cleanup', 'project', this.projectId, requestId, {
          mode,
          candidates,
          deleted,
        }),
      ),
    );
  }
}

export async function claimDatasetJob(pool: Pool, workerId: string, leaseSeconds = 60) {
  return tx(pool, async (client) => {
    await client.query(
      `update background_job_attempts a set status='failed',completed_at=now(),error_code='JOB_LEASE_EXPIRED',retryable=true
       from background_jobs j where a.job_id=j.id and a.status='running' and j.status='running' and j.lease_expires_at<now()`,
    );
    await client.query(
      "update background_jobs set status='queued',lease_owner=null,lease_expires_at=null,updated_at=now() where status='running' and lease_expires_at<now()",
    );
    await client.query(
      `update background_jobs j set status='succeeded',progress=100,completed_at=coalesce(completed_at,now()),lease_owner=null,lease_expires_at=null,updated_at=now()
       from datasets d where j.entity_type='dataset' and j.entity_id=d.id and j.project_id=d.project_id and d.status='ready' and j.status in ('queued','running')`,
    );
    const job = await client.query(
      `select * from background_jobs where status='queued' and scheduled_at<=now() order by scheduled_at,id for update skip locked limit 1`,
    );
    if (!job.rows[0]) return null;
    const row = job.rows[0];
    const attemptNumber = Number(row.attempt_count) + 1;
    await client.query(
      "update background_jobs set status='running',attempt_count=$2,lease_owner=$3,lease_expires_at=now()+($4||' seconds')::interval,started_at=coalesce(started_at,now()),updated_at=now() where id=$1",
      [row.id, attemptNumber, workerId, leaseSeconds],
    );
    const attemptId = uuidv7();
    await client.query(
      'insert into background_job_attempts (id,project_id,job_id,attempt_number,worker_identity) values ($1,$2,$3,$4,$5)',
      [attemptId, row.project_id, row.id, attemptNumber, workerId],
    );
    await client.query(
      "update datasets set status='processing',updated_at=now() where id=$1 and status in ('pending','processing')",
      [row.entity_id],
    );
    return { ...row, attemptId, attemptNumber };
  });
}

export async function completeDatasetJob(
  pool: Pool,
  input: {
    jobId: string;
    attemptId: string;
    datasetId: string;
    projectId: string;
    artifacts: Array<{
      id: string;
      kind: string;
      objectKey: string;
      storageVersionId: string | null;
      contentType: string;
      sizeBytes: number;
      checksum: string;
    }>;
    schema: unknown;
    statistics: unknown;
    rowCount: number;
  },
) {
  return tx(pool, async (client) => {
    for (const artifact of input.artifacts)
      await client.query(
        `insert into dataset_artifacts (id,project_id,dataset_id,artifact_kind,object_key,storage_version_id,content_type,size_bytes,checksum) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          artifact.id,
          input.projectId,
          input.datasetId,
          artifact.kind,
          artifact.objectKey,
          artifact.storageVersionId,
          artifact.contentType,
          artifact.sizeBytes,
          artifact.checksum,
        ],
      );
    await client.query(
      "update datasets set status='ready',schema=$2::jsonb,statistics=$3::jsonb,row_count=$4,ready_at=now(),updated_at=now() where id=$1 and status='processing'",
      [
        input.datasetId,
        JSON.stringify(input.schema),
        JSON.stringify(input.statistics),
        input.rowCount,
      ],
    );
    await client.query(
      "update background_job_attempts set status='succeeded',progress=100,completed_at=now(),heartbeat_at=now(),result_checkpoint=$2::jsonb where id=$1 and status='running'",
      [
        input.attemptId,
        JSON.stringify({
          artifacts: input.artifacts.map((artifact) => ({
            artifactId: artifact.id,
            objectKey: artifact.objectKey,
            checksum: artifact.checksum,
          })),
        }),
      ],
    );
    await client.query(
      "update background_jobs set status='succeeded',progress=100,completed_at=now(),lease_owner=null,lease_expires_at=null,updated_at=now() where id=$1 and status='running'",
      [input.jobId],
    );
    await client.query(
      `insert into outbox_events (id,project_id,event_type,entity_type,entity_id,payload) values ($1,$2,'dataset.parsed','dataset',$3,$4::jsonb)`,
      [uuidv7(), input.projectId, input.datasetId, JSON.stringify({ jobId: input.jobId })],
    );
    await client.query(
      `insert into audit_events (id,organization_id,workspace_id,project_id,actor_id,action,target_type,target_id,request_id,payload)
       select $1,w.organization_id,p.workspace_id,p.id,null,'dataset.parsed','dataset',$2,$3,$4::jsonb from projects p join workspaces w on w.id=p.workspace_id where p.id=$5`,
      [
        uuidv7(),
        input.datasetId,
        `job:${input.jobId}`,
        JSON.stringify({ rowCount: input.rowCount, artifactCount: input.artifacts.length }),
        input.projectId,
      ],
    );
  });
}
export async function failDatasetJob(
  pool: Pool,
  input: {
    jobId: string;
    attemptId: string;
    datasetId: string;
    attemptNumber: number;
    maxAttempts: number;
    code: string;
    retryable: boolean;
  },
) {
  return tx(pool, async (client) => {
    const retry = input.retryable && input.attemptNumber < input.maxAttempts;
    await client.query(
      "update background_job_attempts set status='failed',completed_at=now(),heartbeat_at=now(),error_code=$2,retryable=$3 where id=$1 and status='running'",
      [input.attemptId, input.code, input.retryable],
    );
    await client.query(
      `update background_jobs set status=$2::job_status,scheduled_at=case when $2::job_status='queued' then now()+(least(30,power(2,$3))||' seconds')::interval else scheduled_at end,error_code=$4,retryable=$5,lease_owner=null,lease_expires_at=null,completed_at=case when $2::job_status='failed' then now() else null end,updated_at=now() where id=$1`,
      [input.jobId, retry ? 'queued' : 'failed', input.attemptNumber, input.code, input.retryable],
    );
    await client.query(
      `update datasets set status=$2::dataset_status,failure_code=$3,failure_details=$4::jsonb,updated_at=now() where id=$1`,
      [
        input.datasetId,
        retry ? 'pending' : 'failed',
        input.code,
        JSON.stringify({ retryable: input.retryable, attempt: input.attemptNumber }),
      ],
    );
    if (!retry) {
      await client.query(
        `insert into outbox_events (id,project_id,event_type,entity_type,entity_id,payload) select $1,project_id,'dataset.parse_failed','dataset',$2,$3::jsonb from background_jobs where id=$4`,
        [
          uuidv7(),
          input.datasetId,
          JSON.stringify({ jobId: input.jobId, code: input.code }),
          input.jobId,
        ],
      );
      await client.query(
        `insert into audit_events (id,organization_id,workspace_id,project_id,actor_id,action,target_type,target_id,request_id,payload)
         select $1,w.organization_id,p.workspace_id,p.id,null,'dataset.parse_failed','dataset',$2,$3,$4::jsonb from background_jobs j join projects p on p.id=j.project_id join workspaces w on w.id=p.workspace_id where j.id=$5`,
        [
          uuidv7(),
          input.datasetId,
          `job:${input.jobId}`,
          JSON.stringify({ code: input.code }),
          input.jobId,
        ],
      );
    }
  });
}
