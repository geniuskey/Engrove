import { z } from 'zod';
import { authenticationConfigShape, oidcConfigShape } from './authentication-schema.js';
import { commonConfigShape } from './common-schema.js';
import { dataServicesConfigShape } from './data-services-schema.js';
import { observabilityConfigShape } from './observability-schema.js';

const developmentSecret = /^(engrove_.*_dev_only.*|change-me|changeme)$/i;

export const configSchema = z
  .object({
    ...commonConfigShape,
    ...authenticationConfigShape,
    ...dataServicesConfigShape,
    ...oidcConfigShape,
    ...observabilityConfigShape,
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
