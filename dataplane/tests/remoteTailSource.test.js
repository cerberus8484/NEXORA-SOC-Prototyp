'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { getEventListeners } = require('node:events');
const { createRemoteTailSource } = require('../src/collector/remoteTailSource');

// Fake-Stream: async-iterable von String-Chunks (wie stdout eines `tail -F`).
async function* streamOf(chunks) { for (const c of chunks) yield c; }

async function drain(iterable, max = Infinity) {
  const out = [];
  for await (const line of iterable) { out.push(line); if (out.length >= max) break; }
  return out;
}

test('zerlegt Chunks in Zeilen (auch über Chunk-Grenzen hinweg)', async () => {
  const openStream = async () => streamOf(['foo\nba', 'r\nbaz\n']);
  const lines = await drain(createRemoteTailSource({ openStream, wait: async () => {} }), 3);
  assert.deepStrictEqual(lines, ['foo', 'bar', 'baz']);
});

test('überspringt Leerzeilen und strippt CR (\\r\\n)', async () => {
  const openStream = async () => streamOf(['a\r\n', '\n', 'b\n']);
  const lines = await drain(createRemoteTailSource({ openStream, wait: async () => {} }), 2);
  assert.deepStrictEqual(lines, ['a', 'b']);
});

test('Reconnect: endet der Stream (Verbindungsabbruch), wird neu geöffnet', async () => {
  const ctrl = new AbortController();
  let calls = 0;
  const waited = [];
  const openStream = async () => {
    calls += 1;
    if (calls === 1) return streamOf(['a\n']);
    if (calls === 2) return streamOf(['b\n']);
    ctrl.abort(); return streamOf([]);
  };
  const lines = await drain(createRemoteTailSource({
    openStream, wait: async (ms) => { waited.push(ms); }, reconnectWaitMs: 2000, signal: ctrl.signal,
  }));
  assert.deepStrictEqual(lines, ['a', 'b']);
  assert.ok(calls >= 2);                       // neu verbunden
  assert.ok(waited.every((w) => w === 2000));  // Backoff zwischen den Verbindungen
});

test('Fehler beim Öffnen → onError + Retry (kein Crash)', async () => {
  const ctrl = new AbortController();
  let calls = 0;
  const errors = [];
  const openStream = async () => {
    calls += 1;
    if (calls === 1) throw new Error('ssh connect failed');
    if (calls === 2) return streamOf(['ok\n']);
    ctrl.abort(); return streamOf([]);
  };
  const lines = await drain(createRemoteTailSource({
    openStream, wait: async () => {}, onError: (e) => errors.push(e.message), signal: ctrl.signal,
  }));
  assert.deepStrictEqual(lines, ['ok']);
  assert.deepStrictEqual(errors, ['ssh connect failed']);
});

test('AbortSignal beendet sauber', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const openStream = async () => streamOf(['x\n']);
  const lines = await drain(createRemoteTailSource({ openStream, wait: async () => {}, signal: ctrl.signal }));
  assert.deepStrictEqual(lines, []);
});

test('reconnect/wait räumt Abort-Listener wieder auf', async () => {
  const ctrl = new AbortController();
  let calls = 0;
  const openStream = async () => {
    calls += 1;
    if (calls <= 2) return streamOf(['x\n']);
    ctrl.abort();
    return streamOf([]);
  };
  await drain(createRemoteTailSource({
    openStream,
    reconnectWaitMs: 1,
    wait: (ms, signal) => new Promise((resolve) => {
      let settled = false;
      let onAbort = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const t = setTimeout(finish, ms);
      if (signal) {
        onAbort = () => { clearTimeout(t); finish(); };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }),
    signal: ctrl.signal,
  }));
  assert.strictEqual(getEventListeners(ctrl.signal, 'abort').length, 0);
});

test('openStream ist Pflicht', () => {
  assert.throws(() => createRemoteTailSource({}), /openStream/);
});
