import { applyDecorators, type INestApplication } from '@nestjs/common';
import {
  ApiBody,
  ApiParam,
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

interface MutableResponse {
  $ref?: string;
  headers?: Record<string, unknown>;
  [key: string]: unknown;
}

interface MutableOperation {
  operationId?: string;
  summary?: string;
  security?: Array<Record<string, string[]>>;
  responses?: Record<string, MutableResponse>;
}

export function openApiSchema(schema: ZodType): never {
  const converted = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  delete converted.$schema;
  return converted as never;
}

export function ApiZodBody(
  schema: ZodType,
  description?: string,
  example?: unknown,
): MethodDecorator {
  const bodySchema = z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
  }) as Record<string, unknown>;
  delete bodySchema.$schema;
  if (example !== undefined) bodySchema.example = example;
  return ApiBody({
    schema: bodySchema as never,
    ...(description ? { description } : {}),
  });
}

export function ApiTableResourceParams(): MethodDecorator {
  return applyDecorators(
    ApiParam({
      name: 'workspaceId',
      description: 'Stable public workspace ID (w…) or internal UUID.',
      example: 'w8229121e5c82ae',
    }),
    ApiParam({
      name: 'projectId',
      description: 'Stable public project ID (p…) or internal UUID.',
      example: 'pf3df0667cb3a75',
    }),
    ApiParam({
      name: 'objectTypeId',
      description:
        'Stable public table ID (t…) or internal UUID. Copy it from the table API panel.',
      example: 't1234567890abcd',
    }),
  );
}

const errorEnvelope = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'details', 'requestId'],
      properties: {
        code: { type: 'string', example: 'VALIDATION_FAILED' },
        message: { type: 'string' },
        details: { type: 'array', items: { type: 'object', additionalProperties: true } },
        requestId: { type: 'string', description: 'Trace identifier copied from x-request-id.' },
      },
    },
  },
};

const publicPaths = new Set([
  '/api/v1/setup/status',
  '/api/v1/setup',
  '/api/v1/auth/sign-in',
  '/api/v1/invitations/accept',
  '/api/v1/auth/password-reset-tokens',
  '/api/v1/auth/password-reset',
  '/api/v1/auth/oidc/status',
  '/api/v1/auth/oidc/start',
  '/api/v1/auth/oidc/callback',
]);

const sessionOnlyPrefixes = [
  '/api/v1/api-tokens',
  '/api/v1/client-errors',
  '/api/v1/audit-events',
  '/api/v1/member-groups',
  '/api/v1/members',
  '/api/v1/me/',
  '/api/v1/notifications',
  '/api/v1/pilot',
  '/api/v1/security-tokens',
  '/api/v1/webhooks',
];

const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);

function summary(operationId: string | undefined): string {
  const methodName = operationId?.split('_').at(-1) ?? 'request';
  return methodName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

function errorResponse(description: string, retryAfter = false) {
  return {
    description,
    headers: {
      'x-request-id': { $ref: '#/components/headers/RequestId' },
      ...(retryAfter ? { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } } : {}),
    },
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/ApiErrorEnvelope' } },
    },
  };
}

export function enrichOpenApiDocument(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas = {
    ...(document.components.schemas ?? {}),
    ApiErrorEnvelope: errorEnvelope,
  };
  document.components.headers = {
    ...(document.components.headers ?? {}),
    RequestId: {
      description: 'Stable request trace identifier.',
      schema: { type: 'string' },
    },
    RateLimitLimit: {
      description: 'Maximum requests allowed in the current policy window.',
      schema: { type: 'integer' },
    },
    RateLimitRemaining: {
      description: 'Requests remaining in the current window.',
      schema: { type: 'integer' },
    },
    RateLimitReset: {
      description: 'Seconds until the current quota resets.',
      schema: { type: 'integer' },
    },
    RetryAfter: {
      description: 'Seconds to wait before retrying.',
      schema: { type: 'integer' },
    },
    ETag: {
      description: 'Weak entity tag accepted by a later If-None-Match request.',
      schema: { type: 'string' },
    },
    CacheControl: {
      description: 'Private response cache and revalidation policy.',
      schema: { type: 'string', example: 'private, no-cache' },
    },
    CacheControlNoStore: {
      description: 'Sensitive responses must not be stored by browsers or intermediaries.',
      schema: { type: 'string', example: 'private, no-store' },
    },
  };

  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, candidate] of Object.entries(pathItem ?? {})) {
      if (!methods.has(method) || !candidate || typeof candidate !== 'object') continue;
      const operation = candidate as MutableOperation;
      const versionedApi = path.startsWith('/api/v1/');
      const publicSharedView = path.startsWith('/api/v1/shared-views/');
      const noStoreRead =
        method === 'get' && (path.startsWith('/api/v1/auth/oidc/') || publicSharedView);
      const revalidatableGet = versionedApi && method === 'get' && !noStoreRead;
      operation.summary ||= summary(operation.operationId);
      if (versionedApi && !publicPaths.has(path) && !publicSharedView) {
        operation.security =
          sessionOnlyPrefixes.some((prefix) => path.startsWith(prefix)) ||
          path.includes('/webhooks') ||
          path.endsWith('/share') ||
          path.endsWith('/share/revoke')
            ? [{ engrove_session: [] }]
            : [{ engrove_session: [] }, { engrove_api_token: [] }];
      } else operation.security = [];

      operation.responses ??= {};
      operation.responses['400'] ??= errorResponse('The request failed validation.');
      if (operation.security.length) {
        operation.responses['401'] ??= errorResponse('Authentication is required.');
        operation.responses['403'] ??= errorResponse('The authenticated principal lacks access.');
      }
      if (['post', 'put', 'patch', 'delete'].includes(method))
        operation.responses['409'] ??= errorResponse('The request conflicts with current state.');
      if (versionedApi)
        operation.responses['429'] ??= errorResponse('The request quota was exceeded.', true);
      if (revalidatableGet)
        operation.responses['304'] ??= {
          description: 'The representation matches If-None-Match and has not changed.',
          headers: {
            ETag: { $ref: '#/components/headers/ETag' },
            'Cache-Control': { $ref: '#/components/headers/CacheControl' },
            'x-request-id': { $ref: '#/components/headers/RequestId' },
          },
        };
      operation.responses['500'] ??= errorResponse('An unexpected server error occurred.');

      for (const [status, response] of Object.entries(operation.responses)) {
        if (response.$ref) continue;
        response.headers = {
          ...(response.headers ?? {}),
          'x-request-id': { $ref: '#/components/headers/RequestId' },
          ...(revalidatableGet && /^2\d\d$/.test(status)
            ? {
                ETag: { $ref: '#/components/headers/ETag' },
                'Cache-Control': { $ref: '#/components/headers/CacheControl' },
              }
            : {}),
          ...(noStoreRead && /^[23]\d\d$/.test(status)
            ? {
                'Cache-Control': { $ref: '#/components/headers/CacheControlNoStore' },
              }
            : {}),
          ...(versionedApi
            ? {
                'RateLimit-Limit': { $ref: '#/components/headers/RateLimitLimit' },
                'RateLimit-Remaining': { $ref: '#/components/headers/RateLimitRemaining' },
                'RateLimit-Reset': { $ref: '#/components/headers/RateLimitReset' },
              }
            : {}),
        };
      }
    }
  }
  return document;
}

export function createOpenApiDocument(app: INestApplication, version: string): OpenAPIObject {
  const configuration = new DocumentBuilder()
    .setTitle('Engrove API')
    .setDescription(
      'Versioned REST API for workspaces, programmable engineering data, traceability, and project work. Use either a browser session or a scoped personal API token where supported.',
    )
    .setVersion(version)
    .addCookieAuth('engrove_session', { type: 'apiKey', in: 'cookie', name: 'engrove_session' })
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'eng_pat_*' },
      'engrove_api_token',
    )
    .build();
  return enrichOpenApiDocument(SwaggerModule.createDocument(app, configuration));
}
