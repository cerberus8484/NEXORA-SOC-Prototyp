'use strict';

// ─────────────────────────────────────────────────────────────────────────
// conntrack-Collector — eigener, leichter Flow-Sensor (kein Suricata).
// Quelle: `conntrack -E -e DESTROY` (Kernel zählt Bytes/Pakete pro Verbindung,
// `nf_conntrack_acct=1`). Bei Verbindungs-Ende (DESTROY) sind die ECHTEN
// Byte-/Paketzähler final → genau die Bytes, die in den Honeypot-Tickets fehlen.
//
// `normalize(line)` → NormalizedPart mit normalized.network (5-Tuple + Bytes), oder null.
// Orig-Richtung = Angreifer→Honeypot (toServer), Reply = Honeypot→Angreifer (toClient).
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('node:crypto');

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
function kv(s, k) { const m = s.match(new RegExp(`\\b${k}=(\\S+)`)); return m ? m[1] : undefined; }

/**
 * Parst eine conntrack-Event-Zeile (DESTROY) in orig/reply-Tupel.
 * @returns {{event:string, proto:string, orig:object, reply:object|null}|null}
 */
function parseConntrackEvent(line) {
  if (typeof line !== 'string' || !/DESTROY/.test(line)) return null;
  const protoM = line.match(/\b(tcp|udp|icmp)\b/i);
  const proto = protoM ? protoM[1].toLowerCase() : null;
  if (!proto) return null;

  // orig = bis zum zweiten `src=`, reply = ab dem zweiten `src=`.
  const idxs = [...line.matchAll(/\bsrc=/g)].map((m) => m.index);
  if (idxs.length === 0) return null;
  const origStr = idxs.length >= 2 ? line.slice(idxs[0], idxs[1]) : line.slice(idxs[0]);
  const replyStr = idxs.length >= 2 ? line.slice(idxs[1]) : '';

  const dir = (s) => ({
    src: kv(s, 'src'), dst: kv(s, 'dst'),
    sport: num(kv(s, 'sport')), dport: num(kv(s, 'dport')),
    packets: num(kv(s, 'packets')), bytes: num(kv(s, 'bytes')),
  });
  const orig = dir(origStr);
  if (!orig.src || !orig.dst) return null;
  return { event: 'DESTROY', proto, orig, reply: replyStr ? dir(replyStr) : null };
}

/**
 * Erzeugt einen conntrack-Collector (Flow-Sensor).
 * @param {{ instanceId:string, ports?:number[], parserVersion?:string }} opts
 *   ports = Scope (nur Flows, die einen dieser Ports berühren; leer = alle).
 */
function createConntrackCollector({ instanceId, ports = [], parserVersion = '0.1.0' } = {}) {
  if (!instanceId) throw new Error('conntrackCollector: instanceId required');
  const portSet = new Set(ports);
  const inScope = (o) => portSet.size === 0 || portSet.has(o.dport) || portSet.has(o.sport);

  return {
    name: `conntrack-${instanceId}`,
    domain: 'ids',
    source: { type: 'flow', vendor: 'conntrack', instanceId },
    parserVersion,
    normalize(line) {
      const ev = parseConntrackEvent(line);
      if (!ev || (ev.proto !== 'tcp' && ev.proto !== 'udp')) return null;
      if (!inScope(ev.orig)) return null; // außerhalb Scope (z.B. eigener Egress) → verwerfen
      const o = ev.orig; const r = ev.reply || {};
      return {
        rawHash: crypto.createHash('sha256').update(line).digest('hex'),
        rawRef: `conntrack:${o.src}:${o.sport}->${o.dst}:${o.dport}`,
        entities: [
          { type: 'ip', value: o.src, role: 'source' },
          { type: 'ip', value: o.dst, role: 'destination' },
        ],
        network: {
          srcIp: o.src, dstIp: o.dst, srcPort: o.sport, dstPort: o.dport, protocol: ev.proto,
          bytesToServer: o.bytes ?? null, bytesToClient: r.bytes ?? null,
          pktsToServer: o.packets ?? null, pktsToClient: r.packets ?? null,
        },
        confidence: 1,
      };
    },
  };
}

module.exports = { parseConntrackEvent, createConntrackCollector };
