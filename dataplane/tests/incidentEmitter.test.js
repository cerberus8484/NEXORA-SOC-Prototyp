'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createIncidentEmitter } = require('../src/engine/incidentEmitter');

const INC = { incidentId: 'a'.repeat(64), verdict: 'suspicious' };

function fakeFetch(status) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); if (status instanceof Error) throw status; return { status, ok: status < 300 }; };
  fn.calls = calls;
  return fn;
}

test('createIncidentEmitter: erfordert url + secret', () => {
  assert.throws(() => createIncidentEmitter({ secret: 's' }), /url/);
  assert.throws(() => createIncidentEmitter({ url: 'http://x' }), /secret/);
});

test('emit: HMAC-signiert (X-Webhook-Signature/-Timestamp), JSON-Body, resolved bei 202', async () => {
  const f = fakeFetch(202);
  const emit = createIncidentEmitter({ url: 'http://nexora/api/v1/dataplane/incidents', secret: 'sek', fetchImpl: f });
  await emit(INC);
  const { url, opts } = f.calls[0];
  assert.strictEqual(url, 'http://nexora/api/v1/dataplane/incidents');
  assert.match(opts.headers['x-webhook-signature'], /^sha256=[0-9a-f]{64}$/);
  assert.ok(opts.headers['x-webhook-timestamp']);
  // Signatur reproduzierbar aus timestamp + "." + body
  const ts = opts.headers['x-webhook-timestamp'];
  const expected = 'sha256=' + crypto.createHmac('sha256', 'sek').update(`${ts}.${opts.body}`).digest('hex');
  assert.strictEqual(opts.headers['x-webhook-signature'], expected);
  assert.deepStrictEqual(JSON.parse(opts.body), INC);
});

test('emit: 200 (Duplikat) = Erfolg, kein Throw', async () => {
  const emit = createIncidentEmitter({ url: 'http://n', secret: 's', fetchImpl: fakeFetch(200) });
  await assert.doesNotReject(() => emit(INC));
});

test('emit: non-2xx wirft → Worker markiert retry', async () => {
  const emit = createIncidentEmitter({ url: 'http://n', secret: 's', fetchImpl: fakeFetch(500) });
  await assert.rejects(() => emit(INC), /500/);
});

test('emit: Netzfehler wirft', async () => {
  const emit = createIncidentEmitter({ url: 'http://n', secret: 's', fetchImpl: fakeFetch(new Error('ECONNREFUSED')) });
  await assert.rejects(() => emit(INC), /ECONNREFUSED/);
});
