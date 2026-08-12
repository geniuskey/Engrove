import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createWebServer } from './web-server.mjs';

let directory;
let server;
let origin;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'engrove-web-server-'));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Engrove</title>');
  await writeFile(join(directory, 'engrove-mark.svg'), '<svg/>');
  await writeFile(join(directory, 'assets', 'index-abcdefgh.js'), 'export const ready=true;');
  server = createWebServer({
    rootDirectory: directory,
    apiPublicUrl: 'https://api.engrove.example',
    storagePublicEndpoint: 'https://files.engrove.example',
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(directory, { recursive: true, force: true });
});

test('serves HTML and deep links with restrictive security and revalidation headers', async () => {
  const response = await fetch(`${origin}/workspaces/example`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('permissions-policy'), /camera=\(\)/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(response.headers.get('content-security-policy'), /object-src 'none'/);
  assert.equal(await response.text(), '<!doctype html><title>Engrove</title>');
});

test('serves fingerprinted assets immutably and honors conditional HEAD requests', async () => {
  const response = await fetch(`${origin}/assets/index-abcdefgh.js`);
  const etag = response.headers.get('etag');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.ok(etag);

  const notModified = await fetch(`${origin}/assets/index-abcdefgh.js`, {
    headers: { 'If-None-Match': etag },
  });
  assert.equal(notModified.status, 304);

  const head = await fetch(`${origin}/engrove-mark.svg`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String('<svg/>'.length));
  assert.equal(await head.text(), '');
});

test('rejects unsupported methods and does not disguise missing static assets as HTML', async () => {
  const unsupported = await fetch(`${origin}/`, { method: 'POST' });
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'GET, HEAD');

  const missing = await fetch(`${origin}/assets/missing.js`);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('cache-control'), 'no-store');
});
