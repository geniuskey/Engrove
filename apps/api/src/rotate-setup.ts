import { parseConfig } from '@engrove/config';
import { createPool, rotateSetupToken } from '@engrove/database';

async function main(): Promise<void> {
  const config = parseConfig(process.env);
  const pool = createPool(config.DATABASE_URL, { max: 1 });
  try {
    const setupUrl = await rotateSetupToken(pool, config.ENGROVE_PUBLIC_URL);
    process.stdout.write(`${setupUrl}\n`);
  } finally {
    await pool.end();
  }
}

void main();
