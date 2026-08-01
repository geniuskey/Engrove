import { randomUUID } from 'node:crypto';
import { parseConfig } from '@engrove/config';
import { createPool, rebuildRecordProjections } from '@engrove/database';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const projectId = argument('--project-id');
  const fieldId = argument('--field-id');
  if (!projectId) {
    throw new Error('Usage: pnpm projection:rebuild -- --project-id <uuid> [--field-id <uuid>]');
  }
  const config = parseConfig(process.env);
  const pool = createPool(config.DATABASE_MIGRATION_URL);
  try {
    const result = await rebuildRecordProjections(pool, projectId, randomUUID(), fieldId);
    console.log(JSON.stringify(result));
  } finally {
    await pool.end();
  }
}

void main();
