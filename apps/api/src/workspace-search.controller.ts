import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  resolveWorkspaceIdentifier,
  searchWorkspace,
  type WorkspaceSearchResultType,
} from '@engrove/database';
import type { Request } from 'express';
import { z } from 'zod';
import { actorAllowsAction, requireActor } from './community.controller.js';
import { openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const searchQuery = z
  .object({
    query: z.string().trim().min(2).max(120),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

const searchResult = z.object({
  type: z.enum(['project', 'task', 'milestone', 'table']),
  id: z.uuid(),
  publicId: z.string().nullable(),
  title: z.string(),
  key: z.string(),
  projectPublicId: z.string().nullable(),
  projectName: z.string().nullable(),
  workspaceShared: z.boolean(),
});

const searchResponse = z.object({
  items: z.array(searchResult),
  pageInfo: z.object({
    limit: z.number().int(),
    total: z.number().int(),
    hasMore: z.boolean(),
  }),
});

@ApiTags('Workspace search')
@Controller('api/v1/workspaces/:workspaceId/search')
export class WorkspaceSearchController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiQuery({ name: 'query', required: true, minLength: 2, maxLength: 120 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 50 })
  @ApiOkResponse({
    description:
      'Ranked active projects, tasks, key dates, and tables within the selected workspace.',
    schema: openApiSchema(searchResponse),
  })
  @Get()
  async search(
    @Req() request: Request,
    @Param('workspaceId') workspaceIdentifier: string,
    @Query() raw: unknown,
  ) {
    const actions = ['project.read', 'task.read', 'milestone.read', 'schema.read'] as const;
    const actor = await requireActor(this.runtime, request, actions);
    const allowedTypes: WorkspaceSearchResultType[] = [];
    if (actorAllowsAction(actor, 'project.read')) allowedTypes.push('project');
    if (actorAllowsAction(actor, 'task.read')) allowedTypes.push('task');
    if (actorAllowsAction(actor, 'milestone.read')) allowedTypes.push('milestone');
    if (actorAllowsAction(actor, 'schema.read')) allowedTypes.push('table');
    const input = searchQuery.parse(raw);
    return searchWorkspace(
      this.runtime.pool,
      actor,
      await resolveWorkspaceIdentifier(this.runtime.pool, workspaceIdentifier),
      input.query,
      input.limit,
      allowedTypes,
    );
  }
}
