import { Controller, Get, Req, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@engrove/shared';
import type { Request } from 'express';
import { runReadinessChecks, type Runtime } from './runtime.js';

let runtime: Runtime | undefined;

export function installRuntime(value: Runtime): void {
  runtime = value;
}

function requestId(request: Request): string {
  return String(request.headers['x-request-id'] ?? 'unknown');
}

function base(service: string, version: string, request: Request): Omit<HealthResponse, 'status'> {
  return { service, version, timestamp: new Date().toISOString(), requestId: requestId(request) };
}

@Controller('health')
export class HealthController {
  @Get('live')
  live(@Req() request: Request): HealthResponse {
    return {
      ...base('engrove-api', runtime?.config.ENGROVE_VERSION ?? 'unknown', request),
      status: 'ok',
    };
  }

  @Get('ready')
  async ready(@Req() request: Request): Promise<HealthResponse> {
    if (!runtime) throw new ServiceUnavailableException({ code: 'RUNTIME_NOT_INITIALIZED' });
    const dependencies = await runReadinessChecks(runtime);
    const ready = Object.values(dependencies).every((dependency) => dependency.status === 'ok');
    const response: HealthResponse = {
      ...base('engrove-api', runtime.config.ENGROVE_VERSION, request),
      status: ready ? 'ok' : 'not_ready',
      dependencies,
    };
    if (!ready) throw new ServiceUnavailableException(response);
    return response;
  }
}
