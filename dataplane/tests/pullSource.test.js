'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createPollSource } = require('../src/collector/pullSource');

// Sammelt bis `max` Records (bricht dann ab → schließt die Quelle).
async function collect(iterable, max) {
  const out = [];
  for await (const r of iterable) { out.push(r); if (out.length >= max) break; }
  return out;
}

test('createPollSource: yieldet Records + reicht den Cursor weiter (nur Neues)', async () => {
  const seen = [];
  const fetchSince = async (cursor) => {
    seen.push(cursor);
    return seen.length === 1 ? { records: [{ id: 1 }], cursor: 'c1' } : { records: [{ id: 2 }], cursor: 'c2' };
  };
  const src = createPollSource({ fetchSince, intervalMs: 1, wait: async () => {}, startCursor: null });
  const out = await collect(src, 2);
  assert.deepStrictEqual(out, [{ id: 1 }, { id: 2 }]);
  assert.deepStrictEqual(seen, [null, 'c1']); // zweiter Pull nutzt den fortgeschrittenen Cursor
});

test('createPollSource: leere Antwort → kein Yield, weiter pollen bis Daten kommen', async () => {
  let n = 0;
  const fetchSince = async () => { n += 1; return n < 3 ? { records: [], cursor: null } : { records: [{ id: 9 }], cursor: null }; };
  const out = await collect(createPollSource({ fetchSince, intervalMs: 1, wait: async () => {} }), 1);
  assert.deepStrictEqual(out, [{ id: 9 }]);
  assert.ok(n >= 3);
});

test('createPollSource: intervalMs ist konfigurierbar (sek bis ms) und steuert das Warten', async () => {
  const waited = [];
  const fetchSince = async () => ({ records: [{ id: 1 }], cursor: null });
  await collect(createPollSource({ fetchSince, intervalMs: 50, wait: async (ms) => { waited.push(ms); } }), 2);
  assert.ok(waited.length >= 1 && waited.every((w) => w === 50));
});

test('createPollSource: Fehler in der Quelle → kein Crash, onError + weiter (Backoff)', async () => {
  let n = 0;
  const fetchSince = async () => { n += 1; if (n === 1) throw new Error('source down'); return { records: [{ id: 7 }], cursor: null }; };
  const errors = [];
  const out = await collect(createPollSource({ fetchSince, intervalMs: 1, wait: async () => {}, onError: (e) => errors.push(e.message) }), 1);
  assert.deepStrictEqual(out, [{ id: 7 }]);
  assert.deepStrictEqual(errors, ['source down']);
});

test('createPollSource: AbortSignal beendet die Schleife sauber', async () => {
  const ctrl = new AbortController();
  let n = 0;
  const fetchSince = async () => { n += 1; if (n === 2) ctrl.abort(); return { records: [], cursor: null }; };
  const out = [];
  for await (const r of createPollSource({ fetchSince, intervalMs: 1, wait: async () => {}, signal: ctrl.signal })) out.push(r);
  assert.deepStrictEqual(out, []);
  assert.ok(n <= 2);
});

test('createPollSource: fetchSince ist Pflicht', () => {
  assert.throws(() => createPollSource({}), /fetchSince/);
});
