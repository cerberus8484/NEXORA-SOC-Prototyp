'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Cross-Domain-Fusion (Data Plane Korrelierungs-Engine) — ADR-035.
// Verbindet UNABHÄNGIGE Envelopes verschiedener Kollektoren/Domänen zu EINEM
// Vorfall. NICHT zu verwechseln mit dem backend Evidence-Merge (Parent+Child
// eines Tickets).
//
// Schlüssel: ungeordnetes IP-Paar + Zeitfenster-Bucket (NICHT das volle 5-Tuple).
// Severity = Max über die Quellen (gemeinsame Skala). Verdikt regelbasiert (v1).
// Disziplin (ADR-009): nur aus vorhandenen Signalen ableiten, nichts erfinden.
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('node:crypto');

const DEFAULT_WINDOW_MS = Number(process.env.FUSION_WINDOW_MS || 0) || 300000; // 5 min
const DEFAULT_NOISE_WINDOW_MS = Number(process.env.FUSION_NOISE_WINDOW_MS || 0) || 900000; // 15 min
// Anti-Flood (ADR-035 Erweiterung): wenn aktiv, kollabieren wiederholte Angriffe
// derselben Quell-IP (gleiche Verdikt-Klasse) auf EINE stabile Incident-Identität
// — über Zeitfenster hinweg, ohne Zeit-Bucket. Default AUS → bisheriges Verhalten.
const DEFAULT_ATTACKER_AGG = String(process.env.FUSION_ATTACKER_AGG || '').toLowerCase() === 'true';
const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const RANK_NAME = Object.keys(SEVERITY_RANK);

function uniq(arr) { return [...new Set(arr)]; }
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function keyPart(v) { return encodeURIComponent(String(v == null ? '' : v).toLowerCase()); }
function unkeyPart(v) { return decodeURIComponent(String(v || '')); }

/** IP-Adressen eines Envelopes: bevorzugt network.{srcIp,dstIp}, sonst entities[type=ip]. */
function ipsOf(env) {
  const n = (env && env.normalized) || {};
  const out = [];
  if (n.network) {
    if (n.network.srcIp) out.push(n.network.srcIp);
    if (n.network.dstIp) out.push(n.network.dstIp);
  }
  if (out.length === 0 && Array.isArray(n.entities)) {
    for (const e of n.entities) if (e && e.type === 'ip' && e.value) out.push(e.value);
  }
  return uniq(out);
}

/**
 * Fusionsschlüssel = sortiertes IP-Paar (max 2) + Zeitfenster-Bucket.
 * @returns {string|null} null wenn keine IP (nicht fusionierbar).
 */
function fusionKey(env, { windowMs = DEFAULT_WINDOW_MS } = {}) {
  const ips = ipsOf(env).sort().slice(0, 2);
  if (ips.length === 0) return null;
  const t = Date.parse(env && env.observedAt);
  const bucket = Number.isFinite(t) ? Math.floor(t / windowMs) : 0;
  return `${ips.join('|')}@${bucket}`;
}

function hasActionableSignal(env) {
  const n = (env && env.normalized) || {};
  return !!(n.alert || n.detection || (n.firewall && n.firewall.action));
}

function noiseAggregationKey(env, { noiseWindowMs = DEFAULT_NOISE_WINDOW_MS } = {}) {
  const n = (env && env.normalized) || {};
  const net = n.network || {};
  const srcType = env && env.source && env.source.type;
  const vendor = env && env.source && String(env.source.vendor || '').toLowerCase();
  if (srcType !== 'ids') return null;
  if (vendor !== 'suricata') return null;
  if (hasActionableSignal(env)) return null;
  if (severityOf(env) !== 'info') return null;
  if (!net.srcIp || !net.dstIp) return null;
  const t = Date.parse(env && env.observedAt);
  const bucket = Number.isFinite(t) ? Math.floor(t / noiseWindowMs) : 0;
  const parts = [
    srcType,
    env.source && env.source.vendor,
    net.dstIp,
    net.dstPort || '',
    net.protocol || '',
  ].map(keyPart);
  return `noise:v1:${parts.join('|')}@${bucket}`;
}

/** Quell-(Angreifer-)IP eines Envelopes: bevorzugt network.srcIp, sonst entity role=source. */
function attackerIpOf(env) {
  const n = (env && env.normalized) || {};
  if (n.network && n.network.srcIp) return n.network.srcIp;
  if (Array.isArray(n.entities)) {
    const src = n.entities.find((e) => e && e.type === 'ip' && e.role === 'source' && e.value);
    if (src) return src.value;
  }
  return null;
}

/** Verdikt-Klasse eines EINZELNEN Envelopes (deterministisch, via deriveVerdict). */
function verdictClassOf(env) {
  return deriveVerdict([env]);
}

/**
 * Attacker-Aggregations-Schlüssel = Quell-IP + Verdikt-Klasse, OHNE Zeit-Bucket.
 * Lässt wiederholte Angriffe derselben Quelle (gleiche Klasse) auf EINE Identität
 * kollabieren → kein Ticket-pro-Event-Flut mehr. Verschiedene Verdikt-Klassen
 * bleiben getrennt, damit ein Upgrade (observed→suspicious→confirmed) als eigener,
 * höherwertiger Vorfall sichtbar bleibt und der Escalation-Pfad weiter greift.
 * @returns {string|null} null wenn keine Quell-IP (nicht aggregierbar).
 */
function attackerAggregationKey(env) {
  const srcIp = attackerIpOf(env);
  if (!srcIp) return null;
  const cls = verdictClassOf(env);
  return `attacker:v1:${keyPart(srcIp)}|${keyPart(cls)}`;
}

function correlationKey(env, opts = {}) {
  const useAttacker = opts.attackerAgg !== undefined ? opts.attackerAgg : DEFAULT_ATTACKER_AGG;
  if (useAttacker) {
    const ak = attackerAggregationKey(env);
    if (ak) return ak;
  }
  return noiseAggregationKey(env, opts) || fusionKey(env, opts);
}

/**
 * Zerlegt einen Fusionsschlüssel `ip1|ip2@bucket` zurück in IPs + Bucket.
 * @returns {{ips:string[], bucket:number}|null}
 */
function parseFusionKey(key) {
  if (typeof key !== 'string') return null;
  const at = key.lastIndexOf('@');
  if (at < 0) return null;
  const ips = key.slice(0, at).split('|').filter(Boolean);
  const bucket = Number(key.slice(at + 1));
  if (!ips.length || !Number.isFinite(bucket)) return null;
  return { ips, bucket };
}

function parseCorrelationKey(key) {
  if (typeof key !== 'string') return null;
  if (key.startsWith('attacker:v1:')) {
    const parts = key.slice('attacker:v1:'.length).split('|').map(unkeyPart);
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return { mode: 'attacker', srcIp: parts[0], verdictClass: parts[1] };
  }
  if (!key.startsWith('noise:v1:')) {
    const parsed = parseFusionKey(key);
    return parsed ? { mode: 'pair', ...parsed } : null;
  }
  const at = key.lastIndexOf('@');
  if (at < 0) return null;
  const bucket = Number(key.slice(at + 1));
  const parts = key.slice('noise:v1:'.length, at).split('|').map(unkeyPart);
  if (parts.length !== 5 || !parts[2] || !Number.isFinite(bucket)) return null;
  return {
    mode: 'noise',
    sourceType: parts[0],
    vendor: parts[1],
    dstIp: parts[2],
    dstPort: parts[3],
    protocol: parts[4],
    bucket,
  };
}

/** Gruppiert Envelopes nach Fusionsschlüssel; ohne IP (key=null) werden verworfen. */
function groupByFusionKey(envelopes, opts = {}) {
  const groups = new Map();
  for (const env of envelopes || []) {
    const key = correlationKey(env, opts);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(env);
  }
  return groups;
}

/** IP-Paar-Schlüssel OHNE Zeit-Bucket (sortiert, max 2) — Basis der Sliding-Sessions. */
function ipPairKey(env) {
  const ips = ipsOf(env).sort().slice(0, 2);
  return ips.length ? ips.join('|') : null;
}

/**
 * Session-basierte Gleitfenster-Gruppierung (Slice 3, ADR-035): verkettet Events
 * desselben IP-Paares, deren zeitlicher Abstand ≤ windowMs ist — UNABHÄNGIG von
 * starren Bucket-Grenzen. Eine Lücke > windowMs beginnt eine neue Session (= eigene
 * Angriffs-Episode). Behebt das Boundary-Splitting der Tumbling-Buckets.
 * @returns {{ pairKey:string, envelopes:object[] }[]}
 */
function groupBySlidingWindow(envelopes, { windowMs = DEFAULT_WINDOW_MS } = {}) {
  const byPair = new Map();
  for (const env of envelopes || []) {
    const key = ipPairKey(env);
    if (!key) continue;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(env);
  }
  const sessions = [];
  for (const [pairKey, evs] of byPair) {
    evs.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    let current = null;
    let prevT = null;
    for (const e of evs) {
      const t = Date.parse(e.observedAt);
      if (current && Number.isFinite(prevT) && Number.isFinite(t) && (t - prevT) <= windowMs) {
        current.envelopes.push(e);
      } else {
        current = { pairKey, envelopes: [e] };
        sessions.push(current);
      }
      prevT = t;
    }
  }
  return sessions;
}

/** Severity eines einzelnen Envelopes auf die gemeinsame Skala normalisieren. */
function severityOf(env) {
  const n = (env && env.normalized) || {};
  if (n.detection && typeof n.detection.severity === 'string') {
    return SEVERITY_RANK[n.detection.severity] !== undefined ? n.detection.severity : 'info';
  }
  if (n.alert && isNum(n.alert.severity)) {
    // Suricata: 1 = hoch, 2 = mittel, 3 = niedrig
    return n.alert.severity <= 1 ? 'high' : n.alert.severity === 2 ? 'medium' : 'low';
  }
  if (n.firewall && n.firewall.action === 'block') return 'medium';
  return 'info';
}

function maxSeverity(envs) {
  let rank = 0;
  for (const e of envs) rank = Math.max(rank, SEVERITY_RANK[severityOf(e)]);
  return RANK_NAME[rank];
}

/** Verdikt (v1, deterministisch) aus den vorhandenen Signalen. */
function deriveVerdict(envs) {
  const hasIdsAlert = envs.some((e) => e.normalized && e.normalized.alert);
  const hasBlock = envs.some((e) => e.normalized && e.normalized.firewall && e.normalized.firewall.action === 'block');
  const siemRank = Math.max(0, ...envs.map((e) => (e.normalized && e.normalized.detection)
    ? SEVERITY_RANK[severityOf(e)] : 0));
  const siemHigh = siemRank >= SEVERITY_RANK.high;
  if ((hasIdsAlert && hasBlock) || (hasIdsAlert && siemHigh) || (hasBlock && siemHigh)) {
    return 'confirmed_malicious';
  }
  if (hasIdsAlert || hasBlock || siemRank >= SEVERITY_RANK.medium) return 'suspicious';
  return 'observed';
}

/** Repräsentatives 5-Tuple + aggregierte Byte-/Paketsummen über die Flow-Envelopes. */
function fuseNetwork(envs) {
  const nets = envs.map((e) => e.normalized && e.normalized.network).filter(Boolean);
  if (nets.length === 0) return undefined;
  const base = nets.find((x) => x.srcIp && x.dstIp) || nets[0];
  const sum = (field) => {
    const vals = nets.map((x) => x[field]).filter(isNum);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const pick = (field) => { const f = nets.find((x) => x[field] != null); return f ? f[field] : null; };
  return {
    srcIp: base.srcIp || null,
    dstIp: base.dstIp || null,
    dstPort: pick('dstPort'),
    protocol: pick('protocol'),
    bytesToServer: sum('bytesToServer'),
    bytesToClient: sum('bytesToClient'),
    pktsToServer: sum('pktsToServer'),
    pktsToClient: sum('pktsToClient'),
  };
}

const MAX_SESSION_ACTIVITY = 50;

/**
 * Sammelt die Sitzungs-Aktivität (Cowrie: command/login/download/tunnel) der Envelopes
 * einer fusionierten Session — chronologisch (nach observedAt), dedupliziert und gedeckelt.
 * Trägt den GESAMTEN Sitzungsinhalt in den Vorfall, damit die Ticket-Payload-View nicht
 * leer bleibt. Disziplin (ADR-009): nur real vorhandene Aktivität, nichts erfinden.
 * @returns {Array<{kind:string, value?:string, user?:string, at?:string}>|undefined}
 */
function fuseSessionActivity(envs) {
  const withAct = envs
    .map((e) => ({ act: e.normalized && e.normalized.activity, at: e.observedAt }))
    .filter((x) => x.act && typeof x.act === 'object' && typeof x.act.kind === 'string');
  if (withAct.length === 0) return undefined;
  withAct.sort((a, b) => Date.parse(a.at || '') - Date.parse(b.at || ''));
  const seen = new Set();
  const out = [];
  for (const { act, at } of withAct) {
    const entry = { kind: act.kind };
    if (typeof act.value === 'string' && act.value !== '') entry.value = act.value;
    if (typeof act.user === 'string' && act.user !== '') entry.user = act.user;
    if (at) entry.at = at;
    const dedupKey = `${entry.kind} ${entry.value || ''} ${entry.user || ''}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push(entry);
    if (out.length >= MAX_SESSION_ACTIVITY) break;
  }
  return out.length ? out : undefined;
}

function fuseEntities(envs) {
  const seen = new Set();
  const out = [];
  for (const e of envs) {
    const ents = (e.normalized && e.normalized.entities) || [];
    for (const ent of ents) {
      if (!ent || !ent.type || !ent.value) continue;
      const k = `${ent.type}:${ent.value}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ type: ent.type, value: ent.value, role: ent.role });
    }
  }
  return out;
}

/**
 * Fusioniert eine Gruppe von Envelopes (eine Session) zu einem Vorfall.
 * Identität: `incidentId`/`fusionKey` sind am **frühesten Event der Session** verankert
 * (IP-Paar + Bucket des Session-Starts), NICHT am auslösenden Event — so erhält dieselbe
 * Session über getrennte Worker-Läufe dieselbe ID (behebt die Slice-3-Restschuld).
 * @param {object[]} envelopes
 * @param {{ windowMs?: number }} [opts]
 * @returns {object} FusedIncident
 */
function fuse(envelopes, { windowMs = DEFAULT_WINDOW_MS, identityKey } = {}) {
  const envs = (envelopes || []).filter(Boolean);
  if (envs.length === 0) throw new Error('fuse: keine Envelopes');

  const times = envs.map((e) => e.observedAt).filter(Boolean).sort();
  // Anker = frühestes Event der Session (Watermark), nicht ein beliebiges envs[0].
  const pair = envs.map(ipPairKey).find(Boolean) || 'unkeyed';
  const anchorMs = times.length ? Date.parse(times[0]) : NaN;
  const anchorBucket = Number.isFinite(anchorMs) ? Math.floor(anchorMs / windowMs) : 0;
  const key = identityKey ? String(identityKey) : `${pair}@${anchorBucket}`;
  const mitre = uniq(envs.flatMap((e) => {
    const n = e.normalized || {};
    return [...((n.alert && n.alert.mitre) || []), ...((n.detection && n.detection.mitre) || [])];
  }));
  const signatures = uniq(envs.flatMap((e) => {
    const n = e.normalized || {};
    return [n.alert && n.alert.signature, n.detection && n.detection.signature].filter(Boolean);
  }));
  const verdicts = uniq(envs.map((e) => e.normalized && e.normalized.firewall && e.normalized.firewall.action).filter(Boolean));
  const confidences = envs.map((e) => e.provenance && e.provenance.confidence).filter(isNum);
  const sessionActivity = fuseSessionActivity(envs);

  return {
    incidentId: crypto.createHash('sha256').update(key).digest('hex'),
    fusionKey: key,
    domains: uniq(envs.map((e) => e.source && e.source.type).filter(Boolean)),
    sources: envs.map((e) => ({ domain: e.source && e.source.type, vendor: e.source && e.source.vendor, instanceId: e.source && e.source.instanceId })),
    severity: maxSeverity(envs),
    verdict: deriveVerdict(envs),
    network: fuseNetwork(envs),
    entities: fuseEntities(envs),
    ...(sessionActivity ? { sessionActivity } : {}),
    signatures,
    mitre,
    firewallActions: verdicts,
    confidence: confidences.length ? Math.max(...confidences) : null,
    eventCount: envs.length,
    eventIds: envs.map((e) => e.eventId).filter(Boolean),
    windowStart: times[0] || null,
    windowEnd: times[times.length - 1] || null,
  };
}

module.exports = {
  fusionKey, noiseAggregationKey, attackerAggregationKey, verdictClassOf, attackerIpOf,
  correlationKey, parseFusionKey, parseCorrelationKey,
  ipPairKey, groupByFusionKey, groupBySlidingWindow, fuse, severityOf, deriveVerdict,
  SEVERITY_RANK, DEFAULT_WINDOW_MS, DEFAULT_NOISE_WINDOW_MS, DEFAULT_ATTACKER_AGG,
};
