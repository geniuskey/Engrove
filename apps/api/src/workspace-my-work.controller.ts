import { getWorkspaceMyWork, resolveWorkspaceIdentifier } from '@engrove/database';
import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { requireActor } from './community.controller.js';
import { openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const querySchema = z.object({
  today: z.iso.date().optional(),
  query: z.string().trim().max(200).optional(),
  urgency: z.enum(['all', 'overdue', 'today', 'week', 'blocked', 'no_due']).default('all'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  sort: z.enum(['attention', 'dueDate', 'priority', 'updated']).default('attention'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const responseSchema = z.object({
  summary: z.object({
    total: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
    dueSoon: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    noDueDate: z.number().int().nonnegative(),
  }),
  items: z.array(
    z.object({
      id: z.uuid(),
      taskKey: z.string(),
      title: z.string(),
      status: z.object({
        key: z.string(),
        name: z.string(),
        category: z.enum(['todo', 'in_progress']),
        color: z.string(),
      }),
      priority: z.enum(['low', 'medium', 'high', 'critical']),
      dueDate: z.iso.date().nullable(),
      updatedAt: z.iso.datetime(),
      openBlockerCount: z.number().int().nonnegative(),
      parentTaskKey: z.string().nullable(),
      project: z.object({ id: z.uuid(), publicId: z.string(), name: z.string() }),
    }),
  ),
  pageInfo: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

@ApiTags('Workspace tasks')
@Controller('api/v1/workspaces/:workspaceId/my-work')
export class WorkspaceMyWorkController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiQuery({ name: 'today', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({
    name: 'urgency',
    required: false,
    enum: ['all', 'overdue', 'today', 'week', 'blocked', 'no_due'],
  })
  @ApiQuery({ name: 'priority', required: false, enum: ['low', 'medium', 'high', 'critical'] })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['attention', 'dueDate', 'priority', 'updated'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, maximum: 200 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({
    description: 'The signed-in member’s active assigned work across one workspace.',
    schema: openApiSchema(responseSchema),
  })
  @Get()
  async list(
    @Req() request: Request,
    @Param('workspaceId') workspaceIdentifier: string,
    @Query() raw: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'task.read');
    const input = querySchema.parse(raw);
    return getWorkspaceMyWork(
      this.runtime.pool,
      actor,
      await resolveWorkspaceIdentifier(this.runtime.pool, workspaceIdentifier),
      {
        today: input.today ?? new Date().toISOString().slice(0, 10),
        urgency: input.urgency,
        sort: input.sort,
        limit: input.limit,
        offset: input.offset,
        ...(input.query ? { query: input.query } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
      },
    );
  }
}
