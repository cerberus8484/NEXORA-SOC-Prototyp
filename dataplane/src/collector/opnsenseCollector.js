'use strict';

// ─────────────────────────────────────────────────────────────────────────
// FIREWALL-Collector — OPNsense `filterlog` (CSV). Parst dasselbe Feld wie der
// vorhandene Go-Collector → erzeugt die GLEICHE Envelope-Form (normalized.network
// mit direction + firewall-Verdikt). domain "firewall", vendor "opnsense".
//
// filterlog-CSV (kommagetrennt, KEINE Leerzeichen im Datensatz):
//   0 rulenr · 4 interface · 6 action(pass/block) · 7 direction(in/out) · 8 ipversion
//   v4: 16 protoname · 18 src · 19 dst · 20 srcport · 21 dstport
//   v6: 12 protoname · 15 src · 16 dst · 17 srcport · 18 dstport
// Ein evtl. Syslog-Präfix wird gestrippt (CSV = letztes whitespace-Token).
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('node:crypto');

function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function clean(v) { return (typeof v === 'string' && v.trim() !== '') ? v.trim() : null; }

/**
 * Parst eine filterlog-Zeile (mit/ohne Syslog-Präfix) in ein Verdikt + 5-Tuple.
 * @returns {{action,direction,interface,protocol,srcIp,dstIp,srcPort,dstPort,csv}|null}
 */
function parseFilterlog(line) {
  if (typeof line !== 'string' || line.trim() === '') return null;
  const csv = line.trim().split(/\s+/).pop(); // CSV hat keine Leerzeichen → letztes Token
  const f = csv.split(',');
  if (f.length < 10) return null;
  const action = clean(f[6]);
  const direction = clean(f[7]);
  const ipVersion = clean(f[8]);
  if ((action !== 'pass' && action !== 'block' && action !== 'rdr' && action !== 'nat') ||
      (direction !== 'in' && direction !== 'out') ||
      (ipVersion !== '4' && ipVersion !== '6')) {
    return null; // sieht nicht wie filterlog aus
  }

  // Feldordnung hängt an der IP-Version.
  const idx = ipVersion === '4'
    ? { proto: 16, src: 18, dst: 19, sport: 20, dport: 21 }
    : { proto: 12, src: 15, dst: 16, sport: 17, dport: 18 };

  const protocol = clean(f[idx.proto]) ? f[idx.proto].toLowerCase() : null;
  const srcIp = clean(f[idx.src]);
  const dstIp = clean(f[idx.dst]);
  if (!srcIp || !dstIp) return null;
  const hasPorts = protocol === 'tcp' || protocol === 'udp';

  return {
    action, direction, protocol, srcIp, dstIp,
    srcPort: hasPorts ? toNum(f[idx.sport]) : null,
    dstPort: hasPorts ? toNum(f[idx.dport]) : null,
    interface: clean(f[4]),
    csv,
  };
}

/**
 * @param {{ instanceId:string, assetIps?:string[], parserVersion?:string }} opts
 *   assetIps optional: leer/absent = alle Flows behalten (Perimeter-FW sieht alles).
 */
function createOpnsenseCollector({ instanceId, assetIps = [], parserVersion = '0.1.0' } = {}) {
  if (!instanceId) throw new Error('opnsenseCollector: instanceId required');
  const assets = new Set(assetIps);
  const inScope = (src, dst) => assets.size === 0 || assets.has(src) || assets.has(dst);

  return {
    name: `firewall-opnsense-${instanceId}`,
    domain: 'firewall',
    source: { type: 'firewall', vendor: 'opnsense', instanceId },
    parserVersion,
    normalize(line) {
      const f = parseFilterlog(line);
      if (!f) return null;
      if (!inScope(f.srcIp, f.dstIp)) return null;
      return {
        rawHash: crypto.createHash('sha256').update(f.csv).digest('hex'),
        rawRef: `opnsense:filterlog:${f.srcIp}:${f.srcPort || 0}->${f.dstIp}:${f.dstPort || 0}`,
        entities: [
          { type: 'ip', value: f.srcIp, role: 'source' },
          { type: 'ip', value: f.dstIp, role: 'destination' },
        ],
        network: {
          srcIp: f.srcIp, dstIp: f.dstIp, srcPort: f.srcPort, dstPort: f.dstPort,
          protocol: f.protocol, direction: f.direction,
        },
        firewall: { action: f.action, interface: f.interface, direction: f.direction },
        confidence: 1, // Firewall-Log = faktischer Verdikt-Datensatz
      };
    },
  };
}

module.exports = { parseFilterlog, createOpnsenseCollector };
