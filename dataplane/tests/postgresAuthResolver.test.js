'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createCollectorAuthResolver } = require('../src/intake/postgresAuthResolver');

const TOKEN = 'super-secret-collector-token';
const HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');

function fakePool(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) { calls.push({ sql, params }); return { rows, rowCount: rows.length }; },
  };
}
function req(headers = {}) { return { get: (h) => headers[h.toLowerCase()] }; }

test('resolveAuth: löst gültiges Credential zu Pro-Collector-Identität auf', async () => {
  const pool = fakePool([{ collector_id: 'col-1', tenant_id: 'ten-1', site_id: 'site-1' }]);
  const resolve = createCollectorAuthResolver({ pool });
  const auth = await resolve(req({ 'x-collector-credential': TOKEN }));
  assert.deepStrictEqual(auth, { collectorId: 'col-1', tenantId: 'ten-1', siteId: 'site-1' });
});

test('resolveAuth: vergleicht NUR den SHA-256-Hash, nie den Klartext (kein Timing-Leak)', async () => {
  const pool = fakePool([{ collector_id: 'col-1', tenant_id: 'ten-1', site_id: 'site-1' }]);
  const resolve = createCollectorAuthResolver({ pool });
  await resolve(req({ 'x-collector-credential': TOKEN }));
  const { params } = pool.calls[0];
  assert.strictEqual(params[0], HASH);                 // Hash als Query-Parameter
  assert.ok(!JSON.stringify(pool.calls).includes(TOKEN)); // Klartext taucht nirgends auf
});

test('resolveAuth: nur aktive Credentials (status active im WHERE)', async () => {
  const pool = fakePool([]);
  const resolve = createCollectorAuthResolver({ pool });
  await resolve(req({ 'x-collector-credential': TOKEN }));
  assert.match(pool.calls[0].sql, /status\s*=\s*'active'/i);
});

test('resolveAuth: unbekanntes Credential → null (kein Treffer)', async () => {
  const resolve = createCollectorAuthResolver({ pool: fakePool([]) });
  assert.strictEqual(await resolve(req({ 'x-collector-credential': 'wrong' })), null);
});

test('resolveAuth: fehlender Header → null, ohne DB-Abfrage', async () => {
  const pool = fakePool([]);
  const resolve = createCollectorAuthResolver({ pool });
  assert.strictEqual(await resolve(req({})), null);
  assert.strictEqual(pool.calls.length, 0);
});
