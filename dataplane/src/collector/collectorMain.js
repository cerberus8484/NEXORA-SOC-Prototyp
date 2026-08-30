'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Generischer Container-Entrypoint für ALLE Collectoren. `COLLECTOR_KIND`
// wählt das Plugin; die Runtime (Quelle/Emitter/Health) ist geteilt. Damit ist
// jeder Collector EIN eigenständiger Container — nur die ENV unterscheidet sie.
//
// COLLECTOR_KIND: conntrack | suricata | opnsense | wazuh | cowrie
// Gemeinsame ENV: INTAKE_URL · COLLECTOR_CREDENTIAL · INSTANCE_ID · HEALTH_PORT
//                 REPLAY_FILE/CONNTRACK_REPLAY_FILE · REPLAY_LOOP · REPLAY_DELAY_MS
// Quellenspezifisch: SCOPE_PORTS (conntrack) · ASSET_IPS (suricata/opnsense) · MIN_LEVEL (wazuh) · HONEYPOT_IP (cowrie)
const { runCollector } = require('./collectorRuntime');
const { createConntrackCollector } = require('./conntrackCollector');
const { createSuricataCollector } = require('./suricataCollector');
const { createOpnsenseCollector } = require('./opnsenseCollector');
const { createWazuhCollector } = require('./wazuhCollector');
const { createCowrieCollector } = require('./cowrieCollector');

function csvNums(v, def) {
  if (!v) return def;
  return String(v).split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
}
function csvStrs(v) {
  if (!v) return [];
  return String(v).split(',').map((x) => x.trim()).filter(Boolean);
}

/** Baut den Collector anhand COLLECTOR_KIND + ENV. Wirft bei unbekannter/fehlender Konfiguration. */
function buildCollector(env = process.env) {
  const kind = (env.COLLECTOR_KIND || '').toLowerCase();
  const instanceId = env.INSTANCE_ID || `${kind || 'collector'}-1`;
  switch (kind) {
    case 'conntrack':
      return createConntrackCollector({ instanceId, ports: csvNums(env.SCOPE_PORTS, [22, 2222]) });
    case 'suricata':
      return createSuricataCollector({ instanceId, assetIps: csvStrs(env.ASSET_IPS) });
    case 'opnsense':
      return createOpnsenseCollector({ instanceId, assetIps: csvStrs(env.ASSET_IPS) });
    case 'wazuh':
      return createWazuhCollector({ instanceId, minLevel: Number(env.MIN_LEVEL || 0) || 0 });
    case 'cowrie':
      return createCowrieCollector({ instanceId, honeypotIp: env.HONEYPOT_IP });
    default:
      throw new Error(`collectorMain: unbekannter COLLECTOR_KIND="${env.COLLECTOR_KIND}" (conntrack|suricata|opnsense|wazuh|cowrie)`);
  }
}

async function main() {
  const collector = buildCollector(process.env);
  process.stderr.write(JSON.stringify({ svc: 'collector', msg: 'started', collector: collector.name, domain: collector.domain }) + '\n');
  await runCollector({ collector });
  // Ohne Health-Port (stdin endete) sauber beenden; mit Health-Port bleibt der Server am Leben.
  if (!process.env.HEALTH_PORT) process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(JSON.stringify({ svc: 'collector', msg: 'fatal', error: err.message }) + '\n');
    process.exit(1);
  });
}

module.exports = { buildCollector };
