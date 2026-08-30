'use strict';

// InMemory-Outbox-Store (Dev/Test). Spiegelt das Interface, das der Postgres-Store
// (FOR UPDATE SKIP LOCKED gegen intake_outbox + intake_events.normalized) erfüllen muss.
// Der Worker kennt nur dieses Interface → transport-/storage-entkoppelt + testbar.
//
// Eintrag: { outboxId, envelope, status, attemptCount, availableAt, failureReason }.

const { parseCorrelationKey, correlationKey, ipPairKey } = require('./crossDomainFusion');

const CLAIMABLE = new Set(['pending', 'retrying']);

function createInMemoryOutboxStore(entries = []) {
  const byId = new Map();
  for (const e of entries) {
    byId.set(e.outboxId, {
      outboxId: e.outboxId,
      envelope: e.envelope,
      status: e.status || 'pending',
      attemptCount: e.attemptCount || 0,
      availableAt: e.availableAt || '1970-01-01T00:00:00.000Z',
      failureReason: null,
    });
  }

  return {
    /** Claim: claimbare Einträge (available_at ≤ now) → status=processing, gibt Envelope mit. */
    async claimBatch({ limit = 100, now = new Date().toISOString() } = {}) {
      const claimed = [];
      for (const e of byId.values()) {
        if (claimed.length >= limit) break;
        if (CLAIMABLE.has(e.status) && e.availableAt <= now) {
          e.status = 'processing';
          claimed.push({ outboxId: e.outboxId, attemptCount: e.attemptCount, envelope: e.envelope });
        }
      }
      return claimed;
    },
    async markCompleted(ids) {
      for (const id of ids) { const e = byId.get(id); if (e) { e.status = 'completed'; e.failureReason = null; } }
    },
    async markRetrying(ids, { reason, availableAt }) {
      for (const id of ids) {
        const e = byId.get(id);
        if (e) { e.status = 'retrying'; e.attemptCount += 1; e.availableAt = availableAt; e.failureReason = reason; }
      }
    },
    async markFailed(ids, { reason }) {
      for (const id of ids) { const e = byId.get(id); if (e) { e.status = 'failed'; e.attemptCount += 1; e.failureReason = reason; } }
    },

    // Window-Re-Fusion + Sliding-Window: ALLE Envelopes desselben IP-PAARES (unabhängig
    // von Outbox-Status UND Zeit-Bucket) → der Worker bildet daraus die Sliding-Session.
    // IP-Paar statt fusionKey: so werden grenz-straddelnde Events mitgeladen (Slice 3).
    async loadWindowEnvelopes(key, opts = {}) {
      const parsed = parseCorrelationKey(key);
      const pair = parsed && parsed.mode === 'pair' ? parsed.ips.slice().sort().join('|') : null;
      const out = [];
      for (const e of byId.values()) {
        if (!e.envelope) continue;
        const match = pair ? ipPairKey(e.envelope) === pair : correlationKey(e.envelope, opts) === key;
        if (match) out.push(e.envelope);
      }
      return out;
    },

    // Test-Helfer
    get(id) { return byId.get(id); },
    setAttemptCount(id, n) { const e = byId.get(id); if (e) e.attemptCount = n; },
    countByStatus(status) { return [...byId.values()].filter((e) => e.status === status).length; },
  };
}

module.exports = { createInMemoryOutboxStore };
