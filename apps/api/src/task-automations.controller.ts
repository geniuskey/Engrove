import {
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedTaskAutomationRepository,
  taskAutomationOutcomes,
  taskAutomationTriggerTypes,
  type TaskAutomationRuleInput,
} from '@engrove/database';
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import { ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const status = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const priority = z.enum(['low', 'medium', 'high', 'critical']);
const triggerType = z.enum(taskAutomationTriggerTypes);
const triggerConfig = z
  .object({
    fromStatus: z.union([z.literal('any'), status]).optional(),
    toStatus: z.union([z.literal('any'), status]).optional(),
    fromPriority: z.union([z.literal('any'), priority]).optional(),
    toPriority: z.union([z.literal('any'), priority]).optional(),
    assignment: z.enum(['any', 'assigned', 'unassigned', 'changed']).optional(),
  })
  .strict();
const conditionConfig = z
  .object({
    status: status.optional(),
    priority: priority.optional(),
    assignee: z.enum(['assigned', 'unassigned']).optional(),
  })
  .strict();
const actionConfig = z
  .object({
    status: status.optional(),
    priority: priority.optional(),
    assigneeId: id.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one automation action is required.',
  });
const ruleInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(2_000).default(''),
    triggerType,
    triggerConfig,
    conditionConfig,
    actionConfig,
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = Object.keys(value.triggerConfig);
    const allowed =
      value.triggerType === 'task.created'
        ? []
        : value.triggerType === 'task.status_changed'
          ? ['fromStatus', 'toStatus']
          : value.triggerType === 'task.priority_changed'
            ? ['fromPriority', 'toPriority']
            : ['assignment'];
    if (keys.some((key) => !allowed.includes(key)))
      context.addIssue({
        code: 'custom',
        path: ['triggerConfig'],
        message: 'Trigger configuration does not match the trigger type.',
      });
  });
const executionOutcome = z.enum(taskAutomationOutcomes);
const pageInfoResponse = z.object({
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean(),
});
const ruleResponse = z.object({
  id,
  name: z.string(),
  description: z.string(),
  triggerType,
  triggerConfig,
  conditionConfig,
  actionConfig,
  active: z.boolean(),
  executionCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  lastOutcome: z.enum(taskAutomationOutcomes).nullable(),
  lastErrorCode: z.string().nullable(),
  lastExecutedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const ruleListInput = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const rulePageResponse = z.object({
  items: z.array(ruleResponse).max(100),
  pageInfo: pageInfoResponse,
});
const executionListInput = z.object({
  outcome: z.union([executionOutcome, z.literal('all')]).default('all'),
  ruleId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const executionResponse = z.object({
  id,
  ruleId: id,
  ruleName: z.string(),
  triggerType,
  triggerEvent: z.record(z.string(), z.unknown()),
  taskId: id,
  taskKey: z.string(),
  taskTitle: z.string(),
  traceId: id,
  depth: z.number().int().nonnegative(),
  outcome: executionOutcome,
  changes: z.record(z.string(), z.unknown()),
  errorCode: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
const executionPageResponse = z.object({
  items: z.array(executionResponse).max(100),
  pageInfo: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    hasNext: z.boolean(),
  }),
  summary: z.object({
    succeeded: z.number().int().nonnegative(),
    no_change: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});
const archiveRuleResponse = z.object({ archived: z.literal(true) }).strict();
const ruleExample = {
  name: 'Escalate critical work',
  description: 'Move newly critical tasks into active work.',
  triggerType: 'task.priority_changed',
  triggerConfig: { fromPriority: 'any', toPriority: 'critical' },
  conditionConfig: { assignee: 'assigned' },
  actionConfig: { status: 'in_progress' },
  active: true,
};

async function repository(
  runtime: Runtime,
  request: Request,
  workspaceId: string,
  projectId: string,
  mutation = false,
) {
  const actor = await requireActor(runtime, request, 'task.automation.manage', mutation);
  return ScopedTaskAutomationRepository.open(
    runtime.pool,
    actor,
    await resolveWorkspaceIdentifier(runtime.pool, workspaceId),
    await resolveProjectIdentifier(runtime.pool, projectId),
  );
}

@ApiTags('Task automation')
@Controller('api/v1/workspaces/:workspaceId/projects/:projectId/task-automations')
export class TaskAutomationsController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100).' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Zero-based offset.' })
  @ApiOkResponse({ schema: openApiSchema(rulePageResponse) })
  @Get()
  async list(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const input = ruleListInput.parse({ limit, offset });
    return (await repository(this.runtime, request, workspaceId, projectId)).listRulePage(input);
  }

  @ApiQuery({
    name: 'outcome',
    required: false,
    enum: ['all', ...taskAutomationOutcomes],
  })
  @ApiQuery({ name: 'ruleId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100).' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Zero-based offset.' })
  @ApiOkResponse({ schema: openApiSchema(executionPageResponse) })
  @Get('executions')
  async executions(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('outcome') outcome?: string,
    @Query('ruleId') ruleId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const input = executionListInput.parse({ outcome, ruleId, limit, offset });
    return (await repository(this.runtime, request, workspaceId, projectId)).listExecutionPage({
      ...(input.outcome !== 'all' ? { outcome: input.outcome } : {}),
      ...(input.ruleId ? { ruleId: input.ruleId } : {}),
      limit: input.limit,
      offset: input.offset,
    });
  }

  @ApiZodBody(
    ruleInput,
    'A project-scoped task trigger, optional conditions, and field actions.',
    ruleExample,
  )
  @ApiCreatedResponse({ schema: openApiSchema(ruleResponse) })
  @Post()
  async create(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const input = ruleInput.parse(raw) as TaskAutomationRuleInput;
    return (await repository(this.runtime, request, workspaceId, projectId, true)).createRule({
      ...input,
      requestId: requestId(request),
    });
  }

  @ApiZodBody(ruleInput, 'Replacement automation rule state.', ruleExample)
  @ApiOkResponse({ schema: openApiSchema(ruleResponse) })
  @Patch(':ruleId')
  async update(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('ruleId') ruleId: string,
    @Body() raw: unknown,
  ) {
    const input = ruleInput.parse(raw) as TaskAutomationRuleInput;
    return (await repository(this.runtime, request, workspaceId, projectId, true)).updateRule(
      id.parse(ruleId),
      { ...input, requestId: requestId(request) },
    );
  }

  @ApiOkResponse({ schema: openApiSchema(archiveRuleResponse) })
  @Post(':ruleId/archive')
  async archive(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('ruleId') ruleId: string,
  ) {
    await (
      await repository(this.runtime, request, workspaceId, projectId, true)
    ).archiveRule(id.parse(ruleId), requestId(request));
    return { archived: true };
  }
}
