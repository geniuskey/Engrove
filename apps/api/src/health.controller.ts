import { Controller, Get, Inject, Req, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@engrove/shared';
import type { Request } from 'express';
import { runReadinessChecks, type Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

function requestId(request: Request): string {
  return String(request.headers['x-request-id'] ?? 'unknown');
}

function base(service: string, version: string, request: Request): Omit<HealthResponse, 'status'> {
  return { service, version, timestamp: new Date().toISOString(), requestId: requestId(request) };
}

@Controller('health')
export class HealthController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @Get('live')
  live(@Req() request: Request): HealthResponse {
    return {
      ...base('engrove-api', this.runtime.config.ENGROVE_VERSION, request),
      status: 'ok',
    };
  }

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
