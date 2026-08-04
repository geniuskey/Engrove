import { z } from 'zod';
import { trustedProxyCidrs } from './schema-primitives.js';

export const commonConfigShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ENGROVE_VERSION: z.string().min(1).default('0.1.0'),
  ENGROVE_PUBLIC_URL: z.url(),
  ENGROVE_API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ENGROVE_TRUST_PROXY: trustedProxyCidrs.default([]),
};
