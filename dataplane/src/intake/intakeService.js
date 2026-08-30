'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Intake-Service — die Annahme-Logik der Data Plane (rein, ohne HTTP).
//
// Ablauf je Event:
//   1) Auth prüfen (Collector-Credential ist server-aufgelöst → auth)
//   2) Envelope gegen EventEnvelopeV1-Contract validieren
//   3) server-seitige Felder setzen (tenantId/collector/receivedAt) — fälschungssicher
//   4) Idempotenz (collectorId:eventId) — Duplikat = idempotenter Erfolg, kein Fehler
//   5) persistieren (Repo-Interface)
//
// Maschinenlesbare Rejection-Codes (stabil, vgl. Dataplane R-12).
// ─────────────────────────────────────────────────────────────────────────

const { validateEnvelope } = require('../contract/eventEnvelopeV1');

const REJECTION = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
};

/**
 * @param {object} envelope  roher EventEnvelopeV1 (Collector-Sicht)
 * @param {{ auth?: {collectorId:string, tenantId:string, siteId?:string}, repo: object, now?: string }} ctx
 * @returns {Promise<{status:'accepted'|'duplicate'|'rejected', eventId?:string, idempotencyKey?:string, receivedAt?:string, rejectionCode?:string, errors?:string[]}>}
 */
async function ingestEvent(envelope, { auth, repo, now } = {}) {
  // 1) Auth — der Collector MUSS identifiziert sein (Server hat das Credential aufgelöst).
  if (!auth || !auth.collectorId || !auth.tenantId) {
    return { status: 'rejected', rejectionCode: REJECTION.UNAUTHENTICATED, errors: ['collector credential required'] };
  }

  // 2) Contract-Validierung (lehnt u.a. client-gesetztes tenantId/receivedAt + Raw-Payload ab).
  const v = validateEnvelope(envelope);
  if (!v.valid) {
    return { status: 'rejected', rejectionCode: REJECTION.SCHEMA_INVALID, errors: v.errors };
  }

  // 4) Idempotenz-Schlüssel
  const idempotencyKey = `${auth.collectorId}:${envelope.eventId}`;
  if (await repo.has(idempotencyKey)) {
    return { status: 'duplicate', eventId: envelope.eventId, idempotencyKey };
  }

  // 3) server-seitige Felder — NIE vom Collector bestimmbar (Tenant-Isolation).
  const receivedAt = now || new Date().toISOString();
  const record = {
    ...envelope,
    tenantId: auth.tenantId,
    collector: { collectorId: auth.collectorId, siteId: auth.siteId ?? null },
    receivedAt,
  };

  // 5) persistieren
  await repo.save(idempotencyKey, record);
  return { status: 'accepted', eventId: envelope.eventId, idempotencyKey, receivedAt };
}

module.exports = { ingestEvent, REJECTION };
