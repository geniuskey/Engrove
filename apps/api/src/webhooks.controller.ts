import {
  deriveWebhookSigningSecret,
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedWebhookRepository,
  webhookEventTypes,
} from '@engrove/database';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import { ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const eventType = z.enum(webhookEventTypes);
const deliveryEventType = z.union([eventType, z.literal('webhook.test')]);
const endpointUrl = z
  .url()
  .max(2_000)
  .transform((value, context) => {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
      context.addIssue({
        code: 'custom',
        message: 'Webhook URLs must use HTTPS without credentials or fragments.',
      });
      return z.NEVER;
    }
    return parsed.toString();
  });
const endpointFields = {
  name: z.string().trim().min(1).max(80),
  url: endpointUrl,
  objectTypeId: id.nullable().default(null),
  eventTypes: z
    .array(eventType)
    .min(1)
    .max(webhookEventTypes.length)
    .refine((values) => new Set(values).size === values.length),
};
function validateEndpointScope(
  input: { objectTypeId: string | null; eventTypes: string[] },
  context: z.RefinementCtx,
) {
  if (input.objectTypeId && input.eventTypes.some((event) => event.startsWith('task.')))
    context.addIssue({
      code: 'custom',
      path: ['eventTypes'],
      message: 'Task events require a project-wide endpoint without a table restriction.',
    });
}
const endpointInput = z.object(endpointFields).strict().superRefine(validateEndpointScope);
const endpointUpdateInput = z
  .object({ ...endpointFields, active: z.boolean() })
  .strict()
  .superRefine(validateEndpointScope);
const endpointResponse = z.object({
  id,
  name: z.string(),
  url: z.url(),
  objectTypeId: id.nullable(),
  objectTypeName: z.string().nullable(),
  eventTypes: z.array(eventType),
  secretVersion: z.number().int().positive(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const issuedEndpointResponse = endpointResponse.extend({ signingSecret: z.string() });
const deliveryResponse = z.object({
  id,
  eventType: deliveryEventType,
  status: z.enum(['queued', 'sending', 'succeeded', 'failed']),
  attemptCount: z.number().int().nonnegative(),
  responseStatus: z.number().int().nullable(),
  responseSnippet: z.string().nullable(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.iso.datetime(),
  deliveredAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const deliveryStatus = z.enum(['queued', 'sending', 'succeeded', 'failed']);
const deliveryListInput = z.object({
  status: z.union([deliveryStatus, z.literal('all')]).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const endpointListInput = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const pageInfoResponse = z.object({
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean(),
});
const endpointPageResponse = z.object({
  items: z.array(endpointResponse).max(100),
  pageInfo: pageInfoResponse,
});
const deliveryPageResponse = z.object({
  items: z.array(deliveryResponse).max(100),
  pageInfo: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    hasNext: z.boolean(),
  }),
  summary: z.object({
    queued: z.number().int().nonnegative(),
    sending: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});

async function repository(
  runtime: Runtime,
  request: Request,
  workspaceId: string,
  projectId: string,
  mutation = false,
) {
  const actor = await requireActor(runtime, request, 'webhook.manage', mutation);
  return {
    actor,
    repository: await ScopedWebhookRepository.open(
      runtime.pool,
      actor,
      await resolveWorkspaceIdentifier(runtime.pool, workspaceId),
      await resolveProjectIdentifier(runtime.pool, projectId),
    ),
  };
}

@ApiTags('Webhooks')
@Controller('api/v1/workspaces/:workspaceId/projects/:projectId/webhooks')
export class WebhooksController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100).' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Zero-based offset.' })
  @ApiOkResponse({ schema: openApiSchema(endpointPageResponse) })
  @Get()
  async list(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const input = endpointListInput.parse({ limit, offset });
    const scoped = await repository(this.runtime, request, workspaceId, projectId);
    return scoped.repository.listEndpointPage(input);
  }

  @ApiZodBody(endpointInput, 'Project-wide or table-scoped event subscription.')
  @ApiCreatedResponse({ schema: openApiSchema(issuedEndpointResponse) })
  @Post()
  async create(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const input = endpointInput.parse(raw);
    const scoped = await repository(this.runtime, request, workspaceId, projectId, true);
    const endpoint = await scoped.repository.createEndpoint({
      ...input,
      requestId: requestId(request),
    });
    return {
      ...endpoint,
      signingSecret: deriveWebhookSigningSecret(
        this.runtime.config.INTERNAL_SERVICE_SECRET,
        endpoint.id,
        endpoint.secretVersion,
      ),
    };
  }

  @ApiZodBody(endpointUpdateInput, 'Complete replacement webhook endpoint configuration.')
  @ApiOkResponse({ schema: openApiSchema(endpointResponse) })
  @Patch(':endpointId')
  async update(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('endpointId') endpointId: string,
    @Body() raw: unknown,
  ) {
    const input = endpointUpdateInput.parse(raw);
    const scoped = await repository(this.runtime, request, workspaceId, projectId, true);
    return scoped.repository.updateEndpoint(id.parse(endpointId), {
      ...input,
      requestId: requestId(request),
    });
  }

  @ApiCreatedResponse({ schema: openApiSchema(issuedEndpointResponse) })
  @Post(':endpointId/rotate-secret')
  async rotateSecret(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('endpointId') endpointId: string,
  ) {
    const scoped = await repository(this.runtime, request, workspaceId, projectId, true);
    const endpoint = await scoped.repository.rotateSecret(id.parse(endpointId), requestId(request));
    return {
      ...endpoint,
      signingSecret: deriveWebhookSigningSecret(
        this.runtime.config.INTERNAL_SERVICE_SECRET,
        endpoint.id,
        endpoint.secretVersion,
      ),
    };
  }

  @ApiAcceptedResponse({ schema: openApiSchema(deliveryResponse) })
  @HttpCode(202)
  @Post(':endpointId/test')
  async test(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('endpointId') endpointId: string,
  ) {
    const scoped = await repository(this.runtime, request, workspaceId, projectId, true);
    return scoped.repository.enqueueTest(id.parse(endpointId), requestId(request));
  }

  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['all', 'queued', 'sending', 'succeeded', 'failed'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100).' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Zero-based offset.' })
  @ApiOkResponse({ schema: openApiSchema(deliveryPageResponse) })
  @Get(':endpointId/deliveries')
  async deliveries(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('endpointId') endpointId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const input = deliveryListInput.parse({ status, limit, offset });
    const scoped = await repository(this.runtime, request, workspaceId, projectId);
    return scoped.repository.listDeliveryPage(id.parse(endpointId), {
      ...(input.status !== 'all' ? { status: input.status } : {}),
      limit: input.limit,
      offset: input.offset,
    });
  }

  @ApiAcceptedResponse({ schema: openApiSchema(deliveryResponse) })
  @HttpCode(202)
  @Post(':endpointId/deliveries/:deliveryId/retry')
  async retryDelivery(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('endpointId') endpointId: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    const scoped = await repository(this.runtime, request, workspaceId, projectId, true);
    return scoped.repository.retryDelivery(
      id.parse(endpointId),
      id.parse(deliveryId),
      requestId(request),
    );
  }
}
