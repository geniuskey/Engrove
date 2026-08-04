import {
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedTaskRepository,
  type TaskEntityType,
  type TaskLinkInput,
} from '@engrove/database';
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const status = z.enum(['todo', 'in_progress', 'blocked', 'done']);
const priority = z.enum(['low', 'medium', 'high', 'critical']);
const entityType = z.enum([
  'record',
  'sample',
  'issue',
  'test_run',
  'measurement_result',
  'specification_evaluation',
  'dataset',
]);
const link = z.object({ entityType, entityId: id }).strict();
const baseInput = {
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10_000).default(''),
  status: status.default('todo'),
  priority: priority.default('medium'),
  assigneeId: id.optional(),
  dueDate: z.iso.date().optional(),
};
const createInput = z.object({ ...baseInput, links: z.array(link).max(30).default([]) }).strict();
const updateInput = z.object({ ...baseInput, rowVersion: z.number().int().positive() }).strict();

async function repository(
  runtime: Runtime,
  request: Request,
  workspaceId: string,
  projectId: string,
  action: 'task.read' | 'task.create' | 'task.update' | 'task.archive' | 'task.restore',
  mutation = false,
) {
  const actor = await requireActor(runtime, request, action, mutation);
  return ScopedTaskRepository.open(
    runtime.pool,
    actor,
    await resolveWorkspaceIdentifier(runtime.pool, workspaceId),
    await resolveProjectIdentifier(runtime.pool, projectId),
  );
}

@Controller('api/v1/workspaces/:workspaceId/projects/:projectId')
export class TasksController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @Get('tasks') async tasks(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('entityType') rawEntityType?: string,
    @Query('entityId') rawEntityId?: string,
  ) {
    const parsedEntityType = rawEntityType ? entityType.parse(rawEntityType) : undefined;
    const parsedEntityId = rawEntityId ? id.parse(rawEntityId) : undefined;
    return {
      items: await (
        await repository(this.runtime, request, workspaceId, projectId, 'task.read')
      ).listTasks({
        includeArchived: includeArchived === 'true',
        entityType: parsedEntityType as TaskEntityType | undefined,
        entityId: parsedEntityId,
      }),
    };
  }

  @Get('tasks/:taskId') async task(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ) {
    return (await repository(this.runtime, request, workspaceId, projectId, 'task.read')).getTask(
      id.parse(taskId),
    );
  }

  @Post('tasks') async create(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const input = createInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.create', true)
    ).createTask({
      ...input,
      links: input.links as TaskLinkInput[],
      requestId: requestId(request),
    });
  }

  @Patch('tasks/:taskId') async update(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() raw: unknown,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.update', true)
    ).updateTask(id.parse(taskId), { ...updateInput.parse(raw), requestId: requestId(request) });
  }

  @Patch('tasks/:taskId/archive') async archive(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() raw: unknown,
  ) {
    const body = z
      .object({ reason: z.string().trim().min(1).max(2_000) })
      .strict()
      .parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.archive', true)
    ).setArchived(id.parse(taskId), true, body.reason, requestId(request));
  }

  @Post('tasks/:taskId/restore') async restore(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.restore', true)
    ).setArchived(id.parse(taskId), false, '', requestId(request));
  }

  @Post('specification-evaluations/:evaluationId/task') async fromEvaluation(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('evaluationId') evaluationId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.create', true)
    ).createFromFailedEvaluation(id.parse(evaluationId), requestId(request));
  }
}
