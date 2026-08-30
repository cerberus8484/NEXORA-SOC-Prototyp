'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Outbox-Worker — der fehlende Consumer (ADR-035). Claimt `pending`/`retrying`
// aus der Intake-Outbox, fusioniert die Envelopes je IP-Paar/Fenster zu einem
// Vorfall (crossDomainFusion) und emittiert ihn an den Nexora-Ingress.
//
// Reiner Orchestrator: `store` (claim/complete/retry/fail) und `emit` (Transport
// zum Nexora-Ingress) sind injiziert → DB-/transport-entkoppelt + testbar.
// Disziplin: ein Emit-Fehler bricht den Lauf NICHT ab; betroffene Einträge gehen
// mit Backoff in retrying, bis maxAttempts → failed. `failure_reason` ist ein
// fixer, sicherer Code (NIE Payload/Stack/PII → ADR Outbox).
const { groupByFusionKey, groupBySlidingWindow, fuse, parseCorrelationKey, DEFAULT_ATTACKER_AGG } = require('./crossDomainFusion');

const DEFAULTS = { limit: 100, maxAttempts: 5, backoffMs: 5000, windowMs: undefined, attackerAgg: undefined };

function backoffFor(attemptCount, backoffMs) {
  // exponentiell, gedeckelt (attempt 0→1x, 1→2x, 2→4x … max 64x)
  const factor = Math.min(2 ** attemptCount, 64);
  return backoffMs * factor;
}

/**
 * @param {{
 *   store: object,                 // claimBatch/markCompleted/markRetrying/markFailed
 *   emit: (incident:object)=>Promise<void>,  // Transport zum Nexora-Ingress
 *   workerId?: string,
 *   limit?: number, maxAttempts?: number, backoffMs?: number, windowMs?: number,
 *   now?: ()=>string,              // ISO-Zeit (injizierbar für Backoff-Tests)
 *   onError?: (info:object)=>void,
 * }} opts
 */
function createOutboxWorker(opts = {}) {
  const { store, emit } = opts;
  if (!store || typeof store.claimBatch !== 'function') throw new Error('outboxWorker: store required');
  if (typeof emit !== 'function') throw new Error('outboxWorker: emit function required');
  const cfg = { ...DEFAULTS, ...opts };
  const now = typeof opts.now === 'function' ? opts.now : () => new Date().toISOString();
  const report = typeof opts.onError === 'function' ? opts.onError : () => {};
  const attackerAgg = cfg.attackerAgg !== undefined ? cfg.attackerAgg : DEFAULT_ATTACKER_AGG;
  const windowOpt = { ...(cfg.windowMs ? { windowMs: cfg.windowMs } : {}), attackerAgg };

  async function runOnce() {
    const claimed = await store.claimBatch({ limit: cfg.limit, workerId: cfg.workerId, now: now() });
    const summary = { claimed: claimed.length, incidents: 0, completed: 0, retried: 0, failed: 0 };
    if (claimed.length === 0) return summary;

    // outboxId ↔ envelope behalten, damit wir je Gruppe die richtigen Einträge ack-en.
    const envToOutbox = new Map();
    const attemptOf = new Map();
    for (const c of claimed) { envToOutbox.set(c.envelope, c.outboxId); attemptOf.set(c.outboxId, c.attemptCount); }

    const groups = groupByFusionKey(claimed.map((c) => c.envelope), windowOpt);
    // Envelopes ohne IP (kein Fusionsschlüssel) gehören keiner Gruppe → sicher als completed
    // ack-en (kein fusionierbares Signal; kein Dauerstau).
    const groupedOutboxIds = new Set();

    for (const [key, envs] of groups) {
      const keyInfo = parseCorrelationKey(key);
      const isNoiseGroup = keyInfo && keyInfo.mode === 'noise';
      // Attacker-Aggregation: stabile Identität OHNE Zeit-Bucket (Anti-Flood). Wie
      // Noise behandeln — ganze geladene Menge fusionieren, identityKey = Schlüssel.
      const isAttackerGroup = keyInfo && keyInfo.mode === 'attacker';
      const stableIdentityGroup = isNoiseGroup || isAttackerGroup;
      const outboxIds = envs.map((e) => envToOutbox.get(e)).filter(Boolean);
      outboxIds.forEach((id) => groupedOutboxIds.add(id));
      try {
        // Window-Re-Fusion: die VOLLSTÄNDIGE Fenstermenge fusionieren (alle persistierten
        // Events mit diesem Fusionsschlüssel), nicht nur den Claim-Batch — so erreicht ein
        // spät eintreffendes Signal trotzdem das korrekte Cross-Domain-Verdikt (ADR-035).
        // Fallback auf den Batch, falls der Store kein loadWindowEnvelopes anbietet.
        let fuseSet = envs;
        if (typeof store.loadWindowEnvelopes === 'function') {
          const windowSet = await store.loadWindowEnvelopes(key, windowOpt);
          if (Array.isArray(windowSet) && windowSet.length) {
            // Sliding-Window (Slice 3): aus der geladenen IP-Paar-Historie die Session
            // wählen, die die geclaimten Events enthält — grenzunabhängig (Events knapp
            // über einer Bucket-Grenze gehören derselben Episode). Fallback: ganzes Fenster.
            if (stableIdentityGroup) {
              fuseSet = windowSet;
            } else {
              const claimedIds = new Set(envs.map((e) => e.eventId).filter(Boolean));
              const sessions = groupBySlidingWindow(windowSet, windowOpt);
              const session = sessions.find((s) => s.envelopes.some((e) => claimedIds.has(e.eventId)));
              fuseSet = session ? session.envelopes : windowSet;
            }
          }
        }
        const incident = fuse(fuseSet, { ...windowOpt, ...(stableIdentityGroup ? { identityKey: key } : {}) });
        await emit(incident);
        await store.markCompleted(outboxIds);
        summary.incidents += 1;
        summary.completed += outboxIds.length;
      } catch (err) {
        report({ reason: 'emit_failed', error: err && err.message });
        const maxAttempt = Math.max(...outboxIds.map((id) => attemptOf.get(id) || 0));
        if (maxAttempt + 1 >= cfg.maxAttempts) {
          await store.markFailed(outboxIds, { reason: 'emit_failed' });
          summary.failed += outboxIds.length;
        } else {
          const availableAt = new Date(Date.parse(now()) + backoffFor(maxAttempt, cfg.backoffMs)).toISOString();
          await store.markRetrying(outboxIds, { reason: 'emit_failed', availableAt });
          summary.retried += outboxIds.length;
        }
      }
    }

    // Nicht-gruppierte (keine IP) Einträge abschließen, damit sie nicht hängen bleiben.
    const ungrouped = claimed.map((c) => c.outboxId).filter((id) => !groupedOutboxIds.has(id));
    if (ungrouped.length) { await store.markCompleted(ungrouped); summary.completed += ungrouped.length; }

    return summary;
  }

  return { runOnce };
}

module.exports = { createOutboxWorker, backoffFor };
