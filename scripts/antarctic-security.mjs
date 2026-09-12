import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;

export function createAccessToken(secret, ttlMs = ACCESS_TOKEN_TTL_MS, now = Date.now()) {
  const expiresAt = now + ttlMs;
  const payload = `${expiresAt}.${randomBytes(18).toString('base64url')}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function isValidAccessToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const expiresAt = Number(parts[0]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('base64url'));
  const actual = Buffer.from(parts[2]);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function getCookie(request, name) {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export function createRateLimiter({ windowMs = 60 * 1000, maxEntries = 10_000 } = {}) {
  const buckets = new Map();

  function check(key, limit, now = Date.now()) {
    const bucketKey = `${key}:${limit}`;
    const current = buckets.get(bucketKey);
    const bucket = current && current.expiresAt > now
      ? current
      : { count: 0, expiresAt: now + windowMs };

    bucket.count += 1;
    buckets.set(bucketKey, bucket);

    if (buckets.size > maxEntries) {
      for (const [entryKey, entry] of buckets) {
        if (entry.expiresAt <= now || buckets.size > maxEntries) buckets.delete(entryKey);
        if (buckets.size <= maxEntries) break;
      }
    }

    return {
      allowed: bucket.count <= limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000))
    };
  }

  return { check };
}
