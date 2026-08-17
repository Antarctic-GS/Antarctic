import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomBytes } from 'node:crypto';
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
const relaySessionTtlMs = 30 * 60 * 1000;
const relaySessions = new Map();

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

function removeExpiredRelaySessions() {
  const expiration = Date.now() - relaySessionTtlMs;
  for (const [id, session] of relaySessions) {
    if (session.createdAt < expiration) relaySessions.delete(id);
  }
}

function createRelaySession(backend, target) {
  removeExpiredRelaySessions();
  let id;
  do {
    id = randomBytes(18).toString('base64url');
  } while (relaySessions.has(id));

  relaySessions.set(id, { backend, target, createdAt: Date.now() });
  return id;
}

function decodeRelayLinkSession(id) {
  const separator = id.indexOf('.');
  if (separator < 1 || separator === id.length - 1) return null;

  try {
    const encodedPayload = id.slice(separator + 1);
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!['scramjet', 'ultraviolet'].includes(payload?.backend)) return null;

    const targetUrl = new URL(payload.target);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) return null;

    const session = {
      backend: payload.backend,
      target: targetUrl.href,
      createdAt: Date.now()
    };
    relaySessions.set(id, session);
    return session;
  } catch {
    return null;
  }
}

function serializeInlineConfig(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

async function renderRelaySession(session) {
  const targetQuery = new URLSearchParams({
    backend: session.backend,
    embed: '1',
    url: session.target
  }).toString();
  const frameSource = `/assets/relay/?${targetQuery}`;
  const frameSourceJson = serializeInlineConfig(frameSource);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Antarctic relay</title>
    <style>
      :root, body, #relay-session-frame { width: 100%; height: 100%; }
      html, body { margin: 0; overflow: hidden; background: #081426; }
      #relay-session-frame { display: block; border: 0; }
    </style>
  </head>
  <body>
    <iframe id="relay-session-frame" title="Antarctic relay" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
    <script>
      const parentWindow = window.parent;
      const relayFrame = document.getElementById('relay-session-frame');
      relayFrame.src = ${frameSourceJson};
      window.addEventListener('message', (event) => {
        if (event.source === relayFrame.contentWindow) {
          parentWindow.postMessage(event.data, event.origin);
          return;
        }
        if (event.source === parentWindow) {
          relayFrame.contentWindow?.postMessage(event.data, event.origin);
        }
      });
    </script>
  </body>
</html>`;
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

function extractJsonAfterMarker(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;

  const start = source.indexOf('{', markerIndex + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) {
      try {
        return JSON.parse(source.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function textFromRenderer(value) {
  if (!value || typeof value !== 'object') return '';
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map(run => run?.text ?? '').join('');
  return '';
}

function collectYouTubeResults(value, results, seenIds) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(item => collectYouTubeResults(item, results, seenIds));
    return;
  }

  if (typeof value.videoId === 'string' && !seenIds.has(value.videoId)) {
    const title = textFromRenderer(value.title) || textFromRenderer(value.headline) || value.accessibility?.accessibilityData?.label;
    if (title) {
      const thumbnails = value.thumbnail?.thumbnails;
      const thumbnail = Array.isArray(thumbnails) && thumbnails.length
        ? thumbnails[thumbnails.length - 1]?.url
        : `https://i.ytimg.com/vi/${encodeURIComponent(value.videoId)}/hqdefault.jpg`;
      seenIds.add(value.videoId);
      results.push({
        videoId: value.videoId,
        title: title.replace(/\s+/g, ' ').trim().slice(0, 120),
        sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(value.videoId)}`,
        thumbnail
      });
    }
  }

  Object.values(value).forEach(child => collectYouTubeResults(child, results, seenIds));
}

async function searchYouTube(query) {
  const target = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const response = await fetch(target, {
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
    }
  });
  if (!response.ok) throw new Error(`YouTube search returned ${response.status}.`);

  const html = await response.text();
  const initialData = extractJsonAfterMarker(html, 'var ytInitialData = ')
    || extractJsonAfterMarker(html, 'ytInitialData = ');
  if (!initialData) return [];

  const results = [];
  collectYouTubeResults(initialData, results, new Set());
  const playlistLikeTitle = /\b(playlist|mix|compilation|radio|continuous|nonstop|greatest hits|top\s+\d+|best of)\b/i;
  const songResults = results.filter(result => !playlistLikeTitle.test(result.title));
  return songResults.slice(0, 12);
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

  if (url.pathname === '/api/relay/session') {
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
      sendJson(response, 405, { error: 'Use POST to create a relay session.' });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const backend = body?.backend;
      const target = typeof body?.url === 'string' ? body.url.trim() : '';
      if (!['scramjet', 'ultraviolet'].includes(backend)) {
        sendJson(response, 400, { error: 'A valid relay backend is required.' });
        return;
      }

      let targetUrl;
      try {
        targetUrl = new URL(target);
      } catch {
        sendJson(response, 400, { error: 'A valid target URL is required.' });
        return;
      }

      if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        sendJson(response, 400, { error: 'Relay targets must use HTTP or HTTPS.' });
        return;
      }

      const id = createRelaySession(backend, targetUrl.href);
      sendJson(response, 201, {
        backend,
        id,
        path: `/relay/${id}`,
        url: targetUrl.href
      });
    } catch (error) {
      console.error('Unable to create relay session:', error);
      sendJson(response, 400, { error: 'Unable to create a relay session.' });
    }
    return;
  }

  const relaySessionMatch = url.pathname.match(/^\/relay\/([A-Za-z0-9_.-]+)$/);
  if (relaySessionMatch) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Use GET for a relay session.' });
      return;
    }

    removeExpiredRelaySessions();
    const session = relaySessions.get(relaySessionMatch[1]) || decodeRelayLinkSession(relaySessionMatch[1]);
    if (!session) {
      sendJson(response, 404, { error: 'Relay session not found or expired.' });
      return;
    }

    try {
      const body = await renderRelaySession(session);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
        'Content-Type': 'text/html; charset=utf-8'
      });
      if (request.method === 'HEAD') {
        response.end();
      } else {
        response.end(body);
      }
    } catch (error) {
      console.error('Unable to render relay session:', error);
      sendJson(response, 500, { error: 'Unable to render the relay session.' });
    }
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

  if (url.pathname === '/api/music/search') {
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
      sendJson(response, 405, { error: 'Use GET for music search.' });
      return;
    }

    const query = url.searchParams.get('q')?.trim();
    if (!query) {
      sendJson(response, 400, { error: 'A search query is required.' });
      return;
    }

    try {
      sendJson(response, 200, { results: await searchYouTube(query) });
    } catch (error) {
      console.error('Unable to search YouTube:', error);
      sendJson(response, 502, { error: 'Unable to search YouTube right now.' });
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
  const headers = {
    'Cache-Control': 'no-cache',
    'Content-Length': stats.size,
    'Content-Type': contentType
  };
  if (filePath === resolve(rootDirectory, 'assets/relay/sw.js')) {
    headers['Service-Worker-Allowed'] = '/';
  }
  response.writeHead(200, headers);

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
