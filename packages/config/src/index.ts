import type { z } from 'zod';
import { configSchema } from './config-schema.js';

export type EngroveConfig = z.infer<typeof configSchema>;

export function parseConfig(environment: NodeJS.ProcessEnv): EngroveConfig {
  const result = configSchema.safeParse(environment);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.') || 'environment');
    throw new Error(`Invalid Engrove configuration: ${[...new Set(fields)].join(', ')}`);
  }
  return result.data;
}

export function redactSecrets(config: EngroveConfig): Record<string, unknown> {
  return {
    ...config,
    DATABASE_URL: '[REDACTED]',
    DATABASE_MIGRATION_URL: '[REDACTED]',
    S3_ACCESS_KEY_ID: '[REDACTED]',
    S3_SECRET_ACCESS_KEY: '[REDACTED]',
    INTERNAL_SERVICE_SECRET: '[REDACTED]',
    OIDC_CLIENT_SECRET: config.OIDC_CLIENT_SECRET ? '[REDACTED]' : undefined,
    ENGROVE_SETUP_TOKEN: config.ENGROVE_SETUP_TOKEN ? '[REDACTED]' : undefined,
  };
}
