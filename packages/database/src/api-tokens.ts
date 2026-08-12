import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { appendAudit, type ActorSession, type MemberRole } from './community.js';
import { RepositoryError } from './errors.js';

export type ApiTokenAccessLevel = 'read' | 'write';
export const apiTokenScopes = [
  'workspace',
  'project',
  'data',
  'tasks',
  'schedule',
  'reviews',
] as const;
export type ApiTokenScope = (typeof apiTokenScopes)[number];

export interface ApiTokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  accessLevel: ApiTokenAccessLevel;
  scopes: ApiTokenScope[];
  workspaceId: string | null;
  workspaceName: string | null;
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface IssuedApiToken extends ApiTokenRow {
  token: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function createTokenSecret(): string {
  return `eng_pat_${randomBytes(32).toString('base64url')}`;
}

function mapToken(row: {
  id: string;
  name: string;
  token_prefix: string;
  access_level: ApiTokenAccessLevel;
  scopes: ApiTokenScope[] | null;
  workspace_id: string | null;
  workspace_name: string | null;
  expires_at: Date;
  last_used_at: Date | null;
  created_at: Date;
}): ApiTokenRow {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    accessLevel: row.access_level,
    scopes: row.scopes ?? [...apiTokenScopes],
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    expiresAt: row.expires_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin isolation level serializable');
    const result = await action(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function mapTokenConflict(error: unknown): never {
  if (
    typeof error === 'object' &&
    error &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'api_tokens_active_user_name_key'
  ) {
    throw new RepositoryError(
      'API_TOKEN_NAME_CONFLICT',
      409,
      'An active API token already uses this name.',
    );
  }
  throw error;
}

export async function listApiTokens(pool: Pool, actor: ActorSession): Promise<ApiTokenRow[]> {
  const result = await pool.query(
    `select t.id, t.name, t.token_prefix, t.access_level, t.scopes, t.workspace_id,
            w.name as workspace_name, t.expires_at, t.last_used_at, t.created_at
     from api_tokens t
     left join workspaces w on w.id = t.workspace_id and w.organization_id = t.organization_id
     where t.organization_id = $1 and t.user_id = $2 and t.revoked_at is null
       and t.expires_at > now()
     order by t.created_at desc, t.id desc`,
    [actor.organizationId, actor.actorId],
  );
  return result.rows.map(mapToken);
}

export async function issueApiToken(
  pool: Pool,
  actor: ActorSession,
  input: {
    name: string;
    accessLevel: ApiTokenAccessLevel;
    scopes?: ApiTokenScope[];
    workspaceId?: string;
    expiresInDays: 30 | 90 | 365;
    requestId: string;
  },
): Promise<IssuedApiToken> {
  try {
    return await transaction(pool, async (client) => {
      await client.query(
        `update api_tokens set revoked_at = now(), revoked_reason = 'expired'
         where organization_id = $1 and user_id = $2 and revoked_at is null and expires_at <= now()`,
        [actor.organizationId, actor.actorId],
      );
      const active = await client.query<{ count: string }>(
        `select count(*)::text as count from api_tokens
         where organization_id = $1 and user_id = $2 and revoked_at is null and expires_at > now()`,
        [actor.organizationId, actor.actorId],
      );
      if (Number(active.rows[0]?.count ?? 0) >= 20) {
        throw new RepositoryError(
          'API_TOKEN_LIMIT_REACHED',
          409,
          'Revoke an existing API token before creating another.',
        );
      }
      if (input.workspaceId) {
        const workspace = await client.query(
          'select 1 from workspaces where organization_id = $1 and id = $2 and archived_at is null',
          [actor.organizationId, input.workspaceId],
        );
        if (!workspace.rowCount) {
          throw new RepositoryError('WORKSPACE_NOT_FOUND', 404, 'Workspace was not found.');
        }
      }

      const id = uuidv7();
      const token = createTokenSecret();
      const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
      const result = await client.query(
        `with inserted as (
          insert into api_tokens
            (id, organization_id, user_id, workspace_id, name, token_prefix, token_hash,
             access_level, scopes, expires_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          returning id, name, token_prefix, access_level, scopes, workspace_id, expires_at,
                    last_used_at, created_at
         )
         select inserted.*, w.name as workspace_name from inserted
         left join workspaces w on w.id = inserted.workspace_id`,
        [
          id,
          actor.organizationId,
          actor.actorId,
          input.workspaceId ?? null,
          input.name.trim(),
          token.slice(0, 16),
          digest(token),
          input.accessLevel,
          input.scopes ?? [...apiTokenScopes],
          expiresAt,
        ],
      );
      await appendAudit(client, {
        organizationId: actor.organizationId,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        actorId: actor.actorId,
        action: 'api_token.created',
        targetType: 'api_token',
        targetId: id,
        requestId: input.requestId,
        payload: {
          name: input.name.trim(),
          accessLevel: input.accessLevel,
          scopes: input.scopes ?? [...apiTokenScopes],
          expiresInDays: input.expiresInDays,
        },
      });
      const row = result.rows[0];
      return {
        ...mapToken(row),
        token,
      };
    });
  } catch (error) {
    return mapTokenConflict(error);
  }
}

export async function revokeApiToken(
  pool: Pool,
  actor: ActorSession,
  tokenId: string,
  requestId: string,
): Promise<void> {
  await transaction(pool, async (client) => {
    const result = await client.query<{ name: string }>(
      `update api_tokens
       set revoked_at = now(), revoked_reason = 'user_revoked'
       where id = $1 and organization_id = $2 and user_id = $3 and revoked_at is null
       returning name`,
      [tokenId, actor.organizationId, actor.actorId],
    );
    if (!result.rows[0]) {
      throw new RepositoryError('API_TOKEN_NOT_FOUND', 404, 'API token was not found.');
    }
    await appendAudit(client, {
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action: 'api_token.revoked',
      targetType: 'api_token',
      targetId: tokenId,
      requestId,
      payload: { name: result.rows[0].name },
    });
  });
}

export async function revokeUserApiTokens(
  client: PoolClient,
  userId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `update api_tokens
     set revoked_at = coalesce(revoked_at, now()), revoked_reason = coalesce(revoked_reason, $2)
     where user_id = $1 and revoked_at is null`,
    [userId, reason],
  );
}

export async function authenticateApiToken(
  pool: Pool,
  token: string,
): Promise<ActorSession | undefined> {
  if (!token.startsWith('eng_pat_') || token.length < 48) return undefined;
  const result = await pool.query<{
    token_id: string;
    user_id: string;
    organization_id: string;
    role: MemberRole;
    email: string;
    display_name: string;
    access_level: ApiTokenAccessLevel;
    scopes: ApiTokenScope[] | null;
    workspace_id: string | null;
  }>(
    `select t.id as token_id, u.id as user_id, m.organization_id, m.role, u.email,
            u.display_name, t.access_level, t.scopes, t.workspace_id
     from api_tokens t
     join users u on u.id = t.user_id
     join memberships m on m.user_id = u.id and m.organization_id = t.organization_id
     where t.token_hash = $1 and t.revoked_at is null and t.expires_at > now()
       and u.disabled_at is null`,
    [digest(token)],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  await pool.query(
    `update api_tokens set last_used_at = now()
     where id = $1 and (last_used_at is null or last_used_at < now() - interval '5 minutes')`,
    [row.token_id],
  );
  return {
    sessionId: '',
    actorId: row.user_id,
    organizationId: row.organization_id,
    role: row.role,
    email: row.email,
    displayName: row.display_name,
    csrfTokenHash: '',
    authenticationType: 'api_token',
    apiTokenId: row.token_id,
    apiTokenAccessLevel: row.access_level,
    apiTokenScopes: row.scopes,
    apiTokenWorkspaceId: row.workspace_id,
  };
}
