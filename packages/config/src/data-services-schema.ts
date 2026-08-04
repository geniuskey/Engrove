import { z } from 'zod';
import { booleanString } from './schema-primitives.js';

export const dataServicesConfigShape = {
  DATABASE_URL: z.string().startsWith('postgresql://'),
  DATABASE_MIGRATION_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().startsWith('redis://'),
  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(3),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  S3_FORCE_PATH_STYLE: booleanString.default(true),
  PYTHON_WORKER_BASE_URL: z.url(),
  INTERNAL_SERVICE_SECRET: z.string().min(16),
};
