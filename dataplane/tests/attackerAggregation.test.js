'use strict';

// Attacker-Aggregation (Anti-Flood, ADR-035 Erweiterung): wiederholte Angriffe
// derselben Quell-IP (gleiche Verdikt-Klasse) sollen — wenn FUSION_ATTACKER_AGG=true —
// auf EINE stabile incidentId kollabieren (über Zeitfenster hinweg), statt pro
// Fenster eine neue Identität zu erzeugen. Default (Flag aus) = bisheriges Verhalten.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  attackerAggregationKey, verdictClassOf, correlationKey, parseCorrelationKey, fuse,
} = require('../src/engine/crossDomainFusion');

const T0 = '2026-06-25T12:00:00.000Z';
const FAR = '2026-06-25T18:00:00.000Z'; // viel späteres Fenster (6 h)

function attack(id, srcIp, dstIp, t, extra = {}) {
  return {
    eventId: id, observedAt: t,
    source: { type: 'ids', vendor: 'suricata', instanceId: 's1' },
    provenance: { confidence: 1 },
    normalized: {
      network: { srcIp, dstIp, dstPort: 22, protocol: 'tcp' },
      entities: [{ type: 'ip', value: srcIp, role: 'source' }, { type: 'ip', value: dstIp, role: 'destination' }],
      ...extra,
    },
  };
}

const ON = { attackerAgg: true };

test('verdictClassOf: confirmed bei IDS-Alert + Block, suspicious bei IDS-Alert, observed bei reiner Telemetrie', () => {
  const tele = attack('t', '45.143.200.12', '198.51.100.10', T0);
  assert.strictEqual(verdictClassOf(tele), 'observed');
  const alert = attack('a', '45.143.200.12', '198.51.100.10', T0, { alert: { signature: 'ET SCAN', severity: 1 } });
  assert.strictEqual(verdictClassOf(alert), 'suspicious');
  const confirmed = attack('c', '45.143.200.12', '198.51.100.10', T0, { alert: { signature: 'ET SCAN', severity: 1 }, firewall: { action: 'block' } });
  assert.strictEqual(verdictClassOf(confirmed), 'confirmed_malicious');
});

test('attackerAggregationKey: gleiche Quell-IP + Verdikt-Klasse über Fenster hinweg → IDENTISCHER Schlüssel', () => {
  const early = attack('e', '45.143.200.12', '198.51.100.10', T0, { alert: { signature: 'ET SCAN', severity: 1 } });
  const late = attack('l', '45.143.200.12', '198.51.100.10', FAR, { alert: { signature: 'ET SCAN', severity: 1 } });
  const ke = attackerAggregationKey(early);
  const kl = attackerAggregationKey(late);
  assert.ok(ke);
  assert.strictEqual(ke, kl);                 // KEIN Zeit-Bucket → Flut kollabiert
  assert.match(ke, /^attacker:v1:/);
  assert.ok(ke.includes('suspicious'));
});

test('attackerAggregationKey: verschiedene Quell-IPs → getrennte Schlüssel', () => {
  const a = attack('a', '45.143.200.12', '198.51.100.10', T0, { alert: { signature: 'x', severity: 1 } });
  const b = attack('b', '203.0.113.9', '198.51.100.10', T0, { alert: { signature: 'x', severity: 1 } });
  assert.notStrictEqual(attackerAggregationKey(a), attackerAggregationKey(b));
});

test('attackerAggregationKey: gleiche Quell-IP, andere Verdikt-Klasse → getrennte Schlüssel (Upgrade bleibt sichtbar)', () => {
  const susp = attack('s', '45.143.200.12', '198.51.100.10', T0, { alert: { signature: 'x', severity: 1 } });
  const conf = attack('c', '45.143.200.12', '198.51.100.10', T0, { alert: { signature: 'x', severity: 1 }, firewall: { action: 'block' } });
  assert.notStrictEqual(attackerAggregationKey(susp), attackerAggregationKey(conf));
});

test('attackerAggregationKey: ohne Quell-IP → null (nicht aggregierbar)', () => {
  assert.strictEqual(attackerAggregationKey({ observedAt: T0, normalized: {} }), null);
});

test('correlationKey: Flag AUS (default) → bisheriges Verhalten (kein attacker-Key)', () => {
  const a = attack('a', '45.143.200.12', '198.51.100.10', T0, { alert: { signature: 'x', severity: 1 } });
  const k = correlationKey(a);                  // ohne attackerAgg
  assert.ok(!k.startsWith('attacker:v1:'));
});

test('correlationKey: Flag AN → attacker-Key gewinnt für aktionierbare Quell-IP-Events', () => {
  const a = attack('a', '45.143.200.12', '198.51.100.10', T0, { alert: { signature: 'x', severity: 1 } });
  const k = correlationKey(a, ON);
  assert.match(k, /^attacker:v1:/);
});

test('parseCorrelationKey: zerlegt attacker-Key in srcIp + verdictClass', () => {
  const a = attack('a', '45.143.200.12', '198.51.100.10', T0, { alert: { signature: 'x', severity: 1 }, firewall: { action: 'block' } });
  const parsed = parseCorrelationKey(attackerAggregationKey(a));
  assert.strictEqual(parsed.mode, 'attacker');
  assert.strictEqual(parsed.srcIp, '45.143.200.12');
  assert.strictEqual(parsed.verdictClass, 'confirmed_malicious');
});

test('fuse: identityKey aus attacker-Aggregation hält dasselbe Sammel-Ticket über Fenster stabil', () => {
  const early = attack('e', '45.143.200.12', '198.51.100.10', T0, { alert: { signature: 'ET SCAN', severity: 1 } });
  const late = attack('l', '45.143.200.12', '198.51.100.10', FAR, { alert: { signature: 'ET SCAN', severity: 1 } });
  const key = attackerAggregationKey(early);
  const incEarly = fuse([early], { identityKey: key });
  const incLate = fuse([late], { identityKey: key });
  assert.strictEqual(incEarly.incidentId, incLate.incidentId);  // stabile ID trotz 6 h Abstand
  assert.strictEqual(incEarly.fusionKey, key);
  assert.strictEqual(incEarly.verdict, 'suspicious');
});
