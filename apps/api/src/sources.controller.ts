import {
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedSourceRepository,
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
const httpUrl = z
  .url()
  .max(2_048)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Only HTTP and HTTPS source URLs are supported.',
  });
const baseInput = {
  title: z.string().trim().min(1).max(240),
  provider: z.string().trim().min(1).max(120),
  url: httpUrl,
  externalId: z.string().trim().max(500).default(''),
  version: z.string().trim().max(240).default(''),
  observedOn: z.iso.date(),
  notes: z.string().trim().max(10_000).default(''),
};
const createInput = z.object(baseInput).strict();
const updateInput = z.object({ ...baseInput, rowVersion: z.number().int().positive() }).strict();
const archiveInput = z.object({ reason: z.string().trim().min(1).max(2_000) }).strict();
const listInput = z.object({
  includeArchived: z.enum(['true', 'false']).default('false'),
  archiveState: z.enum(['active', 'archived', 'all']).optional(),
  query: z.string().trim().max(200).optional(),
  provider: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const sourceResponse = z
  .object({
    id,
    title: z.string(),
    provider: z.string(),
    url: z.string(),
    external_id: z.string(),
    version: z.string(),
    observed_on: z.string(),
    notes: z.string(),
    row_version: z.number().int().positive(),
    archived_at: z.string().nullable(),
  })
  .passthrough();
const sourceListResponse = z.object({
  items: z.array(sourceResponse),
  pageInfo: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    hasNext: z.boolean(),
  }),
  summary: z.object({ providerCount: z.number().int().nonnegative() }),
});

async function repository(
  runtime: Runtime,
  request: Request,
  workspaceId: string,
  projectId: string,
  action: 'project.read' | 'project.update',
  mutation = false,
) {
  const actor = await requireActor(runtime, request, action, mutation);
  return ScopedSourceRepository.open(
    runtime.pool,
    actor,
    await resolveWorkspaceIdentifier(runtime.pool, workspaceId),
    await resolveProjectIdentifier(runtime.pool, projectId),
  );
}

@ApiTags('External traceability')
@Controller('api/v1/workspaces/:workspaceId/projects/:projectId')
export class SourcesController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean, deprecated: true })
  @ApiQuery({
    name: 'archiveState',
    required: false,
    enum: ['active', 'archived', 'all'],
    description: 'Lifecycle scope. Overrides the legacy includeArchived flag.',
  })
  @ApiQuery({
    name: 'query',
    required: false,
    type: String,
    description: 'Search source metadata.',
  })
  @ApiQuery({
    name: 'provider',
    required: false,
    type: String,
    description: 'Exact provider name.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–200).' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Zero-based offset.' })
  @ApiOkResponse({ schema: openApiSchema(sourceListResponse) })
  @Get('sources')
  async sources(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('archiveState') archiveState?: string,
    @Query('query') query?: string,
    @Query('provider') provider?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsed = listInput.parse({
      includeArchived,
      archiveState,
      query,
      provider,
      limit,
      offset,
    });
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'project.read')
    ).listSources({
      archiveState: parsed.archiveState ?? (parsed.includeArchived === 'true' ? 'all' : 'active'),
      ...(parsed.query !== undefined ? { query: parsed.query } : {}),
      ...(parsed.provider !== undefined ? { provider: parsed.provider } : {}),
      limit: parsed.limit,
      offset: parsed.offset,
    });
  }

  @ApiOkResponse({ schema: openApiSchema(sourceResponse) })
  @Get('sources/:sourceId')
  async source(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('sourceId') sourceId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'project.read')
    ).getSource(id.parse(sourceId));
  }

  @ApiZodBody(createInput, 'Register an external source without copying its contents.', {
    title: 'Thermal qualification report',
    provider: 'Confluence',
    url: 'https://engineering.example.com/reports/thermal-qualification',
    externalId: 'ENG-142',
    version: 'Rev C',
    observedOn: '2026-08-11',
    notes: 'Authoritative qualification evidence.',
  })
  @ApiCreatedResponse({ schema: openApiSchema(sourceResponse) })
  @Post('sources')
  async create(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'project.update', true)
    ).createSource({ ...createInput.parse(raw), requestId: requestId(request) });
  }

  @ApiZodBody(updateInput, 'Replace source metadata using optimistic concurrency.', {
    title: 'Thermal qualification report',
    provider: 'Confluence',
    url: 'https://engineering.example.com/reports/thermal-qualification',
    externalId: 'ENG-142',
    version: 'Rev D',
    observedOn: '2026-08-11',
    notes: 'Authoritative qualification evidence.',
    rowVersion: 2,
  })
  @ApiOkResponse({ schema: openApiSchema(sourceResponse) })
  @Patch('sources/:sourceId')
  async update(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('sourceId') sourceId: string,
    @Body() raw: unknown,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'project.update', true)
    ).updateSource(id.parse(sourceId), {
      ...updateInput.parse(raw),
      requestId: requestId(request),
    });
  }

  @ApiZodBody(archiveInput, 'Archive a source while retaining traceability.', {
    reason: 'Superseded by the Rev D report',
  })
  @ApiOkResponse({ schema: openApiSchema(sourceResponse) })
  @Patch('sources/:sourceId/archive')
  async archive(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('sourceId') sourceId: string,
    @Body() raw: unknown,
  ) {
    const body = archiveInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'project.update', true)
    ).setArchived(id.parse(sourceId), true, body.reason, requestId(request));
  }

  @ApiOkResponse({ schema: openApiSchema(sourceResponse) })
  @Post('sources/:sourceId/restore')
  async restore(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('sourceId') sourceId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'project.update', true)
    ).setArchived(id.parse(sourceId), false, '', requestId(request));
  }
}
