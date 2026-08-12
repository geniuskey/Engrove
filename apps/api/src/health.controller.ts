import { Controller, Get, Inject, Req, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@engrove/shared';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { openApiSchema } from './openapi.js';
import { runReadinessChecks, type Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

function requestId(request: Request): string {
  return String(request.headers['x-request-id'] ?? 'unknown');
}

function base(service: string, version: string, request: Request): Omit<HealthResponse, 'status'> {
  return { service, version, timestamp: new Date().toISOString(), requestId: requestId(request) };
}

const dependencyHealthResponse = z
  .object({ status: z.enum(['ok', 'not_ready']), code: z.string().optional() })
  .strict();
const healthResponse = z
  .object({
    service: z.string(),
    status: z.enum(['ok', 'not_ready']),
    version: z.string(),
    timestamp: z.iso.datetime(),
    requestId: z.string(),
    dependencies: z.record(z.string(), dependencyHealthResponse).optional(),
  })
  .strict();

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiOkResponse({
    description: 'The API process is running.',
    schema: openApiSchema(healthResponse),
  })
  @Get('live')
  live(@Req() request: Request): HealthResponse {
    return {
      ...base('engrove-api', this.runtime.config.ENGROVE_VERSION, request),
      status: 'ok',
    };
  }

  @ApiOkResponse({
    description: 'The API and every required dependency are ready.',
    schema: openApiSchema(healthResponse),
  })
  @ApiServiceUnavailableResponse({
    description: 'One or more required dependencies are unavailable.',
    schema: openApiSchema(healthResponse),
  })
  @Get('ready')
  async ready(@Req() request: Request): Promise<HealthResponse> {
    const dependencies = await runReadinessChecks(this.runtime);
    const ready = Object.values(dependencies).every((dependency) => dependency.status === 'ok');
    const response: HealthResponse = {
      ...base('engrove-api', this.runtime.config.ENGROVE_VERSION, request),
      status: ready ? 'ok' : 'not_ready',
      dependencies,
    };
    if (!ready) throw new ServiceUnavailableException(response);
    return response;
  }
}
