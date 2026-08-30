'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { createIntakeApp } = require('../src/intake/server');
const { createInMemoryIntakeRepo } = require('../src/intake/inMemoryIntakeRepo');

const repo = createInMemoryIntakeRepo();
// Stub-Auth: nur das Test-Credential ergibt eine Identität.
const resolveAuth = (req) =>
  req.get('x-collector-credential') === 'good'
    ? { collectorId: 'col-1', tenantId: 'tenant-a', siteId: 'site-1' }
    : null;

let server; let base;
const envelope = () => ({
  schemaVersion: '1.0',
  eventId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  observedAt: '2026-06-24T19:05:20.935Z',
  source: { type: 'firewall', vendor: 'opnsense', instanceId: 'fw-01' },
  raw: { hash: 'a'.repeat(64), ref: 's3://raw/abc.json' },
  provenance: { parserVersion: '1.0.0', confidence: 0.9 },
});

before(async () => {
  const app = createIntakeApp({ repo, resolveAuth });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());
beforeEach(() => repo.clear());

const post = (body, cred) =>
  fetch(`${base}/v1/intake/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cred ? { 'x-collector-credential': cred } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('GET /health → 200 ok', async () => {
  const res = await fetch(`${base}/health`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).status, 'ok');
});

test('gültiger Envelope + Credential → 202 accepted', async () => {
  const res = await post(envelope(), 'good');
  assert.strictEqual(res.status, 202);
  assert.strictEqual((await res.json()).status, 'accepted');
});

test('zweites identisches Event → 200 duplicate', async () => {
  await post(envelope(), 'good');
  const res = await post(envelope(), 'good');
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).status, 'duplicate');
});

test('ohne/falsches Credential → 401', async () => {
  assert.strictEqual((await post(envelope(), 'bad')).status, 401);
  assert.strictEqual((await post(envelope())).status, 401);
});

test('ungültiger Envelope → 400 SCHEMA_INVALID', async () => {
  const res = await post({ ...envelope(), schemaVersion: '2.0' }, 'good');
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await res.json()).rejectionCode, 'SCHEMA_INVALID');
});

test('kaputtes JSON → 400 MALFORMED_JSON', async () => {
  const res = await post('{not json', 'good');
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await res.json()).rejectionCode, 'MALFORMED_JSON');
});
