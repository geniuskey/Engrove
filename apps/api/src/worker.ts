import { createHash, createHmac, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parseConfig } from '@engrove/config';
import { can } from '@engrove/permissions';
import {
  checkDatabase,
  claimRecordExportJob,
  claimDatasetJob,
  cleanupExpiredProjectIdempotencyRequests,
  completeDatasetJob,
  completeRecordExportJob,
  createTaskDueDateNotifications,
  createPool,
  deriveWebhookSigningSecret,
  enqueueWebhookDeliveries,
  failDatasetJob,
  failRecordExportJob,
  isRetryableWebhookStatus,
  renewDatasetJobLease,
  ScopedProjectRepository,
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
const RECORD_EXPORT_LEASE_SECONDS = 60;
const RECORD_EXPORT_LEASE_HEARTBEAT_MS = 20_000;
const RECORD_EXPORT_TTL_MS = 6 * 60 * 60_000;
const PYTHON_PROCESS_TIMEOUT_MS = 10 * 60_000;
const WEBHOOK_LEASE_SECONDS = 30;
const WEBHOOK_MAX_ATTEMPTS = 5;
let heartbeat: NodeJS.Timeout | undefined;
let reconciliation: NodeJS.Timeout | undefined;
let stopping = false;
let lastDueDateScan = 0;
let lastIdempotencyCleanup = 0;

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      a! >= 224
    );
  }
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('::ffff:')
  );
}

async function postWebhook(
  endpoint: { id: string; url: string; secret_version: number },
  deliveryId: string,
  eventType: string,
  attemptCount: number,
  payload: unknown,
): Promise<{ status: number; snippet: string }> {
  const url = new URL(endpoint.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('WEBHOOK_URL_INVALID');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  const destination = addresses.find((candidate) => !isPrivateAddress(candidate.address));
  if (!destination || addresses.some((candidate) => isPrivateAddress(candidate.address)))
    throw new Error('WEBHOOK_DESTINATION_BLOCKED');
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = deriveWebhookSigningSecret(
    config.INTERNAL_SERVICE_SECRET,
    endpoint.id,
    endpoint.secret_version,
  );
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: 'https:',
        hostname: destination.address,
        family: destination.family,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        servername: url.hostname,
        headers: {
          host: url.host,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'user-agent': `Engrove/${config.ENGROVE_VERSION}`,
          'x-engrove-event': eventType,
          'x-engrove-delivery': deliveryId,
          'x-engrove-retry': Math.max(attemptCount - 1, 0).toString(),
          'x-engrove-timestamp': timestamp,
          'x-engrove-signature': `sha256=${signature}`,
        },
      },
      (response) => {
        let snippet = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          if (snippet.length < 1_000) snippet += chunk.slice(0, 1_000 - snippet.length);
        });
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, snippet: snippet.slice(0, 1_000) }),
        );
      },
    );
    request.setTimeout(10_000, () => request.destroy(new Error('WEBHOOK_TIMEOUT')));
    request.on('error', reject);
    request.end(body);
  });
}

async function processWebhookDelivery(): Promise<void> {
  const claimed = await pool.query<{
    id: string;
    endpoint_id: string;
    event_type: string;
    payload: unknown;
    attempt_count: number;
    url: string;
    secret_version: number;
  }>(
    `with candidate as (
       select d.id from webhook_deliveries d join webhook_endpoints e on e.id=d.endpoint_id
       where e.active and ((d.status='queued' and d.next_attempt_at<=now())
         or (d.status='sending' and d.lease_expires_at<=now()))
       order by d.next_attempt_at,d.created_at,d.id for update of d skip locked limit 1
     )
     update webhook_deliveries d set status='sending',attempt_count=d.attempt_count+1,
       lease_owner=$1,lease_expires_at=now()+($2::text||' seconds')::interval,updated_at=now()
     from candidate c,webhook_endpoints e
     where d.id=c.id and e.id=d.endpoint_id
     returning d.id,d.endpoint_id,d.event_type,d.payload,d.attempt_count,e.url,e.secret_version`,
    [workerId, WEBHOOK_LEASE_SECONDS],
  );
  const delivery = claimed.rows[0];
  if (!delivery) return;
  try {
    const response = await postWebhook(
      { id: delivery.endpoint_id, url: delivery.url, secret_version: delivery.secret_version },
      delivery.id,
      delivery.event_type,
      delivery.attempt_count,
      delivery.payload,
    );
    if (response.status < 200 || response.status >= 300)
      throw Object.assign(new Error(`WEBHOOK_HTTP_${response.status}`), { response });
    await pool.query(
      `update webhook_deliveries set status='succeeded',response_status=$2,response_snippet=$3,
       last_error=null,delivered_at=now(),lease_owner=null,lease_expires_at=null,updated_at=now()
       where id=$1 and status='sending' and lease_owner=$4`,
      [delivery.id, response.status, response.snippet, workerId],
    );
  } catch (error) {
    const response =
      typeof error === 'object' && error && 'response' in error
        ? (error.response as { status: number; snippet: string })
        : undefined;
    const retryable = response ? isRetryableWebhookStatus(response.status) : true;
    const terminal = !retryable || delivery.attempt_count >= WEBHOOK_MAX_ATTEMPTS;
    const delays = [60, 300, 1_800, 7_200, 43_200];
    await pool.query(
      `update webhook_deliveries set status=$2,response_status=$3,response_snippet=$4,last_error=$5,
       next_attempt_at=now()+($6::text||' seconds')::interval,lease_owner=null,lease_expires_at=null,
       updated_at=now() where id=$1 and status='sending' and lease_owner=$7`,
      [
        delivery.id,
        terminal ? 'failed' : 'queued',
        response?.status ?? null,
        response?.snippet ?? null,
        (error instanceof Error ? error.message : 'WEBHOOK_DELIVERY_FAILED').slice(0, 500),
        terminal ? 0 : delays[Math.min(delivery.attempt_count - 1, delays.length - 1)],
        workerId,
      ],
    );
    log.warn(
      {
        deliveryId: delivery.id,
        endpointId: delivery.endpoint_id,
        retryable,
        terminal,
        err: error,
      },
      'webhook delivery failed',
    );
  }
}

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

async function checkpointRecordExportArtifact(
  jobId: string,
  attemptId: string,
  artifact: { objectKey: string; fileName: string },
) {
  const checkpointed = await pool.query(
    `update background_job_attempts a
     set result_checkpoint=$4::jsonb,heartbeat_at=now()
     from background_jobs j
     where a.id=$1 and a.job_id=$2 and a.job_id=j.id
       and a.status='running' and a.worker_identity=$3
       and j.status='running' and j.lease_owner=$3 and j.lease_expires_at>now()
     returning a.id`,
    [attemptId, jobId, workerId, JSON.stringify({ artifact })],
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

async function processNextRecordExport(): Promise<void> {
  const maintenance = await pool.query(
    'select 1 from maintenance_state where singleton=true and lease_expires_at>now()',
  );
  if (maintenance.rowCount) return;
  const job = await claimRecordExportJob(pool, workerId, RECORD_EXPORT_LEASE_SECONDS);
  if (!job) return;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'engrove-record-export-'));
  const exportPath = join(temporaryDirectory, 'records.csv');
  let leaseLost = false;
  let renewingLease = false;
  let activeLeaseRenewal: Promise<void> | undefined;
  const renewLease = async () => {
    const renewed = await renewDatasetJobLease(
      pool,
      { jobId: job.id, attemptId: job.attemptId, workerId },
      RECORD_EXPORT_LEASE_SECONDS,
    );
    if (!renewed) {
      leaseLost = true;
      throw new Error('JOB_LEASE_LOST');
    }
  };
  const leaseHeartbeat = setInterval(() => {
    if (renewingLease || leaseLost) return;
    renewingLease = true;
    const renewal = renewLease();
    activeLeaseRenewal = renewal;
    void renewal
      .catch((error: unknown) => {
        log.warn({ jobId: job.id, err: error }, 'record export lease renewal failed');
      })
      .finally(() => {
        renewingLease = false;
        if (activeLeaseRenewal === renewal) activeLeaseRenewal = undefined;
      });
  }, RECORD_EXPORT_LEASE_HEARTBEAT_MS);
  leaseHeartbeat.unref();
  try {
    const actor = await pool.query<{
      workspace_id: string;
      organization_id: string;
      email: string;
      display_name: string;
      role: 'owner' | 'admin' | 'engineer' | 'contributor' | 'reviewer' | 'viewer';
    }>(
      `select p.workspace_id,w.organization_id,u.email,u.display_name,m.role
       from projects p join workspaces w on w.id=p.workspace_id
       join users u on u.id=$2 and u.disabled_at is null
       join memberships m on m.organization_id=w.organization_id and m.user_id=u.id
       where p.id=$1`,
      [job.project_id, job.payload.requestedBy],
    );
    const requester = actor.rows[0];
    if (!requester) {
      const error = new Error('RECORD_EXPORT_REQUESTER_UNAVAILABLE');
      Object.assign(error, { retryable: false });
      throw error;
    }
    if (
      !can(
        {
          actorId: job.payload.requestedBy,
          organizationId: requester.organization_id,
          workspaceId: requester.workspace_id,
          projectId: job.project_id,
          role: requester.role,
        },
        'export.execute',
      )
    ) {
      const error = new Error('RECORD_EXPORT_PERMISSION_REVOKED');
      Object.assign(error, { retryable: false });
      throw error;
    }
    const repository = await ScopedProjectRepository.open(
      pool,
      {
        sessionId: `job:${job.id}`,
        actorId: job.payload.requestedBy,
        organizationId: requester.organization_id,
        role: requester.role,
        email: requester.email,
        displayName: requester.display_name,
        csrfTokenHash: '',
      },
      requester.workspace_id,
      job.project_id,
    );
    const digest = createHash('sha256');
    let sizeBytes = 0;
    const file = await open(exportPath, 'w', 0o600);
    let metrics: { rowCount: number; fieldCount: number };
    try {
      metrics = await repository.writeRecordsCsv(
        job.entity_id,
        job.payload.query,
        async (chunk) => {
          if (leaseLost) throw new Error('JOB_LEASE_LOST');
          const bytes = Buffer.from(chunk, 'utf8');
          digest.update(bytes);
          sizeBytes += bytes.byteLength;
          await file.write(bytes);
        },
      );
    } finally {
      await file.close();
    }
    if (leaseLost) throw new Error('JOB_LEASE_LOST');
    const objectKey = `committed/${job.project_id}/record-exports/${job.id}/${job.attemptId}/records.csv`;
    await checkpointRecordExportArtifact(job.id, job.attemptId, {
      objectKey,
      fileName: job.payload.fileName,
    });
    const uploaded = await s3.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: objectKey,
        Body: createReadStream(exportPath),
        ContentLength: sizeBytes,
        ContentType: 'text/csv; charset=utf-8',
      }),
    );
    clearInterval(leaseHeartbeat);
    await activeLeaseRenewal;
    await renewLease();
    await completeRecordExportJob(pool, {
      jobId: job.id,
      attemptId: job.attemptId,
      workerId,
      projectId: job.project_id,
      objectTypeId: job.entity_id,
      requestedBy: job.payload.requestedBy,
      artifact: {
        objectKey,
        storageVersionId: uploaded.VersionId ?? null,
        checksum: digest.digest('hex'),
        sizeBytes,
        rowCount: metrics.rowCount,
        fieldCount: metrics.fieldCount,
        fileName: job.payload.fileName,
        expiresAt: new Date(Date.now() + RECORD_EXPORT_TTL_MS).toISOString(),
      },
    });
    log.info({ jobId: job.id, rowCount: metrics.rowCount }, 'record export completed');
  } catch (error) {
    clearInterval(leaseHeartbeat);
    await activeLeaseRenewal?.catch(() => undefined);
    if (leaseLost) {
      log.warn({ jobId: job.id, err: error }, 'record export stopped after losing its lease');
      return;
    }
    const message = error instanceof Error ? error.message : 'RECORD_EXPORT_FAILED';
    const code =
      typeof error === 'object' && error && 'code' in error
        ? String(error.code)
        : message.split(':')[0]!;
    const retryable =
      typeof error === 'object' && error && 'retryable' in error
        ? Boolean(error.retryable)
        : ![
            'FIELD_NOT_FOUND',
            'FIELD_INDEX_REBUILDING',
            'PROJECT_NOT_FOUND',
            'RECORD_EXPORT_REQUESTER_UNAVAILABLE',
            'RECORD_EXPORT_PERMISSION_REVOKED',
            'RECORD_EXPORT_TOO_LARGE',
          ].includes(code);
    try {
      await renewLease();
      await failRecordExportJob(pool, {
        jobId: job.id,
        attemptId: job.attemptId,
        workerId,
        projectId: job.project_id,
        objectTypeId: job.entity_id,
        requestedBy: job.payload.requestedBy,
        attemptNumber: job.attemptNumber,
        maxAttempts: Number(job.max_attempts),
        code: code.slice(0, 100),
        retryable,
      });
    } catch (leaseError) {
      log.warn(
        { jobId: job.id, err: leaseError },
        'record export failure was not recorded after losing its lease',
      );
      return;
    }
    log.error({ jobId: job.id, err: error }, 'record export failed');
  } finally {
    clearInterval(leaseHeartbeat);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function cleanupExpiredRecordExports(): Promise<void> {
  const expired = await pool.query<{
    attempt_id: string;
    artifact: {
      objectKey: string;
      storageVersionId: string | null;
      deletedAt?: string;
      expiresAt: string;
    };
  }>(
    `select a.id attempt_id,a.result_checkpoint->'artifact' artifact
     from background_job_attempts a join background_jobs j on j.id=a.job_id
     where j.job_type='record.export.csv' and j.status='succeeded' and a.status='succeeded'
       and a.result_checkpoint->'artifact'->>'deletedAt' is null
       and (a.result_checkpoint->'artifact'->>'expiresAt')::timestamptz<=now()
     order by j.completed_at,a.id limit 50`,
  );
  for (const row of expired.rows) {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: row.artifact.objectKey,
        VersionId: row.artifact.storageVersionId ?? undefined,
      }),
    );
    await pool.query(
      `update background_job_attempts
       set result_checkpoint=jsonb_set(result_checkpoint,'{artifact,deletedAt}',to_jsonb(now()::text),true)
       where id=$1 and result_checkpoint->'artifact'->>'deletedAt' is null`,
      [row.attempt_id],
    );
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
    const events = await client.query<{
      id: string;
      project_id: string;
      event_type: string;
      payload: { jobId?: string; objectTypeId?: string };
    }>(
      `select id,project_id,event_type,payload from outbox_events where dispatched_at is null
       order by created_at,id for update skip locked limit 100`,
    );
    for (const event of events.rows) {
      if (event.payload.jobId)
        await queue.add(
          'job-wakeup',
          { jobId: event.payload.jobId },
          { jobId: event.payload.jobId, removeOnComplete: true, removeOnFail: true },
        );
      await enqueueWebhookDeliveries(client, event);
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
    `select id from background_jobs
     where job_type in ('dataset.process','record.export.csv') and status='queued'
       and scheduled_at<=now() order by scheduled_at limit 100`,
  );
  for (const job of queued.rows)
    await queue
      .add(
        'job-wakeup',
        { jobId: job.id },
        { jobId: job.id, removeOnComplete: true, removeOnFail: true },
      )
      .catch(() => undefined);
  await Promise.all(Array.from({ length: 5 }, () => processWebhookDelivery()));
  if (Date.now() - lastDueDateScan >= 60_000) {
    lastDueDateScan = Date.now();
    try {
      const created = await createTaskDueDateNotifications(pool);
      if (created) log.info({ created }, 'task due-date notifications created');
    } catch (error) {
      log.warn({ err: error }, 'task due-date notification scan failed');
    }
  }
  if (Date.now() - lastIdempotencyCleanup >= 60 * 60_000) {
    lastIdempotencyCleanup = Date.now();
    try {
      const deleted = await cleanupExpiredProjectIdempotencyRequests(pool);
      if (deleted) log.info({ deleted }, 'expired project idempotency requests removed');
      await cleanupExpiredRecordExports();
    } catch (error) {
      log.warn({ err: error }, 'project idempotency cleanup failed');
    }
  }
}
const bullWorker = new BullWorker(
  'engrove-system',
  async () => {
    await processNextRecordExport();
    await processNextDataset();
  },
  {
    connection: redis,
    concurrency: 2,
  },
);

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
