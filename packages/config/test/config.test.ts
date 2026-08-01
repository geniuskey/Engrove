import { describe, expect, it } from 'vitest';
import { parseConfig, redactSecrets } from '../src/index.js';

const valid = {
  NODE_ENV: 'development',
  ENGROVE_PUBLIC_URL: 'http://localhost:4173',
  DATABASE_URL: 'postgresql://runtime:secret@localhost/engrove',
  DATABASE_MIGRATION_URL: 'postgresql://migrate:secret@localhost/engrove',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'engrove-development',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'a-secret-key',
  S3_FORCE_PATH_STYLE: 'true',
  PYTHON_WORKER_BASE_URL: 'http://localhost:8000',
  INTERNAL_SERVICE_SECRET: 'an-internal-secret',
};

describe('parseConfig', () => {
  it('names invalid fields without leaking their values', () => {
    expect(() => parseConfig({ ...valid, DATABASE_URL: 'top-secret' })).toThrow(
      'Invalid Engrove configuration: DATABASE_URL',
    );
  });

  it('rejects shared database roles in production', () => {
    expect(() =>
      parseConfig({
        ...valid,
        NODE_ENV: 'production',
        DATABASE_MIGRATION_URL: valid.DATABASE_URL,
      }),
    ).toThrow('DATABASE_MIGRATION_URL');
  });

  it('redacts every credential', () => {
    const redacted = JSON.stringify(redactSecrets(parseConfig(valid)));
    expect(redacted).not.toContain('secret');
    expect(redacted).not.toContain('access-key');
  });
});
