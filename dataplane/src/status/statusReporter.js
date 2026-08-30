'use strict';

// ─────────────────────────────────────────────────────────────────────────
// HMAC-signierter Status-Reporter → Nexora (POST /api/v1/dataplane/status).
// Spiegelt das Webhook-HMAC-Schema des Backends (wie incidentEmitter):
//   Signatur = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
//   Header   = X-Webhook-Signature / X-Webhook-Timestamp
//
// fail-soft: anders als der Incident-Emitter kippt ein fehlgeschlagener Status-
// Push den Knoten NICHT — Status ist Beiwerk, kein Vorfall. Der nächste Tick
// versucht es erneut; Fehler gehen nur an onError/Log.
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('node:crypto');
const { buildStatusSnapshot } = require('./buildStatusSnapshot');
const { gatherDbCounts } = require('./gatherDbCounts');

/**
 * @param {{ url:string, secret:string, fetchImpl?:typeof fetch }} opts
 * @returns {(snapshot:object)=>Promise<void>}
 */
function createStatusSender({ url, secret, fetchImpl = fetch } = {}) {
  if (!url) throw new Error('createStatusSender: url required');
  if (!secret) throw new Error('createStatusSender: secret required');

  return async function send(snapshot) {
    const body = JSON.stringify(snapshot);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': signature,
        'x-webhook-timestamp': timestamp,
      },
      body,
    });
    if (res.status !== 202 && res.status !== 200) {
      throw new Error(`status ingress rejected: HTTP ${res.status}`);
    }
  };
}

/**
 * Periodischer Reporter: gather() (Live-Quellen) → buildStatusSnapshot → send().
 * ENV-gated im Entrypoint verdrahtet. Timer ist unref'd (blockiert den Prozess nicht).
 *
 * @param {{
 *   nodeId:string,
 *   gather: () => Promise<{hubStatus?:Array, intake?:object, outbox?:object}>|object,
 *   send: (snapshot:object)=>Promise<void>,
 *   intervalMs?:number, now?:(()=>number)|number,
 *   setIntervalImpl?:typeof setInterval, clearIntervalImpl?:typeof clearInterval,
 *   onError?:(err:Error)=>void
 * }} opts
 */
function startStatusReporter({
  nodeId, gather, send, intervalMs = 30000, now = Date.now,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval, onError,
} = {}) {
  if (!nodeId) throw new Error('startStatusReporter: nodeId required');
  if (typeof gather !== 'function') throw new Error('startStatusReporter: gather required');
  if (typeof send !== 'function') throw new Error('startStatusReporter: send required');

  async function tick() {
    try {
      const sources = (await gather()) || {};
      const snapshot = buildStatusSnapshot({ nodeId, now, ...sources });
      await send(snapshot);
    } catch (err) {
      if (onError) onError(err);
    }
  }

  const handle = setIntervalImpl(tick, Math.max(1000, intervalMs));
  if (handle && typeof handle.unref === 'function') handle.unref();
  void tick(); // erster Push sofort, nicht erst nach intervalMs

  return { stop() { clearIntervalImpl(handle); }, tick };
}

/**
 * ENV-gatete Verdrahtung für den Hub-Entrypoint. Liefert `null` (Reporter AUS),
 * wenn NEXORA_STATUS_URL oder WEBHOOK_SECRET_DATAPLANE fehlen — der Push ist
 * standardmäßig deaktiviert und muss bewusst aktiviert werden.
 *
 * ENV: NEXORA_STATUS_URL · WEBHOOK_SECRET_DATAPLANE · NEXORA_NODE_ID (Default HOSTNAME)
 *      · STATUS_INTERVAL_MS (Default 30000) · DATAPLANE_DB_URL (optional → echte Zähler)
 *
 * @param {{ hub:{status:()=>Array}, env?:object, makeSender?:Function, makePool?:Function,
 *           setIntervalImpl?:Function, clearIntervalImpl?:Function, onError?:Function }} opts
 * @returns {null | { stop:()=>void, tick:()=>Promise<void> }}
 */
function buildStatusReporterFromEnv({
  hub, env = process.env, makeSender = createStatusSender, makePool,
  setIntervalImpl, clearIntervalImpl, onError,
} = {}) {
  if (!hub || typeof hub.status !== 'function') throw new Error('buildStatusReporterFromEnv: hub.status required');
  const url = env.NEXORA_STATUS_URL;
  const secret = env.WEBHOOK_SECRET_DATAPLANE;
  if (!url || !secret) return null; // Push bewusst AUS

  const nodeId = env.NEXORA_NODE_ID || env.HOSTNAME || 'dataplane';
  const intervalMs = Number(env.STATUS_INTERVAL_MS) || 30000;
  const pool = env.DATAPLANE_DB_URL && typeof makePool === 'function' ? makePool(env.DATAPLANE_DB_URL) : null;
  const send = makeSender({ url, secret });

  const gather = async () => {
    const base = { hubStatus: hub.status() };
    if (pool) {
      try { Object.assign(base, await gatherDbCounts(pool)); } catch (err) { if (onError) onError(err); }
    }
    return base;
  };

  return startStatusReporter({ nodeId, gather, send, intervalMs, setIntervalImpl, clearIntervalImpl, onError });
}

module.exports = { createStatusSender, startStatusReporter, buildStatusReporterFromEnv };
