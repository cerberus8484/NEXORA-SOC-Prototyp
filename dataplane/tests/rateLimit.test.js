'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createRateLimiter } = require('../src/intake/rateLimit');

function res() {
  return { _status: null, _json: null, status(c) { this._status = c; return this; }, json(b) { this._json = b; return this; } };
}
function run(mw, ip) { const r = res(); let nexted = false; mw({ ip }, r, () => { nexted = true; }); return { r, nexted }; }

test('createRateLimiter: lässt bis zum Limit durch, dann 429', () => {
  let t = 1000;
  const mw = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  for (let i = 0; i < 3; i++) assert.strictEqual(run(mw, '1.2.3.4').nexted, true);
  const blocked = run(mw, '1.2.3.4');
  assert.strictEqual(blocked.nexted, false);
  assert.strictEqual(blocked.r._status, 429);
  assert.strictEqual(blocked.r._json.rejectionCode, 'RATE_LIMITED');
});

test('createRateLimiter: getrennte Zähler je IP', () => {
  let t = 0;
  const mw = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
  assert.strictEqual(run(mw, 'a').nexted, true);
  assert.strictEqual(run(mw, 'b').nexted, true);   // andere IP → eigenes Budget
  assert.strictEqual(run(mw, 'a').nexted, false);  // a erschöpft
});

test('createRateLimiter: neues Fenster setzt Zähler zurück', () => {
  let t = 0;
  const mw = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
  assert.strictEqual(run(mw, 'a').nexted, true);
  assert.strictEqual(run(mw, 'a').nexted, false);
  t += 1001;                                       // Fenster vorbei
  assert.strictEqual(run(mw, 'a').nexted, true);
});
