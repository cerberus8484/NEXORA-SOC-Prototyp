'use strict';

// CE-5.3 — Prozess-Instanz des FQDN-Resolvers. Default AUS (kein DNS-Call).
describe('CE-5.3 fqdnResolverInstance — ENV-konfiguriert, default AUS', () => {
  const SAVED = {
    FQDN_RESOLVER_ENABLED: process.env.FQDN_RESOLVER_ENABLED,
    FQDN_DNS_SERVER: process.env.FQDN_DNS_SERVER,
    FQDN_DOMAIN: process.env.FQDN_DOMAIN,
  };

  beforeEach(() => {
    delete process.env.FQDN_RESOLVER_ENABLED;
    delete process.env.FQDN_DNS_SERVER;
    delete process.env.FQDN_DOMAIN;
    jest.resetModules();
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(SAVED)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('Default (keine FQDN_* ENV): Resolver aus, keine Domain', () => {
    const { FQDN_ENABLED, FQDN_DOMAIN } = require('../../src/correlation/fqdnResolverInstance');
    expect(FQDN_ENABLED).toBe(false);
    expect(FQDN_DOMAIN).toBe(null);
  });

  test('Default: fqdnResolver liefert missingReason "disabled" (kein DNS-Call)', async () => {
    const { fqdnResolver } = require('../../src/correlation/fqdnResolverInstance');
    const r = await fqdnResolver({ ip: '10.99.99.10', candidateName: 'DC01.nexora.example' });
    expect(r.missingReason).toBe('disabled');
    expect(r.fqdn).toBe(null);
  });
});
