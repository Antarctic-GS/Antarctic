import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { extname, join, normalize, relative, resolve } from 'node:path';
import process from 'node:process';

import { createChallenge, randomInt, verifySolution } from '../assets/relay/package/node_modules/altcha-lib/dist/esm/v2/index.js';
import { deriveKey } from '../assets/relay/package/node_modules/altcha-lib/dist/esm/v2/algorithms/pbkdf2.js';

const rootDirectory = resolve(process.env.ANTARCTIC_SITE_ROOT ?? process.cwd());
const port = Number(process.env.ANTARCTIC_SITE_PORT ?? 3000);
const tlsCertificate = process.env.ANTARCTIC_TLS_CERT;
const tlsKey = process.env.ANTARCTIC_TLS_KEY;
const hmacSecret = process.env.ALTCHA_HMAC_SECRET ?? 'local-development-secret-change-me';
const challengeCost = Number(process.env.ALTCHA_COST ?? 5_000);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(body);
}

async function createAltchaChallenge() {
  return createChallenge({
    algorithm: 'PBKDF2/SHA-256',
    cost: challengeCost,
    counter: randomInt(5_000, 10_000),
    deriveKey,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    hmacSignatureSecret: hmacSecret
  });
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) {
      throw new Error('Request body is too large.');
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function resolveStaticPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath);
  const requestedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const absolutePath = resolve(rootDirectory, `.${normalize(requestedPath)}`);
  const relativePath = relative(rootDirectory, absolutePath);

  if (relativePath.startsWith('..') || relativePath.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    return null;
  }

  return absolutePath;
}

async function findStaticFile(urlPath) {
  const requestedPath = resolveStaticPath(urlPath);
  if (!requestedPath) {
    return null;
  }

  const candidates = [requestedPath];
  if (!extname(requestedPath)) {
    candidates.push(`${requestedPath}.html`);
    candidates.push(join(requestedPath, 'index.html'));
  }

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) {
        return candidate;
      }
    } catch {
      // Try the next static-file candidate.
    }
  }

  return null;
}

async function handleRequest(request, response) {
  let url;
  try {
    url = new URL(request.url ?? '/', 'http://antarctic.local');
  } catch {
    sendJson(response, 400, { error: 'Invalid request URL.' });
    return;
  }

  if (url.pathname === '/api/captcha/challenge') {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Origin': '*'
      });
      response.end();
      return;
    }

    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Use GET for a challenge.' });
      return;
    }

    try {
      sendJson(response, 200, await createAltchaChallenge());
    } catch (error) {
      console.error('Unable to create an Altcha challenge:', error);
      sendJson(response, 500, { error: 'Unable to create a CAPTCHA challenge.' });
    }
    return;
  }

  if (url.pathname === '/api/captcha/verify') {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Origin': '*'
      });
      response.end();
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Use POST to verify a solution.' });
      return;
    }

    try {
      const body = await readJsonBody(request);
      if (typeof body?.payload !== 'string') {
        sendJson(response, 400, { error: 'A CAPTCHA payload is required.' });
        return;
      }

      const payload = JSON.parse(Buffer.from(body.payload, 'base64').toString('utf8'));
      if (!payload?.challenge || !payload?.solution) {
        sendJson(response, 400, { error: 'The CAPTCHA payload is incomplete.' });
        return;
      }

      const result = await verifySolution({
        challenge: payload.challenge,
        deriveKey,
        hmacSignatureSecret: hmacSecret,
        solution: payload.solution
      });

      sendJson(response, 200, { verified: result.verified });
    } catch (error) {
      console.error('Unable to verify the Altcha solution:', error);
      sendJson(response, 400, { error: 'Unable to verify the CAPTCHA solution.' });
    }
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  let filePath;
  try {
    filePath = await findStaticFile(url.pathname);
  } catch {
    filePath = null;
  }

  if (!filePath) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  const contentType = contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const stats = await fs.stat(filePath);
  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Length': stats.size,
    'Content-Type': contentType
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

const serverOptions = tlsCertificate && tlsKey
  ? {
      cert: await fs.readFile(tlsCertificate),
      key: await fs.readFile(tlsKey)
    }
  : undefined;
const server = serverOptions ? createHttpsServer(serverOptions, handleRequest) : createHttpServer(handleRequest);

server.listen(port, '0.0.0.0', () => {
  const protocol = serverOptions ? 'https' : 'http';
  console.log(`Antarctic site ready at ${protocol}://127.0.0.1:${port}/`);
  console.log(`Altcha challenge endpoint: ${protocol}://127.0.0.1:${port}/api/captcha/challenge`);
});
