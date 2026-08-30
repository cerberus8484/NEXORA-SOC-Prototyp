'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ingestEvent, REJECTION } = require('../src/intake/intakeService');
const { createInMemoryIntakeRepo } = require('../src/intake/inMemoryIntakeRepo');

const NOW = '2026-06-24T19:05:21.000Z';
const AUTH = { collectorId: 'col-fw-01', tenantId: 'tenant-a', siteId: 'site-1' };

const envelope = () => ({
  schemaVersion: '1.0',
  eventId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  observedAt: '2026-06-24T19:05:20.935Z',
  source: { type: 'firewall', vendor: 'opnsense', instanceId: 'fw-01' },
  raw: { hash: 'a'.repeat(64), ref: 's3://raw/abc.json' },
  provenance: { parserVersion: '1.0.0', confidence: 0.9 },
});

let repo;
beforeEach(() => { repo = createInMemoryIntakeRepo(); });

test('akzeptiert gültigen Envelope + persistiert', async () => {
  const r = await ingestEvent(envelope(), { auth: AUTH, repo, now: NOW });
  assert.strictEqual(r.status, 'accepted');
  assert.strictEqual(r.eventId, envelope().eventId);
  assert.strictEqual(r.idempotencyKey, 'col-fw-01:3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  assert.strictEqual(repo.count(), 1);
});

test('setzt server-seitige Felder (tenantId/collector/receivedAt) — fälschungssicher', async () => {
  await ingestEvent(envelope(), { auth: AUTH, repo, now: NOW });
  const rec = await repo.get('col-fw-01:3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  assert.strictEqual(rec.tenantId, 'tenant-a');                 // aus Auth, nicht aus Envelope
  assert.deepStrictEqual(rec.collector, { collectorId: 'col-fw-01', siteId: 'site-1' });
  assert.strictEqual(rec.receivedAt, NOW);
});

test('Idempotenz: zweites identisches Event → duplicate, kein zweiter Eintrag', async () => {
  await ingestEvent(envelope(), { auth: AUTH, repo, now: NOW });
  const r2 = await ingestEvent(envelope(), { auth: AUTH, repo, now: NOW });
  assert.strictEqual(r2.status, 'duplicate');
  assert.strictEqual(repo.count(), 1);
});

test('gleiche eventId, anderer Collector → KEIN Duplikat (Schlüssel je Collector)', async () => {
  await ingestEvent(envelope(), { auth: AUTH, repo, now: NOW });
  const r = await ingestEvent(envelope(), { auth: { collectorId: 'col-fw-02', tenantId: 'tenant-a' }, repo, now: NOW });
  assert.strictEqual(r.status, 'accepted');
  assert.strictEqual(repo.count(), 2);
});

test('ohne Auth → rejected UNAUTHENTICATED', async () => {
  const r = await ingestEvent(envelope(), { repo, now: NOW });
  assert.strictEqual(r.status, 'rejected');
  assert.strictEqual(r.rejectionCode, REJECTION.UNAUTHENTICATED);
  assert.strictEqual(repo.count(), 0);
});

test('ungültiger Envelope → rejected SCHEMA_INVALID, nichts persistiert', async () => {
  const bad = { ...envelope(), schemaVersion: '2.0' };
  const r = await ingestEvent(bad, { auth: AUTH, repo, now: NOW });
  assert.strictEqual(r.status, 'rejected');
  assert.strictEqual(r.rejectionCode, REJECTION.SCHEMA_INVALID);
  assert.ok(r.errors.length > 0);
  assert.strictEqual(repo.count(), 0);
});

test('Collector kann tenantId NICHT fälschen (Contract lehnt ab)', async () => {
  const forged = { ...envelope(), tenantId: 'tenant-evil' };
  const r = await ingestEvent(forged, { auth: AUTH, repo, now: NOW });
  assert.strictEqual(r.status, 'rejected');
  assert.strictEqual(r.rejectionCode, REJECTION.SCHEMA_INVALID);
});
