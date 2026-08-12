import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  parseEnvFile,
  validateComposeConfig,
  validateEnvironmentFileLocation,
  validateEnvironmentFileMode,
  validateProductionEnv,
} from './production-preflight.mjs';

const valid = {
  NODE_ENV: 'production',
  ENGROVE_PUBLIC_URL: 'https://engrove.research.internal',
  ENGROVE_TRUST_PROXY: '172.20.0.10,2001:db8::10',
  VITE_API_BASE_URL: 'https://engrove.research.internal',
  S3_PUBLIC_ENDPOINT: 'https://objects.research.internal',
  POSTGRES_MIGRATION_PASSWORD: 'migration-A8uB2cD4eF6gH8jK0mN2',
  POSTGRES_RUNTIME_PASSWORD: 'runtime-B9vC3dE5fG7hJ9kL1nP3',
  POSTGRES_WORKER_PASSWORD: 'worker-C0wD4eF6gH8jK0mN2pQ4',
  POSTGRES_BACKUP_PASSWORD: 'backup-D1xE5fG7hJ9kL1nP3qR5',
  MINIO_ROOT_USER: 'engrove_root_operator',
  MINIO_ROOT_PASSWORD: 'minio-root-E2yF6gH8jK0mN2pQ4rS6',
  S3_ACCESS_KEY_ID: 'engrove_application',
  S3_SECRET_ACCESS_KEY: 'minio-app-F3zG7hJ9kL1nP3qR5sT7',
  INTERNAL_SERVICE_SECRET: 'internal-G4aH8jK0mN2pQ4rS6tU8vW0x',
  ENGROVE_SETUP_TOKEN: 'setup-H5bJ9kL1nP3qR5sT7uV9wX1yZ3aB',
  OIDC_ISSUER: 'https://identity.research.internal/realms/engrove',
  OIDC_CLIENT_ID: 'engrove-production',
  OIDC_CLIENT_SECRET: 'oidc-I6cK0mN2pQ4rS6tU8vW0xY2z',
  OIDC_REDIRECT_URI: 'https://engrove.research.internal/api/v1/auth/oidc/callback',
  OIDC_AUTO_PROVISION: 'false',
  OIDC_ALLOWED_DOMAINS: '',
  BACKUP_RECIPIENT: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  ENGROVE_BACKUP_DIR: '/srv/engrove/backups',
  BACKUP_IDENTITY_DIR: '/srv/engrove/identities',
};

test('parses literal dotenv values without executing or expanding them', () => {
  assert.deepEqual(parseEnvFile('A=plain # note\nB=\'spaced value\'\nC="escaped\\nvalue"\n'), {
    A: 'plain',
    B: 'spaced value',
    C: 'escaped\nvalue',
  });
  assert.throws(() => parseEnvFile('A=first\nA=second\n'), /Duplicate environment variable A/);
  assert.throws(() => parseEnvFile('A=${SOME_SECRET}\n'), /resolved literal value/);
  assert.throws(() => parseEnvFile('A="${SOME_SECRET}"\n'), /resolved literal value/);
});

test('accepts a hardened production environment and rejects dangerous deployment shortcuts', () => {
  assert.deepEqual(validateProductionEnv(valid), []);
  assert.deepEqual(validateProductionEnv({ ...valid, ENGROVE_SETUP_TOKEN: '' }), []);
  const issues = validateProductionEnv({
    ...valid,
    ENGROVE_PUBLIC_URL: 'http://localhost:4173',
    VITE_API_BASE_URL: 'https://api.other.internal',
    ENGROVE_TRUST_PROXY: '0.0.0.0/0',
    POSTGRES_RUNTIME_PASSWORD: valid.POSTGRES_MIGRATION_PASSWORD,
    BACKUP_RECIPIENT: '',
    ENGROVE_SETUP_TOKEN: 'too-short',
    OIDC_AUTO_PROVISION: 'true',
    OIDC_ALLOWED_DOMAINS: '',
  });
  const keys = issues.map((issue) => issue.key);
  assert.ok(keys.includes('ENGROVE_PUBLIC_URL'));
  assert.ok(keys.includes('VITE_API_BASE_URL'));
  assert.ok(keys.includes('ENGROVE_TRUST_PROXY'));
  assert.ok(keys.includes('POSTGRES_RUNTIME_PASSWORD'));
  assert.ok(keys.includes('BACKUP_RECIPIENT'));
  assert.ok(keys.includes('ENGROVE_SETUP_TOKEN'));
  assert.ok(keys.includes('OIDC_ALLOWED_DOMAINS'));
});

test('requires a private regular environment file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'engrove-preflight-'));
  const path = join(directory, 'production.env');
  try {
    await writeFile(path, 'NODE_ENV=production\n', { mode: 0o600 });
    assert.deepEqual(await validateEnvironmentFileMode(path), []);
    assert.deepEqual(await validateEnvironmentFileLocation(path), []);
    assert.equal((await validateEnvironmentFileLocation(path, directory))[0]?.key, 'env-file');
    await chmod(path, 0o644);
    assert.equal((await validateEnvironmentFileMode(path))[0]?.key, 'env-file');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('verifies rendered Compose isolation without reading secret values', () => {
  const hardened = (environment = {}) => ({
    read_only: true,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    environment,
  });
  const config = {
    services: {
      postgres: {},
      redis: {},
      minio: {},
      migrate: {},
      api: hardened({ DATABASE_URL: 'postgresql://engrove_runtime:redacted@postgres/engrove' }),
      'worker-node': hardened({
        DATABASE_URL: 'postgresql://engrove_worker:redacted@postgres/engrove',
      }),
      'worker-python': hardened({ INTERNAL_SERVICE_SECRET: 'redacted' }),
      web: hardened(),
      admin: {
        environment: { DATABASE_URL: 'postgresql://engrove_backup:redacted@postgres/engrove' },
      },
    },
  };
  assert.deepEqual(validateComposeConfig(config), []);
  config.services.api.ports = [{ published: '3000', target: 3000 }];
  config.services['worker-python'].environment.DATABASE_URL = 'postgresql://forbidden';
  const issues = validateComposeConfig(config);
  assert.ok(issues.some((issue) => issue.key === 'api' && issue.message.includes('host ports')));
  assert.ok(
    issues.some((issue) => issue.key === 'worker-python' && issue.message.includes('DATABASE_URL')),
  );
});
