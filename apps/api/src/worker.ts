import { createHash, randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parseConfig } from '@engrove/config';
import {
  checkDatabase,
  claimDatasetJob,
  completeDatasetJob,
  createPool,
  failDatasetJob,
  renewDatasetJobLease,
} from '@engrove/database';
import { Queue, Worker as BullWorker } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { v7 as uuidv7 } from 'uuid';

const config = parseConfig(process.env);
const log = pino({ level: config.LOG_LEVEL, redact: ['databaseUrl', 'redisUrl'] });
const pool = createPool(config.DATABASE_URL, { max: 2 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue('engrove-system', { connection: redis });
const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  },
});
const workerId = randomUUID();
const heartbeatKey = `engrove:worker-node:${workerId}:heartbeat`;
const DATASET_LEASE_SECONDS = 60;
const DATASET_LEASE_HEARTBEAT_MS = 20_000;
const PYTHON_PROCESS_TIMEOUT_MS = 10 * 60_000;
let heartbeat: NodeJS.Timeout | undefined;
let reconciliation: NodeJS.Timeout | undefined;
let stopping = false;

async function objectDigest(key: string, versionId?: string | null) {
  const object = await s3.send(
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key, VersionId: versionId ?? undefined }),
  );
  if (!object.Body) throw new Error('SOURCE_OBJECT_MISSING');
  const digest = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
    sizeBytes += chunk.byteLength;
    digest.update(chunk);
  }
  return {
    checksum: digest.digest('hex'),
    sizeBytes,
    storageVersionId: object.VersionId ?? versionId ?? null,
  };
}

interface ArtifactPlan {
  id: string;
  kind: 'parquet' | 'preview';
  objectKey: string;
  storageVersionId: string | null;
  contentType: string;
  sizeBytes: number;
  checksum: string;
}

async function checkpointArtifacts(jobId: string, attemptId: string, artifacts: ArtifactPlan[]) {
  const checkpointed = await pool.query(
    `update background_job_attempts a
     set result_checkpoint=$4::jsonb,heartbeat_at=now()
     from background_jobs j
     where a.id=$1 and a.job_id=$2 and a.job_id=j.id
       and a.status='running' and a.worker_identity=$3
       and j.status='running' and j.lease_owner=$3 and j.lease_expires_at>now()
     returning a.id`,
    [attemptId, jobId, workerId, JSON.stringify({ artifacts })],
  );
  if (!checkpointed.rowCount) throw new Error('JOB_LEASE_LOST');
}

async function processNextDataset(): Promise<void> {
  const maintenance = await pool.query(
    'select 1 from maintenance_state where singleton=true and lease_expires_at>now()',
  );
  if (maintenance.rowCount) return;
  const job = await claimDatasetJob(pool, workerId, DATASET_LEASE_SECONDS);
  if (!job) return;
  const processingAbort = new AbortController();
  let leaseLost = false;
  let renewingLease = false;
  let activeLeaseRenewal: Promise<void> | undefined;
  const loseLease = (error: unknown) => {
    if (leaseLost) return;
    leaseLost = true;
    processingAbort.abort(error instanceof Error ? error : new Error('JOB_LEASE_LOST'));
  };
  const renewLease = async () => {
    const renewed = await renewDatasetJobLease(
      pool,
      { jobId: job.id, attemptId: job.attemptId, workerId },
      DATASET_LEASE_SECONDS,
    );
    if (!renewed) {
      const error = new Error('JOB_LEASE_LOST');
      loseLease(error);
      throw error;
    }
  };
  const leaseHeartbeat = setInterval(() => {
    if (renewingLease || leaseLost) return;
    renewingLease = true;
    const renewal = renewLease();
    activeLeaseRenewal = renewal;
    void renewal
      .catch((error: unknown) => {
        loseLease(error);
        log.warn({ jobId: job.id, err: error }, 'dataset job lease renewal failed');
      })
      .finally(() => {
        renewingLease = false;
        if (activeLeaseRenewal === renewal) activeLeaseRenewal = undefined;
      });
  }, DATASET_LEASE_HEARTBEAT_MS);
  leaseHeartbeat.unref();
  try {
    const datasetResult = await pool.query(
      `select d.*,f.final_object_key file_key,f.storage_version_id file_version,
        f.size_bytes file_size,f.checksum file_checksum,a.object_key dataset_key,
        a.storage_version_id dataset_version,a.size_bytes dataset_size,a.checksum dataset_checksum,
        source.schema source_schema
       from datasets d
       left join file_objects f on f.id=d.source_file_id and f.project_id=d.project_id
       left join datasets source on source.id=d.source_dataset_id and source.project_id=d.project_id
       left join dataset_artifacts a on a.dataset_id=source.id and a.project_id=source.project_id
        and a.artifact_kind='parquet'
       where d.id=$1 and d.project_id=$2`,
      [job.entity_id, job.project_id],
    );
    const dataset = datasetResult.rows[0];
    if (!dataset) throw new Error('DATASET_NOT_FOUND');
    const sourceKey = dataset.file_key ?? dataset.dataset_key;
    const sourceVersion = dataset.file_version ?? dataset.dataset_version;
    const sourceSize = Number(dataset.file_size ?? dataset.dataset_size);
    const sourceChecksum = String(dataset.file_checksum ?? dataset.dataset_checksum ?? '');
    if (!sourceKey || !sourceVersion || !sourceSize || !/^[a-f0-9]{64}$/.test(sourceChecksum))
      throw new Error('DATASET_SOURCE_INVALID');
    const artifacts: ArtifactPlan[] = (
      [
        ['parquet', 'application/vnd.apache.parquet'],
        ['preview', 'application/json'],
      ] as const
    ).map(([kind, contentType]) => {
      // Every attempt gets distinct keys. A timed-out worker can finish an in-flight
      // upload after its lease is lost, so sharing keys across attempts would allow
      // it to overwrite the active attempt's output even though database fencing works.
      const artifactId = uuidv7();
      return {
        id: artifactId,
        kind,
        objectKey: `committed/${job.project_id}/datasets/${job.entity_id}/${artifactId}/${kind}`,
        storageVersionId: null,
        contentType,
        sizeBytes: 0,
        checksum: '',
      };
    });
    await checkpointArtifacts(job.id, job.attemptId, artifacts);
    const sourceUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: sourceKey,
        VersionId: sourceVersion,
      }),
      { expiresIn: 15 * 60 },
    );
    const artifactUploads = Object.fromEntries(
      await Promise.all(
        artifacts.map(async (artifact) => [
          artifact.kind,
          {
            url: await getSignedUrl(
              s3,
              new PutObjectCommand({
                Bucket: config.S3_BUCKET,
                Key: artifact.objectKey,
                ContentType: artifact.contentType,
              }),
              { expiresIn: 15 * 60 },
            ),
            content_type: artifact.contentType,
          },
        ]),
      ),
    );
    if (processingAbort.signal.aborted) throw processingAbort.signal.reason;
    const response = await fetch(`${config.PYTHON_WORKER_BASE_URL}/internal/v1/process-dataset`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-engrove-internal-secret': config.INTERNAL_SERVICE_SECRET,
        'x-request-id': job.id,
      },
      body: JSON.stringify({
        dataset_type: dataset.dataset_type,
        source_url: sourceUrl,
        source_size_bytes: sourceSize,
        source_checksum: sourceChecksum,
        artifact_uploads: artifactUploads,
        parameters: dataset.parameters,
        source_schema: dataset.source_schema,
      }),
      signal: AbortSignal.any([
        processingAbort.signal,
        AbortSignal.timeout(PYTHON_PROCESS_TIMEOUT_MS),
      ]),
    });
    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`DATASET_PARSE_FAILED:${detail.slice(0, 300)}`);
      Object.assign(error, { retryable: response.status >= 500 });
      throw error;
    }
    const result = (await response.json()) as {
      schema: unknown;
      statistics: unknown;
      rowCount: number;
      artifacts: Array<{
        kind: 'parquet' | 'preview';
        checksum: string;
        sizeBytes: number;
      }>;
    };
    if (processingAbort.signal.aborted) throw processingAbort.signal.reason;
    for (const artifact of artifacts) {
      if (processingAbort.signal.aborted) throw processingAbort.signal.reason;
      const reported = result.artifacts.find((item) => item.kind === artifact.kind);
      if (!reported || !/^[a-f0-9]{64}$/.test(reported.checksum))
        throw new Error('ARTIFACT_RESULT_INVALID');
      const verified = await objectDigest(artifact.objectKey);
      if (verified.checksum !== reported.checksum || verified.sizeBytes !== reported.sizeBytes) {
        const conflict = new Error('ARTIFACT_CHECKSUM_CONFLICT');
        Object.assign(conflict, { retryable: false });
        throw conflict;
      }
      artifact.storageVersionId = verified.storageVersionId;
      artifact.sizeBytes = verified.sizeBytes;
      artifact.checksum = verified.checksum;
      await checkpointArtifacts(job.id, job.attemptId, artifacts);
    }
    clearInterval(leaseHeartbeat);
    await activeLeaseRenewal;
    await renewLease();
    await completeDatasetJob(pool, {
      jobId: job.id,
      attemptId: job.attemptId,
      workerId,
      datasetId: job.entity_id,
      projectId: job.project_id,
      artifacts,
      schema: result.schema,
      statistics: result.statistics,
      rowCount: result.rowCount,
    });
    log.info({ jobId: job.id, datasetId: job.entity_id }, 'dataset job completed');
  } catch (error) {
    clearInterval(leaseHeartbeat);
    await activeLeaseRenewal?.catch(() => undefined);
    if (leaseLost) {
      log.warn({ jobId: job.id, err: error }, 'dataset job stopped after losing its lease');
      return;
    }
    const message = error instanceof Error ? error.message : 'DATASET_PROCESSING_FAILED';
    const retryable =
      typeof error === 'object' && error && 'retryable' in error
        ? Boolean(error.retryable)
        : !message.startsWith('DATASET_PARSE_FAILED');
    try {
      await renewLease();
    } catch (leaseError) {
      log.warn(
        { jobId: job.id, err: leaseError },
        'dataset job failure was not recorded after losing its lease',
      );
      return;
    }
    await failDatasetJob(pool, {
      jobId: job.id,
      attemptId: job.attemptId,
      workerId,
      datasetId: job.entity_id,
      attemptNumber: job.attemptNumber,
      maxAttempts: Number(job.max_attempts),
      code: message.split(':')[0]!.slice(0, 100),
      retryable,
    });
    log.error({ jobId: job.id, err: error }, 'dataset job failed');
  } finally {
    clearInterval(leaseHeartbeat);
  }
}

async function reconcile(): Promise<void> {
  const maintenance = await pool.query(
    'select 1 from maintenance_state where singleton=true and lease_expires_at>now()',
  );
  if (maintenance.rowCount) return;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const events = await client.query<{ id: string; payload: { jobId?: string } }>(
      `select id,payload from outbox_events where dispatched_at is null order by created_at,id for update skip locked limit 100`,
    );
    for (const event of events.rows) {
      if (event.payload.jobId)
        await queue.add(
          'job-wakeup',
          { jobId: event.payload.jobId },
          { jobId: event.payload.jobId, removeOnComplete: true, removeOnFail: true },
        );
      await client.query(
        'update outbox_events set dispatched_at=now(),attempt_count=attempt_count+1,last_error=null where id=$1 and dispatched_at is null',
        [event.id],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    log.warn({ err: error }, 'outbox reconciliation failed');
  } finally {
    client.release();
  }
  const queued = await pool.query<{ id: string }>(
    "select id from background_jobs where job_type='dataset.process' and entity_type='dataset' and status='queued' and scheduled_at<=now() order by scheduled_at limit 100",
  );
  for (const job of queued.rows)
    await queue
      .add(
        'job-wakeup',
        { jobId: job.id },
        { jobId: job.id, removeOnComplete: true, removeOnFail: true },
      )
      .catch(() => undefined);
}
const bullWorker = new BullWorker('engrove-system', async () => processNextDataset(), {
  connection: redis,
  concurrency: 2,
});

async function connectWithRetry(attempts = 20): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await Promise.all([checkDatabase(pool), redis.ping(), queue.waitUntilReady()]);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      log.warn({ attempt }, 'dependencies not ready');
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * attempt, 2_000)));
    }
  }
}

async function publishHeartbeat(): Promise<void> {
  await redis.set(heartbeatKey, new Date().toISOString(), 'EX', 15);
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (heartbeat) clearInterval(heartbeat);
  if (reconciliation) clearInterval(reconciliation);
  await rm('/tmp/engrove-worker-ready', { force: true });
  log.info({ signal, workerId }, 'worker shutting down');
  await Promise.allSettled([
    bullWorker.close(),
    queue.close(),
    pool.end(),
    redis.quit(),
    Promise.resolve(s3.destroy()),
  ]);
}

async function main(): Promise<void> {
  await connectWithRetry();
  await publishHeartbeat();
  await writeFile('/tmp/engrove-worker-ready', workerId, { mode: 0o600 });
  heartbeat = setInterval(() => void publishHeartbeat(), 5_000);
  heartbeat.unref();
  await reconcile();
  reconciliation = setInterval(() => void reconcile(), 5_000);
  reconciliation.unref();
  log.info({ workerId }, 'node worker ready');
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  log.fatal({ err: error }, 'node worker failed');
  process.exitCode = 1;
});
