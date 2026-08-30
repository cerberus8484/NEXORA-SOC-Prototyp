'use strict';

// HMAC-signierter Emitter für fusionierte Vorfälle → Nexora-Ingress
// (POST /api/v1/dataplane/incidents, ADR-035 §8). Spiegelt das Webhook-HMAC-Schema
// des Backends: Signatur = HMAC-SHA256(secret, `${timestamp}.${rawBody}`), Header
// X-Webhook-Signature / X-Webhook-Timestamp.
//
// Anders als der Collector-Intake-Emitter WIRFT dieser bei Misserfolg — der
// Outbox-Worker fängt das und markiert die Einträge retrying/failed (Backoff).
const crypto = require('node:crypto');

/**
 * @param {{ url:string, secret:string, fetchImpl?:typeof fetch }} opts
 * @returns {(incident:object)=>Promise<void>}
 */
function createIncidentEmitter({ url, secret, fetchImpl = fetch } = {}) {
  if (!url) throw new Error('createIncidentEmitter: url required');
  if (!secret) throw new Error('createIncidentEmitter: secret required');

  return async function emit(incident) {
    const body = JSON.stringify(incident);
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
    // 202 accepted · 200 duplicate (idempotent) → Erfolg. Sonst werfen → Worker-Retry.
    if (res.status !== 202 && res.status !== 200) {
      throw new Error(`incident ingress rejected: HTTP ${res.status}`);
    }
  };
}

module.exports = { createIncidentEmitter };
