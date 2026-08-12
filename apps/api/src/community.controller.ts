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
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  acceptInvitation,
  assertProjectVisible,
  assertWorkspaceVisible,
  authenticateApiToken,
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
  getProjectAccess,
  getWorkspaceAccess,
  getWorkspace,
  getProject,
  getInstallationOrganizationId,
  isSetupAvailable,
  issueSecurityToken,
  listAuditEventPage,
  listLegacyConfigurableDataProjects,
  listMemberGroupPage,
  listOwnMemberGroups,
  listProjectPage,
  listProjectOptions,
  listProjectReferences,
  listMemberPage,
  listWorkspacePage,
  recordAuthenticationEvent,
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  replaceMemberGroupMembers,
  revokeAllUserSessions,
  revokeSecurityToken,
  revokeSession,
  setProjectAccess,
  setProjectArchived,
  setWorkspaceAccess,
  updateMemberRole,
  updateMemberRoles,
  updateMemberGroup,
  updateProject,
  updateWorkspace,
  verifyCsrf,
  type ActorSession,
} from '@engrove/database';
import { assertPermission, can, type Action, type PermissionContext } from '@engrove/permissions';
import { hash, verify } from 'argon2';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const SESSION_COOKIE = 'engrove_session';
const CSRF_COOKIE = 'engrove_csrf';
const memberGroupColor = z.enum(['slate', 'sky', 'emerald', 'amber', 'rose', 'violet']);
const projectOptionsQuery = z
  .object({
    query: z.string().max(120).default(''),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
const projectListQuery = z
  .object({
    query: z.string().trim().max(200).default(''),
    archiveState: z.enum(['active', 'archived', 'all']).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const workspaceListQuery = z
  .object({
    query: z.string().max(120).default(''),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const auditListQuery = z.object({
  query: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const directoryListQuery = z
  .object({
    query: z.string().trim().max(200).default(''),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const directoryPageInfoResponse = z.object({
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean(),
});
const auditEventResponse = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  projectId: z.string().nullable(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  requestId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
const auditPageResponse = z.object({
  items: z.array(auditEventResponse).max(200),
  pageInfo: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    hasNext: z.boolean(),
  }),
});

export function requestId(request: Request): string {
  return String(request.headers['x-request-id'] ?? 'unknown');
}

function clientToken(request: Request): string | undefined {
  return request.cookies?.[SESSION_COOKIE] as string | undefined;
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  const match = value?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

const apiTokenForbiddenActions = new Set<Action>([
  'workspace.manage',
  'workspace.access.manage',
  'project.access.manage',
  'member.manage',
  'audit.read',
  'pilot.manage',
  'storage.cleanup',
  'webhook.manage',
  'view.share',
  'task.automation.manage',
  'notification.read',
  'task.personalize',
  'task.watch',
]);

const apiTokenActionScopes: Partial<Record<Action, string>> = {
  'workspace.read': 'workspace',
  'project.create': 'project',
  'project.read': 'project',
  'project.update': 'project',
  'project.archive': 'project',
  'project.restore': 'project',
  'schema.read': 'data',
  'schema.manage': 'data',
  'table.permission.manage': 'data',
  'view.manage': 'data',
  'record.create': 'data',
  'record.comment': 'data',
  'record.read': 'data',
  'record.update': 'data',
  'record.archive': 'data',
  'record.restore': 'data',
  'file.upload': 'data',
  'file.read': 'data',
  'file.archive': 'data',
  'file.restore': 'data',
  'dataset.upload': 'data',
  'dataset.read': 'data',
  'dataset.archive': 'data',
  'dataset.restore': 'data',
  'job.read': 'data',
  'job.retry': 'data',
  'measurement.create': 'data',
  'measurement.correct': 'data',
  'measurement.read': 'data',
  'specification.read': 'data',
  'specification.manage': 'data',
  'dashboard.manage': 'data',
  'export.execute': 'data',
  'task.create': 'tasks',
  'task.comment': 'tasks',
  'task.worklog': 'tasks',
  'task.read': 'tasks',
  'task.workflow.manage': 'tasks',
  'task.update': 'tasks',
  'task.archive': 'tasks',
  'task.restore': 'tasks',
  'milestone.read': 'schedule',
  'milestone.manage': 'schedule',
  'review.read': 'reviews',
  'review.create': 'reviews',
  'review.resolve': 'reviews',
};

export function apiTokenAllowsAction(
  actor: ActorSession,
  action: Action,
  mutation = false,
): boolean {
  if (actor.authenticationType !== 'api_token') return true;
  if (apiTokenForbiddenActions.has(action)) return false;
  const requiredScope = apiTokenActionScopes[action];
  if (actor.apiTokenScopes && (!requiredScope || !actor.apiTokenScopes.includes(requiredScope)))
    return false;
  return (
    actor.apiTokenAccessLevel === 'write' ||
    (!mutation && (action.endsWith('.read') || action === 'export.execute'))
  );
}

export function apiTokenAllowsWorkspace(actor: ActorSession, workspaceId: string): boolean {
  return !actor.apiTokenWorkspaceId || actor.apiTokenWorkspaceId === workspaceId;
}

export function actorAllowsAction(actor: ActorSession, action: Action, mutation = false): boolean {
  return (
    can(
      {
        actorId: actor.actorId,
        organizationId: actor.organizationId,
        role: actor.role,
      },
      action,
    ) && apiTokenAllowsAction(actor, action, mutation)
  );
}

export async function requireActor(
  runtime: Runtime,
  request: Request,
  action?: Action | readonly [Action, ...Action[]],
  csrf = false,
): Promise<ActorSession> {
  const apiToken = bearerToken(request);
  const sessionToken = clientToken(request);
  const actor = apiToken
    ? await authenticateApiToken(runtime.pool, apiToken)
    : sessionToken
      ? await authenticateSession(runtime.pool, sessionToken, runtime.config.SESSION_IDLE_MINUTES)
      : undefined;
  if (!actor) throw new HttpException({ code: 'AUTHENTICATION_REQUIRED' }, 401);
  if (actor.authenticationType === 'api_token' && !action) {
    const path = request.path.replace(/\/$/, '');
    if (request.method !== 'GET' || path !== '/api/v1/auth/me') {
      throw new HttpException({ code: 'API_TOKEN_OPERATION_FORBIDDEN' }, 403);
    }
  }
  if (actor.apiTokenWorkspaceId) {
    const workspaceIdentifier = request.params?.workspaceId;
    if (workspaceIdentifier) {
      const resolvedWorkspaceId = await resolveWorkspaceIdentifier(
        runtime.pool,
        Array.isArray(workspaceIdentifier) ? workspaceIdentifier[0]! : workspaceIdentifier,
      );
      if (!apiTokenAllowsWorkspace(actor, resolvedWorkspaceId)) {
        throw new HttpException({ code: 'WORKSPACE_NOT_FOUND' }, 404);
      }
    }
  }
  const workspaceIdentifier = request.params?.workspaceId;
  const projectIdentifier = request.params?.projectId;
  if (workspaceIdentifier) {
    const workspaceId = await resolveWorkspaceIdentifier(
      runtime.pool,
      Array.isArray(workspaceIdentifier) ? workspaceIdentifier[0]! : workspaceIdentifier,
    );
    if (projectIdentifier) {
      const projectId = await resolveProjectIdentifier(
        runtime.pool,
        Array.isArray(projectIdentifier) ? projectIdentifier[0]! : projectIdentifier,
      );
      await assertProjectVisible(runtime.pool, actor, workspaceId, projectId);
    } else {
      await assertWorkspaceVisible(runtime.pool, actor, workspaceId);
    }
  }
  if (csrf) {
    const maintenance = await runtime.pool.query(
      'select 1 from maintenance_state where singleton=true and lease_expires_at>now()',
    );
    if (maintenance.rowCount)
      throw new HttpException({ code: 'MAINTENANCE_MODE', message: 'Mutations are paused.' }, 503);
  }
  if (csrf && actor.authenticationType !== 'api_token') {
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
    const requestedActions = typeof action === 'string' ? [action] : action;
    const roleAllowedActions = requestedActions.filter((candidate) => can(context, candidate));
    if (roleAllowedActions.length === 0) assertPermission(context, requestedActions[0]);
    if (!roleAllowedActions.some((candidate) => apiTokenAllowsAction(actor, candidate, csrf))) {
      throw new HttpException({ code: 'API_TOKEN_SCOPE_DENIED' }, 403);
    }
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
const role = z.enum(['owner', 'admin', 'engineer', 'contributor', 'reviewer', 'viewer']);
const setupInput = z
  .object({
    token: z.string().min(32),
    email,
    displayName: z.string().trim().min(1).max(120),
    password,
  })
  .strict();
const signInInput = z.object({ email, password: z.string().min(1).max(256) }).strict();
const invitationInput = z.object({ email, role: role.exclude(['owner']) }).strict();
const invitationAcceptanceInput = z
  .object({
    token: z.string().min(32),
    displayName: z.string().trim().min(1).max(120),
    password,
  })
  .strict();
const passwordResetTokenInput = z.object({ userId: z.uuid() }).strict();
const reasonInput = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
const passwordResetInput = z.object({ token: z.string().min(32), password }).strict();
const workspaceCreateInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().max(2000).optional(),
    visibility: z.enum(['organization', 'restricted']).default('organization'),
  })
  .strict();
const workspaceUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    key: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().max(2000),
  })
  .strict();
const projectCreateInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    key: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_-]{1,15}$/),
    description: z.string().max(2000).optional(),
    visibility: z.enum(['workspace', 'restricted']).default('workspace'),
  })
  .strict();
const projectUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000),
    status: z.enum(['active', 'on_hold', 'completed']),
    rowVersion: z.number().int().positive(),
  })
  .strict();
const accessSubjectsInput = {
  userIds: z.array(z.uuid()).max(100),
  groupIds: z.array(z.uuid()).max(100),
  accessVersion: z.number().int().positive(),
};
const workspaceAccessInput = z
  .object({ visibility: z.enum(['organization', 'restricted']), ...accessSubjectsInput })
  .strict();
const projectAccessInput = z
  .object({ visibility: z.enum(['workspace', 'restricted']), ...accessSubjectsInput })
  .strict();
const accessMemberResponse = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email,
});
const accessGroupResponse = z.object({
  id: z.uuid(),
  name: z.string(),
  color: memberGroupColor,
});
const workspaceAccessResponse = z.object({
  visibility: z.enum(['organization', 'restricted']),
  accessVersion: z.number().int().positive(),
  members: z.array(accessMemberResponse).max(100),
  groups: z.array(accessGroupResponse).max(100),
});
const projectAccessResponse = workspaceAccessResponse.extend({
  visibility: z.enum(['workspace', 'restricted']),
});
const memberRoleInput = z.object({ role }).strict();
const memberRolesInput = z.object({ memberIds: z.array(z.uuid()).min(1).max(500), role }).strict();
const memberGroupCreateInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    color: memberGroupColor.optional(),
  })
  .strict();
const memberGroupUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500),
    color: memberGroupColor,
  })
  .strict();
const memberGroupMembersInput = z.object({ memberIds: z.array(z.uuid()).max(500) }).strict();
const projectResponse = z.object({
  id: z.uuid(),
  publicId: z.string(),
  workspaceId: z.uuid(),
  name: z.string(),
  key: z.string(),
  description: z.string(),
  status: z.enum(['active', 'on_hold', 'completed']),
  rowVersion: z.number().int().positive(),
  archivedAt: z.string().nullable(),
});
const projectReferenceResponse = projectResponse.pick({
  id: true,
  publicId: true,
  name: true,
  key: true,
  archivedAt: true,
});
const projectReferencesInput = z.object({ ids: z.array(z.uuid()).max(500) }).strict();
const workspaceResponse = z.object({
  id: z.uuid(),
  publicId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  archivedAt: z.string().nullable(),
});
const memberResponse = z.object({
  userId: z.uuid(),
  email,
  displayName: z.string(),
  role,
});
const memberPageResponse = z.object({
  items: z.array(memberResponse).max(100),
  pageInfo: directoryPageInfoResponse,
  overallTotal: z.number().int().nonnegative(),
});
const memberGroupResponse = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  color: memberGroupColor,
  memberIds: z.array(z.uuid()).max(500),
  updatedAt: z.iso.datetime(),
});
const memberGroupPageResponse = z.object({
  items: z.array(memberGroupResponse).max(100),
  pageInfo: directoryPageInfoResponse,
  overallTotal: z.number().int().nonnegative(),
});
const installationIdentityResponse = z.object({
  userId: z.uuid(),
  organizationId: z.uuid(),
});
const authenticatedUserResponse = z.object({
  id: z.uuid(),
  email,
  displayName: z.string(),
  role,
  organizationId: z.uuid(),
});
const authenticatedUserEnvelope = z.object({ user: authenticatedUserResponse });
const issuedInvitationResponse = z.object({
  tokenId: z.uuid(),
  invitationUrl: z.url(),
  expiresAt: z.iso.datetime(),
});
const issuedPasswordResetResponse = z.object({
  tokenId: z.uuid(),
  resetUrl: z.url(),
  expiresAt: z.iso.datetime(),
});
const ownMemberGroupsResponse = z.object({
  items: z.array(memberGroupResponse.omit({ memberIds: true })).max(500),
});
const workspaceDataContextResponse = z.object({
  projectId: z.uuid(),
  legacyProjectIds: z.array(z.uuid()),
});
const updatedResponse = z.object({ updated: z.literal(true) });
const bulkUpdatedResponse = z.object({ updated: z.number().int().nonnegative() });
const revokedResponse = z.object({ revoked: z.literal(true) });

@ApiTags('Community')
@Controller('api/v1')
export class CommunityController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiOkResponse({ schema: openApiSchema(z.object({ available: z.boolean() })) })
  @Get('setup/status')
  async setupStatus() {
    return { available: await isSetupAvailable(this.runtime.pool) };
  }

  @ApiCreatedResponse({ schema: openApiSchema(installationIdentityResponse) })
  @ApiZodBody(setupInput, 'Complete the one-time installation setup.', {
    token: 'replace-with-one-time-setup-token',
    email: 'owner@example.com',
    displayName: 'Owner',
    password: 'replace-with-a-strong-password',
  })
  @Post('setup')
  async setup(@Req() request: Request, @Body() unparsed: unknown) {
    const body = setupInput.parse(unparsed);
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

  @ApiCreatedResponse({ schema: openApiSchema(authenticatedUserEnvelope) })
  @ApiZodBody(signInInput, 'Create a browser session.', {
    email: 'engineer@example.com',
    password: 'replace-with-your-password',
  })
  @Post('auth/sign-in')
  async signIn(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() unparsed: unknown,
  ) {
    const body = signInInput.parse(unparsed);
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

  @ApiOkResponse({ schema: openApiSchema(authenticatedUserEnvelope) })
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

  @ApiOkResponse({ schema: openApiSchema(ownMemberGroupsResponse) })
  @Get('me/member-groups')
  async ownMemberGroups(@Req() request: Request) {
    const actor = await requireActor(this.runtime, request);
    return { items: await listOwnMemberGroups(this.runtime.pool, actor) };
  }

  @ApiCreatedResponse({ schema: openApiSchema(z.object({ signedOut: z.literal(true) })) })
  @Post('auth/sign-out')
  async signOut(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const actor = await requireActor(this.runtime, request, undefined, true);
    await revokeSession(this.runtime.pool, actor, actor.sessionId, 'sign_out', requestId(request));
    clearSessionCookies(this.runtime, response);
    return { signedOut: true };
  }

  @ApiCreatedResponse({ schema: openApiSchema(issuedInvitationResponse) })
  @ApiZodBody(invitationInput, 'Issue a single-use member invitation.', {
    email: 'reviewer@example.com',
    role: 'reviewer',
  })
  @Post('invitations')
  async invite(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = invitationInput.parse(unparsed);
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

  @ApiCreatedResponse({ schema: openApiSchema(installationIdentityResponse) })
  @ApiZodBody(invitationAcceptanceInput, 'Accept a single-use invitation.', {
    token: 'replace-with-invitation-token',
    displayName: 'Mina Kim',
    password: 'replace-with-a-strong-password',
  })
  @Post('invitations/accept')
  async acceptInvite(@Req() request: Request, @Body() unparsed: unknown) {
    const body = invitationAcceptanceInput.parse(unparsed);
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

  @ApiCreatedResponse({ schema: openApiSchema(issuedPasswordResetResponse) })
  @ApiZodBody(passwordResetTokenInput, 'Issue a single-use reset link for one member.', {
    userId: '019fbcf9-e020-71da-935a-6a6a728b3790',
  })
  @Post('auth/password-reset-tokens')
  async createPasswordReset(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = passwordResetTokenInput.parse(unparsed);
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

  @ApiCreatedResponse({ schema: openApiSchema(revokedResponse) })
  @ApiZodBody(reasonInput, 'Record why the active security token is revoked.', {
    reason: 'Invitation recipient changed',
  })
  @Post('security-tokens/:tokenId/revoke')
  async revokeToken(
    @Req() request: Request,
    @Param('tokenId') tokenId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = reasonInput.parse(unparsed);
    await revokeSecurityToken(
      this.runtime.pool,
      actor,
      z.string().uuid().parse(tokenId),
      body.reason,
      requestId(request),
    );
    return { revoked: true };
  }

  @ApiCreatedResponse({ schema: openApiSchema(z.object({ reset: z.literal(true) })) })
  @ApiZodBody(passwordResetInput, 'Consume a single-use reset token.', {
    token: 'replace-with-password-reset-token',
    password: 'replace-with-a-strong-password',
  })
  @Post('auth/password-reset')
  async resetPassword(@Req() request: Request, @Body() unparsed: unknown) {
    const body = passwordResetInput.parse(unparsed);
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

  @ApiOkResponse({
    description: 'A bounded, searchable workspace portfolio page.',
    schema: openApiSchema(
      z.object({
        items: z.array(workspaceResponse).max(100),
        pageInfo: z.object({
          limit: z.number().int().min(1).max(100),
          offset: z.number().int().nonnegative(),
          total: z.number().int().nonnegative(),
          overallTotal: z.number().int().nonnegative(),
          hasNext: z.boolean(),
        }),
      }),
    ),
  })
  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @Get('workspaces')
  async workspaces(@Req() request: Request, @Query() raw: unknown) {
    const actor = await requireActor(this.runtime, request, 'workspace.read');
    const input = workspaceListQuery.parse(raw);
    return listWorkspacePage(this.runtime.pool, actor, input.query, input.limit, input.offset);
  }

  @ApiCreatedResponse({ schema: openApiSchema(workspaceResponse) })
  @ApiZodBody(workspaceCreateInput, 'Create an engineering workspace.', {
    name: 'Motor validation',
    slug: 'motor-validation',
    description: 'Shared validation data and project work.',
  })
  @Post('workspaces')
  async newWorkspace(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(this.runtime, request, 'workspace.manage', true);
    const body = workspaceCreateInput.parse(unparsed);
    return createWorkspace(this.runtime.pool, actor, {
      name: body.name,
      slug: body.slug,
      description: body.description ?? '',
      visibility: body.visibility,
      requestId: requestId(request),
    });
  }

  @ApiOkResponse({
    description: 'The requested workspace when it is visible to the current actor.',
    schema: openApiSchema(workspaceResponse),
  })
  @Get('workspaces/:workspaceId')
  async workspace(@Req() request: Request, @Param('workspaceId') workspaceIdentifier: string) {
    const actor = await requireActor(this.runtime, request, 'workspace.read');
    return getWorkspace(this.runtime.pool, actor, workspaceIdentifier);
  }

  @ApiOkResponse({ schema: openApiSchema(workspaceResponse) })
  @ApiZodBody(workspaceUpdateInput, 'Replace the editable workspace metadata.', {
    name: 'Motor validation',
    key: 'motor-validation',
    description: 'Shared validation data and project work.',
  })
  @Patch('workspaces/:workspaceId')
  async editWorkspace(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'workspace.manage', true);
    const body = workspaceUpdateInput.parse(unparsed);
    return updateWorkspace(this.runtime.pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
      name: body.name,
      slug: body.key,
      description: body.description,
      requestId: requestId(request),
    });
  }

  @ApiOkResponse({ schema: openApiSchema(workspaceAccessResponse) })
  @Get('workspaces/:workspaceId/access')
  async workspaceAccess(
    @Req() request: Request,
    @Param('workspaceId') workspaceIdentifier: string,
  ) {
    const actor = await requireActor(this.runtime, request, 'workspace.access.manage');
    return getWorkspaceAccess(
      this.runtime.pool,
      actor,
      await resolveWorkspaceIdentifier(this.runtime.pool, workspaceIdentifier),
    );
  }

  @ApiZodBody(
    workspaceAccessInput,
    'Replace workspace visibility and the members or groups allowed into a restricted workspace.',
  )
  @ApiOkResponse({ schema: openApiSchema(workspaceAccessResponse) })
  @Patch('workspaces/:workspaceId/access')
  async updateWorkspaceAccess(
    @Req() request: Request,
    @Param('workspaceId') workspaceIdentifier: string,
    @Body() raw: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'workspace.access.manage', true);
    return setWorkspaceAccess(this.runtime.pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(this.runtime.pool, workspaceIdentifier),
      ...workspaceAccessInput.parse(raw),
      requestId: requestId(request),
    });
  }

  @ApiOkResponse({
    description: 'A bounded, searchable project catalog with exact filtered and overall totals.',
    schema: openApiSchema(
      z.object({
        items: z.array(projectResponse).max(100),
        pageInfo: directoryPageInfoResponse,
        overallTotal: z.number().int().nonnegative(),
      }),
    ),
  })
  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 200 })
  @ApiQuery({
    name: 'archiveState',
    required: false,
    enum: ['active', 'archived', 'all'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0, maximum: 1_000_000 })
  @Get('workspaces/:workspaceId/projects')
  async projects(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Query() raw: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'project.read');
    const input = projectListQuery.parse(raw);
    return listProjectPage(
      this.runtime.pool,
      actor,
      await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
      input,
    );
  }

  @ApiOkResponse({
    description: 'A bounded, searchable set of active projects for navigation controls.',
    schema: openApiSchema(
      z.object({
        items: z.array(projectResponse).max(50),
        pageInfo: z.object({
          limit: z.number().int().min(1).max(50),
          total: z.number().int().nonnegative(),
          hasMore: z.boolean(),
        }),
      }),
    ),
  })
  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 50 })
  @Get('workspaces/:workspaceId/project-options')
  async projectOptions(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Query() raw: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'project.read');
    const input = projectOptionsQuery.parse(raw);
    return listProjectOptions(
      this.runtime.pool,
      actor,
      await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
      input.query,
      input.limit,
    );
  }

  @ApiBody({ schema: openApiSchema(projectReferencesInput) })
  @ApiOkResponse({
    description: 'Project labels for IDs referenced by the current bounded record page.',
    schema: openApiSchema(
      z.object({
        items: z.array(projectReferenceResponse).max(500),
      }),
    ),
  })
  @Post('workspaces/:workspaceId/project-references/query')
  async projectReferences(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'project.read');
    const body = projectReferencesInput.parse(unparsed);
    return {
      items: await listProjectReferences(
        this.runtime.pool,
        actor,
        await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
        body.ids,
      ),
    };
  }

  @ApiCreatedResponse({ schema: openApiSchema(workspaceDataContextResponse) })
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

  @ApiCreatedResponse({ schema: openApiSchema(projectResponse) })
  @ApiZodBody(projectCreateInput, 'Create a project in the selected workspace.', {
    name: 'Thermal cycling validation',
    key: 'THERMAL',
    description: 'Qualification evidence, key dates, and follow-up work.',
  })
  @Post('workspaces/:workspaceId/projects')
  async newProject(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'project.create', true);
    const body = projectCreateInput.parse(unparsed);
    return createProject(this.runtime.pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
      name: body.name,
      key: body.key,
      description: body.description ?? '',
      visibility: body.visibility,
      requestId: requestId(request),
    });
  }

  @Get('workspaces/:workspaceId/projects/:projectId')
  @ApiOkResponse({
    description: 'One project resolved by stable public ID or internal UUID within its workspace.',
    schema: openApiSchema(projectResponse),
  })
  async project(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Param('projectId') projectIdentifier: string,
  ) {
    const actor = await requireActor(this.runtime, request, 'project.read');
    return getProject(
      this.runtime.pool,
      actor,
      await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
      projectIdentifier,
    );
  }

  @ApiOkResponse({ schema: openApiSchema(projectAccessResponse) })
  @Get('workspaces/:workspaceId/projects/:projectId/access')
  async projectAccess(
    @Req() request: Request,
    @Param('workspaceId') workspaceIdentifier: string,
    @Param('projectId') projectIdentifier: string,
  ) {
    const actor = await requireActor(this.runtime, request, 'project.access.manage');
    return getProjectAccess(
      this.runtime.pool,
      actor,
      await resolveWorkspaceIdentifier(this.runtime.pool, workspaceIdentifier),
      await resolveProjectIdentifier(this.runtime.pool, projectIdentifier),
    );
  }

  @ApiZodBody(
    projectAccessInput,
    'Replace project visibility and the members or groups allowed into a restricted project.',
  )
  @ApiOkResponse({ schema: openApiSchema(projectAccessResponse) })
  @Patch('workspaces/:workspaceId/projects/:projectId/access')
  async updateProjectAccess(
    @Req() request: Request,
    @Param('workspaceId') workspaceIdentifier: string,
    @Param('projectId') projectIdentifier: string,
    @Body() raw: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'project.access.manage', true);
    return setProjectAccess(this.runtime.pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(this.runtime.pool, workspaceIdentifier),
      projectId: await resolveProjectIdentifier(this.runtime.pool, projectIdentifier),
      ...projectAccessInput.parse(raw),
      requestId: requestId(request),
    });
  }

  @ApiOkResponse({ schema: openApiSchema(projectResponse) })
  @ApiZodBody(
    projectUpdateInput,
    'Replace editable project metadata using optimistic concurrency.',
    {
      name: 'Thermal cycling validation',
      description: 'Qualification evidence, key dates, and follow-up work.',
      status: 'active',
      rowVersion: 3,
    },
  )
  @Patch('workspaces/:workspaceId/projects/:projectId')
  async editProject(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Param('projectId') unparsedProjectId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'project.update', true);
    const body = projectUpdateInput.parse(unparsed);
    return updateProject(this.runtime.pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
      projectId: await resolveProjectIdentifier(this.runtime.pool, unparsedProjectId),
      ...body,
      requestId: requestId(request),
    });
  }

  @ApiCreatedResponse({ schema: openApiSchema(projectResponse) })
  @ApiZodBody(reasonInput, 'Archive the project while preserving traceability.', {
    reason: 'Qualification program completed',
  })
  @Post('workspaces/:workspaceId/projects/:projectId/archive')
  async archiveProject(
    @Req() request: Request,
    @Param('workspaceId') unparsedWorkspaceId: string,
    @Param('projectId') unparsedProjectId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'project.archive', true);
    const body = reasonInput.parse(unparsed);
    return setProjectArchived(this.runtime.pool, actor, {
      workspaceId: await resolveWorkspaceIdentifier(this.runtime.pool, unparsedWorkspaceId),
      projectId: await resolveProjectIdentifier(this.runtime.pool, unparsedProjectId),
      archived: true,
      reason: body.reason,
      requestId: requestId(request),
    });
  }

  @ApiCreatedResponse({ schema: openApiSchema(projectResponse) })
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

  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiOkResponse({ schema: openApiSchema(memberPageResponse) })
  @Get('members')
  async members(
    @Req() request: Request,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const actor = await requireActor(this.runtime, request, 'member.manage');
    return listMemberPage(
      this.runtime.pool,
      actor,
      directoryListQuery.parse({ query, limit, offset }),
    );
  }

  @ApiOkResponse({ schema: openApiSchema(updatedResponse) })
  @ApiZodBody(memberRoleInput, 'Replace one organization member role.', { role: 'engineer' })
  @Patch('members/:userId/role')
  async changeRole(
    @Req() request: Request,
    @Param('userId') userId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = memberRoleInput.parse(unparsed);
    await updateMemberRole(
      this.runtime.pool,
      actor,
      z.string().uuid().parse(userId),
      body.role,
      requestId(request),
    );
    return { updated: true };
  }

  @ApiOkResponse({ schema: openApiSchema(bulkUpdatedResponse) })
  @ApiZodBody(memberRolesInput, 'Replace the role for one or more organization members.', {
    memberIds: ['019fbcf9-e020-71da-935a-6a6a728b3790'],
    role: 'reviewer',
  })
  @Patch('members/roles')
  async changeRoles(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = memberRolesInput.parse(unparsed);
    const updated = await updateMemberRoles(
      this.runtime.pool,
      actor,
      body.memberIds,
      body.role,
      requestId(request),
    );
    return { updated };
  }

  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiOkResponse({ schema: openApiSchema(memberGroupPageResponse) })
  @Get('member-groups')
  async memberGroups(
    @Req() request: Request,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const actor = await requireActor(this.runtime, request, 'member.manage');
    return listMemberGroupPage(
      this.runtime.pool,
      actor,
      directoryListQuery.parse({ query, limit, offset }),
    );
  }

  @ApiCreatedResponse({ schema: openApiSchema(memberGroupResponse) })
  @ApiZodBody(memberGroupCreateInput, 'Create an organization member group.', {
    name: 'Reliability reviewers',
    description: 'Reviewers for reliability qualification evidence.',
    color: 'violet',
  })
  @Post('member-groups')
  async createMemberGroup(@Req() request: Request, @Body() unparsed: unknown) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = memberGroupCreateInput.parse(unparsed);
    return createMemberGroup(this.runtime.pool, actor, {
      name: body.name,
      description: body.description ?? '',
      color: body.color ?? 'sky',
      requestId: requestId(request),
    });
  }

  @ApiOkResponse({ schema: openApiSchema(updatedResponse) })
  @ApiZodBody(memberGroupUpdateInput, 'Replace editable member-group metadata.', {
    name: 'Reliability reviewers',
    description: 'Reviewers for reliability qualification evidence.',
    color: 'violet',
  })
  @Patch('member-groups/:groupId')
  async updateMemberGroup(
    @Req() request: Request,
    @Param('groupId') unparsedGroupId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = memberGroupUpdateInput.parse(unparsed);
    await updateMemberGroup(this.runtime.pool, actor, {
      groupId: z.string().uuid().parse(unparsedGroupId),
      ...body,
      requestId: requestId(request),
    });
    return { updated: true };
  }

  @ApiOkResponse({ schema: openApiSchema(updatedResponse) })
  @ApiZodBody(memberGroupMembersInput, 'Atomically replace all members of the group.', {
    memberIds: ['019fbcf9-e020-71da-935a-6a6a728b3790'],
  })
  @Patch('member-groups/:groupId/members')
  async replaceMemberGroupMembers(
    @Req() request: Request,
    @Param('groupId') unparsedGroupId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = memberGroupMembersInput.parse(unparsed);
    await replaceMemberGroupMembers(this.runtime.pool, actor, {
      groupId: z.string().uuid().parse(unparsedGroupId),
      memberIds: body.memberIds,
      requestId: requestId(request),
    });
    return { updated: true };
  }

  @ApiCreatedResponse({ schema: openApiSchema(z.object({ archived: z.literal(true) })) })
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

  @ApiCreatedResponse({ schema: openApiSchema(revokedResponse) })
  @ApiZodBody(reasonInput, 'Revoke every active browser session for one member.', {
    reason: 'Access review',
  })
  @Post('members/:userId/revoke-sessions')
  async revokeMemberSessions(
    @Req() request: Request,
    @Param('userId') userId: string,
    @Body() unparsed: unknown,
  ) {
    const actor = await requireActor(this.runtime, request, 'member.manage', true);
    const body = reasonInput.parse(unparsed);
    await revokeAllUserSessions(
      this.runtime.pool,
      actor,
      z.string().uuid().parse(userId),
      body.reason,
      requestId(request),
    );
    return { revoked: true };
  }

  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–200).' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Zero-based offset.' })
  @ApiOkResponse({ schema: openApiSchema(auditPageResponse) })
  @Get('audit-events')
  async audit(
    @Req() request: Request,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const actor = await requireActor(this.runtime, request, 'audit.read');
    const input = auditListQuery.parse({ query, limit, offset });
    return listAuditEventPage(this.runtime.pool, actor, input);
  }
}
