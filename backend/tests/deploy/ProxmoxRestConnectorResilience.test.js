'use strict';

// getCapacity muss robust gegen EINZELNE fehlschlagende Sub-Abfragen sein.
// Realer Vorfall: ein Connector zeigte auf storage=local-lvm, das auf den ZFS-Nodes
// gar nicht existiert → Proxmox 400 auf /storage/local-lvm/status. Weil getCapacity
// alle Calls per Promise.all bündelte, riss dieser EINE Fehler die KOMPLETTE Kapazität
// (Node/CPU/RAM/Gäste) auf 500 — die UI blieb leer. Node-Kapazität darf nicht an einem
// optionalen Storage-Detail hängen.

const { ProxmoxRestConnector } = require('../../src/deploy/connectors/ProxmoxRestConnector');
const { HypervisorConnector } = require('../../src/deploy/hypervisorConnectorDomain');

const RAW_TOKEN = 'root@pam!nexora=11112222-3333-4444-5555-666677778888';
const ALLOWED = ['10.0.99.100'];

function conn(over = {}) {
  return HypervisorConnector.create({
    type: 'proxmox', name: 'Lab', host: '10.0.99.100', apiToken: RAW_TOKEN,
    targetNode: 'pve1', storage: 'local-lvm', bridge: 'vmbr1', createdBy: 'admin', ...over,
  });
}
function http(handler) {
  const calls = [];
  return { calls, async request(url) { calls.push({ url }); return handler(url); } };
}

describe('ProxmoxRestConnector.getCapacity — Robustheit gegen einzelne Sub-Fehler', () => {
  test('nicht existenter Storage (HTTP 400) blankt NICHT die ganze Kapazität', async () => {
    const h = http((url) => {
      if (/\/storage\/local-lvm\/status$/.test(url)) { const e = new Error('Proxmox (HTTP 400)'); e.status = 400; throw e; }
      if (/\/status$/.test(url)) return { status: 200, data: { data: { status: 'online', cpu: 0.5, maxcpu: 8, mem: 8000, maxmem: 32000 } } };
      if (/\/nodes\/pve1\/storage$/.test(url)) return { status: 200, data: { data: [] } };
      if (/\/qemu$/.test(url)) return { status: 200, data: { data: [{ vmid: 101, template: 0 }] } };
      if (/\/lxc$/.test(url)) return { status: 200, data: { data: [] } };
      throw new Error(`unexpected ${url}`);
    });
    const c = new ProxmoxRestConnector({ connector: conn(), allowedHosts: ALLOWED, httpClient: h });

    const cap = await c.getCapacity(); // darf NICHT werfen
    expect(cap.node).toEqual(expect.objectContaining({ name: 'pve1', online: true, cpu: expect.objectContaining({ total: 8 }) }));
    expect(cap.guests.vms).toBe(1);
    expect(cap.storage.totalBytes).toBe(0);   // Storage degradiert, kein Absturz
    expect(cap.storage.available).toBe(false); // markiert als nicht abrufbar
  });

  test('Node-Kapazität aus dem echten /status-Detail-Endpoint (cpuinfo.cpus, memory.total, KEIN status-Feld)', async () => {
    // /nodes/{node}/status liefert ANDERE Felder als /nodes (Liste): kein `status`,
    // Cores in cpuinfo.cpus, RAM in memory.total/used. Vorher las der Code die
    // Listen-Felder → online=false, CPU/RAM=0 gegen echtes Proxmox.
    const h = http((url) => {
      if (/\/storage\/local-lvm\/status$/.test(url)) return { status: 200, data: { data: { used: 1, total: 2, avail: 1 } } };
      if (/\/nodes\/pve1\/status$/.test(url)) return { status: 200, data: { data: { cpu: 0.5, cpuinfo: { cpus: 8 }, memory: { total: 64e9, used: 32e9 }, uptime: 1000 } } };
      if (/\/nodes\/pve1\/storage$/.test(url)) return { status: 200, data: { data: [] } };
      if (/\/qemu$/.test(url)) return { status: 200, data: { data: [] } };
      if (/\/lxc$/.test(url)) return { status: 200, data: { data: [] } };
      throw new Error(`unexpected ${url}`);
    });
    const c = new ProxmoxRestConnector({ connector: conn(), allowedHosts: ALLOWED, httpClient: h });

    const cap = await c.getCapacity();
    expect(cap.node.online).toBe(true);            // erreichbar (Detail-Response da), trotz fehlendem status-Feld
    expect(cap.node.cpu.total).toBe(8);            // cpuinfo.cpus
    expect(cap.node.cpu.used).toBeCloseTo(4);      // 0.5 * 8 Cores
    expect(cap.node.memory.totalBytes).toBe(64e9); // memory.total
    expect(cap.node.memory.usedBytes).toBe(32e9);  // memory.used
  });

  test('Template-Storage, der vztmpl nicht listen kann, kippt die Kapazität nicht', async () => {
    const h = http((url) => {
      if (/\/storage\/local-lvm\/status$/.test(url)) return { status: 200, data: { data: { used: 1, total: 2, avail: 1 } } };
      if (/\/status$/.test(url)) return { status: 200, data: { data: { status: 'online', cpu: 0.1, maxcpu: 4, mem: 1, maxmem: 2 } } };
      if (/\/nodes\/pve1\/storage$/.test(url)) return { status: 200, data: { data: [{ storage: 'local', content: 'vztmpl' }] } };
      if (/\/qemu$/.test(url)) return { status: 200, data: { data: [] } };
      if (/\/lxc$/.test(url)) return { status: 200, data: { data: [] } };
      if (/\/storage\/local\/content/.test(url)) { const e = new Error('HTTP 500'); e.status = 500; throw e; }
      throw new Error(`unexpected ${url}`);
    });
    const c = new ProxmoxRestConnector({ connector: conn(), allowedHosts: ALLOWED, httpClient: h });

    const cap = await c.getCapacity();
    expect(cap.templates.lxc).toEqual([]);   // degradiert leer, kein Absturz
    expect(cap.storage.totalBytes).toBe(2);
    expect(cap.storage.available).toBe(true);
  });
});
