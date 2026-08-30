'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { rowToEnvelope } = require('../src/engine/postgresOutboxStore');

test('rowToEnvelope: rekonstruiert Envelope aus intake_events-Zeile (für Fusion)', () => {
  const row = {
    event_id: 'e-1',
    observed_at: new Date('2026-06-25T12:00:00.000Z'),
    source_type: 'ids', source_vendor: 'suricata', source_instance: 's1',
    provenance_confidence: '0.90',
    normalized: { network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10' }, alert: { signature: 'X' } },
  };
  const env = rowToEnvelope(row);
  assert.strictEqual(env.source.type, 'ids');
  assert.strictEqual(env.observedAt, '2026-06-25T12:00:00.000Z');
  assert.strictEqual(env.provenance.confidence, 0.9); // numerisch, nicht String
  assert.strictEqual(env.normalized.network.srcIp, '45.143.200.12');
});

test('rowToEnvelope: observed_at fehlt → Fallback received_at; normalized null → {}', () => {
  const env = rowToEnvelope({ event_id: 'e', received_at: new Date('2026-06-25T11:00:00.000Z'), normalized: null });
  assert.strictEqual(env.observedAt, '2026-06-25T11:00:00.000Z');
  assert.deepStrictEqual(env.normalized, {});
});
