'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { buildCollector } = require('../src/collector/collectorMain');

test('buildCollector: jede KIND baut den richtigen Collector', () => {
  assert.strictEqual(buildCollector({ COLLECTOR_KIND: 'conntrack', INSTANCE_ID: 'a' }).domain, 'ids');
  assert.strictEqual(buildCollector({ COLLECTOR_KIND: 'suricata', INSTANCE_ID: 'a', ASSET_IPS: '198.51.100.10' }).domain, 'ids');
  assert.strictEqual(buildCollector({ COLLECTOR_KIND: 'opnsense', INSTANCE_ID: 'a' }).domain, 'firewall');
  assert.strictEqual(buildCollector({ COLLECTOR_KIND: 'wazuh', INSTANCE_ID: 'a' }).domain, 'siem');
  assert.strictEqual(buildCollector({ COLLECTOR_KIND: 'cowrie', INSTANCE_ID: 'a', HONEYPOT_IP: '192.0.2.10' }).domain, 'siem');
});

test('buildCollector: suricata ohne ASSET_IPS → Fehler (Asset-Scope Pflicht)', () => {
  assert.throws(() => buildCollector({ COLLECTOR_KIND: 'suricata', INSTANCE_ID: 'a' }), /assetIps/);
});

test('buildCollector: cowrie ohne HONEYPOT_IP → Fehler (Pairing-Anker Pflicht)', () => {
  assert.throws(() => buildCollector({ COLLECTOR_KIND: 'cowrie', INSTANCE_ID: 'a' }), /honeypotIp/);
});

test('buildCollector: unbekannte/fehlende KIND → Fehler', () => {
  assert.throws(() => buildCollector({ COLLECTOR_KIND: 'nope' }), /unbekannter COLLECTOR_KIND/);
  assert.throws(() => buildCollector({}), /unbekannter COLLECTOR_KIND/);
});
