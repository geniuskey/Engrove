import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  authenticateApiToken,
  issueApiToken,
  listApiTokens,
  revokeApiToken,
} from '../src/api-tokens.js';

const actor = {
  sessionId: 'session-1',
  actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'owner' as const,
  email: 'owner@example.com',
  displayName: 'Owner',
  csrfTokenHash: 'csrf',
};

describe('API token lifecycle', () => {
  it('returns token metadata without exposing stored secrets', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3792',
          name: 'Read dashboard',
          token_prefix: 'eng_pat_example',
          access_level: 'read',
          scopes: null,
          workspace_id: null,
          workspace_name: null,
          expires_at: new Date('2026-11-01T00:00:00.000Z'),
          last_used_at: null,
          created_at: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });

    const tokens = await listApiTokens({ query } as unknown as Pool, actor);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('t.token_prefix'), [
      actor.organizationId,
      actor.actorId,
    ]);
    expect(query.mock.calls[0]?.[0]).not.toContain('t.token_hash,');
    expect(tokens[0]).toMatchObject({
      name: 'Read dashboard',
      accessLevel: 'read',
      scopes: ['workspace', 'project', 'data', 'tasks', 'schedule', 'reviews'],
    });
    expect(tokens[0]).not.toHaveProperty('token');
  });

  it('stores only a digest and reveals the generated token once', async () => {
    let insertParameters: unknown[] = [];
    const query = vi.fn(async (statement: string, parameters?: unknown[]) => {
      if (statement.startsWith('begin') || statement === 'commit' || statement === 'rollback') {
        return { rows: [] };
      }
      if (statement.includes("revoked_reason = 'expired'")) return { rows: [] };
      if (statement.includes('select count(*)')) return { rows: [{ count: '0' }] };
      if (statement.includes('insert into api_tokens')) {
        insertParameters = parameters ?? [];
        return {
          rows: [
            {
              id: parameters?.[0],
              name: parameters?.[4],
              token_prefix: parameters?.[5],
              access_level: parameters?.[7],
              scopes: parameters?.[8],
              workspace_id: null,
              workspace_name: null,
              expires_at: parameters?.[9],
              last_used_at: null,
              created_at: new Date('2026-08-01T00:00:00.000Z'),
            },
          ],
        };
      }
      if (statement.includes('insert into audit_events')) return { rows: [] };
      throw new Error(`Unexpected query: ${statement}`);
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    const issued = await issueApiToken(pool, actor, {
      name: 'CI export',
      accessLevel: 'read',
      scopes: ['workspace', 'data'],
      expiresInDays: 90,
      requestId: 'request-1',
    });

    expect(issued.token).toMatch(/^eng_pat_[A-Za-z0-9_-]{43}$/);
    expect(insertParameters[5]).toBe(issued.tokenPrefix);
    expect(insertParameters[6]).toMatch(/^[a-f0-9]{64}$/);
    expect(insertParameters[6]).not.toBe(issued.token);
    expect(insertParameters[8]).toEqual(['workspace', 'data']);
    expect(JSON.stringify(query.mock.calls)).not.toContain(issued.token);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('authenticates active tokens and carries least-privilege scope into the actor', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            token_id: '019fbcf9-e020-71da-935a-6a6a728b3792',
            user_id: actor.actorId,
            organization_id: actor.organizationId,
            role: 'engineer',
            email: actor.email,
            display_name: actor.displayName,
            access_level: 'read',
            scopes: ['tasks'],
            workspace_id: '019fbcf9-e020-71da-935a-6a6a728b3793',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const token = `eng_pat_${'a'.repeat(43)}`;

    const authenticated = await authenticateApiToken({ query } as unknown as Pool, token);

    expect(query.mock.calls[0]?.[1]?.[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(query.mock.calls[0]?.[1]?.[0]).not.toBe(token);
    expect(authenticated).toMatchObject({
      authenticationType: 'api_token',
      apiTokenAccessLevel: 'read',
      apiTokenScopes: ['tasks'],
      apiTokenWorkspaceId: '019fbcf9-e020-71da-935a-6a6a728b3793',
      role: 'engineer',
    });
    expect(query.mock.calls[1]?.[0]).toContain("interval '5 minutes'");
  });

  it('revokes only the current user token and records the event', async () => {
    const query = vi.fn(async (statement: string, _parameters?: unknown[]) => {
      if (statement.includes('update api_tokens')) return { rows: [{ name: 'Build agent' }] };
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    await revokeApiToken(pool, actor, '019fbcf9-e020-71da-935a-6a6a728b3792', 'request-2');

    expect(query).toHaveBeenCalledWith(expect.stringContaining('user_id = $3'), [
      '019fbcf9-e020-71da-935a-6a6a728b3792',
      actor.organizationId,
      actor.actorId,
    ]);
    expect(
      query.mock.calls.some(([, parameters]) =>
        (parameters as unknown[] | undefined)?.includes('api_token.revoked'),
      ),
    ).toBe(true);
  });
});
