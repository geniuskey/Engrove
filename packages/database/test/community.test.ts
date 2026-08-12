import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  getWorkspace,
  listAuditEventPage,
  listMemberGroupPage,
  listMemberPage,
  listOwnMemberGroups,
  listProjectPage,
  listProjectOptions,
  listProjectReferences,
  listWorkspacePage,
} from '../src/community.js';

const actor = {
  sessionId: 'session-1',
  actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'viewer' as const,
  email: 'viewer@example.com',
  displayName: 'Viewer',
  csrfTokenHash: '',
};

describe('self-service member groups', () => {
  it('returns only the current user memberships without exposing member lists', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3792',
          name: 'Materials laboratory',
          description: 'Material validation team',
          color: 'emerald',
          updated_at: new Date('2026-08-07T00:00:00.000Z'),
        },
      ],
    });

    const groups = await listOwnMemberGroups({ query } as unknown as Pool, actor);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('gm.user_id = $2'), [
      actor.organizationId,
      actor.actorId,
    ]);
    expect(query.mock.calls[0]?.[0]).toContain('g.archived_at is null');
    expect(groups).toEqual([
      {
        id: '019fbcf9-e020-71da-935a-6a6a728b3792',
        name: 'Materials laboratory',
        description: 'Material validation team',
        color: 'emerald',
        updatedAt: '2026-08-07T00:00:00.000Z',
      },
    ]);
    expect(groups[0]).not.toHaveProperty('memberIds');
  });
});

describe('bounded organization directories', () => {
  it('searches and bounds the member directory with an exact total', async () => {
    const query = vi.fn(async (statement: string, _parameters?: unknown[]) =>
      statement.includes('count(*)')
        ? { rows: [{ total: '140', overall_total: '240' }] }
        : {
            rows: [
              {
                user_id: actor.actorId,
                email: actor.email,
                display_name: actor.displayName,
                role: actor.role,
              },
            ],
          },
    );

    const page = await listMemberPage({ query } as unknown as Pool, actor, {
      query: ' 100% Lab_ ',
      limit: 5_000,
      offset: 50,
    });

    expect(query.mock.calls[0]?.[0]).toContain('m.role::text ilike');
    expect(query.mock.calls[0]?.[1]).toEqual([
      actor.organizationId,
      '100% Lab_',
      '100\\% Lab\\_',
      100,
      50,
    ]);
    expect(page).toMatchObject({
      items: [expect.objectContaining({ userId: actor.actorId })],
      pageInfo: { limit: 100, offset: 50, total: 140, hasNext: true },
      overallTotal: 240,
    });
  });

  it('searches active groups and pages aggregated membership identifiers', async () => {
    const updatedAt = new Date('2026-08-08T00:00:00.000Z');
    const query = vi.fn(async (statement: string, _parameters?: unknown[]) =>
      statement.includes('count(*)')
        ? { rows: [{ total: '2', overall_total: '7' }] }
        : {
            rows: [
              {
                id: '019fbcf9-e020-71da-935a-6a6a728b3792',
                name: 'Materials 100% lab_',
                description: 'Qualification',
                color: 'emerald',
                member_ids: [actor.actorId],
                updated_at: updatedAt,
              },
            ],
          },
    );

    const page = await listMemberGroupPage({ query } as unknown as Pool, actor, {
      query: '100% lab_',
      limit: 1,
    });

    expect(query.mock.calls[0]?.[0]).toContain('g.archived_at is null');
    expect(query.mock.calls[0]?.[1]).toEqual([
      actor.organizationId,
      '100% lab_',
      '100\\% lab\\_',
      1,
      0,
    ]);
    expect(page).toEqual({
      items: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3792',
          name: 'Materials 100% lab_',
          description: 'Qualification',
          color: 'emerald',
          memberIds: [actor.actorId],
          updatedAt: updatedAt.toISOString(),
        },
      ],
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
      overallTotal: 7,
    });
  });
});

describe('audit event context', () => {
  it('includes the actor identity without weakening organization scope', async () => {
    const createdAt = new Date('2026-08-07T12:00:00.000Z');
    const event = {
      id: 'event-1',
      workspaceId: null,
      projectId: null,
      actorId: actor.actorId,
      actorName: actor.displayName,
      actorEmail: actor.email,
      action: 'project.updated',
      targetType: 'project',
      targetId: 'project-1',
      requestId: 'request-1',
      payload: {},
      createdAt,
    };
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('count(*)')) return { rows: [{ total: '26' }] };
      return { rows: [event] };
    });

    const page = await listAuditEventPage({ query } as unknown as Pool, actor, {
      query: ' project%_ ',
      limit: 25,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('left join users'), [
      actor.organizationId,
      'project%_',
      'project\\%\\_',
      25,
      0,
    ]);
    expect(query.mock.calls[0]?.[0]).toContain('where e.organization_id = $1');
    expect(page).toMatchObject({
      items: [
        {
          actorName: actor.displayName,
          actorEmail: actor.email,
          action: 'project.updated',
        },
      ],
      pageInfo: { limit: 25, offset: 0, total: 26, hasNext: true },
    });
  });
});

describe('project navigation options', () => {
  it('pages the management catalog with literal search and exact totals', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3700',
          public_id: 'p1234567890abcd',
          workspace_id: '019fbcf9-e020-71da-935a-6a6a728b3701',
          name: 'Drive 100% validation',
          key: 'DRIVE',
          description: 'Qualification project',
          status: 'active',
          row_version: 2,
          archived_at: null,
          total: 140,
          overall_total: 240,
        },
      ],
    });

    const result = await listProjectPage(
      { query } as unknown as Pool,
      actor,
      '019fbcf9-e020-71da-935a-6a6a728b3701',
      { query: '  Drive 100%_  ', archiveState: 'active', limit: 5_000, offset: 50 },
    );

    expect(query).toHaveBeenCalledWith(expect.stringContaining("$3 = 'active'"), [
      '019fbcf9-e020-71da-935a-6a6a728b3701',
      actor.organizationId,
      'active',
      'Drive 100%_',
      'Drive 100\\%\\_',
      100,
      50,
      actor.actorId,
      actor.role,
    ]);
    expect(result).toMatchObject({
      items: [{ name: 'Drive 100% validation', publicId: 'p1234567890abcd' }],
      pageInfo: { limit: 100, offset: 50, total: 140, hasNext: true },
      overallTotal: 240,
    });
  });

  it('normalizes and escapes search input while keeping the result bounded', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3700',
          public_id: 'p1234567890abcd',
          workspace_id: '019fbcf9-e020-71da-935a-6a6a728b3701',
          name: 'Drive 100% validation',
          key: 'DRIVE',
          description: '',
          status: 'active',
          row_version: 1,
          archived_at: null,
          total: 51,
        },
      ],
    });

    const result = await listProjectOptions(
      { query } as unknown as Pool,
      actor,
      '019fbcf9-e020-71da-935a-6a6a728b3701',
      '  Drive 100%_  ',
      500,
    );

    expect(query).toHaveBeenCalledWith(expect.stringContaining('p.public_id ilike'), [
      '019fbcf9-e020-71da-935a-6a6a728b3701',
      actor.organizationId,
      'Drive 100%_',
      'Drive 100\\%\\_',
      50,
      actor.actorId,
      actor.role,
    ]);
    expect(result).toMatchObject({
      items: [{ name: 'Drive 100% validation', publicId: 'p1234567890abcd' }],
      pageInfo: { limit: 50, total: 51, hasMore: true },
    });
    expect(query.mock.calls[0]?.[0]).toContain('p.archived_at is null');
  });

  it('resolves only requested project references in caller order', async () => {
    const firstId = '019fbcf9-e020-71da-935a-6a6a728b3700';
    const secondId = '019fbcf9-e020-71da-935a-6a6a728b3701';
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: secondId,
          public_id: 'p1234567890abce',
          name: 'Archived qualification',
          key: 'ARCH',
          archived_at: new Date('2026-08-01T00:00:00.000Z'),
        },
        {
          id: firstId,
          public_id: 'p1234567890abcd',
          name: 'Active qualification',
          key: 'ACTIVE',
          archived_at: null,
        },
      ],
    });

    const result = await listProjectReferences(
      { query } as unknown as Pool,
      actor,
      '019fbcf9-e020-71da-935a-6a6a728b3799',
      [secondId, firstId, secondId],
    );

    expect(query).toHaveBeenCalledWith(expect.stringContaining('array_position'), [
      '019fbcf9-e020-71da-935a-6a6a728b3799',
      actor.organizationId,
      [secondId, firstId],
      actor.actorId,
      actor.role,
    ]);
    expect(result).toEqual([
      {
        id: secondId,
        publicId: 'p1234567890abce',
        name: 'Archived qualification',
        key: 'ARCH',
        archivedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: firstId,
        publicId: 'p1234567890abcd',
        name: 'Active qualification',
        key: 'ACTIVE',
        archivedAt: null,
      },
    ]);
  });
});

describe('workspace portfolio navigation', () => {
  it('returns bounded, escaped search results with filtered and overall totals', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3700',
          public_id: 'w1234567890abcd',
          name: 'Drive 100% lab',
          slug: 'drive-lab',
          description: 'Validation',
          archived_at: null,
          total: 51,
          overall_total: 80,
        },
      ],
    });

    const result = await listWorkspacePage(
      { query } as unknown as Pool,
      actor,
      '  Drive 100%_  ',
      500,
      7,
    );

    expect(query).toHaveBeenCalledWith(expect.stringContaining('with scoped as materialized'), [
      actor.organizationId,
      null,
      'Drive 100%_',
      'Drive 100\\%\\_',
      100,
      7,
      actor.actorId,
      actor.role,
    ]);
    expect(result).toEqual({
      items: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3700',
          publicId: 'w1234567890abcd',
          name: 'Drive 100% lab',
          slug: 'drive-lab',
          description: 'Validation',
          archivedAt: null,
        },
      ],
      pageInfo: {
        limit: 100,
        offset: 7,
        total: 51,
        overallTotal: 80,
        hasNext: true,
      },
    });
  });

  it('loads a workspace through an organization and API-token scoped identifier', async () => {
    const scopedActor = {
      ...actor,
      apiTokenWorkspaceId: '019fbcf9-e020-71da-935a-6a6a728b3700',
    };
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: scopedActor.apiTokenWorkspaceId,
          public_id: 'w1234567890abcd',
          name: 'Vehicle program',
          slug: 'vehicle-program',
          description: '',
          archived_at: null,
        },
      ],
    });

    await expect(
      getWorkspace({ query } as unknown as Pool, scopedActor, 'w1234567890abcd'),
    ).resolves.toMatchObject({ name: 'Vehicle program' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('and ($2::uuid is null or id = $2)'),
      [
        actor.organizationId,
        scopedActor.apiTokenWorkspaceId,
        'w1234567890abcd',
        actor.actorId,
        actor.role,
      ],
    );
  });
});
