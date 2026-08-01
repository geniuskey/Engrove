import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createPool, grantProductionRoles } from '@engrove/database';

const connectionString = process.env.DATABASE_MIGRATION_URL;
if (!connectionString) throw new Error('DATABASE_MIGRATION_URL is required');

async function main(): Promise<void> {
  const pool = createPool(connectionString!, { max: 1 });
  try {
    await migrate(createDatabase(pool), { migrationsFolder: '/workspace/migrations' });
    if (process.env.NODE_ENV === 'production') await grantProductionRoles(pool);
  } finally {
    await pool.end();
  }
}

void main();
