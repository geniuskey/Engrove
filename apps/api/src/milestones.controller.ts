import {
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedMilestoneRepository,
} from '@engrove/database';
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import { ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const milestoneStatus = z.enum(['planned', 'active', 'at_risk', 'completed']);
const baseInput = {
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10_000).default(''),
  status: milestoneStatus.default('planned'),
  targetDate: z.iso.date(),
};
const taskIds = z
  .array(id)
  .max(200)
  .refine((values) => new Set(values).size === values.length, 'Linked tasks must be unique.');
const createInput = z.object({ ...baseInput, taskIds: taskIds.default([]) }).strict();
const idempotencyKey = z.string().min(8).max(200);
const updateInput = z
  .object({ ...baseInput, taskIds: taskIds.optional(), rowVersion: z.number().int().positive() })
  .strict();
const archiveInput = z.object({ reason: z.string().trim().min(1).max(2_000) }).strict();
const linkedTaskResponse = z.object({
  id,
  task_key: z.string(),
  title: z.string(),
  status: z.string(),
  status_name: z.string(),
  status_category: z.enum(['todo', 'in_progress', 'done']),
  archived_at: z.string().nullable(),
});
const milestoneResponse = z
  .object({
    id,
    title: z.string(),
    description: z.string(),
    status: milestoneStatus,
    target_date: z.string(),
    completed_at: z.string().nullable(),
    row_version: z.number().int().positive(),
    archived_at: z.string().nullable(),
    linked_tasks: z.array(linkedTaskResponse),
    task_count: z.number().int().nonnegative(),
    completed_task_count: z.number().int().nonnegative(),
  })
  .passthrough();
const milestoneCreateResponse = milestoneResponse.extend({ idempotent_replay: z.boolean() });
const milestonePageInfo = z.object({
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean(),
});
const milestoneSummary = z.object({
  planned: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  atRisk: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
});
const milestoneListInput = z
  .object({
    archiveState: z.enum(['active', 'archived', 'all']).optional(),
    includeArchived: z.enum(['true', 'false']).optional(),
    query: z.string().trim().max(120).default(''),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .transform(({ archiveState, includeArchived, ...input }) => ({
    ...input,
    archiveState: archiveState ?? (includeArchived === 'true' ? 'all' : 'active'),
  }));

async function repository(
  runtime: Runtime,
  request: Request,
  workspaceId: string,
  projectId: string,
  action: 'milestone.read' | 'milestone.manage',
  mutation = false,
) {
  const actor = await requireActor(runtime, request, action, mutation);
  return ScopedMilestoneRepository.open(
    runtime.pool,
    actor,
    await resolveWorkspaceIdentifier(runtime.pool, workspaceId),
    await resolveProjectIdentifier(runtime.pool, projectId),
  );
}

@ApiTags('Project key dates')
@Controller('api/v1/workspaces/:workspaceId/projects/:projectId')
export class MilestonesController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'archiveState', required: false, enum: ['active', 'archived', 'all'] })
  @ApiQuery({
    name: 'includeArchived',
    required: false,
    type: Boolean,
    description: 'Legacy alias for archiveState=all.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({
    schema: openApiSchema(
      z.object({
        items: z.array(milestoneResponse).max(100),
        pageInfo: milestonePageInfo,
        summary: milestoneSummary,
        nextMilestoneId: id.nullable(),
      }),
    ),
  })
  @Get('milestones')
  async milestones(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('query') query?: string,
    @Query('archiveState') archiveState?: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const input = milestoneListInput.parse({
      query,
      archiveState,
      includeArchived,
      limit,
      offset,
    });
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'milestone.read')
    ).listMilestonePage(input);
  }

  @ApiOkResponse({ schema: openApiSchema(milestoneResponse) })
  @Get('milestones/:milestoneId')
  async milestone(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'milestone.read')
    ).getMilestone(id.parse(milestoneId));
  }

  @ApiZodBody(createInput, 'Create a single target date with optional linked tasks.', {
    title: 'Design release',
    description: 'Approved drawings released to manufacturing.',
    status: 'planned',
    targetDate: '2026-09-18',
    taskIds: [],
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: true,
    description:
      'Caller-generated key (8–200 characters). Identical retries replay the created key date for 24 hours.',
  })
  @ApiCreatedResponse({ schema: openApiSchema(milestoneCreateResponse) })
  @Post('milestones')
  async create(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Body() raw: unknown,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'milestone.manage', true)
    ).createMilestone({
      ...createInput.parse(raw),
      idempotencyKey: idempotencyKey.parse(rawIdempotencyKey),
      requestId: requestId(request),
    });
  }

  @ApiZodBody(updateInput, 'Replace a key date using its last-read row version.', {
    title: 'Design release',
    description: 'Approved drawings released to manufacturing.',
    status: 'at_risk',
    targetDate: '2026-09-25',
    taskIds: [],
    rowVersion: 2,
  })
  @ApiOkResponse({ schema: openApiSchema(milestoneResponse) })
  @Patch('milestones/:milestoneId')
  async update(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
    @Body() raw: unknown,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'milestone.manage', true)
    ).updateMilestone(id.parse(milestoneId), {
      ...updateInput.parse(raw),
      requestId: requestId(request),
    });
  }

  @ApiZodBody(archiveInput, 'Archive a key date while retaining its task links.', {
    reason: 'Release plan superseded',
  })
  @ApiOkResponse({ schema: openApiSchema(milestoneResponse) })
  @Patch('milestones/:milestoneId/archive')
  async archive(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
    @Body() raw: unknown,
  ) {
    const body = archiveInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'milestone.manage', true)
    ).setArchived(id.parse(milestoneId), true, body.reason, requestId(request));
  }

  @ApiOkResponse({ schema: openApiSchema(milestoneResponse) })
  @Post('milestones/:milestoneId/restore')
  async restore(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'milestone.manage', true)
    ).setArchived(id.parse(milestoneId), false, '', requestId(request));
  }
}
