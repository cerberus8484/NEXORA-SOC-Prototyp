'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReplaySource } = require('../src/collector/replaySource');

function tmpFile(content) {
  const p = path.join(os.tmpdir(), `replay-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  fs.writeFileSync(p, content);
  return p;
}

async function collect(iter, max = Infinity) {
  const out = [];
  for await (const line of iter) { out.push(line); if (out.length >= max) break; }
  return out;
}

test('createReplaySource: liefert nicht-leere, getrimmte Zeilen (einmal)', async () => {
  const p = tmpFile('lineA\n\n  lineB  \n# comment\nlineC\n');
  try {
    const lines = await collect(createReplaySource({ filePath: p }));
    assert.deepStrictEqual(lines, ['lineA', 'lineB', 'lineC']);
  } finally { fs.unlinkSync(p); }
});

test('createReplaySource: # comment-Zeilen werden ignoriert', async () => {
  const p = tmpFile('# header\nreal=1\n#skip\nreal=2\n');
  try {
    const lines = await collect(createReplaySource({ filePath: p }));
    assert.deepStrictEqual(lines, ['real=1', 'real=2']);
  } finally { fs.unlinkSync(p); }
});

test('createReplaySource: loop wiederholt die Datei (über max abgebrochen)', async () => {
  const p = tmpFile('x\ny\n');
  try {
    const lines = await collect(createReplaySource({ filePath: p, loop: true, delayMs: 0 }), 5);
    assert.deepStrictEqual(lines, ['x', 'y', 'x', 'y', 'x']);
  } finally { fs.unlinkSync(p); }
});

test('createReplaySource: fehlende Datei → Fehler', () => {
  assert.throws(() => createReplaySource({ filePath: '/does/not/exist/nope.txt' }), /not found|ENOENT/i);
});

test('createReplaySource: ohne filePath → Fehler', () => {
  assert.throws(() => createReplaySource({}), /filePath/);
});
