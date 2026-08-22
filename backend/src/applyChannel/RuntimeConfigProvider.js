'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_2 Stufe 2 — RuntimeConfigProvider.
//
// Liest den AKTIVEN, angewendeten Wert je apply-eligible Worker-Capability aus dem
// versionierten Runtime-Config-Store. Der Worker liest hierüber an JOB-GRENZEN —
// laufende Jobs behalten ihren beim Start gelesenen Snapshot.
//
// Fail-safe: jeder Fehler / fehlende / unsinnige Wert → der übergebene Default.
// So bleibt der Worker immer auf einem bekannten, sicheren Wert (kein Crash, kein
// undefinierter Zustand).
// ─────────────────────────────────────────────────────────────────────────

const CAP_MAX_CHILDREN = 'correlator.worker.maxChildren';
const CAP_MAX_RETRIES = 'correlator.worker.maxRetries';

class RuntimeConfigProvider {
  constructor({ applyRepo, target = 'correlation-worker' } = {}) {
    if (!applyRepo) throw new Error('RuntimeConfigProvider: applyRepo erforderlich');
    this._repo = applyRepo;
    this._target = target;
  }

  async getNumber(capabilityId, fieldName, fallback) {
    try {
      const active = await this._repo.getActiveRuntimeConfig(capabilityId, this._target);
      const raw = active && active.value ? active.value[fieldName] : undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback; // fail-safe auf bekannten Default
    }
  }

  getMaxChildren(fallback) { return this.getNumber(CAP_MAX_CHILDREN, 'maxChildren', fallback); }
  getMaxRetries(fallback) { return this.getNumber(CAP_MAX_RETRIES, 'maxRetries', fallback); }

  /** Aktive Store-Version je Capability (für die Worker-Adoptions-Meldung). null = keine. */
  async getActiveVersionFor(capabilityId) {
    try {
      const active = await this._repo.getActiveRuntimeConfig(capabilityId, this._target);
      return active ? active.version : null;
    } catch {
      return null;
    }
  }
}

module.exports = { RuntimeConfigProvider, CAP_MAX_CHILDREN, CAP_MAX_RETRIES };
