'use strict';

// Cross-Collector-Konformität: Der vorhandene Firewall-Go-Collector (Nexora-Dataplane,
// internal/mapper/mapper.go → EventEnvelopeV1Input) „dockt" an unseren EventEnvelopeV1-
// Contract + Intake an. Sichert, dass seine Envelope-Form (inkl. seiner Zusatzfelder
// raw.contentType / normalized.network / collector{} / provenance.parserName) von unserem
// validateEnvelope AKZEPTIERT wird — und dass er kein verbotenes tenantId/receivedAt setzt.
const { test } = require('node:test');
const assert = require('node:assert');
const { validateEnvelope } = require('../src/contract/eventEnvelopeV1');

// Repräsentativer Envelope GENAU in der Form, die der Go-Mapper erzeugt.
const goCollectorEnvelope = () => ({
  schemaVersion: '1.0',
  eventId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', // UUIDv4 (Go-Collector generiert)
  observedAt: '2026-06-24T19:05:20.935Z',
  source: { type: 'firewall', vendor: 'opnsense', instanceId: 'fw-01' },
  collector: { collectorId: 'col-fw-01', siteId: 'site-1' }, // Selbst-ID (Server überschreibt)
  raw: {
    contentType: 'application/x-opnsense-filterlog', // Go-Zusatzfeld
    hash: 'd'.repeat(64),
    ref: 'file:///var/log/filter/2026-06-24/abc',
  },
  normalized: {
    entities: [
      { type: 'ip', value: '203.0.113.45', role: 'source' },
      { type: 'ip', value: '198.51.100.9', role: 'destination' },
    ],
    network: { srcIp: '203.0.113.45', dstIp: '198.51.100.9', srcPort: 51514, dstPort: 443, protocol: 'tcp', direction: 'out' }, // Go-Zusatzfeld
  },
  provenance: { parserVersion: '1.0.0', parserName: 'opnsense-filterlog', confidence: 0.9, warnings: [] },
});

test('Go-Firewall-Collector-Envelope passiert unseren Contract (dockt an)', () => {
  const r = validateEnvelope(goCollectorEnvelope());
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.valid, true);
});

test('Zusatzfelder (raw.contentType, normalized.network, collector{}) werden toleriert', () => {
  // Kontrolle: ohne Zusatzfelder ebenfalls gültig → die Extras sind der einzige Unterschied
  const env = goCollectorEnvelope();
  delete env.raw.contentType; delete env.normalized.network; delete env.collector;
  assert.strictEqual(validateEnvelope(env).valid, true);
});

test('Sicherheits-Invariante: setzt der Go-Collector doch tenantId → wird abgelehnt', () => {
  const forged = { ...goCollectorEnvelope(), tenantId: 'tenant-x' };
  const r = validateEnvelope(forged);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.startsWith('tenantId')));
});
