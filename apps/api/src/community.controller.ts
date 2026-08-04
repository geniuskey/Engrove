import { createHash } from 'node:crypto';
import { isIP, SocketAddress } from 'node:net';
import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
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
  updateWorkspace,
  verifyCsrf,
  type ActorSession,
} from '@engrove/database';
import { assertPermission, type Action, type PermissionContext } from '@engrove/permissions';
import { hash, verify } from 'argon2';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const SESSION_COOKIE = 'engrove_session';
const CSRF_COOKIE = 'engrove_csrf';
const memberGroupColor = z.enum(['slate', 'sky', 'emerald', 'amber', 'rose', 'violet']);

export function requestId(request: Request): string {
  return String(request.headers['x-request-id'] ?? 'unknown');
}

function clientToken(request: Request): string | undefined {
  return request.cookies?.[SESSION_COOKIE] as string | undefined;
}

export async function requireActor(
  runtime: Runtime,
  request: Request,
  action?: Action,
  csrf = false,
): Promise<ActorSession> {
  const token = clientToken(request);
  const actor = token
    ? await authenticateSession(runtime.pool, token, runtime.config.SESSION_IDLE_MINUTES)
    : undefined;
  if (!actor) throw new HttpException({ code: 'AUTHENTICATION_REQUIRED' }, 401);
  if (csrf) {
    const maintenance = await runtime.pool.query(
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

export interface AuthenticationRateLimitProfile {
  operation: string;
  windowSeconds: number;
  globalLimit: number;
  clientIpLimit: number;
  accountLimit: number;
}

export const authenticationRateLimits = {
  setup: {
    operation: 'setup',
    windowSeconds: 60,
    globalLimit: 100,
    clientIpLimit: 30,
    accountLimit: 10,
  },
  signIn: {
    operation: 'sign-in',
    windowSeconds: 60,
    globalLimit: 1_000,
    clientIpLimit: 100,
    accountLimit: 12,
  },
  passwordReset: {
    operation: 'password-reset',
    windowSeconds: 60,
    globalLimit: 300,
    clientIpLimit: 60,
    accountLimit: 10,
  },
} satisfies Record<string, AuthenticationRateLimitProfile>;

const rateLimitScript = `
local counts = {}
for index, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('EXPIRE', key, ARGV[1]) end
  counts[index] = count
end
return counts
`;

function hashedRateLimitIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function verifiedClientIp(request: Request): string {
  for (const candidate of [request.ip, request.socket.remoteAddress]) {
    if (!candidate) continue;
    const ipv4Mapped = candidate.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    const address = ipv4Mapped ?? candidate;
    const family = isIP(address);
    if (!family) continue;
    return new SocketAddress({
      address,
      port: 0,
      family: family === 4 ? 'ipv4' : 'ipv6',
    }).address;
  }
  return 'unknown';
}

export function authenticationRateLimitKeys(
  request: Request,
  operation: string,
  accountIdentifier: string,
): string[] {
  const prefix = `engrove:rate-limit:${operation}`;
  return [
    `${prefix}:global`,
    `${prefix}:ip:${hashedRateLimitIdentity(verifiedClientIp(request))}`,
    `${prefix}:account:${hashedRateLimitIdentity(accountIdentifier.trim())}`,
  ];
}

export async function applyAuthenticationRateLimit(
  runtime: Runtime,
  request: Request,
  accountIdentifier: string,
  profile: AuthenticationRateLimitProfile,
): Promise<void> {
  if (runtime.redis.status === 'wait') await runtime.redis.connect();
  const counts = z
    .array(z.coerce.number().int().nonnegative())
    .length(3)
    .parse(
      await runtime.redis.eval(
        rateLimitScript,
        3,
        ...authenticationRateLimitKeys(request, profile.operation, accountIdentifier),
        profile.windowSeconds,
      ),
    );
  const limits = [profile.globalLimit, profile.clientIpLimit, profile.accountLimit];
  if (counts.some((count, index) => count > limits[index]!))
    throw new HttpException({ code: 'RATE_LIMITED' }, 429);
}

function passwordOptions(runtime: Runtime) {
  const config = runtime.config;
  return {
    type: 2 as const,
    memoryCost: config.ARGON2_MEMORY_KIB,
    timeCost: config.ARGON2_ITERATIONS,
    parallelism: config.ARGON2_PARALLELISM,
  };
}

export function setSessionCookies(
  runtime: Runtime,
  response: Response,
  token: string,
  csrfToken: string,
): void {
  const config = runtime.config;
  const common = {
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: config.SESSION_ABSOLUTE_HOURS * 3_600_000,
  };
  response.cookie(SESSION_COOKIE, token, { ...common, httpOnly: true });
  response.cookie(CSRF_COOKIE, csrfToken, { ...common, httpOnly: false });
}

function clearSessionCookies(runtime: Runtime, response: Response): void {
  const secure = runtime.config.NODE_ENV === 'production';
  response.clearCookie(SESSION_COOKIE, { secure, sameSite: 'lax', path: '/' });
  response.clearCookie(CSRF_COOKIE, { secure, sameSite: 'lax', path: '/' });
}

const password = z.string().min(12).max(256);
const email = z.string().email().max(320);
const role = z.enum(['owner', 'admin', 'engineer', 'contributor', 'viewer']);

@Controller('api/v1')
export class CommunityController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @Get('setup/status')
  async setupStatus() {
    return { available: await isSetupAvailable(this.runtime.pool) };
  }

  @Post('setup')
  async setup(@Req() request: Request, @Body() unparsed: unknown) {
    const body = z
      .object({
        token: z.string().min(32),
        email,
        displayName: z.string().trim().min(1).max(120),
        password,
      })
      .parse(unparsed);
    await applyAuthenticationRateLimit(
      this.runtime,
      request,
      body.email.toLowerCase(),
      authenticationRateLimits.setup,
    );
    const result = await completeSetup(this.runtime.pool, {
      ...body,
      passwordHash: await hash(body.password, passwordOptions(this.runtime)),
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
    const body = z.object({ email, password: z.string().min(1).max(256) }).parse(unparsed);
    await applyAuthenticationRateLimit(
      this.runtime,
      request,
      body.email.toLowerCase(),
      authenticationRateLimits.signIn,
    );
    const current = this.runtime;
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
    setSessionCookies(this.runtime, response, session.token, session.csrfToken);
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
    const actor = await requireActor(this.runtime, request);
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
    const actor = await requireActor(this.runtime, request, undefined, true);
    await revokeSession(this.runtime.pool, actor, actor.sessionId, 'sign_out', requestId(request));
    clearSessionCookies(this.runtime, response);
    return { signedOut: true };
  }

  @Post('invitations')
  async invite(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = z.object({ email, role: role.exclude(['owner']) }).parse(unparsed);
    const issued = await issueSecurityToken(this.runtime.pool, actor, {
      type: 'invitation',
      subjectEmail: body.email,
      role: body.role,
      requestId: requestId(request),
    });
    return {
      tokenId: issued.id,
      invitationUrl: `${this.runtime.config.ENGROVE_PUBLIC_URL.replace(/\/$/, '')}/accept-invitation?token=${encodeURIComponent(issued.token)}`,
      expiresAt: issued.expiresAt,
    };
  }

  @Post('invitations/accept')
  async acceptInvite(@Req() request: Request, @Body() unparsed: unknown) {
    const body = z
      .object({
        token: z.string().min(32),
        displayName: z.string().trim().min(1).max(120),
        password,
      })
      .parse(unparsed);
    await applyAuthenticationRateLimit(this.runtime, request, body.token, {
      ...authenticationRateLimits.passwordReset,
      operation: 'invitation',
    });
    const result = await acceptInvitation(this.runtime.pool, {
      token: body.token,
      displayName: body.displayName,
      passwordHash: await hash(body.password, passwordOptions(this.runtime)),
      requestId: requestId(request),
    });
    return result;
  }

  @Post('auth/password-reset-tokens')
  async createPasswordReset(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = z.object({ userId: z.string().uuid() }).parse(unparsed);
    const issued = await issueSecurityToken(this.runtime.pool, actor, {
      type: 'password_reset',
      subjectUserId: body.userId,
      requestId: requestId(request),
    });
    return {
      tokenId: issued.id,
      resetUrl: `${this.runtime.config.ENGROVE_PUBLIC_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(issued.token)}`,
      expiresAt: issued.expiresAt,
    };
  }

  @Post('security-tokens/:tokenId/revoke')
  async revokeToken(
    @Req() request: Request,
    @Param('tokenId') tokenId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = z.object({ reason: z.string().trim().min(1).max(500) }).parse(unparsed);
    await revokeSecurityToken(
      this.runtime.pool,
      actor,
      z.string().uuid().parse(tokenId),
      body.reason,
      requestId(request),
    );
    return { revoked: true };
  }

  @Post('auth/password-reset')
  async resetPassword(@Req() request: Request, @Body() unparsed: unknown) {
    const body = z.object({ token: z.string().min(32), password }).parse(unparsed);
    await applyAuthenticationRateLimit(
      this.runtime,
      request,
      body.token,
      authenticationRateLimits.passwordReset,
    );
    await completePasswordReset(this.runtime.pool, {
      token: body.token,
      passwordHash: await hash(body.password, passwordOptions(this.runtime)),
      requestId: requestId(request),
    });
    return { reset: true };
  }

  @Get('workspaces')
  async workspaces(@Req() request: Request) {
    const actor = await requireActor(this.runtime, request, 'workspace.read');
    return { items: await listWorkspaces(this.runtime.pool, actor) };
  }

  @Post('workspaces')
  async newWorkspace(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(this.runtime, request, 'workspace.manage', true);
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
    return createWorkspace(this.runtime.pool, actor, {
      name: body.name,
      slug: body.slug,
      description: body.description ?? '',
      requestId: requestId(request),
    });
  }

  @Patch('workspaces/:workspaceId')
  async editWorkspace(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'workspace.manage', true);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        key: z
          .string()
          .trim()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().max(2000),
      })
      .parse(unparsed);
    return updateWorkspace(this.runtime.pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
      name: body.name,
      slug: body.key,
      description: body.description,
      requestId: requestId(request),
    });
  }

  @Get('workspaces/:workspaceId/projects')
  async projects(@Req() request: Request, @Param('workspaceId') unparsedWorkspaceId: string) {
    const actor = await requireActor(this.runtime, request, 'project.read');
    return {
      items: await listProjects(
        this.runtime.pool,
        actor,
        await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
      ),
    };
  }

  @Post('workspaces/:workspaceId/data-context')
  async workspaceDataContext(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
  ) {
    const actor = await requireActor(this.runtime, request, 'schema.read', true);
    const parsedWorkspaceId = await resolveWorkspaceIdentifier(
      this.runtime.pool,
      unparsedWorkspaceId,
    );
    const project = await ensureWorkspaceDataProject(
      this.runtime.pool,
      actor,
      parsedWorkspaceId,
      requestId(request),
    );
    const legacyProjects = await listLegacyConfigurableDataProjects(
      this.runtime.pool,
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
    const actor = await requireActor(this.runtime, request, 'project.create', true);
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
    return createProject(this.runtime.pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
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
    const actor = await requireActor(this.runtime, request, 'project.update', true);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().max(2000),
        status: z.enum(['active', 'on_hold', 'completed']),
        rowVersion: z.number().int().positive(),
      })
      .parse(unparsed);
    return updateProject(this.runtime.pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
      projectId: await resolveProjectIdentifier(this.runtime.pool, unparsedProjectId),
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
    const actor = await requireActor(this.runtime, request, 'project.archive', true);
    const body = z.object({ reason: z.string().trim().min(1).max(500) }).parse(unparsed);
    return setProjectArchived(this.runtime.pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
      projectId: await resolveProjectIdentifier(this.runtime.pool, unparsedProjectId),
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
    const actor = await requireActor(this.runtime, request, 'project.restore', true);
    return setProjectArchived(this.runtime.pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
      projectId: await resolveProjectIdentifier(this.runtime.pool, unparsedProjectId),
      archived: false,
      requestId: requestId(request),
    });
  }

  @Get('members')
  async members(@Req() request: Request) {
    const actor = await requireActor(this.runtime, request, 'member.manage');
    return { items: await listMembers(this.runtime.pool, actor) };
  }

  @Patch('members/:userId/role')
  async changeRole(
    @Req() request: Request,
    @Param('userId') userId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = z.object({ role }).parse(unparsed);
    await updateMemberRole(
      this.runtime.pool,
      actor,
      z.string().uuid().parse(userId),
      body.role,
      requestId(request),
    );
    return { updated: true };
  }

  @Patch('members/roles')
  async changeRoles(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = z
      .object({ memberIds: z.array(z.string().uuid()).min(1).max(500), role })
      .strict()
      .parse(unparsed);
    const updated = await updateMemberRoles(
      this.runtime.pool,
      actor,
      body.memberIds,
      body.role,
      requestId(request),
    );
    return { updated };
  }

  @Get('member-groups')
  async memberGroups(@Req() request: Request) {
    const actor = await requireActor(this.runtime, request, 'member.manage');
    return { items: await listMemberGroups(this.runtime.pool, actor) };
  }

  @Post('member-groups')
  async createMemberGroup(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(500).optional(),
        color: memberGroupColor.optional(),
      })
      .strict()
      .parse(unparsed);
    return createMemberGroup(this.runtime.pool, actor, {
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
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(500),
        color: memberGroupColor,
      })
      .strict()
      .parse(unparsed);
    await updateMemberGroup(this.runtime.pool, actor, {
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
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = z
      .object({ memberIds: z.array(z.string().uuid()).max(500) })
      .strict()
      .parse(unparsed);
    await replaceMemberGroupMembers(this.runtime.pool, actor, {
      groupId: z.string().uuid().parse(unparsedGroupId),
      memberIds: body.memberIds,
      requestId: requestId(request),
    });
    return { updated: true };
  }

  @Post('member-groups/:groupId/archive')
  async archiveMemberGroup(@Req() request: Request, @Param('groupId') unparsedGroupId: string) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    await archiveMemberGroup(
      this.runtime.pool,
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
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = z.object({ reason: z.string().trim().min(1).max(500) }).parse(unparsed);
    await revokeAllUserSessions(
      this.runtime.pool,
      actor,
      z.string().uuid().parse(userId),
      body.reason,
      requestId(request),
    );
    return { revoked: true };
  }

  @Get('audit-events')
  async audit(@Req() request: Request, @Query('limit') unparsedLimit?: string) {
    const actor = await requireActor(this.runtime, request, 'audit.read');
    const limit = unparsedLimit
      ? z.coerce.number().int().min(1).max(200).parse(unparsedLimit)
      : 100;
    return { items: await listAuditEvents(this.runtime.pool, actor, limit) };
  }
}
