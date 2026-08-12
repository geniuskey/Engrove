import type { ProjectReference } from './task-types.js';
import { EngroveTasks } from './tasks.js';
import type { ApiResponse, JsonValue, RateLimitMetadata, TableReference } from './types.js';
import { EngroveTable } from './table.js';

export interface EngroveClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  maxRetries?: number;
  retryBaseMs?: number;
  maxRetryDelayMs?: number;
  timeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export interface RequestOptions {
  method?: 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT';
  body?: unknown;
  headers?: HeadersInit;
  idempotencyKey?: string;
  responseType?: 'json' | 'text';
  retry?: 'never' | 'safe';
  signal?: AbortSignal;
}

export interface ApiErrorOptions {
  status: number;
  code: string;
  details?: unknown[];
  requestId?: string;
  retryAfterSeconds?: number;
}

export class EngroveApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown[];
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: ApiErrorOptions) {
    super(message);
    this.name = 'EngroveApiError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details ?? [];
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

const retryableStatuses = new Set([429, 502, 503, 504]);

export class EngroveClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly sleepImplementation: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: EngroveClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    if (!options.token.trim()) throw new TypeError('token must not be empty.');
    this.token = options.token.trim();
    this.fetchImplementation = options.fetch ?? fetch;
    this.maxRetries = integerOption(options.maxRetries, 2, 'maxRetries');
    this.retryBaseMs = integerOption(options.retryBaseMs, 250, 'retryBaseMs');
    this.maxRetryDelayMs = integerOption(options.maxRetryDelayMs, 30_000, 'maxRetryDelayMs');
    this.timeoutMs = integerOption(options.timeoutMs, 30_000, 'timeoutMs');
    this.sleepImplementation = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  table<TValues extends Record<string, unknown> = Record<string, JsonValue>>(
    reference: TableReference,
  ): EngroveTable<TValues> {
    return new EngroveTable(this, reference);
  }

  tasks(reference: ProjectReference): EngroveTasks {
    return new EngroveTasks(this, reference);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    assertSafeApiPath(path);
    const method = options.method ?? 'GET';
    const retryAllowed =
      options.retry === 'safe' ||
      (options.retry !== 'never' &&
        (method === 'GET' || method === 'HEAD' || options.idempotencyKey !== undefined));
    let attempt = 0;

    while (true) {
      try {
        const response = await this.fetchAttempt(path, method, options);
        if (retryAllowed && retryableStatuses.has(response.status) && attempt < this.maxRetries) {
          const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
          await response.body?.cancel();
          await this.sleepImplementation(this.retryDelay(attempt, retryAfter));
          attempt += 1;
          continue;
        }
        return await parseResponse<T>(response, options.responseType ?? 'json');
      } catch (error) {
        if (error instanceof EngroveApiError) {
          if (error.code === 'REQUEST_TIMEOUT' && retryAllowed && attempt < this.maxRetries) {
            await this.sleepImplementation(this.retryDelay(attempt));
            attempt += 1;
            continue;
          }
          throw error;
        }
        if (options.signal?.aborted) throw abortedError();
        if (!retryAllowed || attempt >= this.maxRetries) throw networkError(error);
        await this.sleepImplementation(this.retryDelay(attempt));
        attempt += 1;
      }
    }
  }

  private async fetchAttempt(
    path: string,
    method: NonNullable<RequestOptions['method']>,
    options: RequestOptions,
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set(
      'Accept',
      options.responseType === 'text' ? 'text/csv, text/plain' : 'application/json',
    );
    headers.set('Authorization', `Bearer ${this.token}`);
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.idempotencyKey !== undefined)
      headers.set('Idempotency-Key', options.idempotencyKey);

    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort('Engrove SDK request timeout'), this.timeoutMs);
    try {
      return await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method,
        headers,
        redirect: 'error',
        signal: controller.signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      if (controller.signal.aborted && !options.signal?.aborted) {
        throw new EngroveApiError(`Request timed out after ${this.timeoutMs}ms.`, {
          status: 0,
          code: 'REQUEST_TIMEOUT',
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  private retryDelay(attempt: number, retryAfter?: number): number {
    if (retryAfter !== undefined) return Math.min(retryAfter * 1_000, this.maxRetryDelayMs);
    const exponential = this.retryBaseMs * 2 ** attempt;
    const jitter = 0.5 + this.random() * 0.5;
    return Math.min(Math.round(exponential * jitter), this.maxRetryDelayMs);
  }
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('baseUrl must be a valid HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('baseUrl must be an HTTP(S) URL without credentials.');
  }
  if (url.search || url.hash) throw new TypeError('baseUrl must not include a query or fragment.');
  return url.toString().replace(/\/$/, '');
}

function assertSafeApiPath(path: string): void {
  if (!path.startsWith('/api/v1/') || path.startsWith('//') || path.includes('\\')) {
    throw new TypeError('SDK request paths must be relative /api/v1/ paths.');
  }
}

function integerOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0)
    throw new TypeError(`${name} must be a non-negative integer.`);
  return resolved;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1_000));
}

function responseMetadata(response: Response): Omit<ApiResponse<never>, 'data'> {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const etag = response.headers.get('etag') ?? undefined;
  const rateLimit: RateLimitMetadata = {};
  const limit = numericHeader(response.headers.get('ratelimit-limit'));
  const remaining = numericHeader(response.headers.get('ratelimit-remaining'));
  const reset = numericHeader(response.headers.get('ratelimit-reset'));
  const policy = response.headers.get('ratelimit-policy') ?? undefined;
  if (limit !== undefined) rateLimit.limit = limit;
  if (remaining !== undefined) rateLimit.remaining = remaining;
  if (reset !== undefined) rateLimit.reset = reset;
  if (policy !== undefined) rateLimit.policy = policy;
  return {
    rateLimit,
    ...(requestId === undefined ? {} : { requestId }),
    ...(etag === undefined ? {} : { etag }),
  };
}

function numericHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function parseResponse<T>(
  response: Response,
  responseType: 'json' | 'text',
): Promise<ApiResponse<T>> {
  const metadata = responseMetadata(response);
  const text = await response.text();
  if (!response.ok) {
    const envelope = parseErrorEnvelope(text);
    const requestId = envelope.requestId ?? metadata.requestId;
    const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));
    throw new EngroveApiError(envelope.message, {
      status: response.status,
      code: envelope.code,
      ...(envelope.details === undefined ? {} : { details: envelope.details }),
      ...(requestId === undefined ? {} : { requestId }),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }
  let data: unknown = text;
  if (responseType === 'json') {
    if (!text) data = undefined;
    else {
      try {
        data = JSON.parse(text);
      } catch {
        throw new EngroveApiError('Engrove API returned an invalid JSON response.', {
          status: response.status,
          code: 'INVALID_RESPONSE',
          ...(metadata.requestId === undefined ? {} : { requestId: metadata.requestId }),
        });
      }
    }
  }
  return { data: data as T, ...metadata };
}

function parseErrorEnvelope(text: string): {
  code: string;
  message: string;
  details?: unknown[];
  requestId?: string;
} {
  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown };
    };
    const error = parsed.error;
    if (error && typeof error.code === 'string' && typeof error.message === 'string') {
      return {
        code: error.code,
        message: error.message,
        ...(Array.isArray(error.details) ? { details: error.details } : {}),
        ...(typeof error.requestId === 'string' ? { requestId: error.requestId } : {}),
      };
    }
  } catch {
    // Fall through to a stable transport-level error.
  }
  return {
    code: 'HTTP_ERROR',
    message: text || 'Engrove API request failed.',
  };
}

function networkError(error: unknown): EngroveApiError {
  const message = error instanceof Error ? error.message : 'Unknown network error.';
  return new EngroveApiError(`Engrove API request failed: ${message}`, {
    status: 0,
    code: 'NETWORK_ERROR',
  });
}

function abortedError(): EngroveApiError {
  return new EngroveApiError('Engrove API request was aborted.', {
    status: 0,
    code: 'REQUEST_ABORTED',
  });
}
