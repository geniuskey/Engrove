import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const developmentSecret = /^(engrove_.*_dev_only.*|change-me|changeme)$/i;
const emptyAsUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
const commaSeparated = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    ENGROVE_VERSION: z.string().min(1).default('0.1.0'),
    ENGROVE_PUBLIC_URL: z.url(),
    ENGROVE_API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    ENGROVE_SETUP_TOKEN: emptyAsUndefined(z.string().min(32)),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(8760).default(168),
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(19_456).default(65_536),
    ARGON2_ITERATIONS: z.coerce.number().int().min(2).default(3),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),
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
    OIDC_ISSUER: emptyAsUndefined(z.url()),
    OIDC_CLIENT_ID: emptyAsUndefined(z.string().min(1)),
    OIDC_CLIENT_SECRET: emptyAsUndefined(z.string().min(16)),
    OIDC_REDIRECT_URI: emptyAsUndefined(z.url()),
    OIDC_SCOPES: z.string().min(1).default('openid email profile'),
    OIDC_EMAIL_CLAIM: z.string().min(1).default('email'),
    OIDC_NAME_CLAIM: z.string().min(1).default('name'),
    OIDC_ALLOWED_DOMAINS: commaSeparated.default([]),
    OIDC_AUTO_PROVISION: booleanString.default(true),
    OIDC_DEFAULT_ROLE: z.enum(['admin', 'engineer', 'contributor', 'viewer']).default('viewer'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((value, context) => {
    const oidcValues = [
      value.OIDC_ISSUER,
      value.OIDC_CLIENT_ID,
      value.OIDC_CLIENT_SECRET,
      value.OIDC_REDIRECT_URI,
    ];
    if (oidcValues.some(Boolean) && !oidcValues.every(Boolean))
      context.addIssue({
        code: 'custom',
        path: ['OIDC_ISSUER'],
        message: 'all OIDC settings are required when OIDC is enabled',
      });
    if (value.NODE_ENV === 'production') {
      for (const [name, secret] of [
        ['S3_SECRET_ACCESS_KEY', value.S3_SECRET_ACCESS_KEY],
        ['INTERNAL_SERVICE_SECRET', value.INTERNAL_SERVICE_SECRET],
        ['ENGROVE_SETUP_TOKEN', value.ENGROVE_SETUP_TOKEN],
        ['OIDC_CLIENT_SECRET', value.OIDC_CLIENT_SECRET],
      ] as const) {
        if (secret && developmentSecret.test(secret)) {
          context.addIssue({
            code: 'custom',
            path: [name],
            message: 'development placeholder secrets are forbidden in production',
          });
        }
      }
      if (value.DATABASE_URL === value.DATABASE_MIGRATION_URL) {
        context.addIssue({
          code: 'custom',
          path: ['DATABASE_MIGRATION_URL'],
          message: 'must use a separate migration role in production',
        });
      }
      for (const [name, location] of [
        ['ENGROVE_PUBLIC_URL', value.ENGROVE_PUBLIC_URL],
        ['OIDC_ISSUER', value.OIDC_ISSUER],
        ['OIDC_REDIRECT_URI', value.OIDC_REDIRECT_URI],
      ] as const) {
        if (location && new URL(location).protocol !== 'https:')
          context.addIssue({
            code: 'custom',
            path: [name],
            message: 'HTTPS is required in production',
          });
      }
    }
  });

export type EngroveConfig = z.infer<typeof schema>;

export function parseConfig(environment: NodeJS.ProcessEnv): EngroveConfig {
  const result = schema.safeParse(environment);
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
