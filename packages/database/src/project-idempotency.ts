import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { RepositoryError } from './community.js';

export type ProjectCreateOperation = 'task.create' | 'milestone.create';

interface IdempotencyScope {
  projectId: string;
  actorId: string;
  operation: ProjectCreateOperation;
  idempotencyKey: string;
}

export function hashIdempotencyPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

export async function claimProjectCreate(
  client: PoolClient,
  scope: IdempotencyScope,
  requestHash: string,
): Promise<string | undefined> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1::text,7))', [
    `project-create:${scope.projectId}:${scope.operation}:${scope.actorId}:${scope.idempotencyKey}`,
  ]);
  await client.query(
    `delete from project_idempotency_requests
     where project_id=$1 and operation=$2 and requested_by=$3 and idempotency_key=$4
       and expires_at<=now()`,
    [scope.projectId, scope.operation, scope.actorId, scope.idempotencyKey],
  );
  const existing = await client.query<{ request_hash: string; resource_id: string }>(
    `select request_hash,resource_id from project_idempotency_requests
     where project_id=$1 and operation=$2 and requested_by=$3 and idempotency_key=$4`,
    [scope.projectId, scope.operation, scope.actorId, scope.idempotencyKey],
  );
  if (!existing.rows[0]) return undefined;
  if (existing.rows[0].request_hash !== requestHash)
    throw new RepositoryError(
      'IDEMPOTENCY_KEY_REUSED',
      409,
      'The idempotency key was already used with a different request.',
    );
  return existing.rows[0].resource_id;
}

export async function rememberProjectCreate(
  client: PoolClient,
  scope: IdempotencyScope,
  requestHash: string,
  resourceId: string,
): Promise<void> {
  await client.query(
    `insert into project_idempotency_requests
      (id,project_id,operation,idempotency_key,requested_by,request_hash,resource_id)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      uuidv7(),
      scope.projectId,
      scope.operation,
      scope.idempotencyKey,
      scope.actorId,
      requestHash,
      resourceId,
    ],
  );
}

export async function cleanupExpiredProjectIdempotencyRequests(pool: Pool): Promise<number> {
  const deleted = await pool.query(
    'delete from project_idempotency_requests where expires_at<=now()',
  );
  return deleted.rowCount ?? 0;
}
