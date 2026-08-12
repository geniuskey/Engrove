import { Body, Controller, Header, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common';
import { ApiAcceptedResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import { observeError } from './metrics.controller.js';
import { ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const internalRoute = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) => value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'),
    'Route must be an internal application path.',
  );

export const clientErrorReportInput = z
  .object({
    errorId: z.string().uuid(),
    kind: z.enum(['render_error', 'chunk_load_error']),
    route: internalRoute,
    errorName: z.string().trim().min(1).max(80),
    componentStack: z.string().trim().max(4_000).optional(),
  })
  .strict();

const acceptedResponse = z.object({ accepted: z.literal(true), errorId: z.string().uuid() });

@ApiTags('Operations')
@Controller('api/v1/client-errors')
export class ClientErrorsController {
  private readonly logger = new Logger(ClientErrorsController.name);

  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiZodBody(
    clientErrorReportInput,
    'Privacy-bounded browser failure signal. User-entered values, error messages, full URLs, and JavaScript error stacks are not accepted.',
  )
  @ApiAcceptedResponse({ schema: openApiSchema(acceptedResponse) })
  @Header('Cache-Control', 'no-store')
  @HttpCode(202)
  @Post()
  async report(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(this.runtime, request, undefined, true);
    const report = clientErrorReportInput.parse(unparsed);
    const serverRequestId = requestId(request);
    this.logger.warn({
      event: 'client_render_error',
      errorId: report.errorId,
      kind: report.kind,
      route: report.route,
      errorName: report.errorName,
      ...(report.componentStack ? { componentStack: report.componentStack } : {}),
      actorId: actor.actorId,
      organizationId: actor.organizationId,
      requestId: serverRequestId,
    });
    observeError('CLIENT_RENDER_ERROR');
    return { accepted: true as const, errorId: report.errorId };
  }
}
