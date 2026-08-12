import { describe, expect, it } from 'vitest';
import {
  applyApiResponseCachePolicy,
  applyApiSecurityHeaders,
  redactSharedViewRequest,
} from './main.js';

describe('HTTP request log redaction', () => {
  it('removes public share credentials from every shared-view API path', () => {
    const request = redactSharedViewRequest({
      method: 'POST',
      url: `/api/v1/shared-views/sv_${'a'.repeat(43)}/query?page=1`,
      headers: { host: 'engrove.example.com' },
    });

    expect(request).toEqual({
      method: 'POST',
      url: '/api/v1/shared-views/[REDACTED]/query?page=1',
      headers: { host: 'engrove.example.com' },
    });
    expect(request.url).not.toContain('sv_');
  });

  it('leaves ordinary API route labels intact', () => {
    const request = { method: 'GET', url: '/api/v1/workspaces/w123/overview' };
    expect(redactSharedViewRequest(request)).toBe(request);
  });
});

describe('API response security', () => {
  it('adds browser defense headers and enables HSTS only in production', () => {
    for (const production of [false, true]) {
      const headers = new Map<string, string>();
      let continued = false;
      applyApiSecurityHeaders(
        production,
        {
          setHeader(name, value) {
            headers.set(name, String(value));
            return this as never;
          },
        },
        () => {
          continued = true;
        },
      );
      expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(headers.get('X-Frame-Options')).toBe('DENY');
      expect(headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(headers.get('Permissions-Policy')).toContain('camera=()');
      expect(headers.has('Strict-Transport-Security')).toBe(production);
      expect(continued).toBe(true);
    }
  });
});

describe('API response cache policy', () => {
  it('makes versioned reads private and conditionally revalidated', () => {
    const headers = new Map<string, string>();
    const vary: string[] = [];
    let continued = false;
    applyApiResponseCachePolicy(
      { method: 'GET', path: '/api/v1/workspaces/w123/overview' },
      {
        setHeader(name, value) {
          headers.set(name, String(value));
          return this as never;
        },
        vary(field) {
          vary.push(field);
          return this as never;
        },
      },
      () => {
        continued = true;
      },
    );

    expect(headers.get('Cache-Control')).toBe('private, no-cache');
    expect(vary).toEqual(['Authorization', 'Cookie']);
    expect(continued).toBe(true);
  });

  it('prevents OIDC and public-share reads from being stored', () => {
    for (const path of [
      '/api/v1/auth/oidc/start',
      '/api/v1/auth/oidc/callback',
      '/api/v1/shared-views/sv_redacted',
    ]) {
      const headers = new Map<string, string>();
      applyApiResponseCachePolicy(
        { method: 'GET', path },
        {
          setHeader(name, value) {
            headers.set(name, String(value));
            return this as never;
          },
          vary() {
            return this as never;
          },
        },
        () => undefined,
      );
      expect(headers.get('Cache-Control')).toBe('private, no-store');
    }
  });

  it('prevents mutations, diagnostics, and API documentation from being stored', () => {
    for (const request of [
      { method: 'POST', path: '/api/v1/workspaces' },
      { method: 'GET', path: '/health/ready' },
      { method: 'GET', path: '/metrics' },
      { method: 'GET', path: '/api/docs' },
    ]) {
      const headers = new Map<string, string>();
      applyApiResponseCachePolicy(
        request,
        {
          setHeader(name, value) {
            headers.set(name, String(value));
            return this as never;
          },
          vary() {
            return this as never;
          },
        },
        () => undefined,
      );
      expect(headers.get('Cache-Control')).toMatch(/no-store/);
    }
  });
});
