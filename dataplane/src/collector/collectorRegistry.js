'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Collector-Registry — Plugin-Verzeichnis. „Unbegrenzt Collectoren je System":
// jeder Collector registriert sich mit eindeutigem Namen + Domäne.
//
// Collector-Contract (was jedes Plugin erfüllen muss):
//   { name: string            // eindeutig, z.B. "firewall-opnsense-fw01"
//     domain: string          // "firewall" | "ids" | "siem" | "honeypot" | …
//     source: { type, vendor, instanceId }   // Quellenidentität (→ Envelope.source)
//     parserVersion: string   // → Envelope.provenance.parserVersion
//     normalize(rawItem) → NormalizedPart | null }   // null = bewusst verworfen (Noise)
//
// NormalizedPart = { observedAt, rawHash, rawRef, entities?, confidence?, warnings? }
// ─────────────────────────────────────────────────────────────────────────

function assertValidCollector(k) {
  if (k === null || typeof k !== 'object') throw new Error('collector: must be an object');
  const s = (v) => typeof v === 'string' && v.trim() !== '';
  if (!s(k.name)) throw new Error('collector.name: required non-empty string');
  if (!s(k.domain)) throw new Error('collector.domain: required non-empty string');
  if (!s(k.parserVersion)) throw new Error('collector.parserVersion: required non-empty string');
  if (k.source === null || typeof k.source !== 'object') throw new Error('collector.source: required object');
  for (const f of ['type', 'vendor', 'instanceId']) {
    if (!s(k.source[f])) throw new Error(`collector.source.${f}: required non-empty string`);
  }
  if (typeof k.normalize !== 'function') throw new Error('collector.normalize: required function');
}

function createCollectorRegistry() {
  const byName = new Map();
  return {
    register(k) {
      assertValidCollector(k);
      if (byName.has(k.name)) throw new Error(`collector already registered: ${k.name}`);
      byName.set(k.name, k);
      return k;
    },
    unregister(name) { return byName.delete(name); },
    get(name) { return byName.get(name) || null; },
    has(name) { return byName.has(name); },
    list() { return [...byName.values()]; },
    listByDomain(domain) { return [...byName.values()].filter((k) => k.domain === domain); },
    count() { return byName.size; },
  };
}

module.exports = { createCollectorRegistry, assertValidCollector };
