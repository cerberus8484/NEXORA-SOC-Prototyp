'use strict';

const { resolveFqdn, createNodeResolve4, SOURCE } = require('../../src/correlation/fqdnResolver');

const DNS = '10.99.99.10';
// Gefälschter resolve4: Map Name → IPs; spezielle Namen werfen.
const fakeResolve4 = (map) => async (name) => {
  if (map[name] instanceof Error) throw map[name];
  if (!(name in map)) { const e = new Error('not found'); e.code = 'ENOTFOUND'; throw e; }
  return map[name];
};
const deps = (map, over = {}) => ({ resolve4: fakeResolve4(map), dnsServer: DNS, ...over });

describe('CE-5.2 resolveFqdn — DNS forward-confirm', () => {
  test('1) candidateName löst auf gleiche IP → fqdn gesetzt, high', async () => {
    const r = await resolveFqdn({ ip: '10.99.99.10', candidateName: 'DC01.nexora.example' },
      deps({ 'DC01.nexora.example': ['10.99.99.10'] }));
    expect(r).toMatchObject({ fqdn: 'DC01.nexora.example', source: SOURCE, confidence: 'high', missingReason: null });
    expect(r.provenance).toEqual({ query: 'DC01.nexora.example', expectedIp: '10.99.99.10', resolvedIps: ['10.99.99.10'], dnsServer: DNS });
  });

  test('2) candidateName löst auf ANDERE IP → dns_unconfirmed, kein Fake', async () => {
    const r = await resolveFqdn({ ip: '10.99.99.10', candidateName: 'DC01.nexora.example' },
      deps({ 'DC01.nexora.example': ['10.99.99.99'] }));
    expect(r.fqdn).toBeNull();
    expect(r.missingReason).toBe('dns_unconfirmed');
    expect(r.provenance.resolvedIps).toEqual(['10.99.99.99']);
  });

  test('3a) kein A-Record (ENOTFOUND) → dns_no_record', async () => {
    const r = await resolveFqdn({ ip: '10.99.99.10', candidateName: 'ghost.nexora.example' }, deps({}));
    expect(r.fqdn).toBeNull();
    expect(r.missingReason).toBe('dns_no_record');
  });

  test('3b) leeres A-Record-Array → dns_no_record', async () => {
    const r = await resolveFqdn({ ip: '10.99.99.10', candidateName: 'empty.nexora.example' },
      deps({ 'empty.nexora.example': [] }));
    expect(r.missingReason).toBe('dns_no_record');
  });

  test('4) kein candidateName → no_candidate (aus IP wird nicht geraten)', async () => {
    const r = await resolveFqdn({ ip: '10.99.99.10' }, deps({}));
    expect(r.fqdn).toBeNull();
    expect(r.missingReason).toBe('no_candidate');
    expect(r.provenance).toBeNull();
  });

  test('5) mehrere A-Records, einer passt → confirmed', async () => {
    const r = await resolveFqdn({ ip: '10.99.99.11', candidateName: 'WEC01.nexora.example' },
      deps({ 'WEC01.nexora.example': ['10.99.99.50', '10.99.99.11'] }));
    expect(r.fqdn).toBe('WEC01.nexora.example');
    expect(r.confidence).toBe('high');
    expect(r.provenance.resolvedIps).toEqual(['10.99.99.50', '10.99.99.11']);
  });

  test('6) DNS-Timeout/-Fehler → dns_error, kein Crash', async () => {
    const err = new Error('query timed out'); err.code = 'ETIMEOUT';
    const r = await resolveFqdn({ ip: '10.99.99.10', candidateName: 'slow.nexora.example' },
      deps({ 'slow.nexora.example': err }));
    expect(r.fqdn).toBeNull();
    expect(r.missingReason).toBe('dns_error');
    expect(r.provenance.query).toBe('slow.nexora.example');
  });

  test('7) IP fehlt → no_ip', async () => {
    const r = await resolveFqdn({ candidateName: 'DC01.nexora.example' }, deps({ 'DC01.nexora.example': ['10.99.99.10'] }));
    expect(r.missingReason).toBe('no_ip');
  });

  test('8a) enabled=false → disabled (kein DNS-Call)', async () => {
    let called = false;
    const r = await resolveFqdn({ ip: '10.99.99.10', candidateName: 'DC01.nexora.example' },
      { resolve4: async () => { called = true; return ['10.99.99.10']; }, enabled: false });
    expect(r.missingReason).toBe('disabled');
    expect(called).toBe(false);
  });

  test('8b) kein resolve4 (Config fehlt) → disabled', async () => {
    const r = await resolveFqdn({ ip: '10.99.99.10', candidateName: 'DC01.nexora.example' }, {});
    expect(r.missingReason).toBe('disabled');
  });
});

describe('createNodeResolve4', () => {
  test('liefert eine Funktion (kein Live-Lookup hier)', () => {
    expect(typeof createNodeResolve4({ dnsServer: DNS })).toBe('function');
  });
});
