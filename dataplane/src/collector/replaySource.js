'use strict';

// Replay-Quelle für den Lab-Betrieb: liest conntrack-DESTROY-Zeilen aus einer Datei
// und gibt sie als async-Iterator an `runCollectorPipeline`. Damit läuft derselbe Collector
// im Lab-Container deterministisch (ohne Kernel-conntrack/Privilegien), während er auf
// der VPS stdin von `conntrack -E` konsumiert.
//
// `loop` + `delayMs` lassen den Lab-Container kontinuierlich Flows senden ("live"-Optik).
const fs = require('node:fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ filePath: string, loop?: boolean, delayMs?: number }} opts
 * @returns {AsyncGenerator<string>} nicht-leere, getrimmte Zeilen (ohne #-Kommentare)
 */
function createReplaySource({ filePath, loop = false, delayMs = 0 } = {}) {
  if (!filePath) throw new Error('createReplaySource: filePath required');
  if (!fs.existsSync(filePath)) throw new Error(`createReplaySource: file not found: ${filePath}`);

  const parse = (raw) =>
    raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));

  async function* gen() {
    do {
      const lines = parse(fs.readFileSync(filePath, 'utf8'));
      for (const line of lines) {
        yield line;
        if (delayMs > 0) await sleep(delayMs);
      }
    } while (loop);
  }
  return gen();
}

module.exports = { createReplaySource };
