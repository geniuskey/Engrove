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
  it('retains every configuration field when composing the schema modules', () => {
    const configured = parseConfig({
      ...valid,
      ENGROVE_VERSION: '1.2.3',
      ENGROVE_API_PORT: '3100',
      ENGROVE_TRUST_PROXY: '127.0.0.1',
      ENGROVE_SETUP_TOKEN: 'a-secure-setup-token-with-32-characters',
      SESSION_IDLE_MINUTES: '90',
      SESSION_ABSOLUTE_HOURS: '240',
      ARGON2_MEMORY_KIB: '70000',
      ARGON2_ITERATIONS: '4',
      ARGON2_PARALLELISM: '2',
      OIDC_ISSUER: 'http://identity.example.test',
      OIDC_CLIENT_ID: 'engrove',
      OIDC_CLIENT_SECRET: 'oidc-client-secret',
      OIDC_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/oidc/callback',
      OIDC_SCOPES: 'openid email',
      OIDC_EMAIL_CLAIM: 'mail',
      OIDC_NAME_CLAIM: 'display_name',
      OIDC_ALLOWED_DOMAINS: 'Example.com, Research.example',
      OIDC_AUTO_PROVISION: 'false',
      OIDC_DEFAULT_ROLE: 'engineer',
      LOG_LEVEL: 'debug',
    });

    expect(Object.keys(configured).sort()).toEqual(
      [
        'ARGON2_ITERATIONS',
        'ARGON2_MEMORY_KIB',
        'ARGON2_PARALLELISM',
        'DATABASE_MIGRATION_URL',
        'DATABASE_URL',
        'ENGROVE_API_PORT',
        'ENGROVE_PUBLIC_URL',
        'ENGROVE_SETUP_TOKEN',
        'ENGROVE_TRUST_PROXY',
        'ENGROVE_VERSION',
        'INTERNAL_SERVICE_SECRET',
        'LOG_LEVEL',
        'NODE_ENV',
        'OIDC_ALLOWED_DOMAINS',
        'OIDC_AUTO_PROVISION',
        'OIDC_CLIENT_ID',
        'OIDC_CLIENT_SECRET',
        'OIDC_DEFAULT_ROLE',
        'OIDC_EMAIL_CLAIM',
        'OIDC_ISSUER',
        'OIDC_NAME_CLAIM',
        'OIDC_REDIRECT_URI',
        'OIDC_SCOPES',
        'PYTHON_WORKER_BASE_URL',
        'REDIS_URL',
        'S3_ACCESS_KEY_ID',
        'S3_BUCKET',
        'S3_ENDPOINT',
        'S3_FORCE_PATH_STYLE',
        'S3_PUBLIC_ENDPOINT',
        'S3_REGION',
        'S3_SECRET_ACCESS_KEY',
        'SESSION_ABSOLUTE_HOURS',
        'SESSION_IDLE_MINUTES',
      ].sort(),
    );
    expect(configured).toMatchObject({
      ENGROVE_API_PORT: 3100,
      OIDC_ALLOWED_DOMAINS: ['example.com', 'research.example'],
      OIDC_AUTO_PROVISION: false,
      S3_FORCE_PATH_STYLE: true,
    });
  });

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

  it('accepts only explicit trusted proxy addresses and networks', () => {
    expect(
      parseConfig({ ...valid, ENGROVE_TRUST_PROXY: '127.0.0.1, 172.20.0.0/16, 2001:db8::/32' })
        .ENGROVE_TRUST_PROXY,
    ).toEqual(['127.0.0.1', '172.20.0.0/16', '2001:db8::/32']);
    expect(() => parseConfig({ ...valid, ENGROVE_TRUST_PROXY: 'uniquelocal' })).toThrow(
      'ENGROVE_TRUST_PROXY',
    );
    expect(() => parseConfig({ ...valid, ENGROVE_TRUST_PROXY: '10.0.0.0/99' })).toThrow(
      'ENGROVE_TRUST_PROXY',
    );
    expect(() => parseConfig({ ...valid, ENGROVE_TRUST_PROXY: '0.0.0.0/0' })).toThrow(
      'ENGROVE_TRUST_PROXY',
    );
  });
});
