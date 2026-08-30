'use strict';

const {
  loadConfigFromEnv,
  classifyIp,
} = require('../../src/agents/bundle/ownedAssets');

// ── loadConfigFromEnv ──────────────────────────────────────────────────────

describe('ownedAssets.loadConfigFromEnv()', () => {
  test('liefert leere Listen ohne ENV', () => {
    const cfg = loadConfigFromEnv({});
    expect(cfg.honeypotIps).toEqual([]);
    expect(cfg.internalCidrs).toEqual([]);
  });

  test('parst kommaseparierte Honeypot-IPs (getrimmt, leere weg)', () => {
    const cfg = loadConfigFromEnv({ OWNED_HONEYPOT_IPS: ' 203.0.113.246 , , 10.0.10.80 ' });
    expect(cfg.honeypotIps).toEqual(['203.0.113.246', '10.0.10.80']);
  });

  test('parst interne CIDRs', () => {
    const cfg = loadConfigFromEnv({ OWNED_INTERNAL_CIDRS: '10.0.10.0/24,192.168.0.0/16' });
    expect(cfg.internalCidrs).toEqual(['10.0.10.0/24', '192.168.0.0/16']);
  });
});

// ── classifyIp ─────────────────────────────────────────────────────────────

describe('ownedAssets.classifyIp()', () => {
  const cfg = {
    honeypotIps: ['203.0.113.246'],
    internalCidrs: ['10.0.10.0/24'],
  };

  test('erkennt eigenen Honeypot per exakter IP', () => {
    expect(classifyIp('203.0.113.246', cfg)).toEqual({
      role: 'honeypot',
      label: 'eigener Honeypot (Decoy)',
    });
  });

  test('erkennt interne IP per CIDR-Treffer', () => {
    expect(classifyIp('10.0.10.80', cfg)).toEqual({
      role: 'internal',
      label: 'internes Asset',
    });
  });

  test('stuft unbekannte öffentliche IP als extern ein', () => {
    expect(classifyIp('205.210.31.67', cfg)).toEqual({
      role: 'external',
      label: 'extern',
    });
  });

  test('Honeypot hat Vorrang vor CIDR-Treffer', () => {
    const overlap = { honeypotIps: ['10.0.10.80'], internalCidrs: ['10.0.10.0/24'] };
    expect(classifyIp('10.0.10.80', overlap).role).toBe('honeypot');
  });

  test('gibt null für leere/ungültige Eingabe', () => {
    expect(classifyIp('', cfg)).toBeNull();
    expect(classifyIp(null, cfg)).toBeNull();
    expect(classifyIp('nicht-ip', cfg)).toBeNull();
    expect(classifyIp('999.1.1.1', cfg)).toBeNull();
  });
});
