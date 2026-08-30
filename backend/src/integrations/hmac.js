'use strict';

const crypto = require('crypto');
const { UnauthorizedError } = require('../errors/AppError');

const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 Minuten — Replay-Schutz

/**
 * HMAC-SHA256 für eingehende Webhooks.
 *
 * Sender muss schicken:
 *   X-Webhook-Signature: sha256=<HMAC>
 *   X-Webhook-Timestamp: <Unix-Timestamp als String>
 *
 * HMAC berechnet sich aus: timestamp + "." + rawBody
 */
function verifyWebhookSignature(req, secret) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];

  if (!signature || !timestamp) {
    throw new UnauthorizedError('Fehlende Webhook-Header: X-Webhook-Signature und X-Webhook-Timestamp erforderlich');
  }

  // 1. Timestamp-Alter prüfen (Replay-Schutz)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (isNaN(age) || age > MAX_TIMESTAMP_AGE_SECONDS || age < -60) {
    throw new UnauthorizedError('Webhook-Timestamp zu alt oder ungültig');
  }

  // 2. Erwartete Signatur berechnen — den ECHTEN Rohkörper, nie eine Re-Serialisierung.
  //    Ohne rawBody (z.B. falscher Content-Type, body-parser lief nicht) kein stiller
  //    Fallback auf JSON.stringify(req.body): das könnte eine Signatur über ein anders
  //    serialisiertes Objekt bestätigen → fail-closed ablehnen.
  const rawBody = req.rawBody;
  if (rawBody === undefined || rawBody === null) {
    throw new UnauthorizedError('Kein Rohkörper zur Signaturprüfung — Content-Type application/json erforderlich');
  }
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  // 3. Constant-Time Vergleich — verhindert Timing-Angriffe
  if (signature.length !== expected.length) {
    throw new UnauthorizedError('Ungültige Webhook-Signatur');
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new UnauthorizedError('Ungültige Webhook-Signatur');
  }
}

// Signatur berechnen (für Tests und Sender-Implementierung)
function signWebhook(secret, timestamp, rawBody) {
  return 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

module.exports = { verifyWebhookSignature, signWebhook, MAX_TIMESTAMP_AGE_SECONDS };
