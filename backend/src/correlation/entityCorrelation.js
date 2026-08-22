'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Entity-Korrelation (CE-2)
//
// Führt die beobachtbaren Objekte (Host/IP/User/MAC/Domain/URL/Prozess/
// Datei/Hash) aus MEHREREN Events quellenübergreifend zusammen — jede Entity
// mit Provenance (welche Quelle wie oft) + Event-Count + first/last seen.
//
// Rein (keine Seiteneffekte) → gut testbar. ADR-009: nur Beobachtetes, kein
// Raten. Bewusst eigenständig vom Frontend-`deriveEntities` (TS kann das
// Backend nicht importieren); hier serverseitig über alle korrelierten Events.
// ─────────────────────────────────────────────────────────────────────────

// Sysmon-Hash-String („SHA256=…,MD5=…") in Einzelwerte zerlegen.
function parseHashes(hashes) {
  if (!hashes || typeof hashes !== 'string') return [];
  return hashes.split(',')
    .map((part) => part.trim())
    .filter((part) => part.includes('='))
    .map((part) => {
      const idx = part.indexOf('=');
      return { algo: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() };
    })
    .filter((h) => h.algo && h.value);
}

// Entitäten EINES Events extrahieren — pro Event dedupliziert (kind|value),
// damit der spätere Event-Count Events zählt, nicht Mehrfachnennungen.
function extractEntities(ev = {}) {
  const source = (ev.detection && ev.detection.sourceSystem) || 'Unbekannt';
  const firstSeen = ev.firstSeen || null;
  const lastSeen  = ev.lastSeen || null;
  const seen = new Set();
  const out = [];
  const add = (kind, value, note) => {
    const v = (value == null ? '' : String(value)).trim();
    if (!v) return;
    const key = `${kind}|${v.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value: v, source, note, firstSeen, lastSeen });
  };

  const s = ev.source || {};
  const d = ev.destination || {};
  add('user', s.user);
  add('host', s.host);
  add('host', ev.metadata && ev.metadata.agentName, 'Agent');
  add('ip', s.ip, 'Source');
  add('ip', d.ip, 'Destination');
  add('ip', ev.nat && ev.nat.postNatSourceIp, 'Post-NAT');
  add('mac', s.macAddress);
  add('domain', d.fqdn);
  add('domain', ev.dns && ev.dns.query);
  add('domain', ev.payload && ev.payload.hostHeader);
  add('url', ev.payload && ev.payload.url);
  add('process', ev.process && ev.process.image);
  add('process', ev.process && ev.process.parentImage, 'Parent');
  add('file', ev.file && ev.file.name);
  for (const h of [...parseHashes(ev.process && ev.process.hashes), ...parseHashes(ev.file && ev.file.hashes)]) {
    add('hash', h.value, h.algo);
  }
  return out;
}

// Entity-Referenzen über alle Events zu korrelierten Entitäten verschmelzen.
function mergeEntities(refs) {
  const map = new Map();
  for (const r of (Array.isArray(refs) ? refs : [])) {
    const key = `${r.kind}|${String(r.value).toLowerCase()}`;
    let e = map.get(key);
    if (!e) {
      e = { kind: r.kind, value: r.value, note: r.note, events: 0, sources: new Map(), firstSeen: r.firstSeen, lastSeen: r.lastSeen };
      map.set(key, e);
    }
    e.events += 1;
    e.sources.set(r.source, (e.sources.get(r.source) || 0) + 1);
    if (r.firstSeen && (!e.firstSeen || r.firstSeen < e.firstSeen)) e.firstSeen = r.firstSeen;
    if (r.lastSeen && (!e.lastSeen || r.lastSeen > e.lastSeen)) e.lastSeen = r.lastSeen;
    if (!e.note && r.note) e.note = r.note;
  }
  return [...map.values()].map((e) => ({
    kind: e.kind,
    value: e.value,
    note: e.note,
    events: e.events,
    firstSeen: e.firstSeen,
    lastSeen: e.lastSeen,
    sources: [...e.sources.entries()].map(([sourceSystem, count]) => ({ source: sourceSystem, count })),
  }));
}

// Komplettpfad: Liste normalisierter Events → korrelierte Entitäten.
function correlateEntities(evs) {
  const refs = (Array.isArray(evs) ? evs : []).flatMap(extractEntities);
  return mergeEntities(refs);
}

module.exports = { parseHashes, extractEntities, mergeEntities, correlateEntities };
