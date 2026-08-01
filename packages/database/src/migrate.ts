import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createPool } from './index.js';
import { grantProductionRoles } from './production-roles.js';

const connectionString = process.env.DATABASE_MIGRATION_URL;
if (!connectionString) throw new Error('DATABASE_MIGRATION_URL is required');

const pool = createPool(connectionString, { max: 1 });
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

try {
  await migrate(createDatabase(pool), { migrationsFolder });
  if (process.env.NODE_ENV === 'production') await grantProductionRoles(pool);
} finally {
  await pool.end();
}
