'use strict';

// ─────────────────────────────────────────────────────────────────────────
// ManualHost — manuell gepflegtes Asset (Nicht-Wazuh-Host-Quelle).
//
// Für Geräte, die keinen Wazuh-Agent tragen (Appliances, Netz-Hardware,
// Fremdsysteme), aber im Host-Inventar sichtbar sein sollen. `source` ist fest
// 'manual'; es gibt bewusst KEINEN Heartbeat/Syscollector — die UI zeigt solche
// Hosts ehrlich als „unmonitored" (kein erfundener Status).
// ─────────────────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');

class ManualHost {
  constructor({
    id           = randomUUID(),
    hostname     = '',
    ipAddresses  = [],
    os           = '',
    customer     = '',
    notes        = '',
    source       = 'manual',
    createdBy    = null,
    createdAt    = new Date().toISOString(),
    updatedAt    = new Date().toISOString(),
  } = {}) {
    this.id          = id;
    this.hostname    = hostname;
    this.ipAddresses = Array.isArray(ipAddresses) ? [...ipAddresses] : [];
    this.os          = os;
    this.customer    = customer;
    this.notes       = notes;
    this.source      = source;
    this.createdBy   = createdBy;
    this.createdAt   = createdAt;
    this.updatedAt   = updatedAt;
  }

  static create(data = {}) {
    const now = new Date().toISOString();
    return new ManualHost({ ...data, id: randomUUID(), source: 'manual', createdAt: now, updatedAt: now });
  }

  toJSON() { return { ...this }; }
}

module.exports = { ManualHost };
