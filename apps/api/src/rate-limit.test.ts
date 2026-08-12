import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  apiRateLimitIdentity,
  createApiRateLimitMiddleware,
  shouldRateLimit,
} from './rate-limit.js';
import type { Runtime } from './runtime.js';

function runtime(evalResult: unknown = [1, 60]): Runtime {
  return {
    config: {
      API_RATE_LIMIT_WINDOW_SECONDS: 60,
      API_RATE_LIMIT_TOKEN_REQUESTS: 300,
      API_RATE_LIMIT_SESSION_REQUESTS: 600,
      API_RATE_LIMIT_ANONYMOUS_REQUESTS: 120,
    },
    redis: { status: 'ready', eval: vi.fn().mockResolvedValue(evalResult) },
  } as unknown as Runtime;
}

function request(overrides: Partial<Request> = {}) {
  return {
    method: 'GET',
    path: '/api/v1/workspaces',
    headers: { 'x-request-id': 'request-1' },
    cookies: {},
    ip: '198.51.100.4',
    socket: { remoteAddress: '198.51.100.4' },
    ...overrides,
  } as Request;
}

function response() {
  const headers = new Map<string, string>();
  const state: { status?: number; body?: unknown } = {};
  const value = {
    setHeader(name: string, header: string) {
      headers.set(name, header);
      return value;
    },
    status(status: number) {
      state.status = status;
      return value;
    },
    json(body: unknown) {
      state.body = body;
      return value;
    },
  } as unknown as Response;
  return { value, headers, state };
}

describe('general API rate limiting', () => {
  it('uses isolated hashed buckets without exposing credentials', () => {
    const token = 'eng_pat_secret-value';
    const tokenIdentity = apiRateLimitIdentity(
      runtime(),
      request({ headers: { authorization: `Bearer ${token}` } }),
    );
    const sessionIdentity = apiRateLimitIdentity(
      runtime(),
      request({ cookies: { engrove_session: 'session-secret' } }),
    );
    expect(tokenIdentity.kind).toBe('api-token');
    expect(tokenIdentity.limit).toBe(300);
    expect(tokenIdentity.key).not.toContain(token);
    expect(sessionIdentity.kind).toBe('session');
    expect(sessionIdentity.key).not.toBe(tokenIdentity.key);
  });

  it('limits only versioned API traffic', () => {
    expect(shouldRateLimit(request())).toBe(true);
    expect(shouldRateLimit(request({ method: 'OPTIONS' }))).toBe(false);
    expect(shouldRateLimit(request({ path: '/health/ready' }))).toBe(false);
    expect(shouldRateLimit(request({ path: '/api/docs' }))).toBe(false);
  });

  it('publishes the remaining quota and admits requests within the bucket', async () => {
    const configuredRuntime = runtime([17, 42]);
    const result = response();
    const next = vi.fn();
    await createApiRateLimitMiddleware(configuredRuntime)(request(), result.value, next);
    expect(next).toHaveBeenCalledOnce();
    expect(result.headers.get('RateLimit-Limit')).toBe('120');
    expect(result.headers.get('RateLimit-Remaining')).toBe('103');
    expect(result.headers.get('RateLimit-Reset')).toBe('42');
    expect(result.headers.get('RateLimit-Policy')).toBe('120;w=60');
  });

  it('returns a traceable 429 with Retry-After after the quota is exhausted', async () => {
    const result = response();
    const next = vi.fn();
    await createApiRateLimitMiddleware(runtime([121, 27]))(request(), result.value, next);
    expect(next).not.toHaveBeenCalled();
    expect(result.state.status).toBe(429);
    expect(result.headers.get('Retry-After')).toBe('27');
    expect(result.state.body).toMatchObject({
      error: { code: 'RATE_LIMITED', requestId: 'request-1' },
    });
  });

  it('fails closed when the quota store is unavailable', async () => {
    const configuredRuntime = runtime();
    vi.mocked(configuredRuntime.redis.eval).mockRejectedValueOnce(new Error('redis unavailable'));
    const result = response();
    await createApiRateLimitMiddleware(configuredRuntime)(request(), result.value, vi.fn());
    expect(result.state).toMatchObject({
      status: 503,
      body: { error: { code: 'RATE_LIMIT_UNAVAILABLE', requestId: 'request-1' } },
    });
  });
});
