import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actorAllowsAction,
  apiTokenAllowsAction,
  apiTokenAllowsWorkspace,
  applyAuthenticationRateLimit,
  authenticationRateLimitKeys,
  authenticationRateLimits,
  verifiedClientIp,
} from './community.controller.js';

const apiTokenActor = {
  sessionId: '',
  actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'owner' as const,
  email: 'owner@example.com',
  displayName: 'Owner',
  csrfTokenHash: '',
  authenticationType: 'api_token' as const,
  apiTokenAccessLevel: 'read' as const,
};

const request = (ip: string, remoteAddress = ip) =>
  ({ ip, socket: { remoteAddress } }) as unknown as Request;

afterEach(() => vi.restoreAllMocks());

describe('authentication rate limiting', () => {
  it('uses the trusted-proxy-resolved and normalized client address', () => {
    expect(verifiedClientIp(request('::ffff:192.0.2.12'))).toBe('192.0.2.12');
    expect(verifiedClientIp(request('2001:0db8:0:0::1'))).toBe('2001:db8::1');
    expect(verifiedClientIp(request('not-an-ip', '198.51.100.7'))).toBe('198.51.100.7');
  });

  it('shares global and IP buckets while isolating account buckets', () => {
    const first = authenticationRateLimitKeys(
      request('198.51.100.7'),
      'sign-in',
      'First@Example.com',
    );
    const second = authenticationRateLimitKeys(
      request('198.51.100.7'),
      'sign-in',
      'second@example.com',
    );
    expect(first[0]).toBe(second[0]);
    expect(first[1]).toBe(second[1]);
    expect(first[2]).not.toBe(second[2]);
    expect(first.join(':')).not.toContain('First@Example.com');
  });

  it('enforces all three buckets atomically and keeps the IP ceiling above the account ceiling', async () => {
    const evalCommand = vi.fn().mockResolvedValue([1, 1, 13]);
    const runtime = {
      redis: { status: 'ready', eval: evalCommand },
    } as never;

    await expect(
      applyAuthenticationRateLimit(
        runtime,
        request('198.51.100.7'),
        'member@example.com',
        authenticationRateLimits.signIn,
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(authenticationRateLimits.signIn.clientIpLimit).toBeGreaterThan(
      authenticationRateLimits.signIn.accountLimit,
    );
    expect(evalCommand).toHaveBeenCalledOnce();
    expect(evalCommand.mock.calls[0]?.[1]).toBe(3);
  });

  it('does not let one account exhaust the lower account bucket for peers behind its IP', async () => {
    const values = new Map<string, number>();
    const evalCommand = vi.fn(async (_script: string, _keyCount: number, ...args: unknown[]) =>
      args.slice(0, 3).map((key) => {
        const next = (values.get(String(key)) ?? 0) + 1;
        values.set(String(key), next);
        return next;
      }),
    );
    const runtime = { redis: { status: 'ready', eval: evalCommand } } as never;

    for (let attempt = 0; attempt < authenticationRateLimits.signIn.accountLimit; attempt += 1)
      await expect(
        applyAuthenticationRateLimit(
          runtime,
          request('198.51.100.7'),
          'first@example.com',
          authenticationRateLimits.signIn,
        ),
      ).resolves.toBeUndefined();
    await expect(
      applyAuthenticationRateLimit(
        runtime,
        request('198.51.100.7'),
        'first@example.com',
        authenticationRateLimits.signIn,
      ),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      applyAuthenticationRateLimit(
        runtime,
        request('198.51.100.7'),
        'second@example.com',
        authenticationRateLimits.signIn,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('API token permission boundaries', () => {
  it('keeps read-only tokens read-only and excludes administrative capabilities', () => {
    expect(apiTokenAllowsAction(apiTokenActor, 'record.read')).toBe(true);
    expect(apiTokenAllowsAction(apiTokenActor, 'export.execute')).toBe(true);
    expect(apiTokenAllowsAction(apiTokenActor, 'record.update')).toBe(false);
    expect(apiTokenAllowsAction(apiTokenActor, 'record.comment', true)).toBe(false);
    expect(apiTokenAllowsAction(apiTokenActor, 'view.manage', true)).toBe(false);
    expect(apiTokenAllowsAction(apiTokenActor, 'schema.read', true)).toBe(false);
    expect(
      apiTokenAllowsAction({ ...apiTokenActor, apiTokenAccessLevel: 'write' }, 'record.update'),
    ).toBe(true);
    expect(
      apiTokenAllowsAction(
        { ...apiTokenActor, apiTokenAccessLevel: 'write', apiTokenScopes: ['data'] },
        'view.manage',
        true,
      ),
    ).toBe(true);
    expect(
      apiTokenAllowsAction(
        { ...apiTokenActor, apiTokenAccessLevel: 'write', apiTokenScopes: ['data'] },
        'record.comment',
        true,
      ),
    ).toBe(true);
    expect(
      apiTokenAllowsAction(
        { ...apiTokenActor, apiTokenAccessLevel: 'write', apiTokenScopes: ['data'] },
        'view.share',
        true,
      ),
    ).toBe(false);
    expect(
      apiTokenAllowsAction({ ...apiTokenActor, apiTokenAccessLevel: 'write' }, 'member.manage'),
    ).toBe(false);
    expect(
      apiTokenAllowsAction(
        { ...apiTokenActor, apiTokenAccessLevel: 'write' },
        'workspace.access.manage',
      ),
    ).toBe(false);
    expect(
      apiTokenAllowsAction(
        { ...apiTokenActor, apiTokenAccessLevel: 'write' },
        'project.access.manage',
      ),
    ).toBe(false);
    expect(
      apiTokenAllowsAction({ ...apiTokenActor, apiTokenAccessLevel: 'write' }, 'audit.read'),
    ).toBe(false);
    expect(
      apiTokenAllowsAction({ ...apiTokenActor, apiTokenAccessLevel: 'write' }, 'notification.read'),
    ).toBe(false);
    expect(
      apiTokenAllowsAction({ ...apiTokenActor, apiTokenAccessLevel: 'write' }, 'task.watch', true),
    ).toBe(false);
    expect(
      apiTokenAllowsAction(
        { ...apiTokenActor, apiTokenAccessLevel: 'write' },
        'task.personalize',
        true,
      ),
    ).toBe(false);
    expect(
      apiTokenAllowsAction(
        { ...apiTokenActor, apiTokenAccessLevel: 'write' },
        'task.automation.manage',
        true,
      ),
    ).toBe(false);
  });

  it('limits newly scoped tokens to selected product areas', () => {
    const taskToken = { ...apiTokenActor, apiTokenScopes: ['tasks'] };
    expect(apiTokenAllowsAction(taskToken, 'task.read')).toBe(true);
    expect(apiTokenAllowsAction(taskToken, 'workspace.read')).toBe(false);
    expect(apiTokenAllowsAction(taskToken, 'record.read')).toBe(false);
    expect(apiTokenAllowsAction(taskToken, 'milestone.read')).toBe(false);
    expect(actorAllowsAction(taskToken, 'task.read')).toBe(true);
    expect(actorAllowsAction(taskToken, 'project.read')).toBe(false);
    expect(
      apiTokenAllowsAction({ ...taskToken, apiTokenAccessLevel: 'write' }, 'task.create', true),
    ).toBe(true);
    expect(
      apiTokenAllowsAction(
        { ...taskToken, apiTokenAccessLevel: 'write' },
        'milestone.manage',
        true,
      ),
    ).toBe(false);
    expect(
      apiTokenAllowsAction({ ...apiTokenActor, apiTokenScopes: ['workspace'] }, 'workspace.read'),
    ).toBe(true);
  });

  it('hides workspaces outside a token scope', () => {
    const scoped = {
      ...apiTokenActor,
      apiTokenWorkspaceId: '019fbcf9-e020-71da-935a-6a6a728b3792',
    };
    expect(apiTokenAllowsWorkspace(scoped, scoped.apiTokenWorkspaceId)).toBe(true);
    expect(apiTokenAllowsWorkspace(scoped, '019fbcf9-e020-71da-935a-6a6a728b3793')).toBe(false);
    expect(apiTokenAllowsWorkspace(apiTokenActor, '019fbcf9-e020-71da-935a-6a6a728b3793')).toBe(
      true,
    );
  });
});
