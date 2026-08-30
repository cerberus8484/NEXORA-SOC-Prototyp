'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_2 Stufe 3 — WorkerStatusReporter.
//
// Der Correlation-Worker meldet hierüber seine Live-Signale persistent:
//   heartbeat(state)          — Lebenszeichen + Queue-Zustand (auch idle).
//   adopt(capId, version)     — an einer Job-Grenze übernommene Runtime-Config-Version.
//   jobStarted() / jobCompleted(outcome) — Verarbeitungsnachweis.
//
// Reine Meldeschicht (kein Health-Urteil — das fällt der Health-Adapter). Jede
// Meldung frischt den Heartbeat. Clock injizierbar (deterministische Tests).
// ─────────────────────────────────────────────────────────────────────────

const QUEUE_STATES = ['processing', 'idle', 'stalled', 'error', 'unknown'];

class WorkerStatusReporter {
  constructor({ repo, workerId, clock = () => Date.now() } = {}) {
    if (!repo) throw new Error('WorkerStatusReporter: repo erforderlich');
    if (!workerId) throw new Error('WorkerStatusReporter: workerId erforderlich');
    this._repo = repo;
    this._workerId = workerId;
    this._clock = clock;
  }

  _nowIso() { return new Date(this._clock()).toISOString(); }
  _safeState(s) { return QUEUE_STATES.includes(s) ? s : 'unknown'; }

  async heartbeat(queueProcessingState = 'idle') {
    return this._repo.upsert(this._workerId, { lastHeartbeatAt: this._nowIso(), queueProcessingState: this._safeState(queueProcessingState) });
  }

  /** An einer Job-Grenze übernommene Config-Version melden (+ frischer Heartbeat). */
  async adopt(capabilityId, version, queueProcessingState) {
    const patch = { lastHeartbeatAt: this._nowIso(), adoptedConfigVersions: { [capabilityId]: Number(version) } };
    if (queueProcessingState) patch.queueProcessingState = this._safeState(queueProcessingState);
    return this._repo.upsert(this._workerId, patch);
  }

  async jobStarted() {
    return this._repo.upsert(this._workerId, { lastHeartbeatAt: this._nowIso(), lastJobStartedAt: this._nowIso(), queueProcessingState: 'processing' });
  }

  async jobCompleted(outcome = 'completed') {
    return this._repo.upsert(this._workerId, { lastHeartbeatAt: this._nowIso(), lastJobCompletedAt: this._nowIso(), lastJobOutcome: String(outcome), queueProcessingState: 'idle' });
  }
}

module.exports = { WorkerStatusReporter, QUEUE_STATES };
