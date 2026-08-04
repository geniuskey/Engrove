import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { parseConfig } from '@engrove/config';
import { initializeInstallation } from '@engrove/database';
import { REQUEST_ID_HEADER } from '@engrove/shared';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { Request, Response } from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { AppModule } from './app.module.js';
import { ApiErrorFilter } from './error.filter.js';
import { createRuntime } from './runtime.js';
import { httpRouteLabel, observeHttp } from './metrics.controller.js';

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
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', config.ENGROVE_TRUST_PROXY.length ? config.ENGROVE_TRUST_PROXY : false);
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
        ],
        censor: '[REDACTED]',
      },
    }),
  );
  app.use(cors({ origin: config.ENGROVE_PUBLIC_URL, credentials: true }));
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();

  const openApi = new DocumentBuilder()
    .setTitle('Engrove Community API')
    .setDescription('Community REST API')
    .setVersion(config.ENGROVE_VERSION)
    .addCookieAuth('engrove_session')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApi));

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
