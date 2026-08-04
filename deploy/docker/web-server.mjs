import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'dist');
const types = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function sourceOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

const apiOrigin = sourceOrigin(process.env.WEB_API_PUBLIC_URL ?? 'http://localhost:3000');
const storageOrigin = sourceOrigin(process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000');
const connectSources = [...new Set(["'self'", apiOrigin, storageOrigin].filter(Boolean))].join(' ');
const imageSources = [...new Set(["'self'", 'data:', 'blob:', storageOrigin].filter(Boolean))].join(
  ' ',
);
const contentSecurityPolicy = `default-src 'self'; connect-src ${connectSources}; img-src ${imageSources}`;

async function handleRequest(request, response) {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"status":"ok"}');
    return;
  }
  let requested;
  try {
    requested = normalize(decodeURIComponent((request.url ?? '/').split('?')[0])).replace(
      /^(\.\.[/\\])+/,
      '',
    );
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Malformed request path.');
    return;
  }
  let file = join(root, requested === '/' ? 'index.html' : requested);
  try {
    if (!(await stat(file)).isFile()) file = join(root, 'index.html');
  } catch {
    file = join(root, 'index.html');
  }
  response.writeHead(200, {
    'content-type': types[extname(file)] ?? 'application/octet-stream',
    'content-security-policy': contentSecurityPolicy,
  });
  const stream = createReadStream(file);
  stream.on('error', () => {
    if (response.headersSent) response.destroy();
    else {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('File could not be read.');
    }
  });
  stream.pipe(response);
}

createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error('Unhandled web request error', error);
    if (response.headersSent) response.destroy();
    else {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Internal server error.');
    }
  });
}).listen(Number(process.env.PORT ?? 4173), '0.0.0.0');
