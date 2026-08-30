'use strict';

// Deployment Center — Phase 3: echter Proxmox-REST-Connector (mit gemocktem HTTP-Client).
// Prüft: korrekte API-Pfade, PVEAPIToken-Header (Token entschlüsselt, nie geloggt),
// SSRF-Allowlist (Metadata/nicht-erlaubte Hosts deny), redigierte Fehler.

const { ProxmoxRestConnector } = require('../../src/deploy/connectors/ProxmoxRestConnector');
const { HypervisorConnector } = require('../../src/deploy/hypervisorConnectorDomain');
const { assertConnectorShape } = require('../../src/deploy/connectors/hypervisorConnector');

const RAW_TOKEN = 'root@pam!nexora=11112222-3333-4444-5555-666677778888';

function makeConnectorDomain(overrides = {}) {
  return HypervisorConnector.create({
    type: 'proxmox', name: 'Lab', host: '10.0.99.100', apiToken: RAW_TOKEN,
    targetNode: 'pve1', storage: 'local-lvm', bridge: 'vmbr1', verifyTls: true, createdBy: 'admin',
    ...overrides,
  });
}

// Mock-HTTP-Client: zeichnet Aufrufe auf, liefert kanned responses / wirft.
function makeHttp(handler) {
  const calls = [];
  return {
    calls,
    async request(url, opts = {}) {
      calls.push({ url, opts });
      return handler ? handler(url, opts, calls) : { status: 200, data: { data: null } };
    },
  };
}

const ALLOWED = ['10.0.99.100'];

describe('ProxmoxRestConnector — Vertrag', () => {
  test('erfüllt den Connector-Vertrag', () => {
    const c = new ProxmoxRestConnector({ connector: makeConnectorDomain(), allowedHosts: ALLOWED, httpClient: makeHttp() });
    expect(() => assertConnectorShape(c)).not.toThrow();
  });
});

describe('ProxmoxRestConnector — API-Pfade + Auth-Header', () => {
  test('cloneFromTemplate baut den Clone-Pfad und sendet PVEAPIToken-Header', async () => {
    const http = makeHttp((url) => {
      if (/\/cluster\/nextid/.test(url)) return { status: 200, data: { data: '1234' } };
      return { status: 200, data: { data: 'UPID:...' } };
    });
    const c = new ProxmoxRestConnector({ connector: makeConnectorDomain(), allowedHosts: ALLOWED, httpClient: http });
    const { vmid } = await c.cloneFromTemplate('9000', { name: 'fw-lab' });
    expect(vmid).toBe(1234);
    const clone = http.calls.find((x) => /\/nodes\/pve1\/qemu\/9000\/clone/.test(x.url));
    expect(clone).toBeTruthy();
    expect(clone.opts.method).toBe('POST');
    expect(clone.opts.headers.Authorization).toMatch(/^PVEAPIToken=/);
    // Der ENTSCHLÜSSELTE Token steckt im Header, aber niemals ein Klartext-Leak drumherum.
    expect(clone.opts.headers.Authorization).toContain('root@pam!nexora');
  });

  test('start/status/destroy treffen die richtigen Endpunkte', async () => {
    const http = makeHttp((url) => {
      if (/status\/current/.test(url)) return { status: 200, data: { data: { status: 'running' } } };
      return { status: 200, data: { data: null } };
    });
    const c = new ProxmoxRestConnector({ connector: makeConnectorDomain(), allowedHosts: ALLOWED, httpClient: http });
    await c.start(1234);
    await c.status(1234);
    await c.destroy(1234);
    expect(http.calls.some((x) => /\/qemu\/1234\/status\/start/.test(x.url) && x.opts.method === 'POST')).toBe(true);
    expect(http.calls.some((x) => /\/qemu\/1234\/status\/current/.test(x.url))).toBe(true);
    expect(http.calls.some((x) => /\/qemu\/1234$/.test(x.url) && x.opts.method === 'DELETE')).toBe(true);
  });

  test('status meldet running=true bei laufender VM', async () => {
    const http = makeHttp(() => ({ status: 200, data: { data: { status: 'running' } } }));
    const c = new ProxmoxRestConnector({ connector: makeConnectorDomain(), allowedHosts: ALLOWED, httpClient: http });
    expect((await c.status(1234)).running).toBe(true);
  });

  test('attachConfigMedia lädt das Config-Artefakt hoch und hängt es als CD-ROM an', async () => {
    const http = makeHttp(() => ({ status: 200, data: { data: 'UPID:...' } }));
    const c = new ProxmoxRestConnector({ connector: makeConnectorDomain(), allowedHosts: ALLOWED, httpClient: http });
    const media = { filename: 'opnsense-config-abc.xml', guestPath: '/conf/config.xml', content: '<opnsense/>', configHash: 'a'.repeat(64), label: 'X' };
    const res = await c.attachConfigMedia(1234, media);

    // 1) Upload des Config-Inhalts in den Storage.
    const upload = http.calls.find((x) => /\/storage\/local-lvm\/upload/.test(x.url));
    expect(upload).toBeTruthy();
    expect(upload.opts.method).toBe('POST');
    expect(upload.opts.headers.Authorization).toMatch(/^PVEAPIToken=/);
    // 2) CD-ROM an die VM anhängen (ide2 = volid,media=cdrom).
    const setCd = http.calls.find((x) => /\/qemu\/1234\/config/.test(x.url) && /ide2/.test(JSON.stringify(x.opts.body || {})));
    expect(setCd).toBeTruthy();
    expect(JSON.stringify(setCd.opts.body)).toMatch(/media=cdrom/);
    expect(res.mediaRef).toMatch(/opnsense-config-abc\.xml/);
  });

  test('attachConfigMedia ohne Inhalt wirft (fail-fast)', async () => {
    const c = new ProxmoxRestConnector({ connector: makeConnectorDomain(), allowedHosts: ALLOWED, httpClient: makeHttp() });
    await expect(c.attachConfigMedia(1234, { filename: 'x.xml' })).rejects.toThrow();
  });
});

describe('ProxmoxRestConnector — SSRF-Guard', () => {
  test('Metadata-IP wird immer abgelehnt (auch wenn allowlisted)', () => {
    const conn = makeConnectorDomain({ host: '169.254.169.254' });
    expect(() => new ProxmoxRestConnector({ connector: conn, allowedHosts: ['169.254.169.254'], httpClient: makeHttp() }))
      .toThrow(/ssrf|nicht erlaubt|metadata|link-local/i);
  });

  test('Host außerhalb der Allowlist wird abgelehnt', () => {
    const conn = makeConnectorDomain({ host: '8.8.8.8' });
    expect(() => new ProxmoxRestConnector({ connector: conn, allowedHosts: ALLOWED, httpClient: makeHttp() }))
      .toThrow(/allowlist|nicht erlaubt|ssrf/i);
  });

  test('erlaubter Mgmt-Host wird akzeptiert', () => {
    expect(() => new ProxmoxRestConnector({ connector: makeConnectorDomain(), allowedHosts: ALLOWED, httpClient: makeHttp() }))
      .not.toThrow();
  });
});

describe('ProxmoxRestConnector — Fehler ohne Secret-Leak', () => {
  test('5xx wird zu strukturiertem Fehler ohne Token im Text', async () => {
    const http = makeHttp(() => { const e = new Error('HTTP 500: boom'); e.status = 500; throw e; });
    const c = new ProxmoxRestConnector({ connector: makeConnectorDomain(), allowedHosts: ALLOWED, httpClient: http });
    let caught;
    try { await c.start(1234); } catch (e) { caught = e; }
    expect(caught).toBeTruthy();
    expect(String(caught.message)).not.toContain('11112222');   // Secret-Teil des Tokens
    expect(String(caught.message)).toMatch(/proxmox|500/i);
  });
});

describe('ProxmoxRestConnector — TLS-Verifikation', () => {
  test('rejectUnauthorized spiegelt connector.verifyTls', () => {
    const cOn  = new ProxmoxRestConnector({ connector: makeConnectorDomain({ verifyTls: true }),  allowedHosts: ALLOWED, httpClient: makeHttp() });
    const cOff = new ProxmoxRestConnector({ connector: makeConnectorDomain({ verifyTls: false }), allowedHosts: ALLOWED, httpClient: makeHttp() });
    expect(cOn.rejectUnauthorized).toBe(true);
    expect(cOff.rejectUnauthorized).toBe(false);
  });
});
