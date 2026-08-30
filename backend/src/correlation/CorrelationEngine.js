'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Correlation Engine (CE-3)
//
// Führt die Evidence mehrerer Events zu EINER korrelierten ParsedEvidence
// zusammen — z. B. ein Host-Case (Parent = Inventar) + seine Child-Offenses
// (Flows/Prozesse/DNS). Pro Feld gewinnt der erste aussagekräftige Wert in
// Listenreihenfolge (Parent zuerst → Host-Inventar setzt sich für Source
// durch; leere Parent-Felder werden aus Childs gefüllt).
//
// Rein (keine Fetches, keine Seiteneffekte) → gut testbar. Der Aufrufer
// (Route/Service) besorgt die Child-Tickets und reicht sie hier hinein.
// ─────────────────────────────────────────────────────────────────────────

const { normalizeEvidence } = require('./evidenceNormalizer');
const { correlateEntities } = require('./entityCorrelation');

// Objekt-Gruppen, die immer existieren (auch leer als {}).
const OBJECT_GROUPS = ['detection', 'source', 'destination', 'nat', 'network', 'payload', 'metadata'];
// Optionale Top-Level-Objekte: nur setzen, wenn mind. ein Event sie liefert.
const OPTIONAL_GROUPS = ['process', 'dns', 'file', 'windowsEvent'];

// „unknown" zählt wie leer — sonst überstimmt ein Default-Parent echte Child-Werte.
function isMeaningful(v) {
  if (v === undefined || v === null || v === '') return false;
  if (v === 'unknown') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

// Ersten aussagekräftigen Wert wählen; sonst ersten definierten (z. B. 'unknown').
function pick(values) {
  const real = values.find(isMeaningful);
  if (real !== undefined) return real;
  return values.find((v) => v !== undefined && v !== null);
}

// Eine Objekt-Gruppe über alle Events feldweise mergen (Key-Union).
function mergeGroup(list, group) {
  const keys = new Set();
  for (const ev of list) Object.keys(ev[group] || {}).forEach((k) => keys.add(k));
  const out = {};
  for (const k of keys) out[k] = pick(list.map((ev) => (ev[group] || {})[k]));
  return out;
}

// Spezifischeren Typ bevorzugen (process/dns vor dem generischen 'network').
function pickType(list) {
  const specific = list.find((ev) => ev.type && ev.type !== 'network');
  return specific ? specific.type : (list[0] && list[0].type) || 'network';
}

// Frühesten (min) bzw. spätesten (max) ISO-Zeitstempel über alle Events.
function mergeTime(list, key, keepLeft) {
  const vals = list.map((ev) => ev[key]).filter(Boolean);
  if (vals.length === 0) return undefined;
  return vals.reduce((a, b) => (keepLeft(a, b) ? a : b));
}

// Quellen-Verteilung für die Provenance (welche Quelle wie oft beteiligt).
function sourceCounts(list) {
  const map = new Map();
  for (const ev of list) {
    const s = (ev.detection && ev.detection.sourceSystem) || 'Unbekannt';
    map.set(s, (map.get(s) || 0) + 1);
  }
  return [...map.entries()].map(([source, count]) => ({ source, count }));
}

/**
 * Mehrere ParsedEvidence-Objekte zu einer korrelierten Evidence verschmelzen.
 * @param {object[]} list  Events in Prioritätsreihenfolge (Index 0 gewinnt bei Gleichstand)
 * @returns {object|null}  ParsedEvidence + `correlation`-Meta, oder null bei leerer Liste
 */
function mergeEvidence(list) {
  const evs = (Array.isArray(list) ? list : []).filter(Boolean);
  if (evs.length === 0) return null;

  const merged = { id: evs[0].id || '', type: pickType(evs) };
  for (const g of OBJECT_GROUPS) merged[g] = mergeGroup(evs, g);
  for (const g of OPTIONAL_GROUPS) {
    const m = mergeGroup(evs, g);
    if (Object.keys(m).length > 0) merged[g] = m;
  }
  merged.firstSeen = mergeTime(evs, 'firstSeen', (a, b) => a <= b); // min
  merged.lastSeen  = mergeTime(evs, 'lastSeen',  (a, b) => a >= b); // max
  merged.raw = pick(evs.map((ev) => ev.raw));
  merged.correlation = {
    eventCount: evs.length,
    sources: sourceCounts(evs),
    entities: correlateEntities(evs),
  };
  return merged;
}

/**
 * Ticket + zugehörige Child-Tickets normalisieren und korrelieren.
 * Parent zuerst → Host-Inventar (Host/IP/MAC/OS) setzt sich für Source durch.
 * @param {object}   ticket    Domain-Ticket (Case oder Einzel-Alert)
 * @param {object[]} children  Child-Tickets (leer bei Einzel-Alert)
 * @returns {object|null} korrelierte ParsedEvidence
 */
function correlate(ticket, children = []) {
  const kids = Array.isArray(children) ? children : [];
  return mergeEvidence([normalizeEvidence(ticket), ...kids.map(normalizeEvidence)]);
}

module.exports = { mergeEvidence, correlate };
