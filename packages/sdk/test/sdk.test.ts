import { describe, expect, it, vi } from 'vitest';
import { EngroveApiError, EngroveClient } from '../src/index.js';
import type { EngroveRecord, JsonValue, RecordPage } from '../src/index.js';

const reference = {
  workspaceId: 'workspace / alpha',
  projectId: 'project?one',
  tableId: 'asset#registry',
};

const projectReference = {
  workspaceId: 'workspace / alpha',
  projectId: 'project?one',
};

describe('EngroveClient', () => {
  it('sends bearer credentials only to a validated API path and exposes response metadata', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { items: [] },
        {
          headers: {
            ETag: '"row-12"',
            'RateLimit-Limit': '120',
            'RateLimit-Remaining': '119',
            'RateLimit-Reset': '42',
            'RateLimit-Policy': '120;w=60',
            'X-Request-Id': 'request-123',
          },
        },
      ),
    );
    const client = createClient(request);

    const result = await client.request<{ items: [] }>('/api/v1/workspaces?limit=20');

    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe('https://engrove.example/api/v1/workspaces?limit=20');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-token');
    expect(result).toEqual({
      data: { items: [] },
      requestId: 'request-123',
      etag: '"row-12"',
      rateLimit: { limit: 120, remaining: 119, reset: 42, policy: '120;w=60' },
    });
  });

  it.each(['https://attacker.example/api/v1/workspaces', '//attacker.example/api/v1', '/health'])(
    'rejects unsafe request path %s before fetch',
    async (path) => {
      const request = vi.fn<typeof fetch>();
      const client = createClient(request);

      await expect(client.request(path)).rejects.toThrow(TypeError);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('parses stable API errors and request identifiers', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'The request body is invalid.',
            details: [{ path: 'pageSize', message: 'Too large.' }],
            requestId: 'request-envelope',
          },
        },
        { status: 400 },
      ),
    );

    const error = await createClient(request)
      .request('/api/v1/workspaces')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EngroveApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      requestId: 'request-envelope',
      details: [{ path: 'pageSize', message: 'Too large.' }],
    });
  });

  it('reports a successful but malformed JSON response as a stable SDK error', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html>proxy error</html>', {
        status: 200,
        headers: { 'X-Request-Id': 'request-malformed' },
      }),
    );

    await expect(createClient(request).request('/api/v1/workspaces')).rejects.toMatchObject({
      status: 200,
      code: 'INVALID_RESPONSE',
      requestId: 'request-malformed',
    });
    expect(request.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('retries a throttled read using Retry-After', async () => {
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const response = await createClient(request, { sleep }).request<{ ok: boolean }>(
      '/api/v1/workspaces',
    );

    expect(response.data.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('does not retry a non-idempotent mutation', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));

    await expect(
      createClient(request).request('/api/v1/workspaces', {
        method: 'POST',
        body: { name: 'Do not replay' },
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(request).toHaveBeenCalledOnce();
  });

  it('retries an idempotent mutation without changing its key or body', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ created: [], idempotentReplay: false }));
    const client = createClient(request);
    const table = client.table(reference);

    await table.bulkCreate([{ displayName: 'Pump', values: {} }], {
      idempotencyKey: 'stable-bulk-key',
    });

    expect(request).toHaveBeenCalledTimes(2);
    const first = request.mock.calls[0]?.[1];
    const second = request.mock.calls[1]?.[1];
    expect(new Headers(first?.headers).get('idempotency-key')).toBe('stable-bulk-key');
    expect(new Headers(second?.headers).get('idempotency-key')).toBe('stable-bulk-key');
    expect(first?.body).toBe(second?.body);
  });

  it('does not retry bulk field updates without a server idempotency contract', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    const table = createClient(request).table(reference);

    await expect(
      table.bulkUpdateFields({
        records: [{ id: 'record-1', rowVersion: 2 }],
        changes: [{ fieldKey: 'status', operation: 'set', value: 'ready' }],
      }),
    ).rejects.toMatchObject({ status: 503 });

    expect(request).toHaveBeenCalledOnce();
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).has('idempotency-key')).toBe(false);
  });
});

describe('EngroveTable', () => {
  it('encodes identifiers and provides typed table operations', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ items: [] }));
    const table = createClient(request).table<{ serialNumber: string }>(reference);

    await table.fields();

    expect(request.mock.calls[0]?.[0]).toBe(
      'https://engrove.example/api/v1/workspaces/workspace%20%2F%20alpha/projects/project%3Fone/object-types/asset%23registry/fields',
    );
  });

  it('iterates every page and record without an unbounded preload', async () => {
    const first = page(1, 2, 3, ['first', 'second']);
    const second = page(2, 2, 3, ['third']);
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(first))
      .mockResolvedValueOnce(jsonResponse(second));
    const table = createClient(request).table(reference);

    const names: string[] = [];
    for await (const record of table.records({ pageSize: 2, search: 'pump' })) {
      names.push(record.displayName);
    }

    expect(names).toEqual(['first', 'second', 'third']);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      pageSize: 2,
      search: 'pump',
      page: 1,
    });
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
      pageSize: 2,
      search: 'pump',
      page: 2,
    });
  });

  it('returns CSV text without JSON parsing', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('name,status\nPump,ready', { status: 200 }));

    const result = await createClient(request)
      .table(reference)
      .exportCsv({
        fieldKeys: ['status'],
      });

    expect(result.data).toContain('Pump,ready');
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('accept')).toContain('text/csv');
  });
});

describe('EngroveTasks', () => {
  it('encodes project identifiers and repeats multi-value task filters', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        items: [],
        pageInfo: { limit: 25, offset: 10, total: 0, hasNext: false },
      }),
    );
    const tasks = createClient(request).tasks(projectReference);

    await tasks.list({
      archiveState: 'active',
      statuses: ['todo', 'in_progress'],
      labels: ['safety', 'supplier'],
      hasDueDate: true,
      sort: 'priority',
      direction: 'desc',
      limit: 25,
      offset: 10,
    });

    const url = new URL(String(request.mock.calls[0]?.[0]));
    expect(url.pathname).toBe(
      '/api/v1/workspaces/workspace%20%2F%20alpha/projects/project%3Fone/tasks',
    );
    expect(url.searchParams.getAll('status')).toEqual(['todo', 'in_progress']);
    expect(url.searchParams.getAll('label')).toEqual(['safety', 'supplier']);
    expect(url.searchParams.get('hasDueDate')).toBe('true');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('offset')).toBe('10');
  });

  it('iterates bounded offset pages without preloading the project backlog', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ task_key: 'FORCE-1' }, { task_key: 'FORCE-2' }],
          pageInfo: { limit: 2, offset: 0, total: 3, hasNext: true },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ task_key: 'FORCE-3' }],
          pageInfo: { limit: 2, offset: 2, total: 3, hasNext: false },
        }),
      );
    const keys: string[] = [];

    for await (const task of createClient(request).tasks(projectReference).all({ limit: 2 })) {
      keys.push(task.task_key);
    }

    expect(keys).toEqual(['FORCE-1', 'FORCE-2', 'FORCE-3']);
    expect(new URL(String(request.mock.calls[0]?.[0])).searchParams.get('offset')).toBe('0');
    expect(new URL(String(request.mock.calls[1]?.[0])).searchParams.get('offset')).toBe('2');
  });

  it('creates tasks idempotently and preserves the caller key across a safe retry', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1', task_key: 'FORCE-1' }, { status: 201 }));

    await createClient(request)
      .tasks(projectReference)
      .create(
        { title: 'Review force curve', priority: 'high' },
        { idempotencyKey: 'stable-task-create-key' },
      );

    expect(request).toHaveBeenCalledTimes(2);
    for (const call of request.mock.calls) {
      expect(new Headers(call[1]?.headers).get('idempotency-key')).toBe('stable-task-create-key');
      expect(JSON.parse(String(call[1]?.body))).toEqual({
        title: 'Review force curve',
        priority: 'high',
      });
    }
  });

  it('accepts a human-readable task key and does not retry versioned task mutations', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    const tasks = createClient(request).tasks(projectReference);

    await expect(
      tasks.move(' FORCE-6 ', { status: 'in_progress', rowVersion: 4, placement: 'top' }),
    ).rejects.toMatchObject({ status: 503 });

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe(
      'https://engrove.example/api/v1/workspaces/workspace%20%2F%20alpha/projects/project%3Fone/tasks/FORCE-6/move',
    );
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).has('idempotency-key')).toBe(false);
  });

  it('rejects an empty task identifier before sending credentials', async () => {
    const request = vi.fn<typeof fetch>();
    const tasks = createClient(request).tasks(projectReference);

    expect(() => tasks.get('  ')).toThrow(TypeError);
    expect(request).not.toHaveBeenCalled();
  });
});

function createClient(
  request: typeof fetch,
  options: { sleep?: (milliseconds: number) => Promise<void> } = {},
) {
  return new EngroveClient({
    baseUrl: 'https://engrove.example/',
    token: 'secret-token',
    fetch: request,
    maxRetries: 2,
    retryBaseMs: 0,
    random: () => 0,
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
}

function jsonResponse(
  value: unknown,
  init: { status?: number; headers?: HeadersInit } = {},
): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...Object.fromEntries(new Headers(init.headers)),
    },
  });
}

function page(
  currentPage: number,
  pageSize: number,
  total: number,
  names: string[],
): RecordPage<Record<string, JsonValue>> {
  return {
    items: names.map((name, index) => record(`${currentPage}-${index}`, name)),
    page: currentPage,
    pageSize,
    total,
  };
}

function record(id: string, displayName: string): EngroveRecord<Record<string, JsonValue>> {
  return {
    id,
    projectId: 'project',
    objectTypeId: 'table',
    contextProjectId: null,
    displayName,
    values: {},
    relations: {},
    relationLabels: {},
    referenceLabels: {},
    fileReferences: {},
    datasetReferences: {},
    measurements: {},
    rowVersion: 1,
    archivedAt: null,
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
  };
}
