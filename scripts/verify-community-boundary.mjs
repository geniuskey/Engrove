import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const sourceRoots = ['apps', 'packages', 'deploy'];
const forbiddenPath = /(^|[/\\])(enterprise|commercial)([/\\]|$)/i;
const forbiddenCode =
  /(enterprise[-_ ]?(license|feature|module)|license[-_ ]?gate|commercial[-_ ]?feature)/i;
const findings = [];

async function visit(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', '.venv'].includes(entry.name)) continue;
    const full = join(path, entry.name);
    const name = relative(root, full);
    if (forbiddenPath.test(name)) findings.push(`forbidden path: ${name}`);
    if (entry.isDirectory()) await visit(full);
    else if (/\.(?:[cm]?[jt]sx?|json|ya?ml|py|toml|sql)$/.test(entry.name)) {
      const content = await readFile(full, 'utf8');
      if (forbiddenCode.test(content)) findings.push(`forbidden implementation marker: ${name}`);
    }
  }
}

for (const directory of sourceRoots) await visit(join(root, directory));
if (findings.length) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Community boundary verified: no commercial implementation artifacts found.');
}
