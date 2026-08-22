'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { AppError, ConflictError, NotFoundError, UnauthorizedError } = require('../errors/AppError');
const { AUDIT_ACTIONS } = require('./AuditService');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..');

const ACTIONS = {
  'app-restart': {
    id: 'app-restart',
    name: 'System neu starten',
    description:
      'Stoesst den hinterlegten Host-Befehl fuer einen kontrollierten Neustart von Nexora an. '
      + 'Die Aktion wird nur angenommen; der eigentliche Neustart laeuft danach asynchron auf dem Host.',
    kind: 'restart',
    auditRequested: AUDIT_ACTIONS.SYSTEM_RESTART_REQUESTED,
    auditFailed: AUDIT_ACTIONS.SYSTEM_RESTART_FAILED,
  },
  'app-update': {
    id: 'app-update',
    name: 'System aktualisieren',
    description:
      'Stoesst den hinterlegten Host-Befehl fuer Git-Pull, Rebuild und kontrollierten Redeploy an. '
      + 'Die Aktion wird nur angenommen; die eigentliche Aktualisierung laeuft danach asynchron auf dem Host.',
    kind: 'update',
    auditRequested: AUDIT_ACTIONS.SYSTEM_UPDATE_REQUESTED,
    auditFailed: AUDIT_ACTIONS.SYSTEM_UPDATE_FAILED,
  },
};

function cfgFor(config, action) {
  return action.kind === 'restart'
    ? {
      enabled: config?.systemControl?.restartEnabled === true,
      command: String(config?.systemControl?.restartCommand || '').trim(),
      repoRoot: String(config?.systemControl?.repoRoot || '').trim(),
    }
    : {
      enabled: config?.systemControl?.updateEnabled === true,
      command: String(config?.systemControl?.updateCommand || '').trim(),
      repoRoot: String(config?.systemControl?.repoRoot || '').trim(),
    };
}

function fallbackRepoRoot(repoRoot) {
  return repoRoot || DEFAULT_REPO_ROOT;
}

function actionState({ action, config, active }) {
  const cfg = cfgFor(config, action);
  const repoRoot = fallbackRepoRoot(cfg.repoRoot);
  const isActive = Boolean(active && active.actionId === action.id);
  let enabled = true;
  let disabledReason = null;
  let errorCode = null;

  if (!cfg.enabled) {
    enabled = false;
    disabledReason = 'Serverseitig nicht freigeschaltet';
    errorCode = 'E_DISABLED';
  } else if (!cfg.command) {
    enabled = false;
    disabledReason = 'Kein Host-Kommando konfiguriert';
    errorCode = 'E_NO_COMMAND';
  } else if (!repoRoot) {
    enabled = false;
    disabledReason = 'Kein Host-Arbeitsverzeichnis konfiguriert';
    errorCode = 'E_NO_REPO_ROOT';
  } else if (!fs.existsSync(repoRoot)) {
    enabled = false;
    disabledReason = 'Host-Arbeitsverzeichnis nicht gefunden';
    errorCode = 'E_REPO_ROOT_MISSING';
  } else if (active && active.actionId !== action.id) {
    enabled = false;
    disabledReason = 'Andere System-Operation laeuft bereits';
    errorCode = 'E_BUSY';
  }

  return {
    id: action.id,
    name: action.name,
    description: action.description,
    kind: action.kind,
    requiresReauth: true,
    executionMode: 'detached',
    enabled,
    disabledReason,
    errorCode,
    running: isActive,
    repoRoot,
  };
}

function defaultRunner(command, { cwd }) {
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return child;
}

class SystemControlService {
  constructor({ config, authService, auditService, runner = defaultRunner, now = () => new Date() } = {}) {
    if (!config) throw new Error('SystemControlService: config erforderlich');
    if (!authService || typeof authService.verifyDeployReauth !== 'function') {
      throw new Error('SystemControlService: authService (verifyDeployReauth) erforderlich');
    }
    if (!auditService || typeof auditService.write !== 'function') {
      throw new Error('SystemControlService: auditService.write erforderlich');
    }
    this._config = config;
    this._auth = authService;
    this._audit = auditService;
    this._runner = runner;
    this._now = now;
    this._active = null;
    this._lastResult = null;
  }

  listActions() {
    return Object.values(ACTIONS).map((action) => ({
      ...actionState({ action, config: this._config, active: this._active }),
      lastResult: this._lastResult && this._lastResult.actionId === action.id ? this._lastResult : null,
    }));
  }

  async triggerAction(actionId, { actor, reauthToken, ip = '' } = {}) {
    const action = ACTIONS[actionId];
    if (!action) throw new NotFoundError('System action');

    const state = actionState({ action, config: this._config, active: this._active });
    if (this._active && this._active.actionId !== actionId) {
      throw new ConflictError('Andere System-Operation laeuft bereits');
    }
    if (!state.enabled) {
      const statusCode = state.errorCode === 'E_DISABLED' ? 403 : (state.errorCode === 'E_BUSY' ? 409 : 503);
      throw new AppError(state.disabledReason || 'System-Aktion nicht verfuegbar', statusCode, state.errorCode || 'E_UNAVAILABLE');
    }

    const reauth = await this._auth.verifyDeployReauth(reauthToken, actor && actor.id);
    if (!reauth || !reauth.ok) {
      throw new UnauthorizedError('Frische Reauth erforderlich (X-Reauth-Token).');
    }

    const startedAt = this._now().toISOString();
    let child;
    try {
      child = this._runner(cfgFor(this._config, action).command, { cwd: state.repoRoot, actionId });
    } catch (err) {
      await this._audit.write({
        actorUserId: actor?.id ?? null,
        actorLabel: actor?.label ?? 'unknown',
        action: action.auditFailed,
        targetType: 'system_control',
        targetId: action.id,
        metadata: { outcome: 'start_failed', message: err.message },
        ip,
      }).catch(() => {});
      throw new AppError('Host-Kommando konnte nicht gestartet werden', 502, 'E_START_FAILED');
    }

    const pid = Number(child && child.pid) > 0 ? Number(child.pid) : null;
    this._active = { actionId: action.id, pid, startedAt, actorLabel: actor?.label ?? 'unknown' };
    this._lastResult = {
      actionId: action.id,
      status: 'accepted',
      startedAt,
      finishedAt: null,
      pid,
    };

    if (child && typeof child.once === 'function') {
      child.once('exit', (code, signal) => {
        this._lastResult = {
          actionId: action.id,
          status: code === 0 ? 'finished' : 'failed',
          startedAt,
          finishedAt: this._now().toISOString(),
          pid,
          exitCode: typeof code === 'number' ? code : null,
          signal: signal || null,
        };
        this._active = null;
      });
      child.once('error', () => {
        this._lastResult = {
          actionId: action.id,
          status: 'failed',
          startedAt,
          finishedAt: this._now().toISOString(),
          pid,
          exitCode: null,
          signal: null,
        };
        this._active = null;
      });
    }

    await this._audit.write({
      actorUserId: actor?.id ?? null,
      actorLabel: actor?.label ?? 'unknown',
      action: action.auditRequested,
      targetType: 'system_control',
      targetId: action.id,
      metadata: { outcome: 'accepted', executionMode: 'detached', pid },
      ip,
    });

    return {
      ok: true,
      accepted: true,
      actionId: action.id,
      executionMode: 'detached',
      startedAt,
      pid,
      message: 'Aktion wurde an den Host uebergeben. Die API kann dabei kurz neu starten oder nicht erreichbar sein.',
    };
  }
}

module.exports = { SystemControlService, ACTIONS };
