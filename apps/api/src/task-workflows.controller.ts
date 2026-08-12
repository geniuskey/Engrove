import {
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedTaskWorkflowRepository,
} from '@engrove/database';
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import { ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const category = z.enum(['todo', 'in_progress', 'done']);
const color = z.enum(['slate', 'sky', 'violet', 'amber', 'rose', 'emerald']);
const createStatusInput = z
  .object({
    key,
    name: z.string().trim().min(1).max(80),
    category,
    color,
    wipLimit: z.number().int().min(1).max(999).nullable().optional(),
  })
  .strict();
const updateStatusInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    category,
    color,
    position: z.number().int().min(0).max(1000),
    wipLimit: z.number().int().min(1).max(999).nullable(),
    initial: z.boolean(),
    rowVersion: z.number().int().positive(),
  })
  .strict();
const createTransitionInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    fromStatus: key,
    toStatus: key,
  })
  .strict();
const workflowStatusResponse = z
  .object({
    id,
    key,
    name: z.string(),
    category,
    color,
    position: z.number().int().nonnegative(),
    wip_limit: z.number().int().positive().nullable(),
    initial: z.boolean(),
    row_version: z.number().int().positive(),
    task_count: z.number().int().nonnegative(),
  })
  .strict();
const workflowTransitionResponse = z
  .object({
    id,
    name: z.string(),
    from_status: key,
    to_status: key,
    created_at: z.string(),
  })
  .strict();
const workflowResponse = z
  .object({
    statuses: z.array(workflowStatusResponse),
    transitions: z.array(workflowTransitionResponse),
  })
  .strict();
const archivedResponse = z.object({ archived: z.literal(true) }).strict();
const deletedResponse = z.object({ deleted: z.literal(true) }).strict();

async function repository(
  runtime: Runtime,
  request: Request,
  workspaceId: string,
  projectId: string,
  mutation = false,
) {
  const actor = await requireActor(
    runtime,
    request,
    mutation ? 'task.workflow.manage' : 'task.read',
    mutation,
  );
  return ScopedTaskWorkflowRepository.open(
    runtime.pool,
    actor,
    await resolveWorkspaceIdentifier(runtime.pool, workspaceId),
    await resolveProjectIdentifier(runtime.pool, projectId),
  );
}

@ApiTags('Task workflow')
@Controller('api/v1/workspaces/:workspaceId/projects/:projectId/task-workflow')
export class TaskWorkflowsController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @Get()
  @ApiOkResponse({ schema: openApiSchema(workflowResponse) })
  async get(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
  ) {
    return (await repository(this.runtime, request, workspaceId, projectId)).getWorkflow();
  }

  @ApiZodBody(createStatusInput, 'A project workflow status with a stable API key.')
  @ApiCreatedResponse({ schema: openApiSchema(workflowResponse) })
  @Post('statuses')
  async createStatus(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    return (await repository(this.runtime, request, workspaceId, projectId, true)).createStatus({
      ...createStatusInput.parse(raw),
      requestId: requestId(request),
    });
  }

  @ApiZodBody(updateStatusInput, 'Editable workflow status properties and row version.')
  @ApiOkResponse({ schema: openApiSchema(workflowResponse) })
  @Patch('statuses/:statusId')
  async updateStatus(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('statusId') statusId: string,
    @Body() raw: unknown,
  ) {
    return (await repository(this.runtime, request, workspaceId, projectId, true)).updateStatus(
      id.parse(statusId),
      {
        ...updateStatusInput.parse(raw),
        requestId: requestId(request),
      },
    );
  }

  @ApiOkResponse({ schema: openApiSchema(archivedResponse) })
  @Post('statuses/:statusId/archive')
  async archiveStatus(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('statusId') statusId: string,
  ) {
    await (
      await repository(this.runtime, request, workspaceId, projectId, true)
    ).archiveStatus(id.parse(statusId), requestId(request));
    return { archived: true };
  }

  @ApiZodBody(createTransitionInput, 'A directed transition between two active statuses.')
  @ApiCreatedResponse({ schema: openApiSchema(workflowResponse) })
  @Post('transitions')
  async createTransition(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    return (await repository(this.runtime, request, workspaceId, projectId, true)).createTransition(
      {
        ...createTransitionInput.parse(raw),
        requestId: requestId(request),
      },
    );
  }

  @ApiOkResponse({ schema: openApiSchema(deletedResponse) })
  @Delete('transitions/:transitionId')
  async deleteTransition(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('transitionId') transitionId: string,
  ) {
    await (
      await repository(this.runtime, request, workspaceId, projectId, true)
    ).deleteTransition(id.parse(transitionId), requestId(request));
    return { deleted: true };
  }
}
