import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  acceptInvitation,
  archiveMemberGroup,
  authenticateSession,
  completePasswordReset,
  completeSetup,
  createMemberGroup,
  createProject,
  createSession,
  createWorkspace,
  ensureWorkspaceDataProject,
  findPasswordUser,
  getInstallationOrganizationId,
  isSetupAvailable,
  issueSecurityToken,
  listAuditEvents,
  listLegacyConfigurableDataProjects,
  listMemberGroups,
  listMembers,
  listProjects,
  listWorkspaces,
  recordAuthenticationEvent,
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  replaceMemberGroupMembers,
  revokeAllUserSessions,
  revokeSecurityToken,
  revokeSession,
  setProjectArchived,
  updateMemberRole,
  updateMemberRoles,
  updateMemberGroup,
  updateProject,
  verifyCsrf,
  type ActorSession,
} from '@engrove/database';
import { assertPermission, type Action, type PermissionContext } from '@engrove/permissions';
import { hash, verify } from 'argon2';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Runtime } from './runtime.js';

const SESSION_COOKIE = 'engrove_session';
const CSRF_COOKIE = 'engrove_csrf';
const memberGroupColor = z.enum(['slate', 'sky', 'emerald', 'amber', 'rose', 'violet']);
let runtime: Runtime | undefined;

export function installCommunityRuntime(value: Runtime): void {
  runtime = value;
}

export function appRuntime(): Runtime {
  if (!runtime) throw new HttpException({ code: 'RUNTIME_NOT_INITIALIZED' }, 503);
  return runtime;
}

export function requestId(request: Request): string {
  return String(request.headers['x-request-id'] ?? 'unknown');
}

function clientToken(request: Request): string | undefined {
  return request.cookies?.[SESSION_COOKIE] as string | undefined;
}

export async function requireActor(
  request: Request,
  action?: Action,
  csrf = false,
): Promise<ActorSession> {
  const current = appRuntime();
  const token = clientToken(request);
  const actor = token
    ? await authenticateSession(current.pool, token, current.config.SESSION_IDLE_MINUTES)
    : undefined;
  if (!actor) throw new HttpException({ code: 'AUTHENTICATION_REQUIRED' }, 401);
  if (csrf) {
    const maintenance = await current.pool.query(
      'select 1 from maintenance_state where singleton=true and lease_expires_at>now()',
    );
    if (maintenance.rowCount)
      throw new HttpException({ code: 'MAINTENANCE_MODE', message: 'Mutations are paused.' }, 503);
  }
  if (csrf) {
    const header = request.headers['x-csrf-token'];
    const headerToken = Array.isArray(header) ? header[0] : header;
    const cookieToken = request.cookies?.[CSRF_COOKIE] as string | undefined;
    if (!headerToken || headerToken !== cookieToken || !verifyCsrf(actor, headerToken)) {
      throw new HttpException({ code: 'CSRF_VALIDATION_FAILED' }, 403);
    }
  }
  if (action) {
    const context: PermissionContext = {
      actorId: actor.actorId,
      organizationId: actor.organizationId,
      role: actor.role,
    };
    assertPermission(context, action);
  }
  return actor;
}

async function applyRateLimit(request: Request, bucket: string, limit: number): Promise<void> {
  const current = appRuntime();
  if (current.redis.status === 'wait') await current.redis.connect();
  const identity = createHash('sha256').update(`${request.ip}:${bucket}`).digest('hex');
  const key = `engrove:rate-limit:${bucket}:${identity}`;
  const count = await current.redis.incr(key);
  if (count === 1) await current.redis.expire(key, 60);
  if (count > limit) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
}

function passwordOptions() {
  const config = appRuntime().config;
  return {
    type: 2 as const,
    memoryCost: config.ARGON2_MEMORY_KIB,
    timeCost: config.ARGON2_ITERATIONS,
    parallelism: config.ARGON2_PARALLELISM,
  };
}

export function setSessionCookies(response: Response, token: string, csrfToken: string): void {
  const config = appRuntime().config;
  const common = {
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: config.SESSION_ABSOLUTE_HOURS * 3_600_000,
  };
  response.cookie(SESSION_COOKIE, token, { ...common, httpOnly: true });
  response.cookie(CSRF_COOKIE, csrfToken, { ...common, httpOnly: false });
}

function clearSessionCookies(response: Response): void {
  const secure = appRuntime().config.NODE_ENV === 'production';
  response.clearCookie(SESSION_COOKIE, { secure, sameSite: 'lax', path: '/' });
  response.clearCookie(CSRF_COOKIE, { secure, sameSite: 'lax', path: '/' });
}

const password = z.string().min(12).max(256);
const email = z.string().email().max(320);
const role = z.enum(['owner', 'admin', 'engineer', 'contributor', 'viewer']);

@Controller('api/v1')
export class CommunityController {
  @Get('setup/status')
  async setupStatus() {
    return { available: await isSetupAvailable(appRuntime().pool) };
  }

  @Post('setup')
  async setup(@Req() request: Request, @Body() unparsed: unknown) {
    await applyRateLimit(request, 'setup', 10);
    const body = z
      .object({
        token: z.string().min(32),
        email,
        displayName: z.string().trim().min(1).max(120),
        password,
      })
      .parse(unparsed);
    const result = await completeSetup(appRuntime().pool, {
      ...body,
      passwordHash: await hash(body.password, passwordOptions()),
      requestId: requestId(request),
    });
    return { userId: result.userId, organizationId: result.organizationId };
  }

  @Post('auth/sign-in')
  async signIn(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() unparsed: unknown,
  ) {
    await applyRateLimit(request, 'sign-in', 12);
    const body = z.object({ email, password: z.string().min(1).max(256) }).parse(unparsed);
    const current = appRuntime();
    const user = await findPasswordUser(current.pool, body.email);
    const valid = user ? await verify(user.passwordHash, body.password) : false;
    if (!user || !valid) {
      await recordAuthenticationEvent(current.pool, {
        organizationId: await getInstallationOrganizationId(current.pool),
        action: 'auth.login_failed',
        requestId: requestId(request),
        payload: { reason: 'invalid_credentials' },
      });
      throw new HttpException({ code: 'INVALID_CREDENTIALS' }, 401);
    }
    const session = await createSession(current.pool, {
      userId: user.id,
      organizationId: user.organizationId,
      requestId: requestId(request),
      idleMinutes: current.config.SESSION_IDLE_MINUTES,
      absoluteHours: current.config.SESSION_ABSOLUTE_HOURS,
    });
    setSessionCookies(response, session.token, session.csrfToken);
    await recordAuthenticationEvent(current.pool, {
      organizationId: user.organizationId,
      actorId: user.id,
      targetId: user.id,
      action: 'auth.login_succeeded',
      requestId: requestId(request),
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }

  @Get('auth/me')
  async me(@Req() request: Request) {
    const actor = await requireActor(request);
    return {
      user: {
        id: actor.actorId,
        email: actor.email,
        displayName: actor.displayName,
        role: actor.role,
        organizationId: actor.organizationId,
      },
    };
  }

  @Post('auth/sign-out')
  async signOut(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const actor = await requireActor(request, undefined, true);
    await revokeSession(appRuntime().pool, actor, actor.sessionId, 'sign_out', requestId(request));
    clearSessionCookies(response);
    return { signedOut: true };
  }

  @Post('invitations')
  async invite(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(request, 'member.manage', true);
    const body = z.object({ email, role: role.exclude(['owner']) }).parse(unparsed);
    const issued = await issueSecurityToken(appRuntime().pool, actor, {
      type: 'invitation',
      subjectEmail: body.email,
      role: body.role,
      requestId: requestId(request),
    });
    return {
      tokenId: issued.id,
      invitationUrl: `${appRuntime().config.ENGROVE_PUBLIC_URL.replace(/\/$/, '')}/accept-invitation?token=${encodeURIComponent(issued.token)}`,
      expiresAt: issued.expiresAt,
    };
  }

  @Post('invitations/accept')
  async acceptInvite(@Req() request: Request, @Body() unparsed: unknown) {
    await applyRateLimit(request, 'invitation', 10);
    const body = z
      .object({
        token: z.string().min(32),
        displayName: z.string().trim().min(1).max(120),
        password,
      })
      .parse(unparsed);
    const result = await acceptInvitation(appRuntime().pool, {
      token: body.token,
      displayName: body.displayName,
      passwordHash: await hash(body.password, passwordOptions()),
      requestId: requestId(request),
    });
    return result;
  }

  @Post('auth/password-reset-tokens')
  async createPasswordReset(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(request, 'member.manage', true);
    const body = z.object({ userId: z.string().uuid() }).parse(unparsed);
    const issued = await issueSecurityToken(appRuntime().pool, actor, {
      type: 'password_reset',
      subjectUserId: body.userId,
      requestId: requestId(request),
    });
    return {
      tokenId: issued.id,
      resetUrl: `${appRuntime().config.ENGROVE_PUBLIC_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(issued.token)}`,
      expiresAt: issued.expiresAt,
    };
  }

  @Post('security-tokens/:tokenId/revoke')
  async revokeToken(
    @Req() request: Request,
    @Param('tokenId') tokenId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(request, 'member.manage', true);
    const body = z.object({ reason: z.string().trim().min(1).max(500) }).parse(unparsed);
    await revokeSecurityToken(
      appRuntime().pool,
      actor,
      z.string().uuid().parse(tokenId),
      body.reason,
      requestId(request),
    );
    return { revoked: true };
  }

  @Post('auth/password-reset')
  async resetPassword(@Req() request: Request, @Body() unparsed: unknown) {
    await applyRateLimit(request, 'password-reset', 10);
    const body = z.object({ token: z.string().min(32), password }).parse(unparsed);
    await completePasswordReset(appRuntime().pool, {
      token: body.token,
      passwordHash: await hash(body.password, passwordOptions()),
      requestId: requestId(request),
    });
    return { reset: true };
  }

  @Get('workspaces')
  async workspaces(@Req() request: Request) {
    const actor = await requireActor(request, 'workspace.read');
    return { items: await listWorkspaces(appRuntime().pool, actor) };
  }

  @Post('workspaces')
  async newWorkspace(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(request, 'workspace.manage', true);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        slug: z
          .string()
          .trim()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().max(2000).optional(),
      })
      .parse(unparsed);
    return createWorkspace(appRuntime().pool, actor, {
      name: body.name,
      slug: body.slug,
      description: body.description ?? '',
      requestId: requestId(request),
    });
  }

  @Get('workspaces/:workspaceId/projects')
  async projects(@Req() request: Request, @Param('workspaceId') unparsedWorkspaceId: string) {
    const actor = await requireActor(request, 'project.read');
    return {
      items: await listProjects(
        appRuntime().pool,
        actor,
        await resolveWorkspaceIdentifier(appRuntime().pool, unparsedWorkspaceId),
      ),
    };
  }

  @Post('workspaces/:workspaceId/data-context')
  async workspaceDataContext(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
  ) {
    const actor = await requireActor(request, 'schema.read', true);
    const parsedWorkspaceId = await resolveWorkspaceIdentifier(
      appRuntime().pool,
      unparsedWorkspaceId,
    );
    const project = await ensureWorkspaceDataProject(
      appRuntime().pool,
      actor,
      parsedWorkspaceId,
      requestId(request),
    );
    const legacyProjects = await listLegacyConfigurableDataProjects(
      appRuntime().pool,
      actor,
      parsedWorkspaceId,
    );
    return { projectId: project.id, legacyProjectIds: legacyProjects.map((item) => item.id) };
  }

  @Post('workspaces/:workspaceId/projects')
  async newProject(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(request, 'project.create', true);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        key: z
          .string()
          .trim()
          .regex(/^[A-Za-z][A-Za-z0-9_-]{1,15}$/),
        description: z.string().max(2000).optional(),
      })
      .parse(unparsed);
    return createProject(appRuntime().pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(appRuntime().pool, unparsedWorkspaceId),
      name: body.name,
      key: body.key,
      description: body.description ?? '',
      requestId: requestId(request),
    });
  }

  @Patch('workspaces/:workspaceId/projects/:projectId')
  async editProject(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Param('projectId') unparsedProjectId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(request, 'project.update', true);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().max(2000),
        status: z.enum(['active', 'on_hold', 'completed']),
        rowVersion: z.number().int().positive(),
      })
      .parse(unparsed);
    return updateProject(appRuntime().pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(appRuntime().pool, unparsedWorkspaceId),
      projectId: await resolveProjectIdentifier(appRuntime().pool, unparsedProjectId),
      ...body,
      requestId: requestId(request),
    });
  }

  @Post('workspaces/:workspaceId/projects/:projectId/archive')
  async archiveProject(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Param('projectId') unparsedProjectId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(request, 'project.archive', true);
    const body = z.object({ reason: z.string().trim().min(1).max(500) }).parse(unparsed);
    return setProjectArchived(appRuntime().pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(appRuntime().pool, unparsedWorkspaceId),
      projectId: await resolveProjectIdentifier(appRuntime().pool, unparsedProjectId),
      archived: true,
      reason: body.reason,
      requestId: requestId(request),
    });
  }

  @Post('workspaces/:workspaceId/projects/:projectId/restore')
  async restoreProject(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Param('projectId') unparsedProjectId: string,
  ) {
    const actor = await requireActor(request, 'project.restore', true);
    return setProjectArchived(appRuntime().pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(appRuntime().pool, unparsedWorkspaceId),
      projectId: await resolveProjectIdentifier(appRuntime().pool, unparsedProjectId),
      archived: false,
      requestId: requestId(request),
    });
  }

  @Get('members')
  async members(@Req() request: Request) {
    const actor = await requireActor(request, 'member.manage');
    return { items: await listMembers(appRuntime().pool, actor) };
  }

  @Patch('members/:userId/role')
  async changeRole(
    @Req() request: Request,
    @Param('userId') userId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(request, 'member.manage', true);
    const body = z.object({ role }).parse(unparsed);
    await updateMemberRole(
      appRuntime().pool,
      actor,
      z.string().uuid().parse(userId),
      body.role,
      requestId(request),
    );
    return { updated: true };
  }

  @Patch('members/roles')
  async changeRoles(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(request, 'member.manage', true);
    const body = z
      .object({ memberIds: z.array(z.string().uuid()).min(1).max(500), role })
      .strict()
      .parse(unparsed);
    const updated = await updateMemberRoles(
      appRuntime().pool,
      actor,
      body.memberIds,
      body.role,
      requestId(request),
    );
    return { updated };
  }

  @Get('member-groups')
  async memberGroups(@Req() request: Request) {
    const actor = await requireActor(request, 'member.manage');
    return { items: await listMemberGroups(appRuntime().pool, actor) };
  }

  @Post('member-groups')
  async createMemberGroup(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(request, 'member.manage', true);
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(500).optional(),
        color: memberGroupColor.optional(),
      })
      .strict()
      .parse(unparsed);
    return createMemberGroup(appRuntime().pool, actor, {
      name: body.name,
      description: body.description ?? '',
      color: body.color ?? 'sky',
      requestId: requestId(request),
    });
  }

  @Patch('member-groups/:groupId')
  async updateMemberGroup(
    @Req() request: Request,
    @Param('groupId') unparsedGroupId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(request, 'member.manage', true);
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(500),
        color: memberGroupColor,
      })
      .strict()
      .parse(unparsed);
    await updateMemberGroup(appRuntime().pool, actor, {
      groupId: z.string().uuid().parse(unparsedGroupId),
      ...body,
      requestId: requestId(request),
    });
    return { updated: true };
  }

  @Patch('member-groups/:groupId/members')
  async replaceMemberGroupMembers(
    @Req() request: Request,
    @Param('groupId') unparsedGroupId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(request, 'member.manage', true);
    const body = z
      .object({ memberIds: z.array(z.string().uuid()).max(500) })
      .strict()
      .parse(unparsed);
    await replaceMemberGroupMembers(appRuntime().pool, actor, {
      groupId: z.string().uuid().parse(unparsedGroupId),
      memberIds: body.memberIds,
      requestId: requestId(request),
    });
    return { updated: true };
  }

  @Post('member-groups/:groupId/archive')
  async archiveMemberGroup(@Req() request: Request, @Param('groupId') unparsedGroupId: string) {
    const actor = await requireActor(request, 'member.manage', true);
    await archiveMemberGroup(
      appRuntime().pool,
      actor,
      z.string().uuid().parse(unparsedGroupId),
      requestId(request),
    );
    return { archived: true };
  }

  @Post('members/:userId/revoke-sessions')
  async revokeMemberSessions(
    @Req() request: Request,
    @Param('userId') userId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(request, 'member.manage', true);
    const body = z.object({ reason: z.string().trim().min(1).max(500) }).parse(unparsed);
    await revokeAllUserSessions(
      appRuntime().pool,
      actor,
      z.string().uuid().parse(userId),
      body.reason,
      requestId(request),
    );
    return { revoked: true };
  }

  @Get('audit-events')
  async audit(@Req() request: Request, @Query('limit') unparsedLimit?: string) {
    const actor = await requireActor(request, 'audit.read');
    const limit = unparsedLimit
      ? z.coerce.number().int().min(1).max(200).parse(unparsedLimit)
      : 100;
    return { items: await listAuditEvents(appRuntime().pool, actor, limit) };
  }
}
