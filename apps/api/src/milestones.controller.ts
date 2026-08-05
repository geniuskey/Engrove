import {
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedMilestoneRepository,
} from '@engrove/database';
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const milestoneStatus = z.enum(['planned', 'active', 'at_risk', 'completed']);
const baseInput = {
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10_000).default(''),
  status: milestoneStatus.default('planned'),
  startDate: z.iso.date().optional(),
  targetDate: z.iso.date(),
  progress: z.number().int().min(0).max(100).default(0),
};
const validDateOrder = (value: { startDate?: string | undefined; targetDate: string }) =>
  !value.startDate || value.startDate <= value.targetDate;
const dateOrderError = {
  message: 'Start date must be on or before the target date.',
  path: ['startDate'] as PropertyKey[],
};
const createInput = z.object(baseInput).strict().refine(validDateOrder, dateOrderError);
const updateInput = z
  .object({ ...baseInput, rowVersion: z.number().int().positive() })
  .strict()
  .refine(validDateOrder, dateOrderError);

async function repository(
  runtime: Runtime,
  request: Request,
  workspaceId: string,
  projectId: string,
  action: 'project.read' | 'project.update',
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

@Controller('api/v1/workspaces/:workspaceId/projects/:projectId')
export class MilestonesController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @Get('milestones') async milestones(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return {
      items: await (
        await repository(this.runtime, request, workspaceId, projectId, 'project.read')
      ).listMilestones(includeArchived === 'true'),
    };
  }

  @Get('milestones/:milestoneId') async milestone(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'project.read')
    ).getMilestone(id.parse(milestoneId));
  }

  @Post('milestones') async create(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'project.update', true)
    ).createMilestone({ ...createInput.parse(raw), requestId: requestId(request) });
  }

  @Patch('milestones/:milestoneId') async update(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
    @Body() raw: unknown,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'project.update', true)
    ).updateMilestone(id.parse(milestoneId), {
      ...updateInput.parse(raw),
      requestId: requestId(request),
    });
  }

  @Patch('milestones/:milestoneId/archive') async archive(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
    @Body() raw: unknown,
  ) {
    const body = z
      .object({ reason: z.string().trim().min(1).max(2_000) })
      .strict()
      .parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'project.update', true)
    ).setArchived(id.parse(milestoneId), true, body.reason, requestId(request));
  }

  @Post('milestones/:milestoneId/restore') async restore(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'project.update', true)
    ).setArchived(id.parse(milestoneId), false, '', requestId(request));
  }
}
