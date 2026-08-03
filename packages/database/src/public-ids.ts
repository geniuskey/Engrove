import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { validate as validateUuid } from 'uuid';
import { RepositoryError } from './errors.js';

const alphabet = '1234567890abcdefghijklmnopqrstuvwxyz';
const randomLength = 14;
const unbiasedLimit = Math.floor(256 / alphabet.length) * alphabet.length;

export const basePublicIdPattern = /^p[0-9a-z]{14}$/;
export const tablePublicIdPattern = /^m[0-9a-z]{14}$/;

function generatePublicId(prefix: 'p' | 'm'): string {
  let value = prefix;
  while (value.length <= randomLength) {
    for (const byte of randomBytes(randomLength)) {
      if (byte >= unbiasedLimit) continue;
      value += alphabet[byte % alphabet.length];
      if (value.length > randomLength) break;
    }
  }
  return value;
}

export function generateBasePublicId(): string {
  return generatePublicId('p');
}

export function generateTablePublicId(): string {
  return generatePublicId('m');
}

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

async function resolveIdentifier(
  database: Queryable,
  table: 'projects' | 'object_types',
  identifier: string,
  code: 'PROJECT_NOT_FOUND' | 'OBJECT_TYPE_NOT_FOUND',
  message: string,
): Promise<string> {
  if (validateUuid(identifier)) return identifier;
  const expectedPattern = table === 'projects' ? basePublicIdPattern : tablePublicIdPattern;
  if (!expectedPattern.test(identifier)) throw new RepositoryError(code, 404, message);
  const result = await database.query<{ id: string }>(
    `select id from ${table} where public_id = $1`,
    [identifier],
  );
  if (!result.rows[0]) throw new RepositoryError(code, 404, message);
  return result.rows[0].id;
}

export async function resolveProjectIdentifier(
  database: Queryable,
  identifier: string,
): Promise<string> {
  return resolveIdentifier(
    database,
    'projects',
    identifier,
    'PROJECT_NOT_FOUND',
    'Project was not found.',
  );
}

export async function resolveObjectTypeIdentifier(
  database: Queryable,
  identifier: string,
): Promise<string> {
  return resolveIdentifier(
    database,
    'object_types',
    identifier,
    'OBJECT_TYPE_NOT_FOUND',
    'Object type was not found.',
  );
}
