#!/usr/bin/env node

import { isIP } from 'node:net';
import { spawnSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const requiredSettings = [
  'NODE_ENV',
  'ENGROVE_PUBLIC_URL',
  'ENGROVE_TRUST_PROXY',
  'VITE_API_BASE_URL',
  'S3_PUBLIC_ENDPOINT',
  'MINIO_ROOT_USER',
  'S3_ACCESS_KEY_ID',
  'BACKUP_RECIPIENT',
  'ENGROVE_BACKUP_DIR',
  'BACKUP_IDENTITY_DIR',
];

const secretMinimums = new Map([
  ['POSTGRES_MIGRATION_PASSWORD', 24],
  ['POSTGRES_RUNTIME_PASSWORD', 24],
  ['POSTGRES_WORKER_PASSWORD', 24],
  ['POSTGRES_BACKUP_PASSWORD', 24],
  ['MINIO_ROOT_PASSWORD', 24],
  ['S3_SECRET_ACCESS_KEY', 24],
  ['INTERNAL_SERVICE_SECRET', 32],
]);

const optionalSecretMinimums = new Map([['ENGROVE_SETUP_TOKEN', 32]]);

const placeholderPattern =
  /(^|[-_])(change[-_]?me|changeme|example|placeholder|dev[-_]?only|development|production[-_]?test)([-_]|$)/i;

export function parseEnvFile(content) {
  const values = {};
  const seen = new Set();
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index];
    const trimmed = original.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) throw new Error(`Invalid environment assignment on line ${index + 1}.`);
    const key = match[1];
    if (seen.has(key)) throw new Error(`Duplicate environment variable ${key}.`);
    seen.add(key);
    values[key] = parseEnvValue(match[2], key, index + 1);
  }
  return values;
}

function parseEnvValue(source, key, line) {
  if (!source) return '';
  let value;
  if (source.startsWith('"')) {
    if (!source.endsWith('"')) throw new Error(`Unclosed quoted value for ${key} on line ${line}.`);
    try {
      value = JSON.parse(source);
    } catch {
      throw new Error(`Invalid quoted value for ${key} on line ${line}.`);
    }
  } else if (source.startsWith("'")) {
    if (!source.endsWith("'")) throw new Error(`Unclosed quoted value for ${key} on line ${line}.`);
    value = source.slice(1, -1);
  } else {
    value = source.replace(/\s+#.*$/, '').trim();
  }
  if (value.includes('${'))
    throw new Error(`${key} must contain a resolved literal value, not variable expansion.`);
  return value;
}

export function validateProductionEnv(values) {
  const issues = [];
  const issue = (key, message) => issues.push({ key, message });

  for (const key of requiredSettings) if (!values[key]?.trim()) issue(key, 'is required.');
  if (values.NODE_ENV !== 'production') issue('NODE_ENV', 'must be production.');

  const publicUrl = validateHttpsUrl(values.ENGROVE_PUBLIC_URL, 'ENGROVE_PUBLIC_URL', issue);
  const apiUrl = validateHttpsUrl(values.VITE_API_BASE_URL, 'VITE_API_BASE_URL', issue);
  validateHttpsUrl(values.S3_PUBLIC_ENDPOINT, 'S3_PUBLIC_ENDPOINT', issue);
  if (publicUrl && apiUrl && publicUrl.origin !== apiUrl.origin)
    issue('VITE_API_BASE_URL', 'must use the same public origin as ENGROVE_PUBLIC_URL.');

  validateTrustProxy(values.ENGROVE_TRUST_PROXY, issue);
  validateAbsolutePath(values.ENGROVE_BACKUP_DIR, 'ENGROVE_BACKUP_DIR', issue);
  validateAbsolutePath(values.BACKUP_IDENTITY_DIR, 'BACKUP_IDENTITY_DIR', issue);
  if (values.ENGROVE_BACKUP_DIR && values.ENGROVE_BACKUP_DIR === values.BACKUP_IDENTITY_DIR)
    issue('BACKUP_IDENTITY_DIR', 'must be separate from the backup output directory.');
  if (
    values.BACKUP_RECIPIENT &&
    !/^age1[023456789acdefghjklmnpqrstuvwxyz]{16,}$/i.test(values.BACKUP_RECIPIENT)
  )
    issue('BACKUP_RECIPIENT', 'must be a valid-looking age X25519 recipient beginning with age1.');

  for (const [key, minimum] of secretMinimums) {
    const value = values[key] ?? '';
    if (value.length < minimum) issue(key, `must contain at least ${minimum} characters.`);
    else if (placeholderPattern.test(value)) issue(key, 'must not contain a placeholder value.');
  }
  for (const [key, minimum] of optionalSecretMinimums) {
    const value = values[key] ?? '';
    if (!value) continue;
    if (value.length < minimum) issue(key, `must contain at least ${minimum} characters when set.`);
    else if (placeholderPattern.test(value)) issue(key, 'must not contain a placeholder value.');
  }
  for (const key of ['MINIO_ROOT_USER', 'S3_ACCESS_KEY_ID']) {
    const value = values[key] ?? '';
    if (value.length < 8) issue(key, 'must contain at least 8 characters.');
    else if (placeholderPattern.test(value)) issue(key, 'must not contain a placeholder value.');
  }
  if (values.MINIO_ROOT_USER && values.MINIO_ROOT_USER === values.S3_ACCESS_KEY_ID)
    issue('S3_ACCESS_KEY_ID', 'must differ from the MinIO root user.');

  const secretOwners = new Map();
  for (const key of [
    ...secretMinimums.keys(),
    ...optionalSecretMinimums.keys(),
    'OIDC_CLIENT_SECRET',
  ]) {
    const value = values[key];
    if (!value) continue;
    const previous = secretOwners.get(value);
    if (previous) issue(key, `must not reuse the value from ${previous}.`);
    else secretOwners.set(value, key);
  }

  validateOidc(values, publicUrl, issue);
  return issues;
}

function validateHttpsUrl(value, key, issue) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') issue(key, 'must use HTTPS.');
    if (parsed.username || parsed.password || parsed.hash)
      issue(key, 'must not contain credentials or a URL fragment.');
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === 'example.com' ||
      hostname.endsWith('.example.com') ||
      hostname.endsWith('.example.test')
    )
      issue(key, 'must use the real deployment hostname, not a local or example host.');
    return parsed;
  } catch {
    issue(key, 'must be a valid absolute URL.');
    return undefined;
  }
}

function validateTrustProxy(value, issue) {
  if (!value) return;
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length) return issue('ENGROVE_TRUST_PROXY', 'must name at least one edge proxy.');
  for (const entry of entries) {
    const [address, prefix, ...remainder] = entry.split('/');
    const family = isIP(address ?? '');
    const bits = prefix === undefined ? undefined : Number(prefix);
    if (
      !family ||
      remainder.length ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || bits < 1 || bits > (family === 4 ? 32 : 128)))
    ) {
      issue('ENGROVE_TRUST_PROXY', `contains an invalid explicit IP or CIDR entry (${entry}).`);
    }
  }
}

function validateAbsolutePath(value, key, issue) {
  if (value && !value.startsWith('/')) issue(key, 'must be an absolute path.');
}

function validateOidc(values, publicUrl, issue) {
  const keys = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI'];
  const enabled = keys.some((key) => Boolean(values[key]));
  if (!enabled) return;
  for (const key of keys) if (!values[key]) issue(key, 'is required when OIDC is enabled.');
  validateHttpsUrl(values.OIDC_ISSUER, 'OIDC_ISSUER', issue);
  const redirect = validateHttpsUrl(values.OIDC_REDIRECT_URI, 'OIDC_REDIRECT_URI', issue);
  if ((values.OIDC_CLIENT_SECRET ?? '').length < 24)
    issue('OIDC_CLIENT_SECRET', 'must contain at least 24 characters.');
  else if (placeholderPattern.test(values.OIDC_CLIENT_SECRET))
    issue('OIDC_CLIENT_SECRET', 'must not contain a placeholder value.');
  if (redirect && publicUrl) {
    const expected = new URL('/api/v1/auth/oidc/callback', publicUrl.origin).toString();
    if (redirect.toString() !== expected)
      issue('OIDC_REDIRECT_URI', `must exactly match ${expected}.`);
  }
  const autoProvision = values.OIDC_AUTO_PROVISION === 'true';
  if (autoProvision && !(values.OIDC_ALLOWED_DOMAINS ?? '').trim())
    issue('OIDC_ALLOWED_DOMAINS', 'must restrict domains when OIDC auto-provisioning is enabled.');
}

export function validateComposeConfig(config) {
  const issues = [];
  const services = config?.services ?? {};
  const issue = (service, message) => issues.push({ key: service, message });
  for (const name of [
    'postgres',
    'redis',
    'minio',
    'migrate',
    'api',
    'worker-node',
    'worker-python',
    'web',
    'admin',
  ])
    if (!services[name])
      issue(name, 'service is missing from the rendered production composition.');

  for (const name of ['postgres', 'redis', 'minio', 'api', 'web'])
    if (Array.isArray(services[name]?.ports) && services[name].ports.length)
      issue(name, 'must not publish host ports in the production composition.');

  for (const name of ['api', 'worker-node', 'worker-python', 'web']) {
    const service = services[name];
    if (!service) continue;
    if (service.read_only !== true) issue(name, 'must use a read-only root filesystem.');
    if (!service.cap_drop?.includes('ALL')) issue(name, 'must drop all Linux capabilities.');
    if (!service.security_opt?.some((option) => option.startsWith('no-new-privileges')))
      issue(name, 'must enable no-new-privileges.');
  }

  const pythonEnvironment = services['worker-python']?.environment ?? {};
  for (const key of [
    'DATABASE_URL',
    'DATABASE_MIGRATION_URL',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ])
    if (key in pythonEnvironment) issue('worker-python', `must not receive ${key}.`);

  for (const [name, role] of [
    ['api', 'engrove_runtime'],
    ['worker-node', 'engrove_worker'],
    ['admin', 'engrove_backup'],
  ]) {
    const databaseUrl = services[name]?.environment?.DATABASE_URL;
    if (typeof databaseUrl !== 'string' || !databaseUrl.startsWith(`postgresql://${role}:`))
      issue(name, `must use the ${role} database role.`);
  }
  return issues;
}

export async function validateEnvironmentFileMode(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink())
    return [{ key: 'env-file', message: 'must not be a symbolic link.' }];
  if (!metadata.isFile()) return [{ key: 'env-file', message: 'must be a regular file.' }];
  const exposedBits = metadata.mode & 0o077;
  return exposedBits
    ? [
        {
          key: 'env-file',
          message: 'must not be readable or writable by group or other users (use chmod 600).',
        },
      ]
    : [];
}

export async function validateEnvironmentFileLocation(inputPath, root = repositoryRoot) {
  const issues = [];
  if (!isAbsolute(inputPath)) issues.push({ key: 'env-file', message: 'path must be absolute.' });
  const resolvedPath = await realpath(resolve(inputPath));
  const resolvedRoot = await realpath(root);
  const pathFromRoot = relative(resolvedRoot, resolvedPath);
  const isWithinRoot =
    pathFromRoot === '' ||
    (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot));
  if (isWithinRoot)
    issues.push({ key: 'env-file', message: 'must be stored outside the source repository.' });
  return issues;
}

async function runCli() {
  const args = process.argv.slice(2);
  const envIndex = args.indexOf('--env-file');
  if (envIndex < 0 || !args[envIndex + 1]) {
    console.error('Usage: pnpm production:preflight -- --env-file /absolute/path/production.env');
    process.exitCode = 2;
    return;
  }
  const inputPath = args[envIndex + 1];
  const envPath = resolve(inputPath);
  const skipCompose = args.includes('--skip-compose');
  let values;
  let issues = [];
  try {
    values = parseEnvFile(await readFile(envPath, 'utf8'));
    issues.push(
      ...(await validateEnvironmentFileLocation(inputPath)),
      ...(await validateEnvironmentFileMode(envPath)),
      ...validateProductionEnv(values),
    );
  } catch (error) {
    console.error(`Production preflight could not read the environment file: ${safeError(error)}`);
    process.exitCode = 2;
    return;
  }
  if (!issues.length && !skipCompose) issues.push(...renderAndValidateCompose(envPath, values));
  if (issues.length) {
    console.error('Production preflight failed:');
    for (const item of issues) console.error(`- ${item.key}: ${item.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Production preflight passed for ${envPath}: permissions, endpoints, secret separation${skipCompose ? '' : ', and rendered Compose hardening'} verified.`,
  );
}

function renderAndValidateCompose(envPath, values) {
  const environment = { ...process.env };
  for (const key of Object.keys(values)) delete environment[key];
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--profile',
      'admin',
      '--env-file',
      envPath,
      '-f',
      resolve(repositoryRoot, 'deploy/compose/compose.yaml'),
      '-f',
      resolve(repositoryRoot, 'deploy/compose/compose.production.yaml'),
      'config',
      '--format',
      'json',
    ],
    { cwd: repositoryRoot, encoding: 'utf8', env: environment, maxBuffer: 20 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const status = Number.isInteger(result.status)
      ? `exit status ${result.status}`
      : 'no exit status';
    return [
      {
        key: 'compose',
        message: `could not render the production composition (${status}); external command output was suppressed to protect secrets.`,
      },
    ];
  }
  try {
    return validateComposeConfig(JSON.parse(result.stdout));
  } catch {
    return [{ key: 'compose', message: 'returned an invalid JSON configuration.' }];
  }
}

function safeError(error) {
  const text = error instanceof Error ? error.message : String(error || 'unknown error');
  return text.replace(/[\r\n]+/g, ' ').slice(0, 300);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
