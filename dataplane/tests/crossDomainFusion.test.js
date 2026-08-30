'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  fusionKey, noiseAggregationKey, correlationKey, parseFusionKey,
  groupByFusionKey, groupBySlidingWindow, fuse, SEVERITY_RANK,
} = require('../src/engine/crossDomainFusion');

const T0 = '2026-06-25T12:00:00.000Z';
const T0b = '2026-06-25T12:00:30.000Z';
const T0c = '2026-06-25T12:01:00.000Z';
const FAR = '2026-06-25T13:00:00.000Z'; // anderes Fenster

// Vier Envelopes über dieselbe Angreifer↔Asset-Interaktion (45.143.200.12 ↔ 198.51.100.10).
const idsAlert = {
  eventId: 'e-ids', observedAt: T0, source: { type: 'ids', vendor: 'suricata', instanceId: 's1' },
  provenance: { confidence: 1 },
  normalized: {
    entities: [{ type: 'ip', value: '45.143.200.12', role: 'source' }, { type: 'ip', value: '198.51.100.10', role: 'destination' }],
    network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10', dstPort: 22, protocol: 'tcp' },
    alert: { signature: 'ET SCAN SSH', severity: 1, signatureId: 2001219, mitre: ['T1110'] },
  },
};
const fwBlock = {
  eventId: 'e-fw', observedAt: T0b, source: { type: 'firewall', vendor: 'opnsense', instanceId: 'fw1' },
  provenance: { confidence: 1 },
  normalized: {
    network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10', dstPort: 22, protocol: 'tcp', direction: 'in' },
    firewall: { action: 'block', interface: 'igb0' },
  },
};
const siemHigh = {
  eventId: 'e-siem', observedAt: T0c, source: { type: 'siem', vendor: 'wazuh', instanceId: 'm1' },
  provenance: { confidence: 1 },
  normalized: {
    network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10' },
    detection: { ruleId: '5712', severity: 'high', signature: 'sshd brute force', mitre: ['T1110', 'T1078'] },
  },
};
const flow = {
  eventId: 'e-flow', observedAt: '2026-06-25T12:00:10.000Z', source: { type: 'ids', vendor: 'conntrack', instanceId: 'c1' },
  provenance: { confidence: 1 },
  normalized: {
    network: { srcIp: '198.51.100.10', dstIp: '45.143.200.12', bytesToServer: 1840, bytesToClient: 1450 },
  },
};
const other = {
  eventId: 'e-other', observedAt: T0, source: { type: 'ids', vendor: 'suricata', instanceId: 's1' },
  provenance: { confidence: 1 },
  normalized: { network: { srcIp: '8.8.8.8', dstIp: '1.1.1.1' } },
};

test('fusionKey: IP-Paar ungeordnet → identisch für beide Richtungen, im selben Fenster', () => {
  const k1 = fusionKey(idsAlert);
  const k2 = fusionKey(flow); // umgekehrte Richtung (Reply)
  assert.strictEqual(k1, k2);
});

test('fusionKey: anderes Zeitfenster → anderer Schlüssel', () => {
  const late = { ...idsAlert, observedAt: FAR };
  assert.notStrictEqual(fusionKey(idsAlert), fusionKey(late));
});

test('fusionKey: ohne IP → null (nicht fusionierbar)', () => {
  assert.strictEqual(fusionKey({ observedAt: T0, normalized: {} }), null);
  assert.strictEqual(fusionKey({ observedAt: T0 }), null);
});

test('fusionKey: einzelne IP (nur src) → Single-Sided-Schlüssel, stabil', () => {
  const oneSided = { observedAt: T0, normalized: { entities: [{ type: 'ip', value: '203.0.113.7' }] } };
  const k = fusionKey(oneSided);
  assert.ok(k && k.includes('203.0.113.7'));
});

test('groupByFusionKey: trennt fremde IP-Paare', () => {
  const groups = groupByFusionKey([idsAlert, fwBlock, siemHigh, flow, other]);
  assert.strictEqual(groups.size, 2);
  const main = groups.get(fusionKey(idsAlert));
  assert.strictEqual(main.length, 4);
});

test('fuse: Cross-Domain-Vorfall — Domänen, maxSeverity, Verdikt confirmed_malicious', () => {
  const inc = fuse([idsAlert, fwBlock, siemHigh, flow]);
  assert.deepStrictEqual([...inc.domains].sort(), ['firewall', 'ids', 'siem']);
  assert.strictEqual(inc.severity, 'high');                 // max über alle Quellen
  assert.strictEqual(inc.verdict, 'confirmed_malicious');   // IDS-Alert + Firewall-Block
  assert.strictEqual(inc.eventCount, 4);
});

test('fuse: Byte-Summen, 5-Tuple-Kontext, MITRE-Union, Signaturen', () => {
  const inc = fuse([idsAlert, fwBlock, siemHigh, flow]);
  assert.strictEqual(inc.network.bytesToServer, 1840);
  assert.strictEqual(inc.network.bytesToClient, 1450);
  assert.strictEqual(inc.network.dstPort, 22);
  assert.strictEqual(inc.network.protocol, 'tcp');
  assert.deepStrictEqual([...inc.mitre].sort(), ['T1078', 'T1110']);
  assert.ok(inc.signatures.includes('ET SCAN SSH'));
  assert.ok(inc.signatures.includes('sshd brute force'));
});

test('fuse: Entities dedupliziert (Angreifer + Asset)', () => {
  const inc = fuse([idsAlert, fwBlock, siemHigh, flow]);
  const ips = inc.entities.filter((e) => e.type === 'ip').map((e) => e.value).sort();
  assert.deepStrictEqual(ips, ['198.51.100.10', '45.143.200.12']);
});

test('fuse: stabile, idempotente incidentId aus fusionKey', () => {
  const a = fuse([idsAlert, fwBlock]);
  const b = fuse([fwBlock, idsAlert]); // Reihenfolge egal
  assert.strictEqual(a.incidentId, b.incidentId);
  assert.match(a.incidentId, /^[0-9a-f]{64}$/);
});

test('fuse: nur Telemetrie (Flows) → verdict observed, severity info', () => {
  const inc = fuse([flow]);
  assert.strictEqual(inc.verdict, 'observed');
  assert.strictEqual(inc.severity, 'info');
});

test('fuse: nur SIEM medium ohne Block/IDS-Alert → suspicious', () => {
  const siemMed = { ...siemHigh, eventId: 'e-s2', normalized: { ...siemHigh.normalized, detection: { ...siemHigh.normalized.detection, severity: 'medium' } } };
  const inc = fuse([siemMed]);
  assert.strictEqual(inc.verdict, 'suspicious');
  assert.strictEqual(inc.severity, 'medium');
});

test('fuse: Zeitspanne windowStart/windowEnd aus observedAt', () => {
  const inc = fuse([idsAlert, fwBlock, siemHigh, flow]);
  assert.strictEqual(inc.windowStart, T0);
  assert.strictEqual(inc.windowEnd, T0c);
});

test('parseFusionKey: zerlegt key in IPs + Bucket, Round-Trip mit fusionKey', () => {
  const k = fusionKey(idsAlert);
  const p = parseFusionKey(k);
  assert.ok(p.ips.includes('45.143.200.12') && p.ips.includes('198.51.100.10'));
  assert.ok(Number.isFinite(p.bucket));
  assert.strictEqual(parseFusionKey('nonsense'), null);
});

// ── Sliding-Window (Slice 3): grenzunabhängige Session-Gruppierung ──────────
function ev(id, ip2, t) {
  return { eventId: id, observedAt: t, source: { type: 'ids', vendor: 'x', instanceId: 'i' }, provenance: { confidence: 1 },
    normalized: { network: { srcIp: '45.143.200.12', dstIp: ip2 } } };
}

test('groupBySlidingWindow: nahe Events über eine Bucket-Grenze hinweg → EINE Session', () => {
  // 11:59:58 und 12:00:03 = 5s Abstand, aber bei 5-min-Tumbling in verschiedenen Buckets.
  const a = ev('a', '198.51.100.10', '2026-06-25T11:59:58.000Z');
  const b = ev('b', '198.51.100.10', '2026-06-25T12:00:03.000Z');
  // Beweis, dass Tumbling sie trennen würde:
  assert.notStrictEqual(fusionKey(a), fusionKey(b));
  // Sliding-Window fasst sie zusammen:
  const sessions = groupBySlidingWindow([a, b]);
  assert.strictEqual(sessions.length, 1);
  assert.strictEqual(sessions[0].envelopes.length, 2);
});

test('groupBySlidingWindow: Lücke > Fenster → getrennte Sessions (verschiedene Episoden)', () => {
  const a = ev('a', '198.51.100.10', '2026-06-25T12:00:00.000Z');
  const b = ev('b', '198.51.100.10', '2026-06-25T12:10:00.000Z'); // 10 min > 5 min
  const sessions = groupBySlidingWindow([a, b]);
  assert.strictEqual(sessions.length, 2);
});

test('groupBySlidingWindow: verschiedene IP-Paare → getrennte Sessions', () => {
  const a = ev('a', '198.51.100.10', '2026-06-25T12:00:00.000Z');
  const b = ev('b', '203.0.113.9', '2026-06-25T12:00:01.000Z');
  const sessions = groupBySlidingWindow([a, b]);
  assert.strictEqual(sessions.length, 2);
});

test('groupBySlidingWindow: Kette aus mehreren nahen Events (je ≤ Fenster) → eine Session', () => {
  const xs = ['12:00:00', '12:04:00', '12:08:00', '12:12:00'].map((hms, i) => ev('e' + i, '198.51.100.10', `2026-06-25T${hms}.000Z`));
  // jeweils 4 min Abstand (< 5 min) → durchgehende Session trotz Gesamtspanne 12 min
  const sessions = groupBySlidingWindow(xs);
  assert.strictEqual(sessions.length, 1);
  assert.strictEqual(sessions[0].envelopes.length, 4);
});

test('fuse: incidentId am Session-Start verankert — spätes Event ändert die ID NICHT', () => {
  const early = ev('e1', '198.51.100.10', '2026-06-25T11:59:58.000Z');
  const late = ev('e2', '198.51.100.10', '2026-06-25T12:00:03.000Z'); // anderer Tumbling-Bucket
  const idEarlyOnly = fuse([early]).incidentId;
  const idSession = fuse([late, early]).incidentId;   // Reihenfolge egal; Anker = frühestes Event
  assert.strictEqual(idSession, idEarlyOnly);          // stabil verankert, unabhängig vom Trigger
  // Kontrast: nur das späte Event allein (anderer Bucket) → andere ID (verbleibende Restschuld)
  assert.notStrictEqual(fuse([late]).incidentId, idSession);
});

test('fuse: getrennte Episoden (Lücke > Fenster) bekommen verschiedene incidentIds', () => {
  const a = ev('a', '198.51.100.10', '2026-06-25T12:00:00.000Z');
  const b = ev('b', '198.51.100.10', '2026-06-25T12:20:00.000Z'); // 20 min später
  assert.notStrictEqual(fuse([a]).incidentId, fuse([b]).incidentId);
});

test('SEVERITY_RANK: Ordnung info<low<medium<high<critical', () => {
  assert.ok(SEVERITY_RANK.info < SEVERITY_RANK.medium);
  assert.ok(SEVERITY_RANK.high < SEVERITY_RANK.critical);
});

function telemetry(id, srcIp, dstIp = '31.70.103.246', t = T0) {
  return {
    eventId: id,
    observedAt: t,
    source: { type: 'ids', vendor: 'suricata', instanceId: 's1' },
    provenance: { confidence: 1 },
    normalized: { network: { srcIp, dstIp, dstPort: 443, protocol: 'tcp' } },
  };
}

test('noiseAggregationKey: reine IDS-info-Telemetrie gruppiert nach Ziel/Typ, nicht nach Source-IP', () => {
  const a = telemetry('n1', '45.148.10.121');
  const b = telemetry('n2', '179.155.205.132');
  assert.notStrictEqual(fusionKey(a), fusionKey(b));       // altes IP-Paar wuerde splitten
  assert.strictEqual(noiseAggregationKey(a), noiseAggregationKey(b));
  const groups = groupByFusionKey([a, b]);
  assert.strictEqual(groups.size, 1);
});

test('noiseAggregationKey: IDS-Alert bleibt praezise und wird nicht als Noise verdichtet', () => {
  const noisy = telemetry('n1', '45.148.10.121');
  const alert = {
    ...telemetry('a1', '45.148.10.122'),
    normalized: {
      ...telemetry('a1', '45.148.10.122').normalized,
      alert: { signature: 'ET EXPLOIT', severity: 1 },
    },
  };
  assert.strictEqual(noiseAggregationKey(alert), null);
  assert.notStrictEqual(correlationKey(noisy), correlationKey(alert));
});

test('fuse: Noise-Identity-Key haelt dasselbe Sammel-Ticket stabil', () => {
  const a = telemetry('n1', '45.148.10.121');
  const b = telemetry('n2', '179.155.205.132');
  const key = noiseAggregationKey(a);
  const inc = fuse([a, b], { identityKey: key });
  assert.strictEqual(inc.fusionKey, key);
  assert.strictEqual(inc.verdict, 'observed');
  assert.strictEqual(inc.severity, 'info');
  assert.strictEqual(inc.eventCount, 2);
});

// ── sessionActivity: Cowrie-Sitzungs-Aktivität einer Session in den FusedIncident sammeln ──
const HP = '192.0.2.10';
const ATK = '198.51.100.23';
function cowrieEnv(id, at, activity) {
  return {
    eventId: id, observedAt: at, source: { type: 'siem', vendor: 'cowrie', instanceId: 'hp-1' },
    provenance: { confidence: 1 },
    normalized: {
      network: { srcIp: ATK, dstIp: HP, dstPort: 2222, protocol: 'tcp' },
      detection: { ruleId: 'cowrie.command.input', severity: 'high', signature: 'Cowrie: Befehl', mitre: ['T1059'] },
      ...(activity ? { activity } : {}),
    },
  };
}

test('fuse: sammelt activity der Events in sessionActivity (chronologisch)', () => {
  const e1 = cowrieEnv('c1', T0, { kind: 'login', user: 'root' });
  const e2 = cowrieEnv('c2', T0b, { kind: 'command', value: 'uname -a' });
  const e3 = cowrieEnv('c3', T0c, { kind: 'download', value: 'http://evil.test/m' });
  const inc = fuse([e3, e1, e2]); // unsortiert rein
  assert.ok(Array.isArray(inc.sessionActivity));
  assert.deepStrictEqual(inc.sessionActivity.map((a) => a.kind), ['login', 'command', 'download']);
  assert.strictEqual(inc.sessionActivity[0].at, T0);
  assert.strictEqual(inc.sessionActivity[1].value, 'uname -a');
  assert.strictEqual(inc.sessionActivity[1].user, undefined);
});

test('fuse: sessionActivity dedupliziert identische Aktivität', () => {
  const inc = fuse([
    cowrieEnv('c1', T0, { kind: 'command', value: 'id' }),
    cowrieEnv('c2', T0b, { kind: 'command', value: 'id' }),
  ]);
  assert.strictEqual(inc.sessionActivity.length, 1);
  assert.strictEqual(inc.sessionActivity[0].value, 'id');
});

test('fuse: sessionActivity fehlt, wenn keine Aktivität vorhanden', () => {
  const inc = fuse([cowrieEnv('c1', T0, null)]);
  assert.strictEqual(inc.sessionActivity, undefined);
});

test('fuse: sessionActivity ist auf 50 Einträge gedeckelt', () => {
  const many = [];
  for (let i = 0; i < 80; i++) {
    many.push(cowrieEnv(`c${i}`, new Date(Date.parse(T0) + i * 1000).toISOString(), { kind: 'command', value: `cmd-${i}` }));
  }
  const inc = fuse(many);
  assert.ok(inc.sessionActivity.length <= 50, `len ${inc.sessionActivity.length}`);
});
