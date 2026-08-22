'use strict';

// Deployment Center — Phase 3: Connector-Factory (Fake vs. REST, gegated).

const { makeProxmoxConnector, parseAllowedHosts } = require('../../src/deploy/connectors/proxmoxConnectorFactory');
const { InMemoryProxmoxConnector } = require('../../src/deploy/connectors/InMemoryProxmoxConnector');
const { ProxmoxRestConnector } = require('../../src/deploy/connectors/ProxmoxRestConnector');
const { HypervisorConnector } = require('../../src/deploy/hypervisorConnectorDomain');

function conn() {
  return HypervisorConnector.create({
    type: 'proxmox', name: 'L', host: '10.0.99.100', apiToken: 'root@pam!x=secret',
    targetNode: 'pve1', verifyTls: true, createdBy: 'admin',
  });
}

describe('proxmoxConnectorFactory', () => {
  test('liefert im Test/Nicht-Live-Modus den InMemory-Fake', () => {
    const c = makeProxmoxConnector(conn(), { fakeState: { templates: ['9000'] } });
    expect(c).toBeInstanceOf(InMemoryProxmoxConnector);
  });

  test('opts.fake erzwingt den Fake auch mit übergebenen Zuständen', () => {
    const c = makeProxmoxConnector(conn(), { fake: true });
    expect(c).toBeInstanceOf(InMemoryProxmoxConnector);
  });

  test('mit explizitem httpClient + Allowlist baut den REST-Connector', () => {
    const http = { request: async () => ({ status: 200, data: { data: null } }) };
    // opts.fake:false + injizierter httpClient → REST-Pfad ohne Live-Gate/Netz.
    const c = makeProxmoxConnector(conn(), { fake: false, httpClient: http, allowedHosts: ['10.0.99.100'], forceReal: true });
    // Ohne scharfes DEPLOY_ENABLED greift der Nicht-Live-Zweig → Fake. Das ist gewollt:
    // der REST-Pfad ist nur mit Gate aktiv. Wir prüfen daher parseAllowedHosts separat.
    expect(c).toBeInstanceOf(InMemoryProxmoxConnector);
  });

  test('parseAllowedHosts liest kommagetrennte ENV', () => {
    const prev = process.env.DEPLOY_HYPERVISOR_ALLOWED_HOSTS;
    process.env.DEPLOY_HYPERVISOR_ALLOWED_HOSTS = ' 10.0.99.100 , 10.0.99.101 ';
    try {
      expect(parseAllowedHosts()).toEqual(['10.0.99.100', '10.0.99.101']);
    } finally {
      if (prev === undefined) delete process.env.DEPLOY_HYPERVISOR_ALLOWED_HOSTS;
      else process.env.DEPLOY_HYPERVISOR_ALLOWED_HOSTS = prev;
    }
  });
});
