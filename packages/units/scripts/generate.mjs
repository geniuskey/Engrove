import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = parse(await readFile(resolve(root, 'registry/units.yaml'), 'utf8'));
const stable = (value) =>
  value && typeof value === 'object'
    ? Array.isArray(value)
      ? value.map(stable)
      : Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, stable(value[key])]),
        )
    : value;
const canonical = `${JSON.stringify(stable(registry))}\n`;
const digest = createHash('sha256').update(canonical).digest('hex');
const banner = `// Generated from registry/units.yaml. Version ${registry.version}, sha256:${digest}. Do not edit.\n`;
const outputs = new Map([
  [resolve(root, 'generated/units.canonical.json'), canonical],
  [
    resolve(root, 'src/generated.ts'),
    `${banner}export const REGISTRY_VERSION = ${JSON.stringify(registry.version)} as const;\nexport const REGISTRY_DIGEST = ${JSON.stringify(digest)} as const;\nexport const GENERATED_REGISTRY = ${JSON.stringify(registry, null, 2)} as const;\n`,
  ],
  [
    resolve(root, '../../apps/worker-python/src/engrove_worker/generated_units.py'),
    `# Generated from packages/units/registry/units.yaml. Version ${registry.version}, sha256:${digest}. Do not edit.\nREGISTRY_VERSION = ${JSON.stringify(registry.version)}\nREGISTRY_DIGEST = ${JSON.stringify(digest)}\nREGISTRY = ${JSON.stringify(registry, null, 2).replaceAll('true', 'True').replaceAll('false', 'False').replaceAll('null', 'None')}\n`,
  ],
]);
let stale = false;
for (const [path, content] of outputs) {
  let current = '';
  try {
    current = await readFile(path, 'utf8');
  } catch {
    // A missing generated file is stale and will be created below.
  }
  if (current !== content) {
    stale = true;
    if (!process.argv.includes('--check')) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
  }
}
if (process.argv.includes('--check') && stale)
  throw new Error('Generated unit-registry artifacts are stale. Run pnpm units:generate.');
