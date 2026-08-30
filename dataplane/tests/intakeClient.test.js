'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createIntakeEmitter } = require('../src/collector/intakeClient');

const ENV = { schemaVersion: '1.0', eventId: 'e-1' };

function fakeFetch(responses) {
  // responses = Array von {status} oder Error; calls werden gesammelt.
  const calls = [];
  let i = 0;
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (r instanceof Error) throw r;
    return { status: r.status, ok: r.status >= 200 && r.status < 300 };
  };
  fn.calls = calls;
  return fn;
}

test('createIntakeEmitter: erfordert url + credential', () => {
  assert.throws(() => createIntakeEmitter({ credential: 'c' }), /url/);
  assert.throws(() => createIntakeEmitter({ url: 'http://x' }), /credential/);
});

test('emit: POSTet Envelope als JSON mit Credential-Header, resolved bei 202', async () => {
  const f = fakeFetch([{ status: 202 }]);
  const emit = createIntakeEmitter({ url: 'http://intake/v1/intake/events', credential: 'tok', fetchImpl: f });
  await emit(ENV);
  assert.strictEqual(f.calls.length, 1);
  const { url, opts } = f.calls[0];
  assert.strictEqual(url, 'http://intake/v1/intake/events');
  assert.strictEqual(opts.method, 'POST');
  assert.strictEqual(opts.headers['content-type'], 'application/json');
  assert.strictEqual(opts.headers['x-collector-credential'], 'tok');
  assert.deepStrictEqual(JSON.parse(opts.body), ENV);
});

test('emit: 200 (idempotent duplicate) gilt als Erfolg, kein onError', async () => {
  let errCount = 0;
  const f = fakeFetch([{ status: 200 }]);
  const emit = createIntakeEmitter({ url: 'http://intake', credential: 'tok', fetchImpl: f, onError: () => { errCount += 1; } });
  await emit(ENV);
  assert.strictEqual(errCount, 0);
});

test('emit: non-2xx (z.B. 400) ruft onError mit Status, wirft NICHT', async () => {
  const errs = [];
  const f = fakeFetch([{ status: 400 }]);
  const emit = createIntakeEmitter({ url: 'http://intake', credential: 'tok', fetchImpl: f, onError: (e) => errs.push(e) });
  await emit(ENV); // darf nicht werfen
  assert.strictEqual(errs.length, 1);
  assert.strictEqual(errs[0].status, 400);
});

test('emit: Netzfehler ruft onError mit error, wirft NICHT (Runner läuft weiter)', async () => {
  const errs = [];
  const f = fakeFetch([new Error('ECONNREFUSED')]);
  const emit = createIntakeEmitter({ url: 'http://intake', credential: 'tok', fetchImpl: f, onError: (e) => errs.push(e) });
  await emit(ENV);
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0].error, /ECONNREFUSED/);
});
