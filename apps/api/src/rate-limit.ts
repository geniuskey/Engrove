import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { verifiedClientIp } from './community.controller.js';
import type { Runtime } from './runtime.js';

const rateLimitScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

type RateLimitKind = 'api-token' | 'session' | 'anonymous';

interface RateLimitIdentity {
  key: string;
  kind: RateLimitKind;
  limit: number;
}

function hashIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function apiRateLimitIdentity(runtime: Runtime, request: Request): RateLimitIdentity {
  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer)
    return {
      key: `engrove:rate-limit:api-token:${hashIdentity(bearer)}`,
      kind: 'api-token',
      limit: runtime.config.API_RATE_LIMIT_TOKEN_REQUESTS,
    };

  const session = request.cookies?.engrove_session as string | undefined;
  if (session)
    return {
      key: `engrove:rate-limit:session:${hashIdentity(session)}`,
      kind: 'session',
      limit: runtime.config.API_RATE_LIMIT_SESSION_REQUESTS,
    };

  return {
    key: `engrove:rate-limit:anonymous:${hashIdentity(verifiedClientIp(request))}`,
    kind: 'anonymous',
    limit: runtime.config.API_RATE_LIMIT_ANONYMOUS_REQUESTS,
  };
}

export function shouldRateLimit(request: Request): boolean {
  return request.method !== 'OPTIONS' && request.path.startsWith('/api/v1/');
}

function setRateLimitHeaders(
  response: Response,
  limit: number,
  count: number,
  resetSeconds: number,
  windowSeconds: number,
): void {
  response.setHeader('RateLimit-Limit', String(limit));
  response.setHeader('RateLimit-Remaining', String(Math.max(0, limit - count)));
  response.setHeader('RateLimit-Reset', String(Math.max(1, resetSeconds)));
  response.setHeader('RateLimit-Policy', `${limit};w=${windowSeconds}`);
}

export function createApiRateLimitMiddleware(runtime: Runtime) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    if (!shouldRateLimit(request)) {
      next();
      return;
    }

    const identity = apiRateLimitIdentity(runtime, request);
    const windowSeconds = runtime.config.API_RATE_LIMIT_WINDOW_SECONDS;
    try {
      if (runtime.redis.status === 'wait') await runtime.redis.connect();
      const result = (await runtime.redis.eval(
        rateLimitScript,
        1,
        identity.key,
        windowSeconds,
      )) as [number | string, number | string];
      const count = Number(result[0]);
      const resetSeconds = Math.max(1, Number(result[1]) || windowSeconds);
      setRateLimitHeaders(response, identity.limit, count, resetSeconds, windowSeconds);
      if (count > identity.limit) {
        response.setHeader('Retry-After', String(resetSeconds));
        response.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many API requests. Retry after the indicated interval.',
            details: [{ kind: identity.kind, retryAfterSeconds: resetSeconds }],
            requestId: String(request.headers['x-request-id'] ?? 'unknown'),
          },
        });
        return;
      }
      next();
    } catch {
      response.status(503).json({
        error: {
          code: 'RATE_LIMIT_UNAVAILABLE',
          message: 'API request limiting is temporarily unavailable.',
          details: [],
          requestId: String(request.headers['x-request-id'] ?? 'unknown'),
        },
      });
    }
  };
}
