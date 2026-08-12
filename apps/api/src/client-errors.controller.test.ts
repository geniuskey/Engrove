import { afterEach, describe, expect, it, vi } from 'vitest';

const community = vi.hoisted(() => ({
  actor: {
    actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
    organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
    role: 'owner',
  },
  requestId: vi.fn(() => 'server-request-1'),
  requireActor: vi.fn(),
}));

vi.mock('./community.controller.js', () => community);

import { clientErrorReportInput, ClientErrorsController } from './client-errors.controller.js';

afterEach(() => vi.clearAllMocks());

describe('ClientErrorsController', () => {
  it('accepts and logs a privacy-bounded authenticated render failure', async () => {
    community.requireActor.mockResolvedValue(community.actor);
    const controller = new ClientErrorsController({} as never);
    const warn = vi.fn();
    Object.assign(controller, { logger: { warn } });
    const report = {
      errorId: '019fbcf9-e020-71da-935a-6a6a728b3792',
      kind: 'render_error' as const,
      route: '/workspaces/w1/projects/p1/tasks',
      errorName: 'TypeError',
      componentStack: 'at TasksPage\nat AppContent',
    };

    await expect(controller.report({} as never, report)).resolves.toEqual({
      accepted: true,
      errorId: report.errorId,
    });
    expect(community.requireActor).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      true,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'client_render_error',
        errorId: report.errorId,
        actorId: community.actor.actorId,
        requestId: 'server-request-1',
      }),
    );
  });

  it.each([
    { route: 'https://attacker.example/path' },
    { route: '//attacker.example/path' },
    { route: '/\\attacker.example/path' },
    { errorName: 'x'.repeat(81) },
    { message: 'user-entered content must not be accepted' },
  ])('rejects unsafe or surplus diagnostic data (%j)', (change) => {
    expect(() =>
      clientErrorReportInput.parse({
        errorId: '019fbcf9-e020-71da-935a-6a6a728b3792',
        kind: 'render_error',
        route: '/workspaces/w1',
        errorName: 'TypeError',
        ...change,
      }),
    ).toThrow();
  });
});
