'use strict';

// Lab-Smoke (ADR-036 Slice 3): ein INTERNER Prozess zieht per read-only SSH-`tail -F`
// ein laufendes Log einer externen Quelle und normalisiert es zu gültigen Envelopes —
// OHNE etwas zu schreiben (emit = lokaler Zähler). Beweist die interne Pull-Mechanik.
//
// Konfiguration NUR über ENV (keine realen Werte im Repo):
//   SMOKE_SSH_HOST · SMOKE_SSH_USER · SMOKE_SSH_PORT · SMOKE_SSH_KEY
//   SMOKE_PROXYJUMP · SMOKE_PROXYJUMP_KEY · SMOKE_LOGPATH · SMOKE_HONEYPOT_IP · SMOKE_SECONDS
//
// Lauf:  node tools/pull-hub-smoke.js     (mit gesetzten ENV)

const { spawn } = require('node:child_process');
const { buildSshTailArgs, createSshTailOpenStream } = require('../src/collector/sshTail');
const { createRemoteTailSource } = require('../src/collector/remoteTailSource');
const { createCowrieCollector } = require('../src/collector/cowrieCollector');
const { runCollectorPipeline } = require('../src/collector/runCollectorPipeline');

function reqEnv(name) { const v = process.env[name]; if (!v) throw new Error(`ENV ${name} fehlt`); return v; }

async function main() {
  const seconds = Number(process.env.SMOKE_SECONDS || 20);
  const args = buildSshTailArgs({
    host: reqEnv('SMOKE_SSH_HOST'), user: process.env.SMOKE_SSH_USER, port: Number(process.env.SMOKE_SSH_PORT) || undefined,
    identityFile: process.env.SMOKE_SSH_KEY, proxyJump: process.env.SMOKE_PROXYJUMP, proxyJumpKey: process.env.SMOKE_PROXYJUMP_KEY,
    logPath: reqEnv('SMOKE_LOGPATH'),
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), seconds * 1000);

  const openStream = createSshTailOpenStream({ spawn, args });
  const source = createRemoteTailSource({ openStream, signal: ctrl.signal, onError: (e) => process.stderr.write(`tail: ${e.message}\n`) });
  const collector = createCowrieCollector({ instanceId: 'smoke', honeypotIp: reqEnv('SMOKE_HONEYPOT_IP') });

  let emitted = 0; let sample = null;
  process.stderr.write(`[smoke] internes Pull läuft ${seconds}s (read-only tail über SSH)…\n`);
  const stats = await runCollectorPipeline(collector, source, {
    emit: (env) => { emitted += 1; if (!sample) sample = env; },
  });
  clearTimeout(timer);

  console.log(JSON.stringify({
    emitted, stats,
    sample: sample && {
      vendor: sample.source.vendor, domain: sample.source.type,
      srcIp: sample.normalized && sample.normalized.network && sample.normalized.network.srcIp,
      detection: sample.normalized && sample.normalized.detection && sample.normalized.detection.signature,
      severity: sample.normalized && sample.normalized.detection && sample.normalized.detection.severity,
    },
  }, null, 2));
}

main().catch((err) => { process.stderr.write(`[smoke] FEHLER: ${err.message}\n`); process.exit(1); });
