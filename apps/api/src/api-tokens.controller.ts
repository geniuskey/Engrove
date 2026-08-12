import {
  apiTokenScopes,
  issueApiToken,
  listApiTokens,
  resolveWorkspaceIdentifier,
  revokeApiToken,
} from '@engrove/database';
import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import { openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const scope = z.enum(apiTokenScopes);
const tokenResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tokenPrefix: z.string(),
  accessLevel: z.enum(['read', 'write']),
  scopes: z.array(scope),
  workspaceId: z.string().uuid().nullable(),
  workspaceName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
const createInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    accessLevel: z.enum(['read', 'write']),
    scopes: z
      .array(scope)
      .min(1)
      .max(apiTokenScopes.length)
      .refine((items) => new Set(items).size === items.length, 'Scopes must be unique.')
      .optional(),
    workspaceId: z.string().trim().min(1).optional(),
    expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]),
  })
  .strict();

@ApiTags('API tokens')
@Controller('api/v1/api-tokens')
export class ApiTokensController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiOkResponse({ schema: openApiSchema(z.object({ items: z.array(tokenResponse) })) })
  @Get()
  async list(@Req() request: Request) {
    const actor = await requireActor(this.runtime, request);
    return { items: await listApiTokens(this.runtime.pool, actor) };
  }

  @ApiBody({ schema: openApiSchema(createInput) })
  @ApiCreatedResponse({ schema: openApiSchema(tokenResponse.extend({ token: z.string() })) })
  @Post()
  async create(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(this.runtime, request, undefined, true);
    const body = createInput.parse(unparsed);
    const workspaceId = body.workspaceId
      ? await resolveWorkspaceIdentifier(this.runtime.pool, body.workspaceId)
      : undefined;
    const token = await issueApiToken(this.runtime.pool, actor, {
      name: body.name,
      accessLevel: body.accessLevel,
      ...(body.scopes ? { scopes: body.scopes } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      expiresInDays: body.expiresInDays,
      requestId: requestId(request),
    });
    return token;
  }

  @ApiOkResponse({ schema: openApiSchema(z.object({ revoked: z.literal(true) })) })
  @Post(':tokenId/revoke')
  async revoke(@Req() request: Request, @Param('tokenId') unparsedTokenId: string) {
    const actor = await requireActor(this.runtime, request, undefined, true);
    await revokeApiToken(
      this.runtime.pool,
      actor,
      z.string().uuid().parse(unparsedTokenId),
      requestId(request),
    );
    return { revoked: true };
  }
}
