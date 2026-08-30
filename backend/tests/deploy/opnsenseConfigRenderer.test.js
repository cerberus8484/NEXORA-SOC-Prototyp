'use strict';

// Deployment Center — Phase 5: OPNsense config.xml-Renderer.
// Rendert die Vorgaben deterministisch + XML-escaped (Injection-Schutz),
// niemals ein Secret.

const { renderConfigXml } = require('../../src/deploy/appliers/opnsenseConfigRenderer');

function params(overrides = {}) {
  return {
    hostname: 'fw-lab', ipMode: 'static', staticIp: '10.0.10.1', cidr: 24, gateway: '10.0.10.254',
    vlanTag: 10, dns: ['10.0.10.10', '10.0.10.11'], wanInterface: 'vtnet0', lanInterface: 'vtnet1',
    ...overrides,
  };
}

describe('renderConfigXml — Inhalt', () => {
  test('rendert Hostname, LAN-IP, Subnet (CIDR), VLAN, Gateway, DNS', () => {
    const xml = renderConfigXml(params());
    expect(xml).toMatch(/<hostname>fw-lab<\/hostname>/);
    expect(xml).toMatch(/<ipaddr>10\.0\.10\.1<\/ipaddr>/);
    expect(xml).toMatch(/<subnet>24<\/subnet>/);
    expect(xml).toMatch(/10\.0\.10\.254/);
    expect(xml).toMatch(/<tag>10<\/tag>/);
    expect(xml).toMatch(/10\.0\.10\.10/);
    expect(xml).toMatch(/10\.0\.10\.11/);
  });

  test('ist wohlgeformt genug: startet mit XML-Deklaration + opnsense-Wurzel', () => {
    const xml = renderConfigXml(params());
    expect(xml.trimStart()).toMatch(/^<\?xml/);
    expect(xml).toMatch(/<opnsense>[\s\S]*<\/opnsense>/);
  });

  test('ohne VLAN wird kein tag-Element gerendert', () => {
    const xml = renderConfigXml(params({ vlanTag: undefined }));
    expect(xml).not.toMatch(/<tag>/);
  });
});

describe('renderConfigXml — Injection-Schutz (XML-Escaping)', () => {
  test('escaped Sonderzeichen im Hostname', () => {
    const xml = renderConfigXml(params({ hostname: 'a<b&c"d>e' }));
    expect(xml).toMatch(/a&lt;b&amp;c&quot;d&gt;e/);
    expect(xml).not.toMatch(/a<b&c/); // kein roher, unescapeter Wert
  });

  test('escaped einen versuchten Element-Injection-Payload', () => {
    const xml = renderConfigXml(params({ hostname: '</hostname><evil>x</evil>' }));
    expect(xml).not.toMatch(/<evil>/);
    expect(xml).toMatch(/&lt;evil&gt;/);
  });
});

describe('renderConfigXml — kein Secret im Artefakt', () => {
  test('ein (fälschlich übergebenes) adminPassword taucht NICHT im XML auf', () => {
    const xml = renderConfigXml(params({ adminPassword: 'geheim!' }));
    expect(xml).not.toMatch(/geheim/);
    expect(xml).not.toMatch(/adminPassword/i);
  });
});
