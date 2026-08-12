import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actorAllowsAction: vi.fn(),
  requireActor: vi.fn(),
  resolveWorkspaceIdentifier: vi.fn(),
  searchWorkspace: vi.fn(),
}));

vi.mock('@engrove/database', () => ({
  resolveWorkspaceIdentifier: mocks.resolveWorkspaceIdentifier,
  searchWorkspace: mocks.searchWorkspace,
}));

vi.mock('./community.controller.js', () => ({
  actorAllowsAction: mocks.actorAllowsAction,
  requireActor: mocks.requireActor,
}));

import { WorkspaceSearchController } from './workspace-search.controller.js';

describe('WorkspaceSearchController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes only the search branches allowed by a scoped API token', async () => {
    const actor = {
      actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
      organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
      role: 'owner',
      apiTokenScopes: ['tasks', 'schedule'],
    };
    const pool = {};
    mocks.requireActor.mockResolvedValue(actor);
    mocks.actorAllowsAction.mockImplementation(
      (_actor: unknown, action: string) => action === 'task.read' || action === 'milestone.read',
    );
    mocks.resolveWorkspaceIdentifier.mockResolvedValue('workspace-uuid');
    mocks.searchWorkspace.mockResolvedValue({
      items: [],
      pageInfo: { limit: 12, total: 0, hasMore: false },
    });

    const controller = new WorkspaceSearchController({ pool } as never);
    await expect(
      controller.search({} as Request, 'w1234567890abcd', {
        query: 'release',
        limit: '12',
      }),
    ).resolves.toEqual({
      items: [],
      pageInfo: { limit: 12, total: 0, hasMore: false },
    });

    expect(mocks.requireActor).toHaveBeenCalledWith(
      expect.objectContaining({ pool }),
      expect.anything(),
      ['project.read', 'task.read', 'milestone.read', 'schema.read'],
    );
    expect(mocks.searchWorkspace).toHaveBeenCalledWith(
      pool,
      actor,
      'workspace-uuid',
      'release',
      12,
      ['task', 'milestone'],
    );
  });
});
