import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool, type PoolConfig } from 'pg';

export function createPool(connectionString: string, overrides: PoolConfig = {}): Pool {
  return new Pool({ connectionString, max: 10, ...overrides });
}

export function createDatabase(pool: Pool) {
  return drizzle(pool);
}

export async function checkDatabase(pool: Pool): Promise<void> {
  await createDatabase(pool).execute(sql`select 1`);
}

export async function checkMigrationCompatibility(pool: Pool): Promise<void> {
  const result = await pool.query<{ exists: boolean }>(
    "select exists(select 1 from information_schema.tables where table_schema = 'drizzle' and table_name = '__drizzle_migrations') as exists",
  );
  if (!result.rows[0]?.exists) throw new Error('MIGRATIONS_NOT_APPLIED');
}

export type { Pool } from 'pg';
export * from './community.js';
export * from './configurable-data.js';
export * from './calculated-fields.js';
export * from './engineering-types.js';
export * from './files-datasets.js';
export * from './visualizations.js';
export * from './tasks.js';
export * from './production-roles.js';
export * from './pilot.js';
