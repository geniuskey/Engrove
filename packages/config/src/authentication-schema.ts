import { z } from 'zod';
import { booleanString, commaSeparated, emptyAsUndefined } from './schema-primitives.js';

export const authenticationConfigShape = {
  ENGROVE_SETUP_TOKEN: emptyAsUndefined(z.string().min(32)),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(8760).default(168),
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(19_456).default(65_536),
  ARGON2_ITERATIONS: z.coerce.number().int().min(2).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),
};

export const oidcConfigShape = {
  OIDC_ISSUER: emptyAsUndefined(z.url()),
  OIDC_CLIENT_ID: emptyAsUndefined(z.string().min(1)),
  OIDC_CLIENT_SECRET: emptyAsUndefined(z.string().min(16)),
  OIDC_REDIRECT_URI: emptyAsUndefined(z.url()),
  OIDC_SCOPES: z.string().min(1).default('openid email profile'),
  OIDC_EMAIL_CLAIM: z.string().min(1).default('email'),
  OIDC_NAME_CLAIM: z.string().min(1).default('name'),
  OIDC_ALLOWED_DOMAINS: commaSeparated.default([]),
  OIDC_AUTO_PROVISION: booleanString.default(true),
  OIDC_DEFAULT_ROLE: z
    .enum(['admin', 'engineer', 'contributor', 'reviewer', 'viewer'])
    .default('viewer'),
};
