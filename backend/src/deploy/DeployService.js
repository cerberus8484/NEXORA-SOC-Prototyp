'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — DeployService.
//
// Verdrahtet Kataloge (Modul/Connector-Typ), Params-Validierung, Repository,
// Reauth (AuthService) und den Orchestrator. Öffentliche Views leaken NIE den
// Hypervisor-Token. Der eigentliche Infra-Write läuft ausschließlich über den
// gegateten Orchestrator (DEPLOY_ENABLED + 4-Augen + Reauth + Rollback).
// ─────────────────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');
const { AppError } = require('../errors/AppError');
const { getModule, listModules } = require('./deployModuleCatalog');
const { validateAgainstModule } = require('./deployParamValidation');
const { DeploySpec, DeployRun } = require('./deployDomain');
const { HypervisorConnector } = require('./hypervisorConnectorDomain');
const { SshDeployConnector } = require('./sshDeployConnectorDomain');
const { DeployOrchestrator } = require('./DeployOrchestrator');
const { installLinuxAgent } = require('./adapters/sshSystemdAdapter');
const { installWindowsAgent } = require('./adapters/sshPowershellAdapter');
const { installFirewallCollector, installSiemCollector } = require('./adapters/firewallCollectorAdapter');
const { installIdsSensor } = require('./adapters/idsSensorAdapter');
const { inspectProxmoxCertificate } = require('./connectors/proxmoxTlsCertificate');
const { parseAllowedHosts } = require('./connectors/proxmoxConnectorFactory');

// Control-Adapter-Registry (Code-Allowlist, wie der Modul-Katalog): controlAdapter-Key
// → Installer-Funktion (params, { runner }) → Promise<{ ok, host?, agentName?, reason? }>.
const DEFAULT_CONTROL_ADAPTERS = Object.freeze({
  'ssh-systemd':    (params, deps) => installLinuxAgent(params, deps),
  'ssh-powershell': (params, deps) => installWindowsAgent(params, deps),
  'ssh-firewall-collector': (params, deps) => installFirewallCollector(params, deps),
  'ssh-siem-collector':     (params, deps) => installSiemCollector(params, deps),
  'ssh-ids-sensor':         (params, deps) => installIdsSensor(params, deps),
});

// Ohne konfigurierten SSH-Connector bleibt der agent-install-Pfad fail-closed:
// kein Runner ⇒ kein Remote-Exec. Der echte, verschlüsselte SSH-Connector (privateKey +
// gepinnter Host-Key) wird als sshRunnerFactory injiziert (nächster Slice / DEPLOY_ENABLED).
function defaultSshRunnerFactory() {
  const e = new AppError('SSH-Connector nicht konfiguriert — Linux-Client-Deploy nicht scharfgeschaltet', 400, 'BAD_REQUEST');
  e.status = 400;
  throw e;
}

// Collector-Credential fuer die Data-Plane. Quelle ist das BEREITS existierende
// Dataplane-Secret (WEBHOOK_SECRET_DATAPLANE) — genau der Schluessel, den der Nexora-
// Intake prueft; ein zweiter Speicher waere Redundanz mit Divergenz-Risiko.
// Nicht gesetzt => undefined: der Collector wird installiert, sendet aber (noch)
// nicht authentifiziert. Bewusst kein harter Fehler, damit ein Deploy ohne
// konfigurierte Data-Plane nicht scheitert.
function defaultCollectorTokenResolver() {
  const t = process.env.WEBHOOK_SECRET_DATAPLANE;
  return t && String(t).trim() !== '' ? String(t).trim() : undefined;
}

function appError(message, statusCode, code) { const e = new AppError(message, statusCode, code); e.status = statusCode; return e; }
function notFound(message) { return appError(message, 404, 'NOT_FOUND'); }

class DeployService {
  /**
   * @param {object} deps
   * @param {object} deps.repo             Deploy-Repository (InMemory/Postgres)
   * @param {object} deps.authService      { verifyDeployReauth(token, sub) }
   * @param {function} deps.connectorFactory (connectorDomain, opts?) → Connector
   * @param {object} [deps.configAppliers] { [configApplierId]: (connector, vmid, params) → Promise }
   * @param {function} [deps.isDeployEnabled] () → boolean (DEPLOY_ENABLED-Kill-Switch)
   * @param {object} [deps.orchestrator]   Override (Test)
   */
  constructor({
    repo, authService, connectorFactory, configAppliers = {}, isDeployEnabled, orchestrator,
    controlAdapters = DEFAULT_CONTROL_ADAPTERS, sshRunnerFactory = defaultSshRunnerFactory,
    collectorTokenResolver = defaultCollectorTokenResolver,
    nodeRegistrar, hostKeyScanner,
  } = {}) {
    if (!repo) throw new Error('DeployService: repo erforderlich');
    if (!authService || typeof authService.verifyDeployReauth !== 'function') throw new Error('DeployService: authService (verifyDeployReauth) erforderlich');
    if (typeof connectorFactory !== 'function') throw new Error('DeployService: connectorFactory erforderlich');
    this._repo = repo;
    this._auth = authService;
    this._connectorFactory = connectorFactory;
    this._configAppliers = configAppliers || {};
    this._isDeployEnabled = typeof isDeployEnabled === 'function' ? isDeployEnabled : () => false;
    this._orchestrator = orchestrator || new DeployOrchestrator({ repo });
    this._controlAdapters = controlAdapters || {};
    this._sshRunnerFactory = typeof sshRunnerFactory === 'function' ? sshRunnerFactory : defaultSshRunnerFactory;
    // Löst das Collector-Credential zur Apply-Zeit auf (nie aus der Spec). Injizierbar für Tests.
    this._collectorTokenResolver = typeof collectorTokenResolver === 'function' ? collectorTokenResolver : defaultCollectorTokenResolver;
    // Optionaler Hook: registriert eine erfolgreich deployte Server-VM als persistenten
    // Managed-Node (Provisioning). Fehlt er (Unit-Tests ohne Provisioning) → übersprungen.
    this._nodeRegistrar = typeof nodeRegistrar === 'function' ? nodeRegistrar : null;
    // Optionaler Host-Key-Scanner (Slice 6c, Option 1): best-effort direkt nach dem Deploy
    // den Host-Key erfassen + pinnen. Fehlt er / scheitert (OpenSSH beim First-Boot noch
    // nicht oben) → vertagt auf Option 2 (Arm-Confirm). Nie deploy-kippend.
    this._hostKeyScanner = typeof hostKeyScanner === 'function' ? hostKeyScanner : null;
  }

  // Nach einem ERFOLGREICHEN vm-clone-Server-Deploy die VM als persistenten Managed-Node
  // registrieren („für immer da"). NUR bei terminalem 'deployed' + module.type==='server'
  // (Firewalls/Appliances → kein Node); ein Rollback registriert NICHTS. Best-effort: eine
  // fehlgeschlagene Registrierung kippt den erfolgreichen Deploy NICHT (die VM läuft) — sie
  // wird nur auditiert.
  async _maybeRegisterDeployedNode(module, specRow, result, actor) {
    if (!this._nodeRegistrar) return;
    if (!module || module.type !== 'server') return;
    if (!result || result.status !== 'deployed') return;
    const p = specRow.params || {};
    const os = String(module.id || '').includes('windows') ? 'windows' : 'linux';
    const ip = p.ipMode === 'static' ? p.staticIp : null; // DHCP: IP unbekannt → kein Auto-Scan
    try {
      await this._nodeRegistrar({ hostname: p.hostname, role: 'normal_agent', os, ip, capabilities: ['version_report', 'update_status'] });
      await this._audit('deploy.node.registered', { actor, specId: specRow.id, runId: result.id, detail: { hostname: p.hostname, os, role: 'normal_agent' } });
      // Option 1: best-effort Host-Key-Auto-Capture (kippt den Deploy nie).
      await this._maybeAutoCaptureHostKey({ hostname: p.hostname, os, ip, specId: specRow.id, actor });
    } catch (e) {
      // Kein Roh-Fehler ins Audit (Defense-in-Depth) — nur das Ereignis + der Host.
      await this._audit('deploy.node.register_failed', { actor, specId: specRow.id, runId: result.id, detail: { hostname: p.hostname } });
    }
  }

  // Option 1 (Auto-Capture): direkt nach dem Deploy den Host-Key der frisch erzeugten VM
  // scannen + pinnen — der vertrauenswürdigste Moment (die Box ist Sekunden alt, in unserem
  // Netz). Best-effort: scheitert der Scan (OpenSSH beim First-Boot noch nicht oben / DHCP
  // ohne bekannte IP), wird auf Option 2 (Admin-Arm-Confirm) vertagt — NIE deploy-kippend.
  async _maybeAutoCaptureHostKey({ hostname, os, ip, specId, actor }) {
    if (!this._hostKeyScanner || !ip) {
      if (this._hostKeyScanner) await this._audit('deploy.node.hostkey_deferred', { actor, specId, detail: { hostname, reason: 'no_ip' } });
      return;
    }
    let pin = null;
    try { pin = await this._hostKeyScanner({ host: ip }); } catch { pin = null; }
    if (!pin) {
      await this._audit('deploy.node.hostkey_deferred', { actor, specId, detail: { hostname, reason: 'scan_failed' } });
      return;
    }
    try {
      // Idempotenter Re-Upsert mit dem erfassten Pin (registrar setzt hostKeyPin).
      await this._nodeRegistrar({ hostname, role: 'normal_agent', os, ip, hostKeyPin: pin });
      await this._audit('deploy.node.hostkey_pinned', { actor, specId, detail: { hostname } });
    } catch {
      await this._audit('deploy.node.hostkey_deferred', { actor, specId, detail: { hostname, reason: 'pin_failed' } });
    }
  }

  // Baut den Installer für ein agent-install-Modul: Control-Adapter (Allowlist) +
  // SSH-Runner (aus dem verschlüsselten Connector). Wird erst NACH den Gates gerufen —
  // die transiente Key-Entschlüsselung (sshRunnerFactory) passiert also erst gegated.
  _buildAgentInstaller(module, connectorRow) {
    const adapter = this._controlAdapters[module.controlAdapter];
    if (typeof adapter !== 'function') {
      throw appError(`Control-Adapter '${module.controlAdapter}' nicht verfügbar`, 400, 'BAD_REQUEST');
    }
    // Defense-in-Depth: der ssh-systemd-Adapter braucht einen SSH-Connector. Explizit prüfen,
    // statt nur implizit auf die Runner-Factory zu vertrauen (entkoppelt für künftige Adapter).
    if (!connectorRow || connectorRow.type !== 'ssh') {
      throw appError(`agent-install '${module.id}' erfordert einen SSH-Connector (type=ssh)`, 400, 'BAD_REQUEST');
    }
    const runner = this._sshRunnerFactory(connectorRow); // kann fail-closed werfen (nicht konfiguriert/kein Key)
    // Collector-Credential erst HIER auflösen (nach den Gates, wie die Key-Entschlüsselung):
    // es darf nicht in der DeploySpec stehen (assertNoSecrets) und würde sonst in
    // Plan/Audit/Historie landen. Adapter, die es nicht brauchen, ignorieren es.
    const collectorToken = this._collectorTokenResolver();
    return (params) => adapter(params, { runner, collectorToken });
  }

  async _audit(type, { actor, specId = null, runId = null, connectorId = null, detail = null }) {
    await this._repo.appendDeployAudit({
      id: randomUUID(), type, actor: (actor && actor.label) || null,
      specId, runId, connectorId, detail, at: new Date().toISOString(),
    });
  }

  // ── Kataloge / read ──
  listModules() { return listModules().map((m) => m.toJSON()); }
  async listConnectors() { return (await this._repo.listConnectors()).map(publicConnectorView); }

  // Read-only: liefert die echten Ressourcen und Templates eines Proxmox-Ziels
  // für die Auswahl im Assistant. Keine Infra-Änderung und kein Umgehen des
  // Apply-Gates; unbekannte/andere Connector-Typen werden explizit abgewiesen.
  async getConnectorCapacity(connectorId) {
    const row = await this._repo.getConnector(connectorId);
    if (!row) throw notFound(`Connector '${connectorId}' nicht gefunden`);
    if (row.type !== 'proxmox') throw appError('Kapazitätsabfrage wird aktuell nur für Proxmox-Connectoren unterstützt', 400, 'BAD_REQUEST');
    const connector = this._connectorFactory(new HypervisorConnector(row), { readOnly: true });
    if (!connector || typeof connector.getCapacity !== 'function') {
      throw appError('Connector unterstützt keine Kapazitätsabfrage', 400, 'BAD_REQUEST');
    }
    return connector.getCapacity();
  }

  async inspectConnectorCertificate(connectorId) {
    const row = await this._repo.getConnector(connectorId);
    if (!row) throw notFound(`Connector '${connectorId}' nicht gefunden`);
    if (row.type !== 'proxmox') throw appError('Zertifikatspruefung nur fuer Proxmox-Connectoren', 400, 'BAD_REQUEST');
    const certificate = await inspectProxmoxCertificate({ host: row.host, allowedHosts: parseAllowedHosts() });
    return { fingerprint: certificate.fingerprint, validTo: certificate.validTo };
  }

  async trustConnectorCertificate(connectorId, fingerprint, actor, reauthToken) {
    const reauth = await this._auth.verifyDeployReauth(reauthToken, actor && actor.id);
    if (!reauth || !reauth.ok) throw appError('Frische Reauth erforderlich', 401, 'E_REAUTH');
    const row = await this._repo.getConnector(connectorId);
    if (!row) throw notFound(`Connector '${connectorId}' nicht gefunden`);
    const certificate = await inspectProxmoxCertificate({ host: row.host, allowedHosts: parseAllowedHosts() });
    if (certificate.fingerprint !== fingerprint) throw appError('PVE-Zertifikat hat sich seit der Pruefung geaendert', 409, 'CERTIFICATE_CHANGED');
    const updated = await this._repo.setConnectorCertificate(connectorId, certificate);
    await this._audit('deploy.connector.certificate_pinned', { actor, connectorId, detail: { fingerprint: certificate.fingerprint } });
    return publicConnectorView(updated);
  }

  // ── Connector anlegen (Secret verschlüsselt; frische Reauth wie bei Apply) ──
  async createConnector(input, actor, reauthToken) {
    // Step-up: einen Connector anzulegen speichert ein Geheimnis (SSH-Key/API-Token)
    // → wie Apply eine frische Passwort-Bestätigung verlangen (fail-closed). Bringt
    // Deploy-Connectoren in Linie mit den übrigen Verbindungs-Endpunkten (die längst
    // ein Passwort-Step-up erzwingen). Verweigerte Versuche werden auditiert.
    const reauthRes = await this._auth.verifyDeployReauth(reauthToken, actor && actor.id);
    if (!reauthRes || !reauthRes.ok) {
      await this._audit('deploy.connector.reauth_denied', { actor, detail: { type: input && input.type } });
      throw appError('Frische Reauth erforderlich (X-Reauth-Token) zum Anlegen eines Connectors', 401, 'E_REAUTH');
    }
    // SSH-Connector (agent-install): privateKey/passphrase verschlüsselt at-rest.
    if (input && input.type === 'ssh') {
      const domain = SshDeployConnector.create({ ...input, createdBy: actor && actor.label });
      await this._repo.createConnector(domain.toRow());
      await this._audit('deploy.connector.created', { actor, connectorId: domain.id, detail: { type: 'ssh', host: domain.host } });
      return publicConnectorView(domain.toRow());
    }
    // proxmox (Hypervisor): apiToken verschlüsselt at-rest.
    const domain = HypervisorConnector.create({ ...input, createdBy: actor && actor.label });
    const row = { ...domain.toJSON(), apiTokenEnc: domain.apiTokenEnc };
    await this._repo.createConnector(row);
    await this._audit('deploy.connector.created', { actor, connectorId: domain.id, detail: { type: domain.type, host: domain.host } });
    return publicConnectorView(row);
  }

  // ── Spec anlegen (validiert + idempotent) ──
  async createSpec(input, actor) {
    const module = getModule(input.moduleId); // wirft 404 bei unbekanntem Modul
    const connectorRow = await this._repo.getConnector(input.connectorId);
    if (!connectorRow) throw notFound(`Connector '${input.connectorId}' nicht gefunden`);

    const { value } = validateAgainstModule(module, input.params);
    // agent-install (Brownfield) kennt kein Proxmox-Placement (Node/Storage/Bridge).
    const requirePlacement = module.kind !== 'agent-install';
    const spec = DeploySpec.create({
      moduleId: input.moduleId, connectorId: input.connectorId, targetNode: input.targetNode,
      storage: input.storage, bridge: input.bridge, resources: input.resources, params: value,
      createdBy: actor && actor.label,
    }, { requirePlacement });

    const existing = await this._repo.findSpecByHash(spec.specHash);
    if (existing) return existing; // Idempotenz: gleiche Spec → gleiche Zeile

    await this._repo.createSpec(spec.toJSON());
    await this._audit('deploy.spec.created', { actor, specId: spec.id, connectorId: spec.connectorId, detail: { moduleId: spec.moduleId } });
    return spec.toJSON();
  }

  // ── Plan (Dry-Run, kein Infra-Write) ──
  async plan(specId, actor) {
    const specRow = await this._repo.getSpec(specId);
    if (!specRow) throw notFound(`Spec '${specId}' nicht gefunden`);
    const module = getModule(specRow.moduleId);

    // agent-install: reiner Dry-Run OHNE Ziel-Kontakt (kein SSH) — nur die geplante Aktion.
    if (module.kind === 'agent-install') {
      const p = specRow.params || {};
      const preconditions = {
        ok: true, kind: 'agent-install', controlAdapter: module.controlAdapter,
        targetHost: p.targetHost, wazuhManager: p.wazuhManager,
        agentName: p.agentName || p.targetHost, issues: [],
      };
      const run = DeployRun.plan({ specId, startedBy: actor && actor.label, startedById: actor && actor.id });
      await this._repo.createRun(run.toJSON());
      await this._audit('deploy.planned', { actor, specId, runId: run.id, detail: { preconditionsOk: true, kind: 'agent-install' } });
      return { run: run.toJSON(), preconditions };
    }

    const connector = await this._resolveConnector(specRow.connectorId);
    const templateRef = specRow.params ? specRow.params[module.templateRefField] : undefined;

    const preconditions = module.kind === 'lxc-create'
      ? await connector.checkLxcPreconditions({ templateRef, bridge: specRow.bridge, storage: specRow.storage })
      : await connector.checkPreconditions({ templateRef, bridge: specRow.bridge });
    const run = DeployRun.plan({ specId, startedBy: actor && actor.label, startedById: actor && actor.id });
    await this._repo.createRun(run.toJSON());
    await this._audit('deploy.planned', { actor, specId, runId: run.id, detail: { preconditionsOk: preconditions.ok } });
    return { run: run.toJSON(), preconditions };
  }

  // ── Approve (4-Augen) ──
  async approve(runId, actor, note = '') {
    const runRow = await this._repo.getRun(runId);
    if (!runRow) throw notFound(`Run '${runId}' nicht gefunden`);
    // Vier-Augen: stabile User-ID hat Vorrang, Label nur als Fallback.
    const sameActor = (actor && actor.id && runRow.startedById)
      ? actor.id === runRow.startedById
      : Boolean(actor && actor.label && actor.label === runRow.startedBy);
    if (sameActor) {
      throw appError('Vier-Augen verletzt: Ersteller darf nicht Genehmiger sein', 403, 'E_FOUR_EYES');
    }
    const run = new DeployRun(runRow);
    run.toApproved(actor && actor.label, actor && actor.id);
    await this._repo.updateRun(run.toJSON());
    await this._audit('deploy.approved', { actor, specId: run.specId, runId: run.id, detail: { note: String(note || '').slice(0, 200) } });
    return run.toJSON();
  }

  // ── Apply (Gates + Orchestrator + Reauth) ──
  async apply(runId, actor, reauthToken) {
    const runRow = await this._repo.getRun(runId);
    if (!runRow) throw notFound(`Run '${runId}' nicht gefunden`);
    const run = new DeployRun(runRow);
    const specRow = await this._repo.getSpec(run.specId);
    if (!specRow) throw notFound(`Spec '${run.specId}' nicht gefunden`);
    const module = getModule(specRow.moduleId);

    const reauthRes = await this._auth.verifyDeployReauth(reauthToken, actor && actor.id);
    const reauth = { ok: Boolean(reauthRes && reauthRes.ok), actor: reauthRes && reauthRes.ok ? (actor && actor.label) : null };

    const safety = await this._repo.getSafetyLock();
    const activeRun = await this._repo.findActiveRun();
    const deployedRun = await this._repo.findDeployedRunBySpec(specRow.id);

    const gateContext = {
      // Zwei-Schlüssel-Effektivzustand: der Provider kann sync (env-only, Tests) oder
      // async (env-Boden UND DB-Arm-Toggle, Produktion) sein. await ist für beides sicher.
      killSwitchEnabled: Boolean(await this._isDeployEnabled()),
      safetyLocked: Boolean(safety && safety.locked),
      run: { status: run.status },
      creatorLabel: run.startedBy,
      approverLabel: run.approvedBy,
      creatorId: run.startedById,
      approverId: run.approvedById,
      reauth,
      actor,
      activeRun: Boolean(activeRun),
      deployedRun: Boolean(deployedRun),
    };

    const specDomain = new DeploySpec(specRow);

    try {
      // agent-install (Brownfield): Remote-Install über Control-Adapter/SSH-Runner,
      // kein Proxmox-Connector, kein VM-Klon.
      if (module.kind === 'agent-install') {
        // Connector-Zeile (verschlüsselt) laden — reiner Read, kein Secret entschlüsselt;
        // die Entschlüsselung/den Runner-Bau macht buildInstaller erst NACH den Gates.
        const connectorRow = await this._repo.getConnector(specRow.connectorId);
        if (!connectorRow) throw notFound(`Connector '${specRow.connectorId}' nicht gefunden`);
        const buildInstaller = () => this._buildAgentInstaller(module, connectorRow);
        return await this._orchestrator.executeAgentInstall({ run, spec: specDomain, buildInstaller, gateContext, actor });
      }

      const connector = await this._resolveConnector(specRow.connectorId);
      const templateRef = specRow.params ? specRow.params[module.templateRefField] : undefined;
      const configApplier = this._configAppliers[module.configApplierId];
      const result = await this._orchestrator.execute({ run, spec: specDomain, connector, templateRef, configApplier, gateContext, actor, kind: module.kind });
      // Nur bei Erfolg + Server-Modul: persistenten Managed-Node registrieren (best-effort).
      await this._maybeRegisterDeployedNode(module, specRow, result, actor);
      return result;
    } catch (err) {
      // TOCTOU: verliert dieser Apply das Rennen um den Single-Flight-Slot, wirft der
      // Repo-Backstop (Partial-Unique-Index / InMemory-Single-Flight) ACTIVE_RUN_CONFLICT
      // bzw. DEPLOYED_CONFLICT als plain Error OHNE statusCode → der zentrale
      // errorHandler würde daraus 500 machen. Sauber als 409 mappen (der andere Run
      // läuft/deployte bereits), statt einen Serverfehler zu melden.
      if (err && (err.code === 'ACTIVE_RUN_CONFLICT' || err.code === 'DEPLOYED_CONFLICT')) {
        throw appError(err.message, 409, err.code);
      }
      throw err;
    }
  }

  async getRun(runId) {
    const runRow = await this._repo.getRun(runId);
    if (!runRow) throw notFound(`Run '${runId}' nicht gefunden`);
    return { run: runRow, steps: await this._repo.listRunSteps(runId) };
  }

  /** Jüngste Runs fürs Dashboard; begrenzt, damit die Übersicht keine Historien-API wird. */
  async listRuns(limit = 8) {
    return this._repo.listRuns(limit);
  }

  /** Append-only Deploy-Audit (redigiert). Optional gefiltert nach runId/specId. */
  async listAudit(filter = {}) {
    return this._repo.listDeployAudit(filter);
  }

  async _resolveConnector(connectorId) {
    const row = await this._repo.getConnector(connectorId);
    if (!row) throw notFound(`Connector '${connectorId}' nicht gefunden`);
    const domain = new HypervisorConnector(row);
    return this._connectorFactory(domain);
  }
}

// Öffentliche Sicht auf einen Connector — NIE Secret-Material (apiTokenEnc bzw.
// privateKeyEnc/passphraseEnc). hostKeyPin ist ein öffentlicher Fingerprint → bleibt.
function publicConnectorView(row) {
  if (!row) return null;
  // eslint-disable-next-line no-unused-vars
  const { apiTokenEnc, privateKeyEnc, passphraseEnc, tlsCertificatePem, ...rest } = row;
  return rest;
}

module.exports = { DeployService };
