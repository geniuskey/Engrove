import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('keeps liveness independent from external dependencies', () => {
    const response = new HealthController({
      config: { ENGROVE_VERSION: 'test-version' },
    } as never).live({
      headers: { 'x-request-id': 'live-test' },
    } as unknown as Request);
    expect(response).toMatchObject({ status: 'ok', requestId: 'live-test' });
    expect(response).not.toHaveProperty('dependencies');
  });
});
