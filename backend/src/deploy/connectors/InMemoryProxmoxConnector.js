'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — InMemory-Proxmox-Connector (Fake für Tests/CI).
//
// Deterministisch, kein Netz. Erfüllt den Connector-Vertrag und erlaubt
// Fehler-Injektion je Schritt (failOn), damit die Rollback-/Safe-Stop-Pfade
// des Orchestrators (Phase 4) ohne echtes Proxmox voll testbar sind.
// ─────────────────────────────────────────────────────────────────────────

class InMemoryProxmoxConnector {
  constructor({ templates = [], bridges = [], usedVmids = [], nextVmid = 1000, failOn = {} } = {}) {
    this._templates = new Set(templates.map(String));
    this._bridges = new Set(bridges);
    this._usedVmids = new Set(usedVmids.map(Number));
    this._nextVmid = Number(nextVmid);
    this._failOn = { ...failOn };
    this._vms = new Map();
  }

  _maybeFail(step) {
    if (this._failOn[step]) throw new Error(`injizierter ${step}-Fehler (InMemory-Connector)`);
  }

  _must(vmid) {
    const vm = this._vms.get(Number(vmid));
    if (!vm) throw new Error(`VM ${vmid} existiert nicht`);
    return vm;
  }

  async checkPreconditions({ templateRef, bridge, vmid } = {}) {
    const templateExists = this._templates.has(String(templateRef));
    const bridgeExists = this._bridges.has(bridge);
    const vmidFree = vmid == null || !this._usedVmids.has(Number(vmid));
    const issues = [];
    if (!templateExists) issues.push(`Template '${templateRef}' nicht gefunden`);
    if (!bridgeExists) issues.push(`Bridge '${bridge}' nicht gefunden`);
    if (!vmidFree) issues.push(`VMID ${vmid} bereits belegt`);
    return { ok: issues.length === 0, templateExists, bridgeExists, vmidFree, issues };
  }

  async cloneFromTemplate(templateRef, spec = {}) {
    this._maybeFail('clone');
    if (!this._templates.has(String(templateRef))) throw new Error(`Template '${templateRef}' nicht gefunden (clone)`);
    const vmid = spec.vmid != null ? Number(spec.vmid) : this._nextVmid++;
    this._usedVmids.add(vmid);
    this._vms.set(vmid, { status: 'stopped', resources: null, net: null, name: spec.name || null, snapshots: [] });
    return { vmid };
  }

  async setResources(vmid, resources = {}) {
    this._maybeFail('setResources');
    this._must(vmid).resources = { ...resources };
  }

  async attachNetwork(vmid, net = {}) {
    this._maybeFail('attachNetwork');
    this._must(vmid).net = { ...net };
  }

  async start(vmid) {
    this._maybeFail('start');
    this._must(vmid).status = 'running';
  }

  async status(vmid) {
    const vm = this._vms.get(Number(vmid));
    const running = Boolean(vm && vm.status === 'running');
    return { running, agentReady: running };
  }

  async destroy(vmid) {
    this._maybeFail('destroy');
    this._vms.delete(Number(vmid));
    this._usedVmids.delete(Number(vmid));
  }

  async snapshot(vmid, name) {
    this._maybeFail('snapshot');
    this._must(vmid).snapshots.push(name);
  }

  async attachConfigMedia(vmid, media = {}) {
    this._maybeFail('attachConfigMedia');
    const vm = this._must(vmid);
    vm.configMedia = { ...media };
    return { mediaRef: `inmem:configmedia/${media.filename || `vm-${vmid}.xml`}` };
  }

  // ── Test-Introspektion (nicht Teil des Vertrags) ──
  getVm(vmid) { return this._vms.get(Number(vmid)); }
}

module.exports = { InMemoryProxmoxConnector };
