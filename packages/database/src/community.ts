import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { seedDefaultTaskWorkflow } from './task-workflow-defaults.js';
import { generateBasePublicId, generateWorkspacePublicId } from './public-ids.js';
import { RepositoryError } from './errors.js';

export { RepositoryError } from './errors.js';

export type MemberRole = 'owner' | 'admin' | 'engineer' | 'contributor' | 'reviewer' | 'viewer';
export type SecurityTokenType = 'invitation' | 'password_reset';

export interface ActorSession {
  sessionId: string;
  actorId: string;
  organizationId: string;
  role: MemberRole;
  email: string;
  displayName: string;
  csrfTokenHash: string;
  authenticationType?: 'session' | 'api_token';
  apiTokenId?: string;
  apiTokenAccessLevel?: 'read' | 'write';
  apiTokenScopes?: string[] | null;
  apiTokenWorkspaceId?: string | null;
}

export interface AuditInput {
  organizationId: string;
  workspaceId?: string;
  projectId?: string;
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  requestId: string;
  payload?: Record<string, unknown>;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function opaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

function normalizedEmail(email: string): string {
  return email.trim().normalize('NFC').toLowerCase();
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('begin isolation level serializable');
      const result = await action(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      const code =
        typeof error === 'object' && error && 'code' in error ? String(error.code) : undefined;
      if (attempt === 4 || (code !== '40001' && code !== '40P01')) throw error;
    } finally {
      client.release();
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 10));
  }
  throw new Error('TRANSACTION_RETRY_EXHAUSTED');
}

async function setupTransaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  await client.query("select pg_advisory_lock(hashtext('engrove:first-run-setup'))");
  try {
    await client.query('begin isolation level serializable');
    const result = await action(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('engrove:first-run-setup'))");
    client.release();
  }
}

export async function appendAudit(client: PoolClient, input: AuditInput): Promise<void> {
  await client.query(
    `insert into audit_events
      (id, organization_id, workspace_id, project_id, actor_id, action, target_type, target_id, request_id, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      uuidv7(),
      input.organizationId,
      input.workspaceId ?? null,
      input.projectId ?? null,
      input.actorId ?? null,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.requestId,
      JSON.stringify(input.payload ?? {}),
    ],
  );
}

export async function initializeInstallation(
  pool: Pool,
  suppliedToken: string | undefined,
  publicUrl: string,
): Promise<{ setupUrl?: string }> {
  return setupTransaction(pool, async (client) => {
    let organization = await client.query<{ id: string }>(
      'select id from organizations where singleton = true',
    );
    if (!organization.rows[0]) {
      organization = await client.query<{ id: string }>(
        `insert into organizations (id, name, slug, singleton)
         values ($1, 'Engrove', 'engrove', true) returning id`,
        [uuidv7()],
      );
    }
    const organizationId = organization.rows[0]!.id;
    const existing = await client.query<{ completed_at: Date | null }>(
      'select completed_at from installation_setup where singleton = true',
    );
    if (existing.rows[0]) return {};

    const token = suppliedToken ?? opaqueToken();
    await client.query(
      `insert into installation_setup (singleton, organization_id, setup_token_hash)
       values (true, $1, $2)`,
      [organizationId, digest(token)],
    );
    return { setupUrl: `${publicUrl.replace(/\/$/, '')}/setup?token=${encodeURIComponent(token)}` };
  });
}

export async function rotateSetupToken(pool: Pool, publicUrl: string): Promise<string> {
  return setupTransaction(pool, async (client) => {
    const setup = await client.query<{ completed_at: Date | null }>(
      'select completed_at from installation_setup where singleton = true for update',
    );
    if (!setup.rows[0] || setup.rows[0].completed_at) {
      throw new RepositoryError('SETUP_NOT_AVAILABLE', 404, 'First-run setup is not available.');
    }
    const token = opaqueToken();
    await client.query(
      'update installation_setup set setup_token_hash = $1, updated_at = now() where singleton = true',
      [digest(token)],
    );
    return `${publicUrl.replace(/\/$/, '')}/setup?token=${encodeURIComponent(token)}`;
  });
}

export async function isSetupAvailable(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ available: boolean }>(
    'select completed_at is null and setup_token_hash is not null as available from installation_setup where singleton = true',
  );
  return result.rows[0]?.available ?? false;
}

export async function getInstallationOrganizationId(pool: Pool): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'select id from organizations where singleton = true',
  );
  if (!result.rows[0]) {
    throw new RepositoryError(
      'INSTALLATION_NOT_INITIALIZED',
      503,
      'Installation is not initialized.',
    );
  }
  return result.rows[0].id;
}

export interface CompleteSetupInput {
  token: string;
  email: string;
  displayName: string;
  passwordHash: string;
  requestId: string;
}

export async function completeSetup(
  pool: Pool,
  input: CompleteSetupInput,
): Promise<{ userId: string; organizationId: string }> {
  const result = await setupTransaction(pool, async (client) => {
    const setup = await client.query<{
      organization_id: string;
      setup_token_hash: string | null;
      completed_at: Date | null;
    }>(
      'select organization_id, setup_token_hash, completed_at from installation_setup where singleton = true for update',
    );
    const row = setup.rows[0];
    if (!row || row.completed_at || !row.setup_token_hash) {
      throw new RepositoryError('SETUP_NOT_AVAILABLE', 404, 'First-run setup is not available.');
    }
    if (!safeHashEqual(row.setup_token_hash, digest(input.token))) {
      await appendAudit(client, {
        organizationId: row.organization_id,
        action: 'setup.rejected',
        targetType: 'installation',
        requestId: input.requestId,
        payload: { reason: 'invalid_token' },
      });
      return { rejected: true as const };
    }

    const userId = uuidv7();
    await client.query(
      `insert into users (id, email, display_name, password_hash) values ($1, $2, $3, $4)`,
      [userId, normalizedEmail(input.email), input.displayName.trim(), input.passwordHash],
    );
    await client.query(
      `insert into memberships (id, organization_id, user_id, role, created_by)
       values ($1, $2, $3, 'owner', $3)`,
      [uuidv7(), row.organization_id, userId],
    );
    await client.query(
      `update installation_setup
       set completed_at = now(), setup_token_hash = null, updated_at = now()
       where singleton = true`,
    );
    await appendAudit(client, {
      organizationId: row.organization_id,
      actorId: userId,
      action: 'setup.completed',
      targetType: 'organization',
      targetId: row.organization_id,
      requestId: input.requestId,
    });
    return { rejected: false as const, userId, organizationId: row.organization_id };
  });
  if (result.rejected) {
    throw new RepositoryError('SETUP_TOKEN_INVALID', 401, 'The setup token is invalid.');
  }
  return { userId: result.userId, organizationId: result.organizationId };
}

export interface PasswordUser {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  organizationId: string;
  role: MemberRole;
}

export async function findPasswordUser(
  pool: Pool,
  email: string,
): Promise<PasswordUser | undefined> {
  const result = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string;
    organization_id: string;
    role: MemberRole;
  }>(
    `select u.id, u.email, u.display_name, u.password_hash, m.organization_id, m.role
     from users u join memberships m on m.user_id = u.id
     where u.email = $1 and u.disabled_at is null`,
    [normalizedEmail(email)],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        passwordHash: row.password_hash,
        organizationId: row.organization_id,
        role: row.role,
      }
    : undefined;
}

export async function recordAuthenticationEvent(
  pool: Pool,
  input: Omit<AuditInput, 'targetType'>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await appendAudit(client, { ...input, targetType: 'user' });
  } finally {
    client.release();
  }
}

export interface SessionSecrets {
  token: string;
  csrfToken: string;
  sessionId: string;
}

export async function createSession(
  pool: Pool,
  input: {
    userId: string;
    organizationId: string;
    requestId: string;
    idleMinutes: number;
    absoluteHours: number;
    rotatedFromSessionId?: string;
  },
): Promise<SessionSecrets> {
  const token = opaqueToken();
  const csrfToken = opaqueToken();
  const sessionId = uuidv7();
  const now = Date.now();
  await transaction(pool, async (client) => {
    await client.query(
      `insert into sessions
        (id, user_id, token_hash, csrf_token_hash, idle_expires_at, absolute_expires_at, rotated_from_session_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        sessionId,
        input.userId,
        digest(token),
        digest(csrfToken),
        new Date(now + input.idleMinutes * 60_000),
        new Date(now + input.absoluteHours * 3_600_000),
        input.rotatedFromSessionId ?? null,
      ],
    );
    await appendAudit(client, {
      organizationId: input.organizationId,
      actorId: input.userId,
      action: input.rotatedFromSessionId ? 'session.rotated' : 'session.created',
      targetType: 'session',
      targetId: sessionId,
      requestId: input.requestId,
    });
  });
  return { token, csrfToken, sessionId };
}

export async function authenticateSession(
  pool: Pool,
  token: string,
  idleMinutes: number,
): Promise<ActorSession | undefined> {
  const result = await pool.query<{
    session_id: string;
    user_id: string;
    organization_id: string;
    role: MemberRole;
    email: string;
    display_name: string;
    csrf_token_hash: string;
    absolute_expires_at: Date;
  }>(
    `select s.id as session_id, u.id as user_id, m.organization_id, m.role, u.email,
            u.display_name, s.csrf_token_hash, s.absolute_expires_at
     from sessions s
     join users u on u.id = s.user_id
     join memberships m on m.user_id = u.id
     where s.token_hash = $1 and s.revoked_at is null and s.idle_expires_at > now()
       and s.absolute_expires_at > now() and u.disabled_at is null`,
    [digest(token)],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const idleExpiry = new Date(
    Math.min(Date.now() + idleMinutes * 60_000, row.absolute_expires_at.getTime()),
  );
  await pool.query('update sessions set last_seen_at = now(), idle_expires_at = $2 where id = $1', [
    row.session_id,
    idleExpiry,
  ]);
  return {
    sessionId: row.session_id,
    actorId: row.user_id,
    organizationId: row.organization_id,
    role: row.role,
    email: row.email,
    displayName: row.display_name,
    csrfTokenHash: row.csrf_token_hash,
  };
}

export function verifyCsrf(session: ActorSession, token: string | undefined): boolean {
  return Boolean(token) && safeHashEqual(session.csrfTokenHash, digest(token!));
}

export async function revokeSession(
  pool: Pool,
  actor: ActorSession,
  sessionId: string,
  reason: string,
  requestId: string,
): Promise<void> {
  await transaction(pool, async (client) => {
    const result = await client.query(
      `update sessions set revoked_at = coalesce(revoked_at, now()), revoked_reason = coalesce(revoked_reason, $3)
       where id = $1 and user_id = $2`,
      [sessionId, actor.actorId, reason],
    );
    if (!result.rowCount)
      throw new RepositoryError('SESSION_NOT_FOUND', 404, 'Session was not found.');
    await appendAudit(client, {
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: 'session.revoked',
      targetType: 'session',
      targetId: sessionId,
      requestId,
      payload: { reason },
    });
  });
}

export async function revokeUserSessions(
  client: PoolClient,
  userId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `update sessions set revoked_at = coalesce(revoked_at, now()), revoked_reason = coalesce(revoked_reason, $2)
     where user_id = $1 and revoked_at is null`,
    [userId, reason],
  );
}

export async function revokeAllUserSessions(
  pool: Pool,
  actor: ActorSession,
  userId: string,
  reason: string,
  requestId: string,
): Promise<void> {
  await transaction(pool, async (client) => {
    const member = await client.query(
      'select 1 from memberships where organization_id = $1 and user_id = $2',
      [actor.organizationId, userId],
    );
    if (!member.rowCount)
      throw new RepositoryError('MEMBER_NOT_FOUND', 404, 'Member was not found.');
    await revokeUserSessions(client, userId, reason);
    await appendAudit(client, {
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: 'session.administrator_revoked',
      targetType: 'user',
      targetId: userId,
      requestId,
      payload: { reason },
    });
  });
}

export interface IssuedSecurityToken {
  id: string;
  token: string;
  expiresAt: string;
}

export async function issueSecurityToken(
  pool: Pool,
  actor: ActorSession,
  input: {
    type: SecurityTokenType;
    subjectEmail?: string;
    subjectUserId?: string;
    role?: MemberRole;
    requestId: string;
    ttlMinutes?: number;
  },
): Promise<IssuedSecurityToken> {
  const id = uuidv7();
  const token = opaqueToken();
  const expiresAt = new Date(Date.now() + (input.ttlMinutes ?? 30) * 60_000);
  await transaction(pool, async (client) => {
    if (input.type === 'password_reset') {
      const member = await client.query(
        'select 1 from memberships where organization_id = $1 and user_id = $2',
        [actor.organizationId, input.subjectUserId ?? null],
      );
      if (!member.rowCount) {
        throw new RepositoryError('MEMBER_NOT_FOUND', 404, 'Member was not found.');
      }
    }
    await client.query(
      `insert into security_tokens
        (id, organization_id, type, token_hash, subject_email, subject_user_id, role, created_by, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        actor.organizationId,
        input.type,
        digest(token),
        input.subjectEmail ? normalizedEmail(input.subjectEmail) : null,
        input.subjectUserId ?? null,
        input.role ?? null,
        actor.actorId,
        expiresAt,
      ],
    );
    await appendAudit(client, {
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: `${input.type}.token_created`,
      targetType: 'security_token',
      targetId: id,
      requestId: input.requestId,
      payload: { expiresAt: expiresAt.toISOString() },
    });
  });
  return { id, token, expiresAt: expiresAt.toISOString() };
}

export async function revokeSecurityToken(
  pool: Pool,
  actor: ActorSession,
  tokenId: string,
  reason: string,
  requestId: string,
): Promise<void> {
  await transaction(pool, async (client) => {
    const result = await client.query<{ type: SecurityTokenType }>(
      `update security_tokens
       set revoked_at = now()
       where id = $1 and organization_id = $2 and used_at is null and revoked_at is null
       returning type`,
      [tokenId, actor.organizationId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new RepositoryError('TOKEN_NOT_ACTIVE', 404, 'The active token was not found.');
    }
    await appendAudit(client, {
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: `${row.type}.token_revoked`,
      targetType: 'security_token',
      targetId: tokenId,
      requestId,
      payload: { reason },
    });
  });
}

export async function acceptInvitation(
  pool: Pool,
  input: {
    token: string;
    displayName: string;
    passwordHash: string;
    requestId: string;
  },
): Promise<{ userId: string; organizationId: string }> {
  const result = await transaction(pool, async (client) => {
    const token = await client.query<{
      id: string;
      organization_id: string;
      subject_email: string | null;
      role: MemberRole | null;
      expires_at: Date;
      used_at: Date | null;
      revoked_at: Date | null;
    }>(
      `select id, organization_id, subject_email, role, expires_at, used_at, revoked_at
       from security_tokens where token_hash = $1 and type = 'invitation' for update`,
      [digest(input.token)],
    );
    const row = token.rows[0];
    if (!row || row.used_at || row.revoked_at || !row.subject_email || !row.role) {
      throw new RepositoryError(
        'TOKEN_INVALID_OR_EXPIRED',
        400,
        'The token is invalid or expired.',
      );
    }
    if (row.expires_at.getTime() <= Date.now()) {
      await client.query('update security_tokens set revoked_at = now() where id = $1', [row.id]);
      await appendAudit(client, {
        organizationId: row.organization_id,
        action: 'invitation.token_expired',
        targetType: 'security_token',
        targetId: row.id,
        requestId: input.requestId,
      });
      return { expired: true as const };
    }
    const userId = uuidv7();
    await client.query(
      'insert into users (id, email, display_name, password_hash) values ($1, $2, $3, $4)',
      [userId, row.subject_email, input.displayName.trim(), input.passwordHash],
    );
    await client.query(
      `insert into memberships (id, organization_id, user_id, role, created_by)
       select $1, $2, $3, $4, created_by from security_tokens where id = $5`,
      [uuidv7(), row.organization_id, userId, row.role, row.id],
    );
    await client.query('update security_tokens set used_at = now() where id = $1', [row.id]);
    await appendAudit(client, {
      organizationId: row.organization_id,
      actorId: userId,
      action: 'invitation.token_used',
      targetType: 'user',
      targetId: userId,
      requestId: input.requestId,
    });
    return { expired: false as const, userId, organizationId: row.organization_id };
  });
  if (result.expired) {
    throw new RepositoryError('TOKEN_INVALID_OR_EXPIRED', 400, 'The token is invalid or expired.');
  }
  return { userId: result.userId, organizationId: result.organizationId };
}

export async function completePasswordReset(
  pool: Pool,
  input: { token: string; passwordHash: string; requestId: string },
): Promise<void> {
  const result = await transaction(pool, async (client) => {
    const token = await client.query<{
      id: string;
      organization_id: string;
      subject_user_id: string | null;
      expires_at: Date;
      used_at: Date | null;
      revoked_at: Date | null;
    }>(
      `select id, organization_id, subject_user_id, expires_at, used_at, revoked_at
       from security_tokens where token_hash = $1 and type = 'password_reset' for update`,
      [digest(input.token)],
    );
    const row = token.rows[0];
    if (!row || row.used_at || row.revoked_at || !row.subject_user_id) {
      throw new RepositoryError(
        'TOKEN_INVALID_OR_EXPIRED',
        400,
        'The token is invalid or expired.',
      );
    }
    if (row.expires_at.getTime() <= Date.now()) {
      await client.query('update security_tokens set revoked_at = now() where id = $1', [row.id]);
      await appendAudit(client, {
        organizationId: row.organization_id,
        action: 'password_reset.token_expired',
        targetType: 'security_token',
        targetId: row.id,
        requestId: input.requestId,
      });
      return { expired: true as const };
    }
    await client.query('update users set password_hash = $2, updated_at = now() where id = $1', [
      row.subject_user_id,
      input.passwordHash,
    ]);
    await revokeUserSessions(client, row.subject_user_id, 'password_reset');
    await client.query(
      `update api_tokens
       set revoked_at = coalesce(revoked_at, now()),
           revoked_reason = coalesce(revoked_reason, 'password_reset')
       where user_id = $1 and revoked_at is null`,
      [row.subject_user_id],
    );
    await client.query('update security_tokens set used_at = now() where id = $1', [row.id]);
    await appendAudit(client, {
      organizationId: row.organization_id,
      actorId: row.subject_user_id,
      action: 'password_reset.token_used',
      targetType: 'user',
      targetId: row.subject_user_id,
      requestId: input.requestId,
    });
    return { expired: false as const };
  });
  if (result.expired) {
    throw new RepositoryError('TOKEN_INVALID_OR_EXPIRED', 400, 'The token is invalid or expired.');
  }
}

export interface WorkspaceRow {
  id: string;
  publicId: string;
  name: string;
  slug: string;
  description: string;
  archivedAt: string | null;
}

function mapWorkspace(row: {
  id: string;
  public_id: string;
  name: string;
  slug: string;
  description: string;
  archived_at: Date | null;
}): WorkspaceRow {
  return {
    id: row.id,
    publicId: row.public_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    archivedAt: row.archived_at?.toISOString() ?? null,
  };
}

function mapWorkspaceConflict(error: unknown): never {
  if (
    typeof error === 'object' &&
    error &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'workspaces_organization_slug_key'
  ) {
    throw new RepositoryError(
      'WORKSPACE_KEY_CONFLICT',
      409,
      'Another workspace already uses this key.',
    );
  }
  throw error;
}

export async function listWorkspaces(pool: Pool, actor: ActorSession): Promise<WorkspaceRow[]> {
  const result = await pool.query(
    `select id, public_id, name, slug, description, archived_at from workspaces
     where organization_id = $1 and ($2::uuid is null or id = $2)
       and workspace_visible_to(id,$1,$3,$4)
     order by name, id`,
    [actor.organizationId, actor.apiTokenWorkspaceId ?? null, actor.actorId, actor.role],
  );
  return result.rows.map(mapWorkspace);
}

export interface WorkspacePage {
  items: WorkspaceRow[];
  pageInfo: {
    limit: number;
    offset: number;
    total: number;
    overallTotal: number;
    hasNext: boolean;
  };
}

export async function getWorkspace(
  pool: Pool,
  actor: ActorSession,
  workspaceIdentifier: string,
): Promise<WorkspaceRow> {
  const result = await pool.query<{
    id: string;
    public_id: string;
    name: string;
    slug: string;
    description: string;
    archived_at: Date | null;
  }>(
    `select id, public_id, name, slug, description, archived_at
     from workspaces
     where organization_id = $1
       and ($2::uuid is null or id = $2)
       and workspace_visible_to(id,$1,$4,$5)
       and (id::text = $3 or public_id = $3)`,
    [
      actor.organizationId,
      actor.apiTokenWorkspaceId ?? null,
      workspaceIdentifier,
      actor.actorId,
      actor.role,
    ],
  );
  if (!result.rows[0])
    throw new RepositoryError('WORKSPACE_NOT_FOUND', 404, 'Workspace was not found.');
  return mapWorkspace(result.rows[0]);
}

/** Bounded workspace portfolio lookup for navigation and management surfaces. */
export async function listWorkspacePage(
  pool: Pool,
  actor: ActorSession,
  query = '',
  requestedLimit = 50,
  requestedOffset = 0,
): Promise<WorkspacePage> {
  const normalizedQuery = query.normalize('NFKC').trim();
  const escapedQuery = normalizedQuery.replace(/[\\%_]/g, '\\$&');
  const limit = Math.max(1, Math.min(100, requestedLimit));
  const offset = Math.max(0, Math.min(1_000_000, requestedOffset));
  const result = await pool.query<{
    id: string | null;
    public_id: string | null;
    name: string | null;
    slug: string | null;
    description: string | null;
    archived_at: Date | null;
    total: number;
    overall_total: number;
  }>(
    `with scoped as materialized (
       select id, public_id, name, slug, description, archived_at
       from workspaces
       where organization_id = $1 and ($2::uuid is null or id = $2)
         and workspace_visible_to(id,$1,$7,$8)
     ), filtered as materialized (
       select * from scoped
       where $3 = ''
          or name ilike '%' || $4 || '%' escape '\\'
          or slug ilike '%' || $4 || '%' escape '\\'
          or description ilike '%' || $4 || '%' escape '\\'
          or public_id ilike '%' || $4 || '%' escape '\\'
     )
     select page.id, page.public_id, page.name, page.slug, page.description, page.archived_at,
            counts.total, counts.overall_total
     from (
       select (select count(*)::int from filtered) as total,
              (select count(*)::int from scoped) as overall_total
     ) counts
     left join lateral (
       select * from filtered
       order by archived_at nulls first,
                case when lower(name) = lower($3) or lower(slug) = lower($3) then 0 else 1 end,
                name, id
       limit $5 offset $6
     ) page on true`,
    [
      actor.organizationId,
      actor.apiTokenWorkspaceId ?? null,
      normalizedQuery,
      escapedQuery,
      limit,
      offset,
      actor.actorId,
      actor.role,
    ],
  );
  const first = result.rows[0];
  const total = first?.total ?? 0;
  const overallTotal = first?.overall_total ?? 0;
  const items = result.rows
    .filter(
      (
        row,
      ): row is typeof row & {
        id: string;
        public_id: string;
        name: string;
        slug: string;
        description: string;
      } => row.id !== null,
    )
    .map(mapWorkspace);
  return {
    items,
    pageInfo: {
      limit,
      offset,
      total,
      overallTotal,
      hasNext: offset + items.length < total,
    },
  };
}

export async function createWorkspace(
  pool: Pool,
  actor: ActorSession,
  input: {
    name: string;
    slug: string;
    description?: string;
    visibility?: 'organization' | 'restricted';
    requestId: string;
  },
): Promise<WorkspaceRow> {
  return transaction(pool, async (client) => {
    const id = uuidv7();
    const result = await client.query(
      `insert into workspaces
         (id, public_id, organization_id, name, slug, description, visibility, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, public_id, name, slug, description, archived_at`,
      [
        id,
        generateWorkspacePublicId(),
        actor.organizationId,
        input.name.trim(),
        input.slug.trim().toLowerCase(),
        input.description ?? '',
        input.visibility ?? 'organization',
        actor.actorId,
      ],
    );
    await appendAudit(client, {
      organizationId: actor.organizationId,
      workspaceId: id,
      actorId: actor.actorId,
      action: 'workspace.created',
      targetType: 'workspace',
      targetId: id,
      requestId: input.requestId,
    });
    return mapWorkspace(result.rows[0]);
  }).catch(mapWorkspaceConflict);
}

export async function updateWorkspace(
  pool: Pool,
  actor: ActorSession,
  input: {
    workspaceId: string;
    name: string;
    slug: string;
    description: string;
    requestId: string;
  },
): Promise<WorkspaceRow> {
  return transaction(pool, async (client) => {
    const previous = await client.query<{ name: string; slug: string; description: string }>(
      `select name, slug, description from workspaces
       where id = $1 and organization_id = $2
         and workspace_visible_to(id,$2,$3,$4) for update`,
      [input.workspaceId, actor.organizationId, actor.actorId, actor.role],
    );
    if (!previous.rows[0])
      throw new RepositoryError('WORKSPACE_NOT_FOUND', 404, 'Workspace was not found.');
    const result = await client.query(
      `update workspaces set name = $3, slug = $4, description = $5, updated_at = now()
       where id = $1 and organization_id = $2
       returning id, public_id, name, slug, description, archived_at`,
      [
        input.workspaceId,
        actor.organizationId,
        input.name.trim(),
        input.slug.trim().toLowerCase(),
        input.description,
      ],
    );
    await appendAudit(client, {
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
      actorId: actor.actorId,
      action: 'workspace.updated',
      targetType: 'workspace',
      targetId: input.workspaceId,
      requestId: input.requestId,
      payload: {
        from: previous.rows[0],
        to: {
          name: input.name.trim(),
          slug: input.slug.trim().toLowerCase(),
          description: input.description,
        },
      },
    });
    return mapWorkspace(result.rows[0]);
  }).catch(mapWorkspaceConflict);
}

export interface ProjectRow {
  id: string;
  publicId: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string;
  status: string;
  rowVersion: number;
  archivedAt: string | null;
}

function mapProject(row: {
  id: string;
  public_id: string;
  workspace_id: string;
  name: string;
  key: string;
  description: string;
  status: string;
  row_version: number;
  archived_at: Date | null;
}): ProjectRow {
  return {
    id: row.id,
    publicId: row.public_id,
    workspaceId: row.workspace_id,
    name: row.name,
    key: row.key,
    description: row.description,
    status: row.status,
    rowVersion: row.row_version,
    archivedAt: row.archived_at?.toISOString() ?? null,
  };
}

async function assertWorkspaceScope(
  client: PoolClient,
  actor: ActorSession,
  workspaceId: string,
): Promise<void> {
  const result = await client.query(
    `select 1 from workspaces where id = $1 and organization_id = $2
       and workspace_visible_to(id,$2,$3,$4)`,
    [workspaceId, actor.organizationId, actor.actorId, actor.role],
  );
  if (!result.rowCount)
    throw new RepositoryError('WORKSPACE_NOT_FOUND', 404, 'Workspace was not found.');
}

export type ProjectArchiveState = 'active' | 'archived' | 'all';

export interface ProjectPage {
  items: ProjectRow[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  overallTotal: number;
}

/** Bounded project catalog for management surfaces and API integrations. */
export async function listProjectPage(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
  options: {
    query?: string;
    archiveState?: ProjectArchiveState;
    limit?: number;
    offset?: number;
  } = {},
): Promise<ProjectPage> {
  const query = (options.query ?? '').normalize('NFKC').trim();
  const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
  const archiveState = options.archiveState ?? 'all';
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
  const offset = Math.min(Math.max(Math.trunc(options.offset ?? 0), 0), 1_000_000);
  const result = await pool.query<{
    id: string | null;
    public_id: string | null;
    workspace_id: string | null;
    name: string | null;
    key: string | null;
    description: string | null;
    status: string | null;
    row_version: number | null;
    archived_at: Date | null;
    total: number;
    overall_total: number;
  }>(
    `with scoped as materialized (
       select p.id, p.public_id, p.workspace_id, p.name, p.key, p.description, p.status,
              p.row_version, p.archived_at
       from projects p join workspaces w on w.id = p.workspace_id
       where p.workspace_id = $1 and w.organization_id = $2 and p.system = false
         and project_visible_to(p.id,$1,$2,$8,$9)
     ), filtered as materialized (
       select * from scoped
       where ($3 = 'all'
              or ($3 = 'active' and archived_at is null)
              or ($3 = 'archived' and archived_at is not null))
         and ($4 = ''
              or name ilike '%' || $5 || '%' escape '\\'
              or key ilike '%' || $5 || '%' escape '\\'
              or description ilike '%' || $5 || '%' escape '\\'
              or status ilike '%' || $5 || '%' escape '\\'
              or public_id ilike '%' || $5 || '%' escape '\\')
     )
     select page.id, page.public_id, page.workspace_id, page.name, page.key,
            page.description, page.status, page.row_version, page.archived_at,
            counts.total, counts.overall_total
     from (
       select (select count(*)::int from filtered) as total,
              (select count(*)::int from scoped) as overall_total
     ) counts
     left join lateral (
       select * from filtered
       order by archived_at nulls first,
                case when lower(name) = lower($4) or lower(key) = lower($4) then 0 else 1 end,
                lower(name), id
       limit $6 offset $7
     ) page on true`,
    [
      workspaceId,
      actor.organizationId,
      archiveState,
      query,
      escapedQuery,
      limit,
      offset,
      actor.actorId,
      actor.role,
    ],
  );
  const first = result.rows[0];
  const total = first?.total ?? 0;
  const overallTotal = first?.overall_total ?? 0;
  const items = result.rows
    .filter(
      (
        row,
      ): row is typeof row & {
        id: string;
        public_id: string;
        workspace_id: string;
        name: string;
        key: string;
        description: string;
        status: string;
        row_version: number;
      } => row.id !== null,
    )
    .map(mapProject);
  return {
    items,
    pageInfo: { limit, offset, total, hasNext: offset + items.length < total },
    overallTotal,
  };
}

export interface ProjectOptionPage {
  items: ProjectRow[];
  pageInfo: {
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

export interface ProjectReferenceRow {
  id: string;
  publicId: string;
  name: string;
  key: string;
  archivedAt: string | null;
}

export async function listProjectReferences(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
  projectIds: string[],
): Promise<ProjectReferenceRow[]> {
  const ids = [...new Set(projectIds)].slice(0, 500);
  if (ids.length === 0) return [];
  const result = await pool.query<{
    id: string;
    public_id: string;
    name: string;
    key: string;
    archived_at: Date | null;
  }>(
    `select p.id, p.public_id, p.name, p.key, p.archived_at
     from projects p join workspaces w on w.id = p.workspace_id
     where p.workspace_id = $1 and w.organization_id = $2 and p.system = false
       and p.id = any($3::uuid[])
       and project_visible_to(p.id,$1,$2,$4,$5)
     order by array_position($3::uuid[], p.id)`,
    [workspaceId, actor.organizationId, ids, actor.actorId, actor.role],
  );
  return result.rows.map((row) => ({
    id: row.id,
    publicId: row.public_id,
    name: row.name,
    key: row.key,
    archivedAt: row.archived_at?.toISOString() ?? null,
  }));
}

/**
 * Bounded project lookup for navigation controls. Unlike the management catalog, this provides
 * relevance-ranked active projects without offset pagination.
 */
export async function listProjectOptions(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
  query = '',
  limit = 20,
): Promise<ProjectOptionPage> {
  const normalizedQuery = query.normalize('NFKC').trim();
  const escapedQuery = normalizedQuery.replace(/[\\%_]/g, '\\$&');
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 50));
  const result = await pool.query<{
    id: string;
    public_id: string;
    workspace_id: string;
    name: string;
    key: string;
    description: string;
    status: string;
    row_version: number;
    archived_at: Date | null;
    total: number;
  }>(
    `select p.id,p.public_id,p.workspace_id,p.name,p.key,p.description,p.status,p.row_version,
            p.archived_at,count(*) over()::int total
     from projects p join workspaces w on w.id=p.workspace_id
     where p.workspace_id=$1 and w.organization_id=$2 and p.system=false and p.archived_at is null
       and project_visible_to(p.id,$1,$2,$6,$7)
       and ($3::text='' or p.name ilike '%'||$4||'%' escape '\\'
                         or p.key ilike '%'||$4||'%' escape '\\'
                         or p.public_id ilike '%'||$4||'%' escape '\\')
     order by case
       when lower(p.name)=lower($3) then 0
       when lower(p.key)=lower($3) then 1
       when lower(p.public_id)=lower($3) then 2
       when p.name ilike $4||'%' escape '\\' then 3
       when p.key ilike $4||'%' escape '\\' then 4
       when p.public_id ilike $4||'%' escape '\\' then 5
       else 6 end,
       p.name,p.id
     limit $5`,
    [
      workspaceId,
      actor.organizationId,
      normalizedQuery,
      escapedQuery,
      boundedLimit,
      actor.actorId,
      actor.role,
    ],
  );
  const total = Number(result.rows[0]?.total ?? 0);
  return {
    items: result.rows.map(mapProject),
    pageInfo: { limit: boundedLimit, total, hasMore: result.rows.length < total },
  };
}

export async function getProject(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
  projectIdentifier: string,
): Promise<ProjectRow> {
  const result = await pool.query(
    `select p.id, p.public_id, p.workspace_id, p.name, p.key, p.description, p.status,
            p.row_version, p.archived_at
     from projects p join workspaces w on w.id=p.workspace_id
     where p.workspace_id=$1 and w.organization_id=$2 and p.system=false
       and project_visible_to(p.id,$1,$2,$4,$5)
       and (p.id::text=$3 or p.public_id=$3)`,
    [workspaceId, actor.organizationId, projectIdentifier, actor.actorId, actor.role],
  );
  if (!result.rows[0])
    throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
  return mapProject(result.rows[0]);
}

export async function listLegacyConfigurableDataProjects(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
): Promise<ProjectRow[]> {
  const result = await pool.query(
    `select p.id, p.public_id, p.workspace_id, p.name, p.key, p.description, p.status, p.row_version,
            p.archived_at
     from projects p join workspaces w on w.id = p.workspace_id
     where p.workspace_id = $1 and w.organization_id = $2 and p.system = false
       and project_visible_to(p.id,$1,$2,$3,$4)
       and exists (select 1 from object_types o where o.project_id = p.id)
     order by p.name, p.id`,
    [workspaceId, actor.organizationId, actor.actorId, actor.role],
  );
  return result.rows.map(mapProject);
}

export async function ensureWorkspaceDataProject(
  pool: Pool,
  actor: ActorSession,
  workspaceId: string,
  requestId: string,
): Promise<ProjectRow> {
  return transaction(pool, async (client) => {
    await assertWorkspaceScope(client, actor, workspaceId);
    const existing = await client.query(
      `select id, public_id, workspace_id, name, key, description, status, row_version, archived_at
       from projects where workspace_id = $1 and system = true`,
      [workspaceId],
    );
    if (existing.rows[0]) return mapProject(existing.rows[0]);

    const id = uuidv7();
    const inserted = await client.query(
      `insert into projects
         (id, public_id, workspace_id, name, key, description, system, created_by)
       values ($1, $2, $3, 'Workspace data', '__WORKSPACE_DATA__',
               'Internal backing scope for workspace-shared tables.', true, $4)
       on conflict do nothing
       returning id, public_id, workspace_id, name, key, description, status, row_version, archived_at`,
      [id, generateBasePublicId(), workspaceId, actor.actorId],
    );
    const project =
      inserted.rows[0] ??
      (
        await client.query(
          `select id, public_id, workspace_id, name, key, description, status, row_version, archived_at
           from projects where workspace_id = $1 and system = true`,
          [workspaceId],
        )
      ).rows[0];
    if (!project)
      throw new RepositoryError(
        'WORKSPACE_DATA_UNAVAILABLE',
        500,
        'Workspace data scope could not be initialized.',
      );
    if (inserted.rows[0]) {
      await appendAudit(client, {
        organizationId: actor.organizationId,
        workspaceId,
        actorId: actor.actorId,
        action: 'workspace.data_initialized',
        targetType: 'project',
        targetId: id,
        requestId,
      });
    }
    return mapProject(project);
  });
}

export async function createProject(
  pool: Pool,
  actor: ActorSession,
  input: {
    workspaceId: string;
    name: string;
    key: string;
    description?: string;
    visibility?: 'workspace' | 'restricted';
    requestId: string;
  },
): Promise<ProjectRow> {
  return transaction(pool, async (client) => {
    await assertWorkspaceScope(client, actor, input.workspaceId);
    const id = uuidv7();
    const result = await client.query(
      `insert into projects
         (id, public_id, workspace_id, name, key, description, visibility, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, public_id, workspace_id, name, key, description, status, row_version, archived_at`,
      [
        id,
        generateBasePublicId(),
        input.workspaceId,
        input.name.trim(),
        input.key.trim().toUpperCase(),
        input.description ?? '',
        input.visibility ?? 'workspace',
        actor.actorId,
      ],
    );
    await seedDefaultTaskWorkflow(client, id, actor.actorId);
    await appendAudit(client, {
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
      projectId: id,
      actorId: actor.actorId,
      action: 'project.created',
      targetType: 'project',
      targetId: id,
      requestId: input.requestId,
    });
    return mapProject(result.rows[0]);
  });
}

export async function updateProject(
  pool: Pool,
  actor: ActorSession,
  input: {
    workspaceId: string;
    projectId: string;
    name: string;
    description: string;
    status: string;
    rowVersion: number;
    requestId: string;
  },
): Promise<ProjectRow> {
  return transaction(pool, async (client) => {
    await assertWorkspaceScope(client, actor, input.workspaceId);
    const result = await client.query(
      `update projects set name = $4, description = $5, status = $6,
          row_version = row_version + 1, updated_at = now()
       where id = $1 and workspace_id = $2 and row_version = $3 and system = false
         and project_visible_to(id,$2,$7,$8,$9)
       returning id, public_id, workspace_id, name, key, description, status, row_version, archived_at`,
      [
        input.projectId,
        input.workspaceId,
        input.rowVersion,
        input.name.trim(),
        input.description,
        input.status,
        actor.organizationId,
        actor.actorId,
        actor.role,
      ],
    );
    if (!result.rows[0]) {
      const exists = await client.query(
        `select 1 from projects where id = $1 and workspace_id = $2 and system = false
           and project_visible_to(id,$2,$3,$4,$5)`,
        [input.projectId, input.workspaceId, actor.organizationId, actor.actorId, actor.role],
      );
      throw new RepositoryError(
        exists.rowCount ? 'VERSION_CONFLICT' : 'PROJECT_NOT_FOUND',
        exists.rowCount ? 409 : 404,
        exists.rowCount ? 'The project changed; reload and retry.' : 'Project was not found.',
      );
    }
    await appendAudit(client, {
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: actor.actorId,
      action: 'project.updated',
      targetType: 'project',
      targetId: input.projectId,
      requestId: input.requestId,
      payload: { rowVersion: input.rowVersion + 1 },
    });
    return mapProject(result.rows[0]);
  });
}

export async function setProjectArchived(
  pool: Pool,
  actor: ActorSession,
  input: {
    workspaceId: string;
    projectId: string;
    archived: boolean;
    reason?: string;
    requestId: string;
  },
): Promise<ProjectRow> {
  return transaction(pool, async (client) => {
    await assertWorkspaceScope(client, actor, input.workspaceId);
    const result = await client.query(
      `update projects
       set archived_at = case when $4::boolean then now() else null end,
           archived_by = case when $4::boolean then $3::uuid else null end,
           archive_reason = case when $4::boolean then $5::text else null end,
           row_version = row_version + 1, updated_at = now()
       where id = $1 and workspace_id = $2 and system = false
         and project_visible_to(id,$2,$6,$3,$7)
       returning id, public_id, workspace_id, name, key, description, status, row_version, archived_at`,
      [
        input.projectId,
        input.workspaceId,
        actor.actorId,
        input.archived,
        input.reason ?? null,
        actor.organizationId,
        actor.role,
      ],
    );
    if (!result.rows[0])
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    await appendAudit(client, {
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: actor.actorId,
      action: input.archived ? 'project.archived' : 'project.restored',
      targetType: 'project',
      targetId: input.projectId,
      requestId: input.requestId,
      payload: input.archived ? { reason: input.reason ?? null } : {},
    });
    return mapProject(result.rows[0]);
  });
}

export interface MemberRow {
  userId: string;
  email: string;
  displayName: string;
  role: MemberRole;
}

export interface MemberPage {
  items: MemberRow[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  overallTotal: number;
}

export async function listMemberPage(
  pool: Pool,
  actor: ActorSession,
  options: { query?: string; limit?: number; offset?: number } = {},
): Promise<MemberPage> {
  const query = (options.query ?? '').normalize('NFKC').trim();
  const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.min(Math.max(options.offset ?? 0, 0), 1_000_000);
  const matches = `($2::text = ''
    or u.display_name ilike '%' || $3 || '%' escape '\\'
    or u.email ilike '%' || $3 || '%' escape '\\'
    or m.role::text ilike '%' || $3 || '%' escape '\\')`;
  const [items, count] = await Promise.all([
    pool.query<{
      user_id: string;
      email: string;
      display_name: string;
      role: MemberRole;
    }>(
      `select m.user_id, u.email, u.display_name, m.role
       from memberships m join users u on u.id = m.user_id
       where m.organization_id = $1 and ${matches}
       order by lower(u.display_name), lower(u.email), u.id limit $4 offset $5`,
      [actor.organizationId, query, escapedQuery, limit, offset],
    ),
    pool.query<{ total: string; overall_total: string }>(
      `select count(*) filter (where ${matches})::text total,
              count(*)::text overall_total
       from memberships m join users u on u.id = m.user_id
       where m.organization_id = $1`,
      [actor.organizationId, query, escapedQuery],
    ),
  ]);
  const total = Number(count.rows[0]?.total ?? 0);
  const overallTotal = Number(count.rows[0]?.overall_total ?? 0);
  return {
    items: items.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
    })),
    pageInfo: { limit, offset, total, hasNext: offset + items.rows.length < total },
    overallTotal,
  };
}

export async function updateMemberRole(
  pool: Pool,
  actor: ActorSession,
  userId: string,
  role: MemberRole,
  requestId: string,
): Promise<void> {
  await transaction(pool, async (client) => {
    const current = await client.query<{ role: MemberRole }>(
      'select role from memberships where organization_id = $1 and user_id = $2 for update',
      [actor.organizationId, userId],
    );
    if (!current.rows[0])
      throw new RepositoryError('MEMBER_NOT_FOUND', 404, 'Member was not found.');
    if (current.rows[0].role === 'owner' && role !== 'owner') {
      const owners = await client.query<{ count: string }>(
        "select count(*)::text as count from memberships where organization_id = $1 and role = 'owner'",
        [actor.organizationId],
      );
      if (Number(owners.rows[0]?.count) <= 1) {
        throw new RepositoryError('LAST_OWNER_REQUIRED', 409, 'The last Owner cannot be demoted.');
      }
    }
    await client.query(
      'update memberships set role = $3, updated_at = now() where organization_id = $1 and user_id = $2',
      [actor.organizationId, userId, role],
    );
    await appendAudit(client, {
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: 'membership.role_changed',
      targetType: 'user',
      targetId: userId,
      requestId,
      payload: { from: current.rows[0].role, to: role },
    });
  });
}

export async function updateMemberRoles(
  pool: Pool,
  actor: ActorSession,
  memberIds: string[],
  role: MemberRole,
  requestId: string,
): Promise<number> {
  const uniqueMemberIds = [...new Set(memberIds)];
  if (uniqueMemberIds.length === 0) return 0;
  return transaction(pool, async (client) => {
    const organizationMembers = await client.query<{ user_id: string; role: MemberRole }>(
      `select user_id, role from memberships
       where organization_id = $1
       order by user_id for update`,
      [actor.organizationId],
    );
    const requested = new Set(uniqueMemberIds);
    const current = organizationMembers.rows.filter((member) => requested.has(member.user_id));
    if (current.length !== uniqueMemberIds.length) {
      throw new RepositoryError('MEMBER_NOT_FOUND', 404, 'One or more members were not found.');
    }

    if (role !== 'owner') {
      const ownerCount = organizationMembers.rows.filter(
        (member) => member.role === 'owner',
      ).length;
      const selectedOwnerCount = current.filter((member) => member.role === 'owner').length;
      if (ownerCount - selectedOwnerCount <= 0) {
        throw new RepositoryError('LAST_OWNER_REQUIRED', 409, 'The last Owner cannot be demoted.');
      }
    }

    const changed = current.filter((member) => member.role !== role);
    if (changed.length === 0) return 0;
    await client.query(
      `update memberships set role = $3, updated_at = now()
       where organization_id = $1 and user_id = any($2::uuid[])`,
      [actor.organizationId, changed.map((member) => member.user_id), role],
    );
    await appendAudit(client, {
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: 'membership.roles_changed',
      targetType: 'organization',
      targetId: actor.organizationId,
      requestId,
      payload: {
        memberIds: changed.map((member) => member.user_id),
        from: Object.fromEntries(changed.map((member) => [member.user_id, member.role])),
        to: role,
      },
    });
    return changed.length;
  });
}

export type MemberGroupColor = 'slate' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet';

export interface MemberGroupRow {
  id: string;
  name: string;
  description: string;
  color: MemberGroupColor;
  memberIds: string[];
  updatedAt: string;
}

export interface MemberGroupPage {
  items: MemberGroupRow[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  overallTotal: number;
}

export type OwnMemberGroupRow = Omit<MemberGroupRow, 'memberIds'>;

function mapMemberGroupConflict(error: unknown): never {
  if (
    typeof error === 'object' &&
    error &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'member_groups_active_organization_name_key'
  ) {
    throw new RepositoryError(
      'MEMBER_GROUP_NAME_CONFLICT',
      409,
      'An active group already uses this name.',
    );
  }
  throw error;
}

export async function listMemberGroupPage(
  pool: Pool,
  actor: ActorSession,
  options: { query?: string; limit?: number; offset?: number } = {},
): Promise<MemberGroupPage> {
  const query = (options.query ?? '').normalize('NFKC').trim();
  const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.min(Math.max(options.offset ?? 0, 0), 1_000_000);
  const matches = `($2::text = ''
    or g.name ilike '%' || $3 || '%' escape '\\'
    or g.description ilike '%' || $3 || '%' escape '\\')`;
  const [items, count] = await Promise.all([
    pool.query<{
      id: string;
      name: string;
      description: string;
      color: MemberGroupColor;
      member_ids: string[];
      updated_at: Date;
    }>(
      `select g.id, g.name, g.description, g.color, g.updated_at,
              coalesce(array_agg(gm.user_id order by gm.user_id)
                filter (where gm.user_id is not null), '{}') as member_ids
       from member_groups g
       left join member_group_memberships gm
         on gm.organization_id = g.organization_id and gm.group_id = g.id
       where g.organization_id = $1 and g.archived_at is null and ${matches}
       group by g.id
       order by lower(g.name), g.id limit $4 offset $5`,
      [actor.organizationId, query, escapedQuery, limit, offset],
    ),
    pool.query<{ total: string; overall_total: string }>(
      `select count(*) filter (where ${matches})::text total,
              count(*)::text overall_total
       from member_groups g
       where g.organization_id = $1 and g.archived_at is null`,
      [actor.organizationId, query, escapedQuery],
    ),
  ]);
  const total = Number(count.rows[0]?.total ?? 0);
  const overallTotal = Number(count.rows[0]?.overall_total ?? 0);
  return {
    items: items.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      color: row.color,
      memberIds: row.member_ids,
      updatedAt: row.updated_at.toISOString(),
    })),
    pageInfo: { limit, offset, total, hasNext: offset + items.rows.length < total },
    overallTotal,
  };
}

export async function listOwnMemberGroups(
  pool: Pool,
  actor: ActorSession,
): Promise<OwnMemberGroupRow[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    description: string;
    color: MemberGroupColor;
    updated_at: Date;
  }>(
    `select g.id, g.name, g.description, g.color, g.updated_at
     from member_groups g
     join member_group_memberships gm
       on gm.organization_id = g.organization_id and gm.group_id = g.id
     where g.organization_id = $1 and gm.user_id = $2 and g.archived_at is null
     order by lower(g.name), g.id`,
    [actor.organizationId, actor.actorId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function createMemberGroup(
  pool: Pool,
  actor: ActorSession,
  input: { name: string; description: string; color: MemberGroupColor; requestId: string },
): Promise<MemberGroupRow> {
  try {
    return await transaction(pool, async (client) => {
      const id = uuidv7();
      const result = await client.query<{
        id: string;
        name: string;
        description: string;
        color: MemberGroupColor;
        updated_at: Date;
      }>(
        `insert into member_groups (id, organization_id, name, description, color, created_by)
         values ($1, $2, $3, $4, $5, $6)
         returning id, name, description, color, updated_at`,
        [
          id,
          actor.organizationId,
          input.name.trim(),
          input.description.trim(),
          input.color,
          actor.actorId,
        ],
      );
      await appendAudit(client, {
        organizationId: actor.organizationId,
        actorId: actor.actorId,
        action: 'member_group.created',
        targetType: 'member_group',
        targetId: id,
        requestId: input.requestId,
        payload: { name: input.name.trim(), color: input.color },
      });
      const row = result.rows[0]!;
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        color: row.color,
        memberIds: [],
        updatedAt: row.updated_at.toISOString(),
      };
    });
  } catch (error) {
    return mapMemberGroupConflict(error);
  }
}

export async function updateMemberGroup(
  pool: Pool,
  actor: ActorSession,
  input: {
    groupId: string;
    name: string;
    description: string;
    color: MemberGroupColor;
    requestId: string;
  },
): Promise<void> {
  try {
    await transaction(pool, async (client) => {
      const current = await client.query<{ name: string; description: string; color: string }>(
        `select name, description, color from member_groups
         where organization_id = $1 and id = $2 and archived_at is null for update`,
        [actor.organizationId, input.groupId],
      );
      if (!current.rows[0])
        throw new RepositoryError('MEMBER_GROUP_NOT_FOUND', 404, 'Group was not found.');
      await client.query(
        `update member_groups set name = $3, description = $4, color = $5, updated_at = now()
         where organization_id = $1 and id = $2`,
        [
          actor.organizationId,
          input.groupId,
          input.name.trim(),
          input.description.trim(),
          input.color,
        ],
      );
      await appendAudit(client, {
        organizationId: actor.organizationId,
        actorId: actor.actorId,
        action: 'member_group.updated',
        targetType: 'member_group',
        targetId: input.groupId,
        requestId: input.requestId,
        payload: {
          from: current.rows[0],
          to: {
            name: input.name.trim(),
            description: input.description.trim(),
            color: input.color,
          },
        },
      });
    });
  } catch (error) {
    return mapMemberGroupConflict(error);
  }
}

export async function replaceMemberGroupMembers(
  pool: Pool,
  actor: ActorSession,
  input: { groupId: string; memberIds: string[]; requestId: string },
): Promise<void> {
  await transaction(pool, async (client) => {
    const group = await client.query(
      `select 1 from member_groups
       where organization_id = $1 and id = $2 and archived_at is null for update`,
      [actor.organizationId, input.groupId],
    );
    if (!group.rowCount)
      throw new RepositoryError('MEMBER_GROUP_NOT_FOUND', 404, 'Group was not found.');
    const uniqueMemberIds = [...new Set(input.memberIds)];
    const available = uniqueMemberIds.length
      ? await client.query<{ user_id: string }>(
          `select user_id from memberships
           where organization_id = $1 and user_id = any($2::uuid[])`,
          [actor.organizationId, uniqueMemberIds],
        )
      : { rows: [] };
    if (available.rows.length !== uniqueMemberIds.length) {
      throw new RepositoryError(
        'MEMBER_GROUP_MEMBER_NOT_FOUND',
        404,
        'One or more selected members are unavailable.',
      );
    }
    const previous = await client.query<{ user_id: string }>(
      `select user_id from member_group_memberships
       where organization_id = $1 and group_id = $2 order by user_id`,
      [actor.organizationId, input.groupId],
    );
    await client.query(
      'delete from member_group_memberships where organization_id = $1 and group_id = $2',
      [actor.organizationId, input.groupId],
    );
    for (const memberId of uniqueMemberIds) {
      await client.query(
        `insert into member_group_memberships
          (id, organization_id, group_id, user_id, assigned_by)
         values ($1, $2, $3, $4, $5)`,
        [uuidv7(), actor.organizationId, input.groupId, memberId, actor.actorId],
      );
    }
    await appendAudit(client, {
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: 'member_group.members_replaced',
      targetType: 'member_group',
      targetId: input.groupId,
      requestId: input.requestId,
      payload: {
        previousMemberIds: previous.rows.map((row) => row.user_id),
        memberIds: uniqueMemberIds,
      },
    });
  });
}

export async function archiveMemberGroup(
  pool: Pool,
  actor: ActorSession,
  groupId: string,
  requestId: string,
): Promise<void> {
  await transaction(pool, async (client) => {
    const result = await client.query<{ name: string }>(
      `update member_groups set archived_at = now(), archived_by = $3, updated_at = now()
       where organization_id = $1 and id = $2 and archived_at is null returning name`,
      [actor.organizationId, groupId, actor.actorId],
    );
    if (!result.rows[0])
      throw new RepositoryError('MEMBER_GROUP_NOT_FOUND', 404, 'Group was not found.');
    await appendAudit(client, {
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: 'member_group.archived',
      targetType: 'member_group',
      targetId: groupId,
      requestId,
      payload: { name: result.rows[0].name },
    });
  });
}

export interface AuditEventRow {
  id: string;
  workspaceId: string | null;
  projectId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  requestId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditEventPage {
  items: AuditEventRow[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
}

export async function listAuditEventPage(
  pool: Pool,
  actor: ActorSession,
  options: { query?: string; limit?: number; offset?: number } = {},
): Promise<AuditEventPage> {
  const query = (options.query ?? '').normalize('NFKC').trim();
  const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const offset = Math.min(Math.max(options.offset ?? 0, 0), 1_000_000);
  const matches = `($2 = ''
    or e.action ilike '%' || $3 || '%' escape '\\'
    or e.target_type ilike '%' || $3 || '%' escape '\\'
    or coalesce(e.target_id::text,'') ilike '%' || $3 || '%' escape '\\'
    or e.request_id ilike '%' || $3 || '%' escape '\\'
    or coalesce(u.display_name,'') ilike '%' || $3 || '%' escape '\\'
    or coalesce(u.email,'') ilike '%' || $3 || '%' escape '\\')`;
  const [items, count] = await Promise.all([
    pool.query<AuditEventRow>(
      `select e.id, e.workspace_id as "workspaceId", e.project_id as "projectId",
              e.actor_id as "actorId", u.display_name as "actorName", u.email as "actorEmail",
              e.action, e.target_type as "targetType", e.target_id as "targetId",
              e.request_id as "requestId", e.payload, e.created_at as "createdAt"
       from audit_events e
       left join users u on u.id = e.actor_id
       where e.organization_id = $1 and ${matches}
       order by e.created_at desc, e.id desc limit $4 offset $5`,
      [actor.organizationId, query, escapedQuery, limit, offset],
    ),
    pool.query<{ total: string }>(
      `select count(*)::text total from audit_events e
       left join users u on u.id = e.actor_id
       where e.organization_id = $1 and ${matches}`,
      [actor.organizationId, query, escapedQuery],
    ),
  ]);
  const total = Number(count.rows[0]?.total ?? 0);
  return {
    items: items.rows,
    pageInfo: { limit, offset, total, hasNext: offset + items.rows.length < total },
  };
}
