'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Geteilte Collector-Runtime — ein eigenständiger Collector-Container besteht aus:
//   Quelle (stdin/Replay) → runCollectorPipeline(collector) → Intake-Emitter (POST) + Health.
// Diese Funktion bündelt genau das, transport- und collector-agnostisch, damit jeder
// Collector (conntrack/suricata/opnsense/wazuh) denselben Container-Lifecycle teilt.
//
// Bewusst OHNE process.exit / ohne globale Effekte → testbar (fetchImpl + source injizierbar).
// Den Exit-/Stdin-Lebenszyklus regelt der dünne Entrypoint (collectorMain.js).
const http = require('node:http');
const readline = require('node:readline');
const { createIntakeEmitter } = require('./intakeClient');
const { createReplaySource } = require('./replaySource');
const { runCollectorPipeline } = require('./runCollectorPipeline');

const DEFAULT_INTAKE = 'http://127.0.0.1:8081/v1/intake/events';

function log(o) { process.stderr.write(JSON.stringify({ svc: 'collector', ...o }) + '\n'); }

/** Roh-Zeilen-Quelle aus ENV: Replay-Datei (Lab) oder stdin (`conntrack -E` / `tail -f`). */
function buildLineSource(env = process.env) {
  const replay = env.CONNTRACK_REPLAY_FILE || env.REPLAY_FILE;
  if (replay) {
    const loop = /^(1|true|yes)$/i.test(env.REPLAY_LOOP || env.CONNTRACK_REPLAY_LOOP || '');
    const delayMs = Number(env.REPLAY_DELAY_MS || env.CONNTRACK_REPLAY_DELAY_MS || 0) || 0;
    log({ msg: 'source: replay file', file: replay, loop, delayMs });
    return createReplaySource({ filePath: replay, loop, delayMs });
  }
  log({ msg: 'source: stdin' });
  return readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
}

/**
 * Führt einen Collector als Collector aus.
 * @param {{
 *   collector: object,
 *   source?: Iterable|AsyncIterable,   // default: ENV-Quelle (Replay/stdin)
 *   env?: object,                      // default: process.env
 *   fetchImpl?: typeof fetch,          // default: global fetch (Tests injizieren)
 * }} opts
 * @returns {Promise<{stats:object, counters:object, stopHealth:()=>void}>}
 */
async function runCollector({ collector, source, env = process.env, fetchImpl } = {}) {
  if (!collector || typeof collector.normalize !== 'function') {
    throw new Error('runCollector: collector required');
  }
  const counters = { emitted: 0, skipped: 0, invalid: 0, errors: 0 };

  const emit = createIntakeEmitter({
    url: env.INTAKE_URL || DEFAULT_INTAKE,
    credential: env.COLLECTOR_CREDENTIAL,  // Pflicht — createIntakeEmitter wirft, wenn nicht gesetzt (kein stiller Dev-Default)
    fetchImpl: fetchImpl || globalThis.fetch,
    onError: (info) => { counters.errors += 1; log({ msg: 'intake emit error', ...info }); },
  });

  const stopHealth = startHealthServer(Number(env.HEALTH_PORT || 0) || 0, collector, counters);

  const stats = await runCollectorPipeline(collector, source || buildLineSource(env), {
    emit: async (e) => { await emit(e); counters.emitted += 1; },
  });
  counters.skipped = stats.skipped;
  counters.invalid = stats.invalid;
  log({ msg: 'source drained', collector: collector.name, stats });
  return { stats, counters, stopHealth };
}

/** Optionaler Health-Server (Container-Liveness): /health → Identität + Live-Zähler. */
function startHealthServer(port, collector, counters) {
  if (!port) return () => {};
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok', service: 'collector',
        collector: collector.name, domain: collector.domain, counters,
      }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, () => log({ msg: 'health server listening', port }));
  return () => server.close();
}

module.exports = { runCollector, buildLineSource };
