'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Hub-Entrypoint (ADR-036): Config → echte Factories → Collector-Hub.
// EINE Config-Liste beschreibt alle Kollektoren; der Hub fährt sie intern + pullt
// automatisch. Erweiterbar = ein Eintrag mehr. Alle schweren Abhängigkeiten sind
// injizierbar (deps) → testbar ohne SSH/Intake; Prod-Defaults s.u.
//
// config = { intakeUrl, collectors: [{
//     name, kind, options?, credential,
//     source: { mode:'tail', ssh:{host,user,port,identityFile,proxyJump,proxyJumpKey}, logPath }
//            | { mode:'poll', intervalMs?, startCursor?, fetchSince } }] }
// ─────────────────────────────────────────────────────────────────────────

const { createCollectorHub } = require('./collectorHub');
const { createRemoteTailSource } = require('./remoteTailSource');
const { createPollSource } = require('./pullSource');
const { buildSshTailArgs, createSshTailOpenStream } = require('./sshTail');
const { buildStatusReporterFromEnv } = require('../status/statusReporter');

// — Prod-Defaults (dünne Kompositionen bereits getesteter Module) —
function defaultBuildCollector(spec) {
  const { buildCollector } = require('./collectorMain');
  const o = spec.options || {};
  return buildCollector({
    COLLECTOR_KIND: spec.kind,
    INSTANCE_ID: spec.name,
    ASSET_IPS: (o.assetIps || []).join(','),
    SCOPE_PORTS: (o.scopePorts || []).join(','),
    MIN_LEVEL: o.minLevel != null ? String(o.minLevel) : undefined,
    HONEYPOT_IP: o.honeypotIp,
  });
}

function defaultMakeEmitter({ intakeUrl, resolveCredential, fetchImpl }) {
  const { createIntakeEmitter } = require('./intakeClient');
  const cache = new Map(); // ein Emitter je Credential (per-Collector-Identität)
  return async (env, spec) => {
    const cred = resolveCredential(spec.credential);
    let emit = cache.get(cred);
    if (!emit) { emit = createIntakeEmitter({ url: intakeUrl, credential: cred, fetchImpl }); cache.set(cred, emit); }
    return emit(env);
  };
}

function findWeakHostKeyCollectors(config, env = process.env) {
  const globalMode = env.COLLECTOR_SSH_STRICT_HOST_KEY || 'accept-new';
  const collectors = Array.isArray(config && config.collectors) ? config.collectors : [];
  return collectors
    .filter((spec) => spec && spec.source && spec.source.mode === 'tail')
    .map((spec) => ({
      name: spec.name || '?',
      mode: (spec.source.ssh && spec.source.ssh.strictHostKeyChecking) || globalMode,
    }))
    .filter((item) => item.mode === 'accept-new');
}

function buildHubFromConfig(config, deps = {}) {
  if (!config || !config.intakeUrl) throw new Error('hubConfig: intakeUrl required');
  if (!Array.isArray(config.collectors)) throw new Error('hubConfig: collectors[] required');
  for (const c of config.collectors) {
    if (!c || !c.source || !c.source.mode) throw new Error(`hubConfig: ${(c && c.name) || '?'}: source.mode required`);
  }

  const {
    buildCollector = defaultBuildCollector,
    spawn = require('node:child_process').spawn,
    wait, // an die Pull-Quellen durchgereicht; undefined → deren Default (echtes setTimeout)
    makeEmitter = defaultMakeEmitter,
    resolveCredential = (ref) => (ref && process.env[ref]) || ref,
    fetchImpl,
  } = deps;

  const emit = makeEmitter({ intakeUrl: config.intakeUrl, resolveCredential, fetchImpl });

  const makeCollector = (spec) => buildCollector(spec);
  const makeSource = (spec, { signal }) => {
    const s = spec.source;
    if (s.mode === 'tail') {
      // HostKey-Modus: per-Collector (ssh.strictHostKeyChecking) > global ENV > Default accept-new.
      const args = buildSshTailArgs({
        ...(s.ssh || {}),
        logPath: s.logPath,
        filter: s.filter,
        strictHostKeyChecking: (s.ssh && s.ssh.strictHostKeyChecking) || process.env.COLLECTOR_SSH_STRICT_HOST_KEY || 'accept-new',
      });
      const openStream = createSshTailOpenStream({ spawn, args });
      return createRemoteTailSource({ openStream, signal, wait });
    }
    if (s.mode === 'poll') {
      return createPollSource({ fetchSince: s.fetchSince, intervalMs: s.intervalMs, startCursor: s.startCursor, signal, wait });
    }
    throw new Error(`hubConfig: ${spec.name}: unbekannter source.mode "${s.mode}"`);
  };

  return createCollectorHub({ specs: config.collectors, makeCollector, makeSource, emit });
}

/** Lädt + parst die Hub-Config aus einer JSON-Datei. readFileSync injizierbar (Test). */
function loadHubConfig(filePath, { readFileSync = require('node:fs').readFileSync } = {}) {
  if (!filePath) throw new Error('hubConfig: HUB_CONFIG_FILE Pfad erforderlich');
  const raw = readFileSync(filePath, 'utf8');
  try { return JSON.parse(raw); } catch (e) { throw new Error(`hubConfig: ungültiges JSON in ${filePath}: ${e.message}`); }
}

// — Container-Entrypoint: Config laden → Hub starten → bei SIGTERM/SIGINT sauber stoppen —
async function main() {
  const config = loadHubConfig(process.env.HUB_CONFIG_FILE);
  const weakCollectors = findWeakHostKeyCollectors(config, process.env);
  if (weakCollectors.length) {
    process.stderr.write(JSON.stringify({
      svc: 'collector-hub',
      msg: 'weak_hostkey_policy',
      strictHostKeyChecking: 'accept-new',
      collectors: weakCollectors.map((item) => item.name),
      hint: 'Setze COLLECTOR_SSH_STRICT_HOST_KEY=yes oder pro Collector ssh.strictHostKeyChecking=yes',
    }) + '\n');
  }
  const hub = buildHubFromConfig(config);
  const ctrl = new AbortController();
  const shutdown = () => { process.stderr.write(JSON.stringify({ svc: 'collector-hub', msg: 'shutdown' }) + '\n'); ctrl.abort(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.stderr.write(JSON.stringify({ svc: 'collector-hub', msg: 'started', collectors: config.collectors.map((c) => c.name) }) + '\n');
  hub.start({ signal: ctrl.signal });
  const statusTimer = setInterval(() => {
    process.stderr.write(JSON.stringify({ svc: 'collector-hub', msg: 'status', collectors: hub.status() }) + '\n');
  }, 30000);

  // Hub↔Backend-Status-Brücke (ENV-gated): meldet Live-Status periodisch an Nexora.
  // null = AUS (kein NEXORA_STATUS_URL/WEBHOOK_SECRET_DATAPLANE). fail-soft.
  const reporter = buildStatusReporterFromEnv({
    hub,
    makePool: (url) => new (require('pg').Pool)({ connectionString: url }),
    onError: (err) => process.stderr.write(JSON.stringify({ svc: 'collector-hub', msg: 'status_push_error', error: err.message }) + '\n'),
  });
  if (reporter) process.stderr.write(JSON.stringify({ svc: 'collector-hub', msg: 'status_bridge_enabled' }) + '\n');

  await hub.wait();
  if (reporter) reporter.stop();
  clearInterval(statusTimer);
  process.stderr.write(JSON.stringify({ svc: 'collector-hub', msg: 'stopped' }) + '\n');
}

if (require.main === module) {
  main().catch((err) => { process.stderr.write(JSON.stringify({ svc: 'collector-hub', msg: 'fatal', error: err.message }) + '\n'); process.exit(1); });
}

module.exports = { buildHubFromConfig, loadHubConfig, defaultBuildCollector, defaultMakeEmitter, findWeakHostKeyCollectors };
