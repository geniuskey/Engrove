import type * as DatabaseModule from '@engrove/database';
import { afterEach, describe, expect, it, vi } from 'vitest';

const community = vi.hoisted(() => {
  const actor = {
    actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
    organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
    role: 'member',
  };
  return {
    actor,
    requestId: vi.fn(() => 'request-1'),
    requireActor: vi.fn(async () => actor),
  };
});
const database = vi.hoisted(() => ({ listNotifications: vi.fn() }));

vi.mock('./community.controller.js', () => community);
vi.mock('@engrove/database', async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseModule>();
  return { ...actual, listNotifications: database.listNotifications };
});

import { NotificationsController } from './notifications.controller.js';

afterEach(() => vi.clearAllMocks());

describe('NotificationsController catalog', () => {
  it('passes a normalized bounded page request to the actor-scoped repository', async () => {
    const page = {
      items: [],
      unreadCount: 4,
      pageInfo: { limit: 25, offset: 50, total: 75, hasNext: false },
    };
    database.listNotifications.mockResolvedValue(page);
    const pool = {};

    await expect(
      new NotificationsController({ pool } as never).list({} as never, 'true', '25', '50'),
    ).resolves.toEqual(page);
    expect(database.listNotifications).toHaveBeenCalledWith(pool, community.actor, {
      unreadOnly: true,
      limit: 25,
      offset: 50,
    });
  });
});
