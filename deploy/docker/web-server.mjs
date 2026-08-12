import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

const defaultRoot = join(process.cwd(), 'dist');
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

export function webSecurityHeaders({ apiPublicUrl, storagePublicEndpoint } = {}) {
  const apiOrigin = sourceOrigin(apiPublicUrl ?? 'http://localhost:3000');
  const storageOrigin = sourceOrigin(storagePublicEndpoint ?? 'http://localhost:9000');
  const connectSources = [...new Set(["'self'", apiOrigin, storageOrigin].filter(Boolean))].join(
    ' ',
  );
  const imageSources = [
    ...new Set(["'self'", 'data:', 'blob:', storageOrigin].filter(Boolean)),
  ].join(' ');
  return {
    'content-security-policy': [
      "default-src 'self'",
      "base-uri 'self'",
      `connect-src ${connectSources}`,
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      `img-src ${imageSources}`,
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
    ].join('; '),
    'permissions-policy': 'camera=(), geolocation=(), microphone=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };
}

function immutableAsset(requestedPath) {
  return (
    requestedPath.startsWith('/assets/') &&
    /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(basename(requestedPath))
  );
}

function weakEtag(metadata) {
  return `W/"${metadata.size.toString(16)}-${Math.trunc(metadata.mtimeMs).toString(16)}"`;
}

function send(response, status, headers, body = '') {
  response.writeHead(status, headers);
  response.end(body);
}

export function createWebServer({
  rootDirectory = defaultRoot,
  apiPublicUrl = process.env.WEB_API_PUBLIC_URL,
  storagePublicEndpoint = process.env.S3_PUBLIC_ENDPOINT,
} = {}) {
  const securityHeaders = webSecurityHeaders({ apiPublicUrl, storagePublicEndpoint });

  async function handleRequest(request, response) {
    if (request.url === '/health') {
      send(
        response,
        200,
        {
          ...securityHeaders,
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
        },
        request.method === 'HEAD' ? '' : '{"status":"ok"}',
      );
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      send(response, 405, {
        ...securityHeaders,
        allow: 'GET, HEAD',
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      });
      return;
    }

    let requestedPath;
    try {
      requestedPath = normalize(decodeURIComponent((request.url ?? '/').split('?')[0])).replace(
        /^(\.\.[/\\])+/,
        '',
      );
    } catch {
      send(response, 400, {
        ...securityHeaders,
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      });
      return;
    }

    let file = join(rootDirectory, requestedPath === '/' ? 'index.html' : requestedPath);
    let metadata;
    let spaFallback = false;
    try {
      metadata = await stat(file);
      if (!metadata.isFile()) throw new Error('Not a file.');
    } catch {
      if (requestedPath.startsWith('/assets/') || extname(requestedPath)) {
        send(response, 404, {
          ...securityHeaders,
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        });
        return;
      }
      file = join(rootDirectory, 'index.html');
      metadata = await stat(file);
      spaFallback = true;
    }

    const etag = weakEtag(metadata);
    const cacheControl = immutableAsset(requestedPath)
      ? 'public, max-age=31536000, immutable'
      : extname(file) === '.html' || spaFallback
        ? 'no-cache'
        : 'public, max-age=3600, must-revalidate';
    const headers = {
      ...securityHeaders,
      'cache-control': cacheControl,
      'content-length': String(metadata.size),
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      etag,
      'last-modified': metadata.mtime.toUTCString(),
    };
    if (request.headers['if-none-match'] === etag) {
      send(response, 304, headers);
      return;
    }
    response.writeHead(200, headers);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on('error', () => {
      if (response.headersSent) response.destroy();
      else
        send(response, 500, {
          ...securityHeaders,
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        });
    });
    stream.pipe(response);
  }

  return createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      console.error('Unhandled web request error', error);
      if (response.headersSent) response.destroy();
      else
        send(response, 500, {
          ...securityHeaders,
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  createWebServer().listen(Number(process.env.PORT ?? 4173), '0.0.0.0');
