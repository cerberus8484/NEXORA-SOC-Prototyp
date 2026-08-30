'use strict';

// Cache-Schnittstelle für Threat-Intel-Ergebnisse (key = `${type}:${value}`, TTL).
// P17.1: InMemory. P17.2+: optional Postgres-Cache (eigene Tabelle) — Vertrag bleibt gleich.
class ThreatIntelCacheRepository {
  // eslint-disable-next-line no-unused-vars
  async get(key) { throw new Error('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async set(key, value, ttlMs) { throw new Error('not implemented'); }
}

class InMemoryThreatIntelCache extends ThreatIntelCacheRepository {
  constructor() { super(); this._m = new Map(); }
  async get(key) {
    const e = this._m.get(key);
    if (!e) return null;
    if (Date.now() > e.exp) { this._m.delete(key); return null; }
    return e.val;
  }
  async set(key, value, ttlMs) { this._m.set(key, { val: value, exp: Date.now() + ttlMs }); }
}

module.exports = { ThreatIntelCacheRepository, InMemoryThreatIntelCache };
