'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createWazuhCollector, mapLevelToSeverity } = require('../src/collector/wazuhCollector');
const { buildEnvelope } = require('../src/collector/buildEnvelope');
const { validateEnvelope } = require('../src/contract/eventEnvelopeV1');
const { runCollectorPipeline } = require('../src/collector/runCollectorPipeline');

// Echtes Wazuh-Alert-JSON (alerts.json-Zeile).
const ALERT = JSON.stringify({
  id: '1718900000.123456',
  timestamp: '2026-06-24T21:00:00.000+0000',
  rule: { id: '5710', level: 10, description: 'sshd: Attempt to login using a non-existent user',
    groups: ['syslog', 'sshd', 'authentication_failed'],
    mitre: { id: ['T1110'], tactic: ['Credential Access'], technique: ['Brute Force'] } },
  agent: { id: '013', name: 'nexora-honeypot', ip: '10.99.99.80' },
  data: { srcip: '45.143.200.12', srcport: '54321', dstip: '10.99.99.80' },
  location: '/var/log/auth.log',
  full_log: 'Jun 24 21:00:00 hp sshd[1]: Invalid user admin from 45.143.200.12',
});
const INFO = JSON.stringify({ id: '1.1', timestamp: '2026-06-24T21:00:01Z', rule: { id: '530', level: 2, description: 'Listened ports status' }, agent: { id: '000', name: 'manager' } });

test('mapLevelToSeverity: Wazuh-Bänder', () => {
  assert.strictEqual(mapLevelToSeverity(0), 'info');
  assert.strictEqual(mapLevelToSeverity(3), 'info');
  assert.strictEqual(mapLevelToSeverity(5), 'medium');
  assert.strictEqual(mapLevelToSeverity(9), 'high');
  assert.strictEqual(mapLevelToSeverity(13), 'critical');
});

test('createWazuhCollector: Identität (siem/wazuh)', () => {
  const k = createWazuhCollector({ instanceId: 'mgr-1' });
  assert.strictEqual(k.domain, 'siem');
  assert.strictEqual(k.source.vendor, 'wazuh');
});

test('normalize alert: detection-Block + Severity + MITRE', () => {
  const k = createWazuhCollector({ instanceId: 'mgr-1' });
  const part = k.normalize(ALERT);
  assert.strictEqual(part.detection.ruleId, '5710');
  assert.strictEqual(part.detection.level, 10);
  assert.strictEqual(part.detection.severity, 'high');
  assert.strictEqual(part.detection.signature, 'sshd: Attempt to login using a non-existent user');
  assert.deepStrictEqual(part.detection.mitre, ['T1110']);
  assert.strictEqual(part.observedAt, new Date('2026-06-24T21:00:00.000+0000').toISOString());
});

test('normalize alert: network + entities (src/dst/agent)', () => {
  const k = createWazuhCollector({ instanceId: 'mgr-1' });
  const part = k.normalize(ALERT);
  assert.strictEqual(part.network.srcIp, '45.143.200.12');
  assert.strictEqual(part.network.dstIp, '10.99.99.80');
  assert.strictEqual(part.network.srcPort, 54321);
  const vals = part.entities.map((e) => e.value);
  assert.ok(vals.includes('45.143.200.12'));
  assert.ok(vals.includes('nexora-honeypot')); // agent als host-entity
});

test('normalize: alert ohne IPs → kein network-Block, aber detection bleibt', () => {
  const k = createWazuhCollector({ instanceId: 'mgr-1' });
  const part = k.normalize(INFO);
  assert.strictEqual(part.network, undefined);
  assert.strictEqual(part.detection.severity, 'info');
});

test('normalize: minLevel-Filter verwirft Rauschen (level < minLevel → null)', () => {
  const k = createWazuhCollector({ instanceId: 'mgr-1', minLevel: 5 });
  assert.strictEqual(k.normalize(INFO), null);     // level 2 < 5
  assert.notStrictEqual(k.normalize(ALERT), null); // level 10 ≥ 5
});

test('normalize: kein rule-Objekt / kaputtes JSON → null', () => {
  const k = createWazuhCollector({ instanceId: 'mgr-1' });
  assert.strictEqual(k.normalize('{nope'), null);
  assert.strictEqual(k.normalize(JSON.stringify({ id: 'x' })), null);
});

test('alert → buildEnvelope → contract-konform', () => {
  const k = createWazuhCollector({ instanceId: 'mgr-1' });
  const env = buildEnvelope(k, k.normalize(ALERT));
  assert.strictEqual(validateEnvelope(env).valid, true);
  assert.strictEqual(env.source.type, 'siem');
  assert.strictEqual(env.normalized.detection.ruleId, '5710');
});

test('runCollectorPipeline über Wazuh-Alerts (minLevel): nur relevante emittiert', async () => {
  const k = createWazuhCollector({ instanceId: 'mgr-1', minLevel: 5 });
  const out = [];
  const stats = await runCollectorPipeline(k, [ALERT, INFO, '{nope'], { emit: (e) => out.push(e) });
  assert.strictEqual(stats.emitted, 1);
  assert.ok(validateEnvelope(out[0]).valid);
});
