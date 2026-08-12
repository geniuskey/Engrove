import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { parseConfig } from '@engrove/config';
import { initializeInstallation } from '@engrove/database';
import { REQUEST_ID_HEADER } from '@engrove/shared';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { Request, Response } from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { AppModule } from './app.module.js';
import { ApiErrorFilter } from './error.filter.js';
import { createRuntime } from './runtime.js';
import { httpRouteLabel, observeHttp } from './metrics.controller.js';
import { createOpenApiDocument } from './openapi.js';
import { createApiRateLimitMiddleware } from './rate-limit.js';

export function redactSharedViewRequest<T extends { url?: string }>(request: T): T {
  if (!request.url) return request;
  const url = request.url.replace(
    /\/api\/v1\/shared-views\/[^/?#]+/g,
    '/api/v1/shared-views/[REDACTED]',
  );
  if (url === request.url) return request;
  return {
    ...request,
    url,
  };
}

export function applyApiSecurityHeaders(
  production: boolean,
  response: Pick<Response, 'setHeader'>,
  next: () => void,
): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  if (production)
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

export function applyApiResponseCachePolicy(
  request: Pick<Request, 'method' | 'path'>,
  response: Pick<Response, 'setHeader' | 'vary'>,
  next: () => void,
): void {
  if (request.path.startsWith('/api/v1/')) {
    if (['GET', 'HEAD'].includes(request.method)) {
      const sensitiveRead =
        request.path.startsWith('/api/v1/auth/oidc/') ||
        request.path.startsWith('/api/v1/shared-views/');
      response.setHeader(
        'Cache-Control',
        sensitiveRead ? 'private, no-store' : 'private, no-cache',
      );
    } else {
      response.setHeader('Cache-Control', 'private, no-store');
    }
    response.vary('Authorization');
    response.vary('Cookie');
  } else if (
    request.path.startsWith('/health/') ||
    request.path === '/metrics' ||
    request.path.startsWith('/api/docs')
  ) {
    response.setHeader('Cache-Control', 'no-store');
  }
  next();
}

export async function bootstrap() {
  const config = parseConfig(process.env);
  const runtime = createRuntime(config);

  const setup = await initializeInstallation(
    runtime.pool,
    config.ENGROVE_SETUP_TOKEN,
    config.ENGROVE_PUBLIC_URL,
  );
  if (setup.setupUrl) {
    pino({ level: config.LOG_LEVEL }).warn(
      { setupUrl: setup.setupUrl },
      'first-run Owner setup URL; this value is printed only once',
    );
  }

  const app = await NestFactory.create(AppModule.register(runtime), { bufferLogs: true });
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  express.set(
    'trust proxy',
    config.ENGROVE_TRUST_PROXY.length ? config.ENGROVE_TRUST_PROXY : false,
  );
  app.use((_: Request, response: Response, next: () => void) =>
    applyApiSecurityHeaders(config.NODE_ENV === 'production', response, next),
  );
  app.use(cookieParser());
  app.use((request: Request, response: Response, next: () => void) => {
    const started = process.hrtime.bigint();
    response.once('finish', () =>
      observeHttp(
        request.method,
        httpRouteLabel(request.route),
        response.statusCode,
        Number(process.hrtime.bigint() - started) / 1_000_000_000,
      ),
    );
    next();
  });
  app.use(
    pinoHttp({
      level: config.LOG_LEVEL,
      genReqId(request: Request, response: Response) {
        const id = String(request.headers[REQUEST_ID_HEADER] ?? randomUUID());
        response.setHeader(REQUEST_ID_HEADER, id);
        request.headers[REQUEST_ID_HEADER] = id;
        return id;
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.x-engrove-internal-secret',
          'req.headers.x-engrove-share-access',
        ],
        censor: '[REDACTED]',
      },
      serializers: { req: redactSharedViewRequest },
    }),
  );
  app.use(
    cors({
      origin: config.ENGROVE_PUBLIC_URL,
      credentials: true,
      exposedHeaders: [
        REQUEST_ID_HEADER,
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
        'RateLimit-Policy',
        'Retry-After',
        'ETag',
      ],
    }),
  );
  app.use(applyApiResponseCachePolicy);
  app.use(createApiRateLimitMiddleware(runtime));
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();

  SwaggerModule.setup('api/docs', app, createOpenApiDocument(app, config.ENGROVE_VERSION));

  const shutdown = async () => {
    await app.close();
    await runtime.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  await app.listen(config.ENGROVE_API_PORT, '0.0.0.0');
  return { app, runtime };
}

if (process.env.NODE_ENV !== 'test') void bootstrap();
