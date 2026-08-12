import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  deriveWebhookSigningSecret,
  enqueueWebhookDeliveries,
  isRetryableWebhookStatus,
  ScopedWebhookRepository,
} from '../src/webhooks.js';

const actor = {
  sessionId: 'session-1',
  actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'owner' as const,
  email: 'owner@example.com',
  displayName: 'Owner',
  csrfTokenHash: 'csrf',
};
const workspaceId = '019fbcf9-e020-71da-935a-6a6a728b3792';
const projectId = '019fbcf9-e020-71da-935a-6a6a728b3793';
const objectTypeId = '019fbcf9-e020-71da-935a-6a6a728b3794';

describe('webhook endpoints', () => {
  it('retries only transient HTTP failures', () => {
    expect([408, 409, 425, 429, 500, 503].every(isRetryableWebhookStatus)).toBe(true);
    expect([400, 401, 403, 404, 422].some(isRetryableWebhookStatus)).toBe(false);
  });

  it('routes task events only to project-wide endpoints', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('select id from webhook_endpoints'))
        return { rows: [{ id: 'endpoint-1' }, { id: 'endpoint-2' }] };
      if (statement.includes('insert into webhook_deliveries')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${statement}`);
    });

    const count = await enqueueWebhookDeliveries(
      { query } as unknown as Pick<PoolClient, 'query'>,
      {
        id: 'event-1',
        project_id: projectId,
        event_type: 'task.updated',
        payload: { objectTypeId },
      },
    );

    expect(count).toBe(2);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('and object_type_id is null'),
      [projectId, 'task.updated'],
    );
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('ignores outbox events outside record and task resources', async () => {
    const query = vi.fn();
    await expect(
      enqueueWebhookDeliveries({ query } as unknown as Pick<PoolClient, 'query'>, {
        id: 'event-1',
        project_id: projectId,
        event_type: 'dataset.profile.requested',
        payload: {},
      }),
    ).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('derives stable versioned signing secrets without persisting endpoint secrets', () => {
    const first = deriveWebhookSigningSecret('internal-secret-with-enough-entropy', projectId, 1);
    const repeated = deriveWebhookSigningSecret(
      'internal-secret-with-enough-entropy',
      projectId,
      1,
    );
    const rotated = deriveWebhookSigningSecret('internal-secret-with-enough-entropy', projectId, 2);

    expect(first).toBe(repeated);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated).not.toBe(first);
  });

  it('pages endpoint configuration with an exact project total', async () => {
    const createdAt = new Date('2026-08-08T00:00:00.000Z');
    const poolQuery = vi.fn(async (statement: string) => {
      if (statement.includes('from projects p join workspaces')) return { rowCount: 1, rows: [{}] };
      if (statement.startsWith('select count(*)')) return { rows: [{ count: '2' }] };
      if (statement.includes('from webhook_endpoints w'))
        return {
          rows: [
            {
              id: 'endpoint-1',
              name: 'Quality gateway',
              url: 'https://example.com/hooks/quality',
              object_type_id: null,
              object_type_name: null,
              event_types: ['record.created'],
              secret_version: 1,
              active: true,
              created_at: createdAt,
              updated_at: createdAt,
            },
          ],
        };
      throw new Error(`Unexpected query: ${statement}`);
    });
    const repository = await ScopedWebhookRepository.open(
      { query: poolQuery } as unknown as Pool,
      actor,
      workspaceId,
      projectId,
    );

    await expect(repository.listEndpointPage({ limit: 1, offset: 0 })).resolves.toEqual({
      items: [expect.objectContaining({ id: 'endpoint-1', name: 'Quality gateway' })],
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
    });
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('limit $2 offset $3'), [
      projectId,
      1,
      0,
    ]);
  });

  it('pages delivery history with exact endpoint-wide status totals', async () => {
    const createdAt = new Date('2026-08-08T00:00:00.000Z');
    const poolQuery = vi.fn(async (statement: string) => {
      if (statement.includes('from projects p join workspaces')) return { rowCount: 1, rows: [{}] };
      if (statement.startsWith('select 1 from webhook_endpoints'))
        return { rowCount: 1, rows: [{}] };
      if (statement.includes('count(*) filter'))
        return {
          rows: [{ total: '2', queued: '1', sending: '0', succeeded: '0', failed: '1' }],
        };
      if (statement.includes('from webhook_deliveries'))
        return {
          rows: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3796',
              event_type: 'task.updated',
              status: 'failed',
              attempt_count: 5,
              response_status: 503,
              response_snippet: 'upstream unavailable',
              last_error: 'WEBHOOK_HTTP_503',
              next_attempt_at: createdAt,
              delivered_at: null,
              created_at: createdAt,
              updated_at: createdAt,
            },
          ],
        };
      throw new Error(`Unexpected pool query: ${statement}`);
    });
    const pool = { query: poolQuery } as unknown as Pool;
    const repository = await ScopedWebhookRepository.open(pool, actor, workspaceId, projectId);

    await expect(repository.listDeliveryPage('endpoint-1', { limit: 1 })).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: '019fbcf9-e020-71da-935a-6a6a728b3796',
          status: 'failed',
          responseStatus: 503,
        }),
      ],
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
      summary: { queued: 1, sending: 0, succeeded: 0, failed: 1 },
    });
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('limit $4 offset $5'), [
      projectId,
      'endpoint-1',
      null,
      1,
      0,
    ]);
  });

  it('creates a scoped endpoint, validates its table, and audits the change', async () => {
    let generatedId = '';
    const clientQuery = vi.fn(async (statement: string, parameters?: unknown[]) => {
      if (statement === 'begin' || statement === 'commit' || statement === 'rollback')
        return { rows: [] };
      if (statement.startsWith('select 1 from object_types')) return { rowCount: 1, rows: [{}] };
      if (statement.includes('insert into webhook_endpoints')) {
        generatedId = String(parameters?.[0]);
        return { rowCount: 1, rows: [] };
      }
      if (statement.includes('insert into audit_events')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected client query: ${statement}`);
    });
    const endpointRow = {
      id: '',
      name: 'Quality gateway',
      url: 'https://example.com/hooks/quality',
      object_type_id: objectTypeId,
      object_type_name: 'Samples',
      event_types: ['record.created', 'record.updated'],
      secret_version: 1,
      active: true,
      created_at: new Date('2026-08-08T00:00:00.000Z'),
      updated_at: new Date('2026-08-08T00:00:00.000Z'),
    };
    const poolQuery = vi.fn(async (statement: string) => {
      if (statement.includes('from projects p join workspaces')) return { rowCount: 1, rows: [{}] };
      if (statement.includes('from webhook_endpoints w'))
        return { rows: [{ ...endpointRow, id: generatedId }] };
      throw new Error(`Unexpected pool query: ${statement}`);
    });
    const pool = {
      query: poolQuery,
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
    } as unknown as Pool;
    const repository = await ScopedWebhookRepository.open(pool, actor, workspaceId, projectId);

    const created = await repository.createEndpoint({
      name: endpointRow.name,
      url: endpointRow.url,
      objectTypeId,
      eventTypes: ['record.created', 'record.updated'],
      requestId: 'request-1',
    });

    expect(created).toMatchObject({
      name: endpointRow.name,
      objectTypeName: 'Samples',
      eventTypes: ['record.created', 'record.updated'],
    });
    expect(created).not.toHaveProperty('signingSecret');
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into webhook_endpoints'),
      expect.arrayContaining([
        actor.organizationId,
        workspaceId,
        projectId,
        objectTypeId,
        endpointRow.name,
        endpointRow.url,
      ]),
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into audit_events'),
      expect.any(Array),
    );
    await expect(
      repository.createEndpoint({
        name: 'Invalid scoped task endpoint',
        url: endpointRow.url,
        objectTypeId,
        eventTypes: ['task.created'],
        requestId: 'request-2',
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SCOPE_INVALID', status: 400 });
  });
});
