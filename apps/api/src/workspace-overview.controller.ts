import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { getWorkspaceOverview, resolveWorkspaceIdentifier } from '@engrove/database';
import type { Request } from 'express';
import { z } from 'zod';
import { requireActor } from './community.controller.js';
import { openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const overviewQuery = z
  .object({
    today: z.iso.date().optional(),
    dateLimit: z.coerce.number().int().min(1).max(50).default(6),
    projectQuery: z.string().trim().max(200).default(''),
    projectLimit: z.coerce.number().int().min(1).max(50).default(20),
    projectOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();

const overviewDate = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.enum(['planned', 'active', 'at_risk', 'completed']),
  targetDate: z.iso.date(),
  project: z.object({ id: z.uuid(), publicId: z.string(), name: z.string() }),
});

const overviewResponse = z.object({
  workspace: z.object({
    id: z.uuid(),
    publicId: z.string(),
    name: z.string(),
    description: z.string(),
  }),
  summary: z.object({
    activeProjects: z.number().int().nonnegative(),
    openTasks: z.number().int().nonnegative(),
    blockedTasks: z.number().int().nonnegative(),
    overdueDates: z.number().int().nonnegative(),
    nextUpcomingDate: overviewDate.nullable(),
  }),
  projects: z
    .array(
      z.object({
        id: z.uuid(),
        publicId: z.string(),
        name: z.string(),
        key: z.string(),
        status: z.enum(['active', 'on_hold', 'completed']),
        archivedAt: z.string().nullable(),
        openTaskCount: z.number().int().nonnegative(),
        blockedTaskCount: z.number().int().nonnegative(),
        overdueDateCount: z.number().int().nonnegative(),
        nextDate: overviewDate.omit({ project: true }).nullable(),
      }),
    )
    .max(50),
  projectPageInfo: z.object({
    limit: z.number().int().min(1).max(50),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    hasNext: z.boolean(),
  }),
  dates: z.array(overviewDate).max(50),
});

@ApiTags('Workspace overview')
@Controller('api/v1/workspaces/:workspaceId/overview')
export class WorkspaceOverviewController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiQuery({
    name: 'today',
    required: false,
    type: String,
    format: 'date',
    description: 'Viewer-local date used for overdue and upcoming classification; defaults to UTC.',
  })
  @ApiQuery({ name: 'dateLimit', required: false, type: Number, minimum: 1, maximum: 50 })
  @ApiQuery({
    name: 'projectQuery',
    required: false,
    type: String,
    maxLength: 200,
    description: 'Literal case-insensitive search over project name, key, and description.',
  })
  @ApiQuery({ name: 'projectLimit', required: false, type: Number, minimum: 1, maximum: 50 })
  @ApiQuery({
    name: 'projectOffset',
    required: false,
    type: Number,
    minimum: 0,
    maximum: 1_000_000,
  })
  @ApiOkResponse({
    description: 'A consistent, bounded workspace project and schedule snapshot.',
    schema: openApiSchema(overviewResponse),
  })
  @Get()
  async overview(
    @Req() request: Request,
    @Param('workspaceId') workspaceIdentifier: string,
    @Query() raw: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'project.read');
    const input = overviewQuery.parse(raw);
    return getWorkspaceOverview(
      this.runtime.pool,
      actor,
      await resolveWorkspaceIdentifier(this.runtime.pool, workspaceIdentifier),
      input.today ?? new Date().toISOString().slice(0, 10),
      input.dateLimit,
      input.projectLimit,
      input.projectOffset,
      input.projectQuery,
    );
  }
}
