import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createAccessToken,
  createRateLimiter,
  getCookie,
  isValidAccessToken
} from './antarctic-security.mjs';

test('access tokens validate, expire, and reject tampering', () => {
  const issuedAt = 1_700_000_000_000;
  const token = createAccessToken('test-secret', 1_000, issuedAt);

  assert.equal(isValidAccessToken(token, 'test-secret', issuedAt + 999), true);
  assert.equal(isValidAccessToken(token, 'test-secret', issuedAt + 1_000), false);
  assert.equal(isValidAccessToken(`${token}x`, 'test-secret', issuedAt), false);
  assert.equal(isValidAccessToken(token, 'other-secret', issuedAt), false);
});

test('cookies are read by name without confusing prefixes', () => {
  const request = { headers: { cookie: 'other=value; antarctic_access=token-value; trailing=yes' } };
  assert.equal(getCookie(request, 'antarctic_access'), 'token-value');
  assert.equal(getCookie(request, 'access'), null);
});

test('rate limiter blocks only after the configured limit', () => {
  const limiter = createRateLimiter({ windowMs: 1_000 });
  assert.equal(limiter.check('client', 2, 5_000).allowed, true);
  assert.equal(limiter.check('client', 2, 5_100).allowed, true);
  assert.equal(limiter.check('client', 2, 5_200).allowed, false);
  assert.equal(limiter.check('client', 2, 6_001).allowed, true);
});

test('relay regressions stay fixed', async () => {
  const serviceWorker = await readFile(new URL('../assets/relay/sw.js', import.meta.url), 'utf8');
  const rewriter = await readFile(new URL('../assets/relay/antarctic-link-rewriter.js', import.meta.url), 'utf8');
  const terms = await readFile(new URL('../terms.html', import.meta.url), 'utf8');

  assert.match(serviceWorker, /response\.clone\(\)\.text\(\)/);
  assert.doesNotMatch(serviceWorker, /const body = await response\.text\(\)/);
  assert.match(rewriter, /DOMContentLoaded/);
  assert.match(rewriter, /try \{/);
  assert.doesNotMatch(terms, /\[YOUR EMAIL\]/);
});
