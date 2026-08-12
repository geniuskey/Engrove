import { describe, expect, it, vi } from 'vitest';
import { parseOidcIdentityClaims, resolveOidcUser, safeOidcReturnTo } from './oidc.controller.js';

const claimConfig = {
  OIDC_EMAIL_CLAIM: 'email',
  OIDC_NAME_CLAIM: 'name',
  OIDC_ALLOWED_DOMAINS: ['example.com'],
};

describe('OIDC identity claims', () => {
  it.each([undefined, false, 'true'])(
    'rejects an email unless email_verified is the boolean true (%s)',
    (emailVerified) => {
      expect(() =>
        parseOidcIdentityClaims(
          {
            iss: 'https://identity.example.com',
            sub: 'subject-1',
            email: 'member@example.com',
            email_verified: emailVerified,
          },
          claimConfig,
        ),
      ).toThrow(expect.objectContaining({ status: 403 }));
    },
  );

  it('accepts a verified email and retains the stable issuer and subject', () => {
    expect(
      parseOidcIdentityClaims(
        {
          iss: 'https://identity.example.com',
          sub: 'subject-1',
          email: 'Member@Example.com',
          email_verified: true,
          name: 'Member',
        },
        claimConfig,
      ),
    ).toEqual({
      issuer: 'https://identity.example.com',
      subject: 'subject-1',
      email: 'member@example.com',
      displayName: 'Member',
    });
  });
});

describe('OIDC return path', () => {
  it('preserves an internal deep link including query and hash', () => {
    expect(safeOidcReturnTo('/workspaces/w1/projects/p1/tasks?view=list#task-1')).toBe(
      '/workspaces/w1/projects/p1/tasks?view=list#task-1',
    );
  });

  it.each([
    undefined,
    'https://attacker.example/path',
    '//attacker.example/path',
    '/\\attacker.example/path',
    '/sign-in',
    `/workspaces/${'x'.repeat(2048)}`,
  ])('falls back instead of redirecting to an unsafe or auth path (%s)', (value) => {
    expect(safeOidcReturnTo(value)).toBe('/workspaces');
  });
});

describe('OIDC identity resolution', () => {
  it('uses an existing issuer-subject link instead of relinking by a changed email', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('from oidc_identities'))
        return {
          rows: [{ user_id: 'user-1', disabled_at: null, has_membership: true }],
        };
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = { connect: vi.fn(async () => ({ query, release })) };

    await expect(
      resolveOidcUser(
        pool as never,
        'organization-1',
        { OIDC_AUTO_PROVISION: true, OIDC_DEFAULT_ROLE: 'viewer' },
        {
          issuer: 'https://identity.example.com',
          subject: 'subject-1',
          email: 'new-address@example.com',
        },
      ),
    ).resolves.toBe('user-1');
    expect(query.mock.calls.some(([statement]) => statement.includes('lower(u.email)'))).toBe(
      false,
    );
    expect(query.mock.calls.some(([statement]) => statement === 'commit')).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });
});
