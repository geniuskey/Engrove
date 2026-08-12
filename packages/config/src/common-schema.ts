import { z } from 'zod';
import { trustedProxyCidrs } from './schema-primitives.js';

export const commonConfigShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ENGROVE_VERSION: z.string().min(1).default('0.1.0'),
  ENGROVE_PUBLIC_URL: z.url(),
  ENGROVE_API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ENGROVE_TRUST_PROXY: trustedProxyCidrs.default([]),
  API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  API_RATE_LIMIT_TOKEN_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(300),
  API_RATE_LIMIT_SESSION_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(600),
  API_RATE_LIMIT_ANONYMOUS_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(120),
};
