import { describe, expect, it } from 'vitest';
import { runReadinessChecks } from './runtime.js';

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
