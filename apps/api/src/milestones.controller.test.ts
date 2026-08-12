import type * as DatabaseModule from '@engrove/database';
import { afterEach, describe, expect, it, vi } from 'vitest';

const community = vi.hoisted(() => ({
  requestId: vi.fn(() => 'request-1'),
  requireActor: vi.fn(async () => ({
    actorId: 'actor-1',
    organizationId: 'organization-1',
    role: 'owner',
  })),
}));
const database = vi.hoisted(() => ({
  open: vi.fn(),
  resolveProjectIdentifier: vi.fn(async () => 'project-1'),
  resolveWorkspaceIdentifier: vi.fn(async () => 'workspace-1'),
}));

vi.mock('./community.controller.js', () => community);
vi.mock('@engrove/database', async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseModule>();
  return {
    ...actual,
    resolveProjectIdentifier: database.resolveProjectIdentifier,
    resolveWorkspaceIdentifier: database.resolveWorkspaceIdentifier,
    ScopedMilestoneRepository: { open: database.open },
  };
});

import { MilestonesController } from './milestones.controller.js';

afterEach(() => vi.clearAllMocks());

describe('MilestonesController catalog', () => {
  it('passes the normalized bounded list contract to the scoped repository', async () => {
    const page = {
      items: [],
      pageInfo: { limit: 25, offset: 50, total: 0, hasNext: false },
      summary: { planned: 0, active: 0, atRisk: 0, completed: 0, archived: 0 },
      nextMilestoneId: null,
    };
    const repository = { listMilestonePage: vi.fn(async () => page) };
    database.open.mockResolvedValue(repository);

    await expect(
      new MilestonesController({ pool: {} } as never).milestones(
        {} as never,
        'workspace-public-id',
        'project-public-id',
        ' Release ',
        'all',
        'false',
        '25',
        '50',
      ),
    ).resolves.toEqual(page);
    expect(repository.listMilestonePage).toHaveBeenCalledWith({
      archiveState: 'all',
      query: 'Release',
      limit: 25,
      offset: 50,
    });
  });

  it('retains includeArchived=true as the legacy all-state alias', async () => {
    const repository = { listMilestonePage: vi.fn(async () => ({})) };
    database.open.mockResolvedValue(repository);

    await new MilestonesController({ pool: {} } as never).milestones(
      {} as never,
      'workspace-public-id',
      'project-public-id',
      undefined,
      undefined,
      'true',
      undefined,
      undefined,
    );

    expect(repository.listMilestonePage).toHaveBeenCalledWith({
      archiveState: 'all',
      query: '',
      limit: 50,
      offset: 0,
    });
  });
});
