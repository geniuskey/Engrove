import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { type EngroveConfig } from '@engrove/config';
import {
  checkDatabase,
  checkMigrationCompatibility,
  createPool,
  type Pool,
} from '@engrove/database';
import type { DependencyHealth } from '@engrove/shared';
import Redis from 'ioredis';

export interface Runtime {
  config: EngroveConfig;
  pool: Pool;
  redis: Redis;
  s3: S3Client;
  s3Public: S3Client;
  close(): Promise<void>;
}

export function createRuntime(config: EngroveConfig): Runtime {
  const pool = createPool(config.DATABASE_URL);
  const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const s3 = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
  const s3Public = new S3Client({
    endpoint: config.S3_PUBLIC_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
  return {
    config,
    pool,
    redis,
    s3,
    s3Public,
    async close() {
      await Promise.allSettled([pool.end(), redis.quit(), s3.destroy(), s3Public.destroy()]);
    },
  };
}

export type ReadinessCheck = () => Promise<void>;

export async function runReadinessChecks(
  runtime: Runtime,
  checks: Record<string, ReadinessCheck> = {
    postgres: () => checkDatabase(runtime.pool),
    migrations: () => checkMigrationCompatibility(runtime.pool),
    redis: async () => {
      if (runtime.redis.status === 'wait') await runtime.redis.connect();
      await runtime.redis.ping();
    },
    objectStorage: async () => {
      await runtime.s3.send(new HeadBucketCommand({ Bucket: runtime.config.S3_BUCKET }));
    },
    nodeWorker: async () => {
      if (runtime.redis.status === 'wait') await runtime.redis.connect();
      const keys = await runtime.redis.keys('engrove:worker-node:*:heartbeat');
      if (!keys.length) throw new Error('NODE_WORKER_HEARTBEAT_MISSING');
    },
    pythonWorker: async () => {
      const response = await fetch(
        `${runtime.config.PYTHON_WORKER_BASE_URL}/internal/v1/capabilities`,
        {
          headers: { 'x-engrove-internal-secret': runtime.config.INTERNAL_SERVICE_SECRET },
          signal: AbortSignal.timeout(3_000),
        },
      );
      if (!response.ok) throw new Error('PYTHON_WORKER_UNAVAILABLE');
      const capabilities = (await response.json()) as { parsers?: string[] };
      if (!capabilities.parsers?.includes('csv-v1') || !capabilities.parsers.includes('xy-v1'))
        throw new Error('PYTHON_PARSER_INCOMPATIBLE');
    },
  },
): Promise<Record<string, DependencyHealth>> {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      try {
        await check();
        return [name, { status: 'ok' }] as const;
      } catch {
        const code = `${name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_UNAVAILABLE`;
        return [name, { status: 'not_ready', code }] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}
