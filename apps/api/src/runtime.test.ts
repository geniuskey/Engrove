import { describe, expect, it } from 'vitest';
import { httpRouteLabel } from './metrics.controller.js';
import { runReadinessChecks } from './runtime.js';

describe('HTTP metrics', () => {
  it('uses matched route templates and collapses unmatched requests', () => {
    expect(httpRouteLabel({ path: '/api/v1/workspaces/:workspaceId' })).toBe(
      '/api/v1/workspaces/:workspaceId',
    );
    expect(httpRouteLabel(undefined)).toBe('unmatched');
    expect(httpRouteLabel({ path: 42 })).toBe('unmatched');
  });
});

describe('readiness', () => {
  it('reports every dependency failure with stable safe codes', async () => {
    const dependencies = await runReadinessChecks({} as never, {
      postgres: async () => undefined,
      redis: async () => {
        throw new Error('redis://user:password@secret-host');
      },
      objectStorage: async () => {
        throw new Error('access key leaked here');
      },
    });
    expect(dependencies).toEqual({
      postgres: { status: 'ok' },
      redis: { status: 'not_ready', code: 'REDIS_UNAVAILABLE' },
      objectStorage: { status: 'not_ready', code: 'OBJECT_STORAGE_UNAVAILABLE' },
    });
    expect(JSON.stringify(dependencies)).not.toContain('password');
  });
});
