'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — DeployOrchestrator.
//
// Fährt den Deploy fail-closed über den Connector-Vertrag:
//   Gates → applying → checkPreconditions → cloning(clone·setResources·attachNetwork)
//         → starting(start) → configuring(configApplier) → verifying(status-Poll)
//         → deployed
//                ↘ Fehler ab clone → rolling_back → destroy → rolled_back
//                                                  ↘ destroy-Fehler → failed_safe_stop + globale Sperre
//
// KEIN Shell/SSH — nur der injizierte Connector. Jeder Schritt erzeugt append-only
// Audit/Step; Secrets landen NIE im Audit (Spec-Params sind bereits secret-frei).
// ─────────────────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');
const logger = require('../logger');
const { AppError } = require('../errors/AppError');
const { evaluateDeployGates } = require('./deployGates');

const DEPLOY_AUDIT = Object.freeze({
  DENIED: 'deploy.denied', STARTED: 'deploy.started', DEPLOYED: 'deploy.deployed',
  ROLLING_BACK: 'deploy.rolling_back', ROLLED_BACK: 'deploy.rolled_back', FAILED_SAFE_STOP: 'deploy.failed_safe_stop',
});

function appError(message, statusCode, code) { const e = new AppError(message, statusCode, code); e.status = statusCode; return e; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class DeployOrchestrator {
  constructor({ repo, statusPollAttempts = 30, statusPollDelayMs = 2000 } = {}) {
    if (!repo) throw new Error('DeployOrchestrator: repo erforderlich');
    this._repo = repo;
    this._pollAttempts = statusPollAttempts;
    this._pollDelayMs = statusPollDelayMs;
  }

  async _step(run, step, status, detail = null) {
    await this._repo.appendRunStep({ id: randomUUID(), runId: run.id, step, status, detail, at: new Date().toISOString() });
  }

  async _audit(type, { run, spec, actor, detail = null }) {
    await this._repo.appendDeployAudit({
      id: randomUUID(), type, actor: (actor && actor.label) || null,
      specId: spec ? spec.id : (run ? run.specId : null), runId: run ? run.id : null,
      connectorId: spec ? spec.connectorId : null, detail, at: new Date().toISOString(),
    });
  }

  /**
   * @param {object} p
   * @param {object} p.run      DeployRun (Status 'approved')
   * @param {object} p.spec     DeploySpec (secret-frei)
   * @param {object} p.connector Hypervisor-Connector (Vertrag)
   * @param {string|number} p.templateRef Golden-Template-Referenz
   * @param {function} [p.configApplier] (connector, vmid, params) → Promise
   * @param {object} p.gateContext  Kontext für evaluateDeployGates
   * @param {object} p.actor     { label }
   */
  async execute({ run, spec, connector, templateRef, configApplier, gateContext, actor, kind = 'vm-clone' } = {}) {
    if (!run || !spec || !connector) throw appError('Deploy: run/spec/connector fehlt', 400, 'BAD_REQUEST');

    // 1) Gates (fail-closed) — VOR jeder Wirkung.
    const gate = evaluateDeployGates(gateContext);
    if (!gate.allowed) {
      await this._audit(DEPLOY_AUDIT.DENIED, { run, spec, actor, detail: { code: gate.code, reason: gate.reason } });
      throw appError(gate.reason || 'Deploy abgelehnt', 403, gate.code || 'E_DEPLOY_DENIED');
    }

    // 2) applying.
    run.toApplying();
    await this._repo.updateRun(run.toJSON());
    await this._audit(DEPLOY_AUDIT.STARTED, { run, spec, actor });

    const p = spec.params || {};
    const isLxc = kind === 'lxc-create';
    try {
      // Vorbedingungen (Template/Bridge vorhanden).
      const pre = isLxc
        ? await connector.checkLxcPreconditions({ templateRef, bridge: spec.bridge, storage: spec.storage })
        : await connector.checkPreconditions({ templateRef, bridge: spec.bridge });
      if (!pre.ok) throw new Error(`Vorbedingungen nicht erfüllt: ${(pre.issues || []).join('; ')}`);

      // 3) cloning: clone → setResources → attachNetwork.
      run.toCloning();
      await this._repo.updateRun(run.toJSON());
      const { vmid } = isLxc
        ? await connector.createLxc(templateRef, { ...spec.resources, ...p, bridge: spec.bridge, storage: spec.storage })
        : await connector.cloneFromTemplate(templateRef, { name: p.hostname });
      run.setVmid(vmid);
      await this._repo.updateRun(run.toJSON());
      await this._step(run, 'clone', 'ok', { vmid });

      if (!isLxc) {
        await connector.setResources(vmid, spec.resources || {});
        await this._step(run, 'set_resources', 'ok');

        await connector.attachNetwork(vmid, { bridge: spec.bridge, vlanTag: p.vlanTag });
        await this._step(run, 'attach_network', 'ok');
      }

      // 4) starting.
      run.toStarting();
      await this._repo.updateRun(run.toJSON());
      if (isLxc) await connector.startLxc(vmid);
      else await connector.start(vmid);
      await this._step(run, 'start', 'ok');

      // 5) configuring (config.xml-Import).
      run.toConfiguring();
      await this._repo.updateRun(run.toJSON());
      if (typeof configApplier === 'function') await configApplier(connector, vmid, p);
      await this._step(run, 'config_import', 'ok');

      // 6) verifying (Status-Poll mit Backoff).
      run.toVerifying();
      await this._repo.updateRun(run.toJSON());
      const st = await this._pollStatus(connector, vmid, isLxc ? 'lxcStatus' : 'status');
      if (!st.running) throw new Error(`${isLxc ? 'Container' : 'VM'} nach Start nicht erreichbar (Status-Poll timeout)`);
      await this._step(run, 'verify', 'ok');

      // 7) deployed.
      run.toDeployed();
      await this._repo.updateRun(run.toJSON());
      await this._audit(DEPLOY_AUDIT.DEPLOYED, { run, spec, actor, detail: { vmid } });
      logger.info('deploy_deployed', { runId: run.id, specId: spec.id, vmid });
      return run.toJSON();
    } catch (err) {
      logger.warn('deploy_error_rollback', { runId: run.id, message: err.message });
      return this._rollback({ run, spec, connector, actor, reason: err.message, kind });
    }
  }

  /**
   * agent-install-Pfad (Brownfield): kein VM-Klon, sondern ein atomarer Remote-Install
   * über den Control-Adapter (z. B. Wazuh-Agent via ssh-systemd). Fail-closed über die
   * gleichen Gates; der Installer ist idempotent → „Rollback" = nichts zerstören (skip),
   * nur den Run sauber terminal (rolled_back) markieren.
   *
   * @param {object}   p
   * @param {object}   p.run            DeployRun (Status 'approved')
   * @param {object}   p.spec           DeploySpec (secret-frei; params = Ziel/Manager/…)
   * @param {function} p.buildInstaller () → (params) → Promise<{ ok, host?, agentName?, reason? }>
   *                   Wird ERST nach den Gates aufgerufen (baut den SSH-Runner aus dem Connector).
   * @param {object}   p.gateContext    Kontext für evaluateDeployGates
   * @param {object}   p.actor          { label }
   */
  async executeAgentInstall({ run, spec, buildInstaller, gateContext, actor } = {}) {
    if (!run || !spec || typeof buildInstaller !== 'function') {
      throw appError('Deploy(agent): run/spec/buildInstaller fehlt', 400, 'BAD_REQUEST');
    }

    // 1) Gates (fail-closed) — VOR jeder Wirkung, auch vor dem Bau des Runners.
    const gate = evaluateDeployGates(gateContext);
    if (!gate.allowed) {
      await this._audit(DEPLOY_AUDIT.DENIED, { run, spec, actor, detail: { code: gate.code, reason: gate.reason } });
      throw appError(gate.reason || 'Deploy abgelehnt', 403, gate.code || 'E_DEPLOY_DENIED');
    }

    // 2) applying.
    run.toApplying();
    await this._repo.updateRun(run.toJSON());
    await this._audit(DEPLOY_AUDIT.STARTED, { run, spec, actor });

    const p = spec.params || {};
    try {
      const installer = buildInstaller(); // baut Runner aus Connector — kann fail-closed werfen
      const res = await installer(p);
      if (!res || res.ok !== true) {
        throw new Error(`Agent-Install fehlgeschlagen (${(res && res.reason) || 'unbekannt'})`);
      }
      await this._step(run, 'agent_install', 'ok', { host: res.host, agentName: res.agentName });

      // 3) deployed (atomarer Pfad: applying → deployed).
      run.toDeployed();
      await this._repo.updateRun(run.toJSON());
      await this._audit(DEPLOY_AUDIT.DEPLOYED, { run, spec, actor, detail: { host: res.host, agentName: res.agentName } });
      logger.info('deploy_agent_deployed', { runId: run.id, specId: spec.id, host: res.host });
      return run.toJSON();
    } catch (err) {
      logger.warn('deploy_agent_error', { runId: run.id, message: err.message });
      return this._failAgentInstall({ run, spec, actor, reason: err.message });
    }
  }

  // Fehlschlag im agent-install-Pfad: kein destruktiver Rollback (Installer idempotent),
  // nur sauber terminal markieren + redigiert auditieren.
  async _failAgentInstall({ run, spec, actor, reason }) {
    const red = this._redact(reason);
    try { if (!run.isTerminal() && run.status !== 'rolling_back') run.toRollingBack(red); } catch { /* schon terminal */ }
    await this._repo.updateRun(run.toJSON());
    await this._audit(DEPLOY_AUDIT.ROLLING_BACK, { run, spec, actor, detail: { reason: red } });
    await this._step(run, 'agent_install', 'failed', { reason: red });
    try { run.toRolledBack(); } catch { /* falls schon terminal */ }
    await this._repo.updateRun(run.toJSON());
    await this._audit(DEPLOY_AUDIT.ROLLED_BACK, { run, spec, actor });
    logger.warn('deploy_agent_rolled_back', { runId: run.id, specId: spec.id });
    return run.toJSON();
  }

  async _pollStatus(connector, vmid, method = 'status') {
    let last = { running: false };
    for (let i = 0; i < this._pollAttempts; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await connector[method](vmid);
      if (last && last.running) return last;
      if (i < this._pollAttempts - 1) await sleep(this._pollDelayMs); // eslint-disable-line no-await-in-loop
    }
    return last || { running: false };
  }

  async _rollback({ run, spec, connector, actor, reason, kind = 'vm-clone' }) {
    try { if (!run.isTerminal() && run.status !== 'rolling_back') run.toRollingBack(this._redact(reason)); } catch { /* schon rolling_back/terminal */ }
    await this._repo.updateRun(run.toJSON());
    await this._audit(DEPLOY_AUDIT.ROLLING_BACK, { run, spec, actor, detail: { reason: this._redact(reason) } });
    await this._step(run, 'rollback_destroy', 'started');

    try {
      if (run.vmid != null) {
        if (kind === 'lxc-create') await connector.destroyLxc(run.vmid);
        else await connector.destroy(run.vmid);
      }
      run.toRolledBack();
      await this._repo.updateRun(run.toJSON());
      await this._step(run, 'rollback_destroy', 'ok');
      await this._audit(DEPLOY_AUDIT.ROLLED_BACK, { run, spec, actor });
      logger.warn('deploy_rolled_back', { runId: run.id, specId: spec.id });
      return run.toJSON();
    } catch (err) {
      return this._safeStop({ run, spec, actor, reason: `Rollback/destroy fehlgeschlagen: ${err.message}` });
    }
  }

  async _safeStop({ run, spec, actor, reason }) {
    try { run.toFailedSafeStop(this._redact(reason)); } catch { /* terminal */ }
    await this._repo.updateRun(run.toJSON());
    await this._repo.setSafetyLock(true, this._redact(reason)); // globale Deploy-Sperre bis manueller Review
    await this._step(run, 'rollback_destroy', 'failed');
    await this._audit(DEPLOY_AUDIT.FAILED_SAFE_STOP, { run, spec, actor, detail: { reason: this._redact(reason) } });
    logger.error('deploy_failed_safe_stop', { runId: run.id, specId: spec.id, reason: this._redact(reason) });
    return run.toJSON();
  }

  // Fehlertext redigieren, BEVOR er via run.failureReason/Audit an den Client geht:
  // Secret-Muster (Proxmox-Token, Auth-Header, key=value, URL-Credentials, lange
  // Hex/Base64) scrubben + auf 200 Zeichen kürzen. Der rohe Text bleibt nur im
  // internen Server-Log (deploy_error_rollback), das nicht an den Client geht.
  _redact(reason) {
    const t = String(reason || '')
      .replace(/PVEAPIToken\s*[=:]\s*[^\s"',;}]+/gi, 'PVEAPIToken=[redacted]')
      .replace(/\b(authorization|bearer)\b\s*[:=]?\s*[^\s"',;}]+/gi, '$1 [redacted]')
      .replace(/\b(password|passwd|secret|token|api[_-]?key|apikey|credential|passphrase)\b\s*["']?\s*[:=]\s*["']?[^\s"',;}]+/gi, '$1=[redacted]')
      // SSH-Key-Referenz/-Pfad (key=/root/.ssh/…) — im Deploy-Kontext sensibel, defensiv scrubben.
      .replace(/\bkey\s*[:=]\s*[^\s"',;}]+/gi, 'key=[redacted]')
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@"']+@/gi, '$1[redacted]@')
      .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[redacted]')
      .replace(/\s+/g, ' ')
      .trim();
    return t.length > 200 ? `${t.slice(0, 199)}…` : t;
  }
}

module.exports = { DeployOrchestrator, DEPLOY_AUDIT };
