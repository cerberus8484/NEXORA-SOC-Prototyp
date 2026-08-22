'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_2 Stufe 3 — echte Worker-Live-Probe (fail-closed).
//
// Liest den persistenten Worker-Status und urteilt über die drei Live-Signale:
//   heartbeatFresh — Lebenszeichen innerhalb der Schwelle
//   adoptedOk      — erwartete Runtime-Config-Version je Capability übernommen
//   queueOk        — Queue verarbeitet (processing) ODER explizit idle-but-healthy
//
// KEIN konservatives true: fehlender/staler Heartbeat, Versions-Mismatch, negativer
// oder unbekannter Queue-Zustand, fehlender Status ⇒ Signal negativ (deny).
// ─────────────────────────────────────────────────────────────────────────

const HEALTHY_QUEUE_STATES = new Set(['processing', 'idle']); // idle ist explizit gesund

function buildWorkerProbe({ workerStatusRepo, workerId, heartbeatMaxAgeMs, now = Date.now } = {}) {
  if (!workerStatusRepo) throw new Error('buildWorkerProbe: workerStatusRepo erforderlich');
  if (!workerId) throw new Error('buildWorkerProbe: workerId erforderlich');
  const maxAge = Math.max(0, Number(heartbeatMaxAgeMs) || 0);

  return async ({ capabilityId, expectedVersion } = {}) => {
    let st = null;
    try { st = await workerStatusRepo.get(workerId); } catch { st = null; }

    if (!st || !st.lastHeartbeatAt) {
      return { adoptedOk: false, heartbeatFresh: false, queueOk: false, reason: 'kein Worker-Status / kein Heartbeat (fail-closed)' };
    }

    const age = now() - new Date(st.lastHeartbeatAt).getTime();
    const heartbeatFresh = Number.isFinite(age) && age >= 0 && age <= maxAge;

    const adopted = (st.adoptedConfigVersions || {})[capabilityId];
    const adoptedOk = adopted !== undefined && Number(adopted) === Number(expectedVersion);

    const queueOk = HEALTHY_QUEUE_STATES.has(st.queueProcessingState);

    const reason = !heartbeatFresh ? 'Heartbeat veraltet oder fehlt'
      : !adoptedOk ? 'erwartete Config-Version vom Worker nicht übernommen'
        : !queueOk ? `Queue-Zustand nicht gesund (${st.queueProcessingState})`
          : null;

    return { adoptedOk, heartbeatFresh, queueOk, reason, observed: { adoptedVersion: adopted ?? null, queueState: st.queueProcessingState, heartbeatAgeMs: age } };
  };
}

module.exports = { buildWorkerProbe, HEALTHY_QUEUE_STATES };
