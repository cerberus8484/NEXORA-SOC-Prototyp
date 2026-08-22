'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — echter Proxmox-REST-Connector.
//
// Spricht die Proxmox VE REST-API (kein Shell/SSH). Der API-Token wird nur
// transient aus dem verschlüsselten Connector geholt (getApiToken) und steckt
// ausschließlich im Authorization-Header — nie im Log/Fehlertext/Return.
//
// SSRF-Härtung (OWASP A10): der Ziel-Host muss in der Deploy-Allowlist stehen;
// Link-local/Metadata (169.254.x) wird immer abgelehnt; ohne Allowlist werden
// öffentliche IPs abgelehnt. 3xx wird vom HttpClient nicht gefolgt (redirect:error).
// ─────────────────────────────────────────────────────────────────────────

const { isPublicIp } = require('../../integrations/threatIntel/ipClass');

const PVE_PORT = 8006;

// Cloud-Metadata- + Link-local-Adressen immer verweigern (auch wenn allowlisted).
// 169.254.0.0/16 (inkl. AWS/Azure/GCP IMDS 169.254.169.254) + Alibaba 100.100.100.200.
const METADATA_HOSTS = new Set(['100.100.100.200']);
function isBlockedHost(host) { return /^169\.254\./.test(String(host)) || METADATA_HOSTS.has(String(host)); }

class ProxmoxRestConnector {
  constructor({ connector, httpClient, allowedHosts = [], apiPort = PVE_PORT } = {}) {
    if (!connector || !connector.host) throw new Error('ProxmoxRestConnector: connector (mit host) fehlt');
    if (!httpClient || typeof httpClient.request !== 'function') throw new Error('ProxmoxRestConnector: httpClient fehlt');
    this._connector = connector;
    this._http = httpClient;
    this._allowed = (allowedHosts || []).map(String);
    this._host = String(connector.host);
    this._node = connector.targetNode;
    this._storage = connector.storage || null;
    this._port = apiPort;
    // Informativ + für den Factory-Pfad: TLS-Verifikation folgt connector.verifyTls.
    this.rejectUnauthorized = connector.verifyTls !== false;
    this._assertHostAllowed();
  }

  _assertHostAllowed() {
    const host = this._host;
    if (isBlockedHost(host)) throw new Error(`SSRF-Schutz: Link-local/Metadata-Host nicht erlaubt: ${host}`);
    if (this._allowed.length > 0) {
      if (!this._allowed.includes(host)) throw new Error(`SSRF-Schutz: Host '${host}' nicht in der Deploy-Allowlist`);
    } else if (isPublicIp(host)) {
      throw new Error(`SSRF-Schutz: öffentlicher Host '${host}' ohne Allowlist nicht erlaubt`);
    }
  }

  _base() { return `https://${this._host}:${this._port}/api2/json`; }
  _authHeader() { return { Authorization: `PVEAPIToken=${this._connector.getApiToken()}` }; }

  async _req(method, path, body = null) {
    const url = `${this._base()}${path}`;
    try {
      const res = await this._http.request(url, { method, headers: { ...this._authHeader() }, body });
      return res && res.data !== undefined ? res.data : res;
    } catch (e) {
      // Redigiert: der Token steckt nur im Request-Header, NICHT im Fehlertext.
      const status = e && e.status ? e.status : '?';
      const err = new Error(`Proxmox ${method} ${path} fehlgeschlagen (HTTP ${status})`);
      err.status = e && e.status;
      throw err;
    }
  }

  async _nextId() {
    const data = await this._req('GET', '/cluster/nextid');
    const raw = data && data.data !== undefined ? data.data : data;
    return Number(raw);
  }

  // Read-only Inventar für die Connector-Auswahl. Dieser Pfad schreibt nie in
  // Proxmox und darf deshalb auch bei deaktiviertem Deploy-Gate verwendet werden:
  // Das Gate schützt die Ausführung, nicht die transparente Kapazitätsanzeige.
  async getCapacity() {
    const unwrap = (value) => (value && value.data !== undefined ? value.data : value);
    const storage = this._storage;
    // Der Storage-STATUS ist ein optionales Detail: ist der konfigurierte Storage auf dem
    // Node nicht (mehr) vorhanden (z.B. `local-lvm` auf einem ZFS-Node → HTTP 400), darf
    // das NICHT die gesamte Kapazität (Node/CPU/RAM/Gäste) auf Fehler ziehen. Deshalb
    // fail-soft: der eine Call wird abgefangen, `available` markiert die Abrufbarkeit.
    const [nodeRaw, storageRaw, qemuRaw, lxcRaw, storagesRaw] = await Promise.all([
      this._req('GET', `/nodes/${this._node}/status`),
      storage ? this._req('GET', `/nodes/${this._node}/storage/${storage}/status`).catch(() => null) : Promise.resolve(null),
      this._req('GET', `/nodes/${this._node}/qemu`),
      this._req('GET', `/nodes/${this._node}/lxc`),
      this._req('GET', `/nodes/${this._node}/storage`),
    ]);
    const node = unwrap(nodeRaw) || {};
    // available=false → Storage konfiguriert, aber nicht abrufbar (Karte kann das anzeigen,
    // statt fälschlich „0 Bytes"). Ohne konfigurierten Storage bleibt es schlicht null.
    const storageAvailable = storage ? storageRaw != null : true;
    const storageStatus = unwrap(storageRaw) || {};
    const qemu = Array.isArray(unwrap(qemuRaw)) ? unwrap(qemuRaw) : [];
    const lxcGuests = Array.isArray(unwrap(lxcRaw)) ? unwrap(lxcRaw) : [];
    const storages = Array.isArray(unwrap(storagesRaw)) ? unwrap(storagesRaw) : [];
    const templateStorages = storages.filter((entry) => entry && String(entry.content || '').split(',').includes('vztmpl'));
    const templateLists = await Promise.all(templateStorages.map(async (entry) => {
      // Auch hier fail-soft: ein Storage, der vztmpl nicht listen kann, liefert eine leere
      // Liste statt die gesamte Kapazität zu kippen.
      const content = await this._req('GET', `/nodes/${this._node}/storage/${encodeURIComponent(entry.storage)}/content?content=vztmpl`).catch(() => null);
      return Array.isArray(unwrap(content)) ? unwrap(content) : [];
    }));
    const lxc = templateLists.flat();

    return {
      kind: 'proxmox',
      updatedAt: new Date().toISOString(),
      node: (() => {
        // ACHTUNG: /nodes/{node}/status (Detail) hat ANDERE Felder als /nodes (Liste).
        // Detail: kein `status`-Feld, Cores in cpuinfo.cpus, RAM in memory.total/used.
        // Liste:  status/maxcpu/mem/maxmem. Wir lesen primär die Detail-Felder und fallen
        // auf die Listen-Felder zurück (hält Fake/Tests gültig). cpu ist der Auslastungs-
        // Anteil (0..1), nicht die Core-Zahl.
        const cores = Number(node.cpuinfo && node.cpuinfo.cpus) || Number(node.maxcpu) || 0;
        const cpuFraction = Number(node.cpu) || 0;
        const memTotal = Number(node.memory && node.memory.total) || Number(node.maxmem) || 0;
        const memUsed = Number(node.memory && node.memory.used) || Number(node.mem) || 0;
        // Kein `status`-Feld im Detail-Endpoint → erreichbar = wir haben eine valide
        // Status-Antwort bekommen (uptime/cpuinfo/memory), sonst der Listen-Wert 'online'.
        const online = node.status === 'online' || node.uptime != null || Boolean(node.cpuinfo) || Boolean(node.memory);
        return {
          name: this._node,
          online,
          cpu: { used: cpuFraction * cores, total: cores },
          memory: { usedBytes: memUsed, totalBytes: memTotal },
        };
      })(),
      storage: {
        name: storage,
        available: storageAvailable,
        usedBytes: Number(storageStatus.used) || 0,
        totalBytes: Number(storageStatus.total) || 0,
        freeBytes: Number(storageStatus.avail) || 0,
      },
      guests: {
        vms: qemu.filter((entry) => Number(entry && entry.template) !== 1).length,
        containers: lxcGuests.filter((entry) => Number(entry && entry.template) !== 1).length,
      },
      templates: {
        vm: qemu.filter((entry) => Number(entry && entry.template) === 1)
          .map((entry) => ({ vmid: Number(entry.vmid), name: String(entry.name || `VM ${entry.vmid}`) })),
        lxc: lxc.filter((entry) => entry && entry.content === 'vztmpl' && typeof entry.volid === 'string')
          .map((entry) => ({ volid: entry.volid, name: entry.volid.split('/').pop() })),
      },
    };
  }

  async checkPreconditions({ templateRef, bridge, vmid } = {}) {
    const issues = [];
    let templateExists = false; let bridgeExists = false; let vmidFree = true;
    try { const d = await this._req('GET', `/nodes/${this._node}/qemu/${templateRef}/config`); templateExists = Boolean(d); }
    catch { issues.push(`Template '${templateRef}' nicht gefunden`); }
    try { const d = await this._req('GET', `/nodes/${this._node}/network/${bridge}`); bridgeExists = Boolean(d); }
    catch { issues.push(`Bridge '${bridge}' nicht gefunden`); }
    if (vmid != null) {
      try { await this._req('GET', `/nodes/${this._node}/qemu/${vmid}/config`); vmidFree = false; issues.push(`VMID ${vmid} bereits belegt`); }
      catch { vmidFree = true; }
    }
    return { ok: issues.length === 0, templateExists, bridgeExists, vmidFree, issues };
  }

  async checkLxcPreconditions({ templateRef, bridge, storage, vmid } = {}) {
    const issues = [];
    let templateExists = false; let bridgeExists = false; let vmidFree = true;
    try {
      const storageName = String(templateRef || '').split(':', 1)[0];
      if (!/^[A-Za-z0-9_.-]{1,200}$/.test(storageName)) throw new Error('ungültiger Storage');
      const d = await this._req('GET', `/nodes/${this._node}/storage/${encodeURIComponent(storageName)}/content?content=vztmpl`);
      const templates = d && d.data ? d.data : d;
      templateExists = Array.isArray(templates) && templates.some((entry) => entry && entry.volid === templateRef);
      if (!templateExists) issues.push(`LXC-Template '${templateRef}' nicht gefunden`);
    } catch { issues.push(`LXC-Template '${templateRef}' nicht prüfbar`); }
    try {
      const d = await this._req('GET', `/nodes/${this._node}/storage`);
      const storages = d && d.data ? d.data : d;
      const entry = Array.isArray(storages) && storages.find((item) => item && item.storage === storage);
      if (!entry || !String(entry.content || '').split(',').includes('rootdir')) issues.push(`Storage '${storage}' unterstützt keine Container`);
    } catch { issues.push(`Storage '${storage}' nicht prüfbar`); }
    try { const d = await this._req('GET', `/nodes/${this._node}/network/${bridge}`); bridgeExists = Boolean(d); }
    catch { issues.push(`Bridge '${bridge}' nicht gefunden`); }
    if (vmid != null) {
      try { await this._req('GET', `/nodes/${this._node}/lxc/${vmid}/config`); vmidFree = false; issues.push(`CTID ${vmid} bereits belegt`); }
      catch { vmidFree = true; }
    }
    return { ok: issues.length === 0, templateExists, bridgeExists, vmidFree, issues };
  }

  async cloneFromTemplate(templateRef, spec = {}) {
    const vmid = spec.vmid != null ? Number(spec.vmid) : await this._nextId();
    const body = { newid: vmid, full: 1 };
    if (spec.name) body.name = spec.name;
    if (this._storage) body.storage = this._storage;
    await this._req('POST', `/nodes/${this._node}/qemu/${templateRef}/clone`, body);
    return { vmid };
  }

  // LXC wird von Proxmox direkt aus einem Distribution-Template erzeugt (kein
  // VM-Klon). Das Template kommt ausschließlich aus dem zuvor gelesenen
  // Connector-Inventar; Ressourcen und Netz werden in einem atomaren Create
  // übergeben, damit kein halb konfigurierter Container entsteht.
  async createLxc(templateRef, spec = {}) {
    const vmid = spec.vmid != null ? Number(spec.vmid) : await this._nextId();
    const net = [`name=eth0`, `bridge=${spec.bridge}`];
    if (spec.vlanTag != null) net.push(`tag=${Number(spec.vlanTag)}`);
    if (spec.ipMode === 'dhcp') net.push('ip=dhcp');
    else {
      net.push(`ip=${spec.staticIp}/${Number(spec.cidr)}`);
      if (spec.gateway) net.push(`gw=${spec.gateway}`);
    }
    const body = {
      vmid,
      ostemplate: String(templateRef),
      hostname: String(spec.hostname),
      cores: Number(spec.cpu),
      memory: Number(spec.ramMB),
      rootfs: `${String(spec.storage)}:${Number(spec.diskGB)}`,
      net0: net.join(','),
      unprivileged: 1,
      start: 0,
    };
    if (Array.isArray(spec.dns) && spec.dns.length > 0) body.nameserver = spec.dns.join(',');
    await this._req('POST', `/nodes/${this._node}/lxc`, body);
    return { vmid };
  }

  async startLxc(vmid) { await this._req('POST', `/nodes/${this._node}/lxc/${vmid}/status/start`); }

  async lxcStatus(vmid) {
    const d = await this._req('GET', `/nodes/${this._node}/lxc/${vmid}/status/current`);
    const st = d && d.data ? d.data : d;
    return { running: Boolean(st && st.status === 'running') };
  }

  async destroyLxc(vmid) { await this._req('DELETE', `/nodes/${this._node}/lxc/${vmid}`); }

  async setResources(vmid, { cpu, ramMB } = {}) {
    const body = {};
    if (cpu != null) body.cores = cpu;
    if (ramMB != null) body.memory = ramMB;
    await this._req('POST', `/nodes/${this._node}/qemu/${vmid}/config`, body);
    // diskGB-Resize ist ein separater Endpoint — im Schnitt #1 bewusst weggelassen (YAGNI).
  }

  async attachNetwork(vmid, { bridge, vlanTag } = {}) {
    let net0 = `virtio,bridge=${bridge}`;
    if (vlanTag != null) net0 += `,tag=${vlanTag}`;
    await this._req('POST', `/nodes/${this._node}/qemu/${vmid}/config`, { net0 });
  }

  async start(vmid) { await this._req('POST', `/nodes/${this._node}/qemu/${vmid}/status/start`); }

  async status(vmid) {
    const d = await this._req('GET', `/nodes/${this._node}/qemu/${vmid}/status/current`);
    const st = d && d.data ? d.data : d;
    const running = Boolean(st && st.status === 'running');
    return { running, agentReady: running };
  }

  async destroy(vmid) { await this._req('DELETE', `/nodes/${this._node}/qemu/${vmid}`); }

  async snapshot(vmid, name) { await this._req('POST', `/nodes/${this._node}/qemu/${vmid}/snapshot`, { snapname: name }); }

  // First-Boot-Drive: den gerenderten config.xml-Inhalt in den Storage schreiben
  // und als CD-ROM (ide2) an die VM hängen. Der Golden-Template-First-Boot-Importer
  // zieht /conf/config.xml beim (Re)Boot. Kein Shell/SSH — nur die REST-API.
  // Hinweis: die genaue Storage-Materialisierung (upload → bootbares Volume) ist
  // umgebungsspezifisch und wird beim Live-Smoke gegen echtes Proxmox verifiziert.
  async attachConfigMedia(vmid, { filename, content } = {}) {
    if (!filename || content == null) throw new Error('attachConfigMedia: filename/content erforderlich');
    if (!this._storage) throw new Error('attachConfigMedia: kein Storage am Connector konfiguriert');
    // 1) Config-Inhalt in den Storage laden (Content-Typ snippets).
    await this._req('POST', `/nodes/${this._node}/storage/${this._storage}/upload`, {
      content: 'snippets', filename, data: content,
    });
    const volid = `${this._storage}:snippets/${filename}`;
    // 2) Als CD-ROM (media=cdrom) anhängen, damit OPNsense sie beim Boot importiert.
    await this._req('POST', `/nodes/${this._node}/qemu/${vmid}/config`, { ide2: `${volid},media=cdrom` });
    return { mediaRef: volid };
  }
}

module.exports = { ProxmoxRestConnector };
