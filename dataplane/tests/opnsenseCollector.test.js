'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createOpnsenseCollector, parseFilterlog } = require('../src/collector/opnsenseCollector');
const { buildEnvelope } = require('../src/collector/buildEnvelope');
const { validateEnvelope } = require('../src/contract/eventEnvelopeV1');
const { runCollectorPipeline } = require('../src/collector/runCollectorPipeline');

// Echte OPNsense filterlog-CSV (das Feld, das der Go-Collector ebenfalls parst).
const V4_TCP_BLOCK = '97,,,0,igb0,match,block,in,4,0x0,,64,0,0,DF,6,tcp,60,203.0.113.45,198.51.100.9,40522,22,0,S,...';
const V4_UDP_PASS = '100,,,0,igb0,match,pass,out,4,0x0,,64,0,0,none,17,udp,80,198.51.100.9,8.8.8.8,40000,53,60';
const V6_TCP_BLOCK = '120,,,0,igb1,match,block,in,6,0x00,0x00000,64,tcp,6,40,2001:db8::1,2001:db8::2,55000,443';
const V4_ICMP = '5,,,0,igb0,match,block,in,4,0x0,,64,0,0,none,1,icmp,84,203.0.113.45,198.51.100.9';
// Mit syslog-Präfix (BSD-Stil) — CSV ist das letzte whitespace-Token.
const PREFIXED = `<134>filterlog[12345]: ${V4_TCP_BLOCK}`;

test('parseFilterlog: v4 tcp block — action/dir/5-Tuple', () => {
  const f = parseFilterlog(V4_TCP_BLOCK);
  assert.strictEqual(f.action, 'block');
  assert.strictEqual(f.direction, 'in');
  assert.strictEqual(f.protocol, 'tcp');
  assert.strictEqual(f.srcIp, '203.0.113.45');
  assert.strictEqual(f.dstIp, '198.51.100.9');
  assert.strictEqual(f.srcPort, 40522);
  assert.strictEqual(f.dstPort, 22);
  assert.strictEqual(f.interface, 'igb0');
});

test('parseFilterlog: v4 udp pass', () => {
  const f = parseFilterlog(V4_UDP_PASS);
  assert.strictEqual(f.action, 'pass');
  assert.strictEqual(f.direction, 'out');
  assert.strictEqual(f.protocol, 'udp');
  assert.strictEqual(f.dstIp, '8.8.8.8');
  assert.strictEqual(f.dstPort, 53);
});

test('parseFilterlog: v6 tcp — andere Feldordnung korrekt', () => {
  const f = parseFilterlog(V6_TCP_BLOCK);
  assert.strictEqual(f.protocol, 'tcp');
  assert.strictEqual(f.srcIp, '2001:db8::1');
  assert.strictEqual(f.dstIp, '2001:db8::2');
  assert.strictEqual(f.srcPort, 55000);
  assert.strictEqual(f.dstPort, 443);
});

test('parseFilterlog: icmp ohne Ports', () => {
  const f = parseFilterlog(V4_ICMP);
  assert.strictEqual(f.protocol, 'icmp');
  assert.strictEqual(f.srcPort, null);
  assert.strictEqual(f.dstPort, null);
});

test('parseFilterlog: syslog-Präfix wird gestrippt (CSV = letztes Token)', () => {
  const f = parseFilterlog(PREFIXED);
  assert.strictEqual(f.srcIp, '203.0.113.45');
  assert.strictEqual(f.dstPort, 22);
});

test('parseFilterlog: Müll → null', () => {
  assert.strictEqual(parseFilterlog('not,a,filterlog,line'), null);
  assert.strictEqual(parseFilterlog(''), null);
  assert.strictEqual(parseFilterlog(null), null);
});

test('createOpnsenseCollector: Identität (firewall/opnsense) + Envelope-konform', () => {
  const k = createOpnsenseCollector({ instanceId: 'fw-01' });
  assert.strictEqual(k.domain, 'firewall');
  assert.strictEqual(k.source.vendor, 'opnsense');
  const part = k.normalize(V4_TCP_BLOCK);
  assert.strictEqual(part.network.direction, 'in');
  assert.strictEqual(part.firewall.action, 'block');
  assert.deepStrictEqual(part.entities.map((e) => e.value), ['203.0.113.45', '198.51.100.9']);
  const env = buildEnvelope(k, part);
  assert.strictEqual(validateEnvelope(env).valid, true);
  assert.strictEqual(env.source.type, 'firewall');
});

test('normalize: optionaler Asset-Scope filtert fremde Flows', () => {
  const k = createOpnsenseCollector({ instanceId: 'fw-01', assetIps: ['198.51.100.9'] });
  assert.notStrictEqual(k.normalize(V4_TCP_BLOCK), null);   // dst=198.51.100.9 → Asset, behalten
  assert.strictEqual(k.normalize(V6_TCP_BLOCK), null);      // 2001:db8::1/::2 kein Asset → verworfen
});

test('runCollectorPipeline über filterlog-Zeilen: nur valide emittiert', async () => {
  const k = createOpnsenseCollector({ instanceId: 'fw-01' });
  const out = [];
  const stats = await runCollectorPipeline(k, [V4_TCP_BLOCK, V4_UDP_PASS, V6_TCP_BLOCK, 'garbage'], { emit: (e) => out.push(e) });
  assert.strictEqual(stats.emitted, 3);
  assert.ok(out.every((e) => validateEnvelope(e).valid));
});
