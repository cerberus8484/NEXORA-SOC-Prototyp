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

  async cloneFromTemplate(templateRef, spec = {}) {
    const vmid = spec.vmid != null ? Number(spec.vmid) : await this._nextId();
    const body = { newid: vmid, full: 1 };
    if (spec.name) body.name = spec.name;
    if (this._storage) body.storage = this._storage;
    await this._req('POST', `/nodes/${this._node}/qemu/${templateRef}/clone`, body);
    return { vmid };
  }

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
