'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_2 Stufe 3 — Health-Adapter für den Correlation-Worker (Live).
//
// Ersetzt den Stufe-2-Seam: KEIN konservatives true mehr. Ein Apply gilt nur als
// gesund, wenn innerhalb eines festen Timeouts GLEICHZEITIG gilt:
//   1. Store: erwartete Runtime-Config-Version ist aktiv.
//   2. Worker: hat die erwartete Version übernommen (adoptedOk).
//   3. Heartbeat frisch.
//   4. Queue verarbeitet bzw. ist explizit idle-but-healthy.
//
// Pollt bis healthy ODER Timeout (Worker übernimmt asynchron an der nächsten
// Job-Grenze/idle-Heartbeat). Fehlt die Worker-Probe ⇒ fail-closed (nicht gesund).
// clock/sleep injizierbar (deterministische Tests).
// ─────────────────────────────────────────────────────────────────────────

// unref'd: ein in-flight Health-Sleep darf den Prozess nie offen halten.
const defaultSleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t && t.unref) t.unref(); });

function buildCorrelationHealthAdapter({ applyRepo, workerProbe = null, sleep = defaultSleep, now = Date.now, pollIntervalMs = 250 } = {}) {
  if (!applyRepo) throw new Error('buildCorrelationHealthAdapter: applyRepo erforderlich');

  async function evaluateOnce({ capabilityId, targetId, expectedVersion }) {
    let configVersion = null;
    try {
      const active = await applyRepo.getActiveRuntimeConfig(capabilityId, targetId);
      configVersion = active ? active.version : null;
    } catch { configVersion = null; }
    const versionOk = configVersion === expectedVersion;

    // Fail-closed: ohne echte Worker-Probe ist nichts gesund (kein konservatives true).
    let probe = { adoptedOk: false, heartbeatFresh: false, queueOk: false, reason: 'keine Worker-Probe (fail-closed)' };
    if (typeof workerProbe === 'function') {
      try { probe = await workerProbe({ capabilityId, expectedVersion }); }
      catch { probe = { adoptedOk: false, heartbeatFresh: false, queueOk: false, reason: 'Worker-Probe-Fehler (fail-closed)' }; }
    }

    const healthy = versionOk && probe.adoptedOk && probe.heartbeatFresh && probe.queueOk;
    const reason = healthy ? null
      : (!versionOk ? 'Store: erwartete Config-Version nicht aktiv' : probe.reason || 'Worker-Health-Signal negativ');
    return {
      healthy, configVersion,
      adoptedOk: !!probe.adoptedOk, heartbeatFresh: !!probe.heartbeatFresh, queueOk: !!probe.queueOk,
      observed: probe.observed || null, reason,
    };
  }

  return {
    async checkHealth({ capabilityId, targetId, expectedVersion, timeoutMs = 10000 } = {}) {
      const deadline = now() + Math.max(0, Number(timeoutMs) || 0);
      let last = await evaluateOnce({ capabilityId, targetId, expectedVersion });
      while (!last.healthy && now() < deadline) {
        await sleep(pollIntervalMs);
        last = await evaluateOnce({ capabilityId, targetId, expectedVersion });
      }
      if (!last.healthy && !last.reason) last.reason = 'Health-Timeout';
      return last;
    },
  };
}

module.exports = { buildCorrelationHealthAdapter };
