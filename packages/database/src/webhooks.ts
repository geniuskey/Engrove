import { createHmac } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';

export const webhookEventTypes = [
  'record.created',
  'record.updated',
  'record.archived',
  'record.restored',
  'task.created',
  'task.updated',
  'task.archived',
  'task.restored',
] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];
export type WebhookDeliveryEventType = WebhookEventType | 'webhook.test';

export function isRetryableWebhookStatus(status: number): boolean {
  return [408, 409, 425, 429].includes(status) || status >= 500;
}

export interface WebhookOutboxEvent {
  id: string;
  project_id: string;
  event_type: string;
  payload: { objectTypeId?: string };
}

export async function enqueueWebhookDeliveries(
  client: Pick<PoolClient, 'query'>,
  event: WebhookOutboxEvent,
): Promise<number> {
  const resource = event.event_type.split('.')[0];
  if (resource !== 'record' && resource !== 'task') return 0;
  const parameters =
    resource === 'record'
      ? [event.project_id, event.payload.objectTypeId ?? null, event.event_type]
      : [event.project_id, event.event_type];
  const endpoints = await client.query<{ id: string }>(
    resource === 'record'
      ? `select id from webhook_endpoints where project_id=$1 and active
         and (object_type_id is null or object_type_id=$2::uuid)
         and event_types ? $3`
      : `select id from webhook_endpoints where project_id=$1 and active
         and object_type_id is null and event_types ? $2`,
    parameters,
  );
  for (const endpoint of endpoints.rows)
    await client.query(
      `insert into webhook_deliveries
       (id,endpoint_id,project_id,event_id,event_type,payload)
       values ($1,$2,$3,$4,$5,$6::jsonb)
       on conflict (endpoint_id,event_id) do nothing`,
      [
        uuidv7(),
        endpoint.id,
        event.project_id,
        event.id,
        event.event_type,
        JSON.stringify(event.payload),
      ],
    );
  return endpoints.rows.length;
}

interface Scope {
  actor: ActorSession;
  workspaceId: string;
  projectId: string;
}

export interface WebhookEndpointRow {
  id: string;
  name: string;
  url: string;
  objectTypeId: string | null;
  objectTypeName: string | null;
  eventTypes: WebhookEventType[];
  secretVersion: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryRow {
  id: string;
  eventType: WebhookDeliveryEventType;
  status: 'queued' | 'sending' | 'succeeded' | 'failed';
  attemptCount: number;
  responseStatus: number | null;
  responseSnippet: string | null;
  lastError: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WebhookDeliveryStatus = WebhookDeliveryRow['status'];

export interface WebhookDeliveryListOptions {
  status?: WebhookDeliveryStatus;
  limit?: number;
  offset?: number;
}

export interface WebhookDeliveryPage {
  items: WebhookDeliveryRow[];
  pageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
  summary: Record<WebhookDeliveryStatus, number>;
}

export interface WebhookEndpointPage {
  items: WebhookEndpointRow[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function mapEndpoint(row: {
  id: string;
  name: string;
  url: string;
  object_type_id: string | null;
  object_type_name: string | null;
  event_types: WebhookEventType[];
  secret_version: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}): WebhookEndpointRow {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    objectTypeId: row.object_type_id,
    objectTypeName: row.object_type_name,
    eventTypes: row.event_types,
    secretVersion: row.secret_version,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapDelivery(row: {
  id: string;
  event_type: WebhookDeliveryEventType;
  status: WebhookDeliveryRow['status'];
  attempt_count: number;
  response_status: number | null;
  response_snippet: string | null;
  last_error: string | null;
  next_attempt_at: Date;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): WebhookDeliveryRow {
  return {
    id: row.id,
    eventType: row.event_type,
    status: row.status,
    attemptCount: row.attempt_count,
    responseStatus: row.response_status,
    responseSnippet: row.response_snippet,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at.toISOString(),
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function deriveWebhookSigningSecret(
  internalSecret: string,
  endpointId: string,
  secretVersion: number,
): string {
  return createHmac('sha256', internalSecret)
    .update(`engrove-webhook:${endpointId}:${secretVersion}`)
    .digest('base64url');
}

export class ScopedWebhookRepository {
  private constructor(
    private readonly pool: Pool,
    private readonly scope: Scope,
  ) {}

  static async open(pool: Pool, actor: ActorSession, workspaceId: string, projectId: string) {
    const found = await pool.query(
      `select 1 from projects p join workspaces w on w.id=p.workspace_id
       where p.id=$1 and p.workspace_id=$2 and w.organization_id=$3 and p.system=false
         and project_visible_to(p.id,$2,$3,$4,$5)`,
      [projectId, workspaceId, actor.organizationId, actor.actorId, actor.role],
    );
    if (!found.rowCount)
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    return new ScopedWebhookRepository(pool, { actor, workspaceId, projectId });
  }

  private audit(action: string, endpointId: string, requestId: string, payload = {}) {
    return {
      organizationId: this.scope.actor.organizationId,
      workspaceId: this.scope.workspaceId,
      projectId: this.scope.projectId,
      actorId: this.scope.actor.actorId,
      action,
      targetType: 'webhook_endpoint',
      targetId: endpointId,
      requestId,
      payload,
    };
  }

  private async getEndpoint(endpointId: string): Promise<WebhookEndpointRow> {
    const result = await this.pool.query(
      `select w.id,w.name,w.url,w.object_type_id,o.name object_type_name,w.event_types,
              w.secret_version,w.active,w.created_at,w.updated_at
       from webhook_endpoints w left join object_types o on o.id=w.object_type_id
       where w.project_id=$1 and w.id=$2`,
      [this.scope.projectId, endpointId],
    );
    if (!result.rows[0])
      throw new RepositoryError('WEBHOOK_NOT_FOUND', 404, 'Webhook endpoint was not found.');
    return mapEndpoint(result.rows[0]);
  }

  async listEndpointPage(
    options: { limit?: number; offset?: number } = {},
  ): Promise<WebhookEndpointPage> {
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);
    const [result, count] = await Promise.all([
      this.pool.query(
        `select w.id,w.name,w.url,w.object_type_id,o.name object_type_name,w.event_types,
                w.secret_version,w.active,w.created_at,w.updated_at
         from webhook_endpoints w left join object_types o on o.id=w.object_type_id
         where w.project_id=$1 order by w.active desc,w.created_at desc,w.id
         limit $2 offset $3`,
        [this.scope.projectId, limit, offset],
      ),
      this.pool.query<{ count: string }>(
        'select count(*)::text count from webhook_endpoints where project_id=$1',
        [this.scope.projectId],
      ),
    ]);
    const items = result.rows.map(mapEndpoint);
    const total = Number(count.rows[0]?.count ?? 0);
    return {
      items,
      pageInfo: { limit, offset, total, hasNext: offset + items.length < total },
    };
  }

  private async validateObjectType(client: PoolClient, objectTypeId: string | null) {
    if (!objectTypeId) return;
    const found = await client.query(
      'select 1 from object_types where project_id=$1 and id=$2 and archived_at is null',
      [this.scope.projectId, objectTypeId],
    );
    if (!found.rowCount)
      throw new RepositoryError('OBJECT_TYPE_NOT_FOUND', 404, 'Object type was not found.');
  }

  private validateEventScope(objectTypeId: string | null, eventTypes: WebhookEventType[]) {
    if (objectTypeId && eventTypes.some((eventType) => eventType.startsWith('task.')))
      throw new RepositoryError(
        'WEBHOOK_SCOPE_INVALID',
        400,
        'Task events require a project-wide endpoint without a table restriction.',
      );
  }

  async createEndpoint(input: {
    name: string;
    url: string;
    objectTypeId: string | null;
    eventTypes: WebhookEventType[];
    requestId: string;
  }): Promise<WebhookEndpointRow> {
    const endpointId = uuidv7();
    this.validateEventScope(input.objectTypeId, input.eventTypes);
    try {
      await transaction(this.pool, async (client) => {
        await this.validateObjectType(client, input.objectTypeId);
        await client.query(
          `insert into webhook_endpoints
           (id,organization_id,workspace_id,project_id,object_type_id,name,url,event_types,created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
          [
            endpointId,
            this.scope.actor.organizationId,
            this.scope.workspaceId,
            this.scope.projectId,
            input.objectTypeId,
            input.name,
            input.url,
            JSON.stringify(input.eventTypes),
            this.scope.actor.actorId,
          ],
        );
        await appendAudit(
          client,
          this.audit('webhook.created', endpointId, input.requestId, {
            eventTypes: input.eventTypes,
            objectTypeId: input.objectTypeId,
          }),
        );
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'constraint' in error &&
        error.constraint === 'webhook_endpoints_project_name_key'
      )
        throw new RepositoryError(
          'WEBHOOK_NAME_CONFLICT',
          409,
          'An endpoint with this name already exists.',
        );
      throw error;
    }
    return this.getEndpoint(endpointId);
  }

  async updateEndpoint(
    endpointId: string,
    input: {
      name: string;
      url: string;
      objectTypeId: string | null;
      eventTypes: WebhookEventType[];
      active: boolean;
      requestId: string;
    },
  ): Promise<WebhookEndpointRow> {
    this.validateEventScope(input.objectTypeId, input.eventTypes);
    await transaction(this.pool, async (client) => {
      await this.validateObjectType(client, input.objectTypeId);
      const changed = await client.query(
        `update webhook_endpoints set name=$3,url=$4,object_type_id=$5,event_types=$6::jsonb,
                active=$7,updated_at=now()
         where project_id=$1 and id=$2 returning id`,
        [
          this.scope.projectId,
          endpointId,
          input.name,
          input.url,
          input.objectTypeId,
          JSON.stringify(input.eventTypes),
          input.active,
        ],
      );
      if (!changed.rowCount)
        throw new RepositoryError('WEBHOOK_NOT_FOUND', 404, 'Webhook endpoint was not found.');
      await appendAudit(
        client,
        this.audit('webhook.updated', endpointId, input.requestId, {
          active: input.active,
          eventTypes: input.eventTypes,
          objectTypeId: input.objectTypeId,
        }),
      );
    });
    return this.getEndpoint(endpointId);
  }

  async rotateSecret(endpointId: string, requestId: string): Promise<WebhookEndpointRow> {
    await transaction(this.pool, async (client) => {
      const changed = await client.query(
        `update webhook_endpoints set secret_version=secret_version+1,updated_at=now()
         where project_id=$1 and id=$2 returning secret_version`,
        [this.scope.projectId, endpointId],
      );
      if (!changed.rowCount)
        throw new RepositoryError('WEBHOOK_NOT_FOUND', 404, 'Webhook endpoint was not found.');
      await appendAudit(client, this.audit('webhook.secret_rotated', endpointId, requestId));
    });
    return this.getEndpoint(endpointId);
  }

  private async getDelivery(endpointId: string, deliveryId: string): Promise<WebhookDeliveryRow> {
    const result = await this.pool.query(
      `select id,event_type,status,attempt_count,response_status,response_snippet,last_error,
              next_attempt_at,delivered_at,created_at,updated_at
       from webhook_deliveries where project_id=$1 and endpoint_id=$2 and id=$3`,
      [this.scope.projectId, endpointId, deliveryId],
    );
    if (!result.rowCount)
      throw new RepositoryError('WEBHOOK_DELIVERY_NOT_FOUND', 404, 'Delivery was not found.');
    return mapDelivery(result.rows[0]);
  }

  async enqueueTest(endpointId: string, requestId: string): Promise<WebhookDeliveryRow> {
    const eventId = uuidv7();
    const deliveryId = uuidv7();
    await transaction(this.pool, async (client) => {
      const endpoint = await client.query<{ active: boolean }>(
        'select active from webhook_endpoints where project_id=$1 and id=$2 for update',
        [this.scope.projectId, endpointId],
      );
      if (!endpoint.rowCount)
        throw new RepositoryError('WEBHOOK_NOT_FOUND', 404, 'Webhook endpoint was not found.');
      if (!endpoint.rows[0]!.active)
        throw new RepositoryError(
          'WEBHOOK_PAUSED',
          409,
          'Resume the webhook endpoint before sending a test.',
        );
      const payload = {
        version: 1,
        id: eventId,
        type: 'webhook.test',
        occurredAt: new Date().toISOString(),
        workspaceId: this.scope.workspaceId,
        projectId: this.scope.projectId,
        webhookEndpointId: endpointId,
        actorId: this.scope.actor.actorId,
        data: { test: true },
      };
      await client.query(
        `insert into outbox_events
         (id,project_id,event_type,entity_type,entity_id,payload,dispatched_at,attempt_count)
         values ($1,$2,'webhook.test','webhook_endpoint',$3,$4::jsonb,now(),1)`,
        [eventId, this.scope.projectId, endpointId, JSON.stringify(payload)],
      );
      await client.query(
        `insert into webhook_deliveries
         (id,endpoint_id,project_id,event_id,event_type,payload)
         values ($1,$2,$3,$4,'webhook.test',$5::jsonb)`,
        [deliveryId, endpointId, this.scope.projectId, eventId, JSON.stringify(payload)],
      );
      await appendAudit(
        client,
        this.audit('webhook.test_queued', endpointId, requestId, { deliveryId }),
      );
    });
    return this.getDelivery(endpointId, deliveryId);
  }

  async retryDelivery(
    endpointId: string,
    deliveryId: string,
    requestId: string,
  ): Promise<WebhookDeliveryRow> {
    await transaction(this.pool, async (client) => {
      const delivery = await client.query<{
        active: boolean;
        status: WebhookDeliveryRow['status'];
        attempt_count: number;
        last_error: string | null;
      }>(
        `select e.active,d.status,d.attempt_count,d.last_error
         from webhook_deliveries d join webhook_endpoints e on e.id=d.endpoint_id
         where d.project_id=$1 and d.endpoint_id=$2 and d.id=$3 for update of d`,
        [this.scope.projectId, endpointId, deliveryId],
      );
      if (!delivery.rowCount)
        throw new RepositoryError('WEBHOOK_DELIVERY_NOT_FOUND', 404, 'Delivery was not found.');
      const current = delivery.rows[0]!;
      if (!current.active)
        throw new RepositoryError(
          'WEBHOOK_PAUSED',
          409,
          'Resume the webhook endpoint before retrying a delivery.',
        );
      if (current.status !== 'failed')
        throw new RepositoryError(
          'WEBHOOK_DELIVERY_NOT_FAILED',
          409,
          'Only a terminal failed delivery can be retried manually.',
        );
      await client.query(
        `update webhook_deliveries set status='queued',attempt_count=0,next_attempt_at=now(),
           lease_owner=null,lease_expires_at=null,delivered_at=null,updated_at=now()
         where project_id=$1 and endpoint_id=$2 and id=$3`,
        [this.scope.projectId, endpointId, deliveryId],
      );
      await appendAudit(
        client,
        this.audit('webhook.delivery_retried', endpointId, requestId, {
          deliveryId,
          previousAttemptCount: current.attempt_count,
          previousError: current.last_error,
        }),
      );
    });
    return this.getDelivery(endpointId, deliveryId);
  }

  async listDeliveryPage(
    endpointId: string,
    options: WebhookDeliveryListOptions = {},
  ): Promise<WebhookDeliveryPage> {
    const found = await this.pool.query(
      'select 1 from webhook_endpoints where project_id=$1 and id=$2',
      [this.scope.projectId, endpointId],
    );
    if (!found.rowCount)
      throw new RepositoryError('WEBHOOK_NOT_FOUND', 404, 'Webhook endpoint was not found.');
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);
    const status = options.status ?? null;
    const [result, counts] = await Promise.all([
      this.pool.query(
        `select id,event_type,status,attempt_count,response_status,response_snippet,last_error,
                next_attempt_at,delivered_at,created_at,updated_at
         from webhook_deliveries
         where project_id=$1 and endpoint_id=$2 and ($3::text is null or status=$3)
         order by created_at desc,id desc limit $4 offset $5`,
        [this.scope.projectId, endpointId, status, limit, offset],
      ),
      this.pool.query<{
        total: string;
        queued: string;
        sending: string;
        succeeded: string;
        failed: string;
      }>(
        `select
           count(*) filter(where $3::text is null or status=$3)::text total,
           count(*) filter(where status='queued')::text queued,
           count(*) filter(where status='sending')::text sending,
           count(*) filter(where status='succeeded')::text succeeded,
           count(*) filter(where status='failed')::text failed
         from webhook_deliveries where project_id=$1 and endpoint_id=$2`,
        [this.scope.projectId, endpointId, status],
      ),
    ]);
    const total = Number(counts.rows[0]?.total ?? 0);
    return {
      items: result.rows.map(mapDelivery),
      pageInfo: {
        limit,
        offset,
        total,
        hasNext: offset + result.rows.length < total,
      },
      summary: {
        queued: Number(counts.rows[0]?.queued ?? 0),
        sending: Number(counts.rows[0]?.sending ?? 0),
        succeeded: Number(counts.rows[0]?.succeeded ?? 0),
        failed: Number(counts.rows[0]?.failed ?? 0),
      },
    };
  }
}
