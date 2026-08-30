'use strict';

const { SystemControlService } = require('../../src/services/systemControlService');

function makeAudit() {
  const entries = [];
  return {
    entries,
    write: async (entry) => { entries.push(entry); },
  };
}

function makeConfig() {
  return {
    systemControl: {
      repoRoot: process.cwd(),
      restartEnabled: false,
      restartCommand: '',
      updateEnabled: false,
      updateCommand: '',
    },
  };
}

describe('SystemControlService', () => {
  test('liefert beide Aktionen fail-closed mit ehrlichem Disabled-Grund', () => {
    const svc = new SystemControlService({
      config: makeConfig(),
      authService: { verifyDeployReauth: async () => ({ ok: true }) },
      auditService: makeAudit(),
      runner: () => ({ pid: 10, once: () => {} }),
    });

    const actions = svc.listActions();
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.id)).toEqual(expect.arrayContaining(['app-restart', 'app-update']));
    expect(actions.every((a) => a.enabled === false)).toBe(true);
    expect(actions.every((a) => a.disabledReason === 'Serverseitig nicht freigeschaltet')).toBe(true);
  });

  test('gibt Aktion frei, wenn Flag, Kommando und Repo-Root gesetzt sind', () => {
    const config = makeConfig();
    config.systemControl.restartEnabled = true;
    config.systemControl.restartCommand = 'echo restart';

    const svc = new SystemControlService({
      config,
      authService: { verifyDeployReauth: async () => ({ ok: true }) },
      auditService: makeAudit(),
      runner: () => ({ pid: 10, once: () => {} }),
    });

    const restart = svc.listActions().find((a) => a.id === 'app-restart');
    expect(restart.enabled).toBe(true);
    expect(restart.disabledReason).toBeNull();
    expect(restart.executionMode).toBe('detached');
  });

  test('triggerAction verlangt frische deploy_reauth', async () => {
    const config = makeConfig();
    config.systemControl.restartEnabled = true;
    config.systemControl.restartCommand = 'echo restart';
    const svc = new SystemControlService({
      config,
      authService: { verifyDeployReauth: async () => ({ ok: false }) },
      auditService: makeAudit(),
      runner: () => ({ pid: 10, once: () => {} }),
    });

    await expect(svc.triggerAction('app-restart', {
      actor: { id: 'u1', label: 'admin@x' },
      reauthToken: 'bad',
    })).rejects.toMatchObject({ statusCode: 401 });
  });

  test('triggerAction startet Kommando detached und schreibt Audit', async () => {
    const config = makeConfig();
    config.systemControl.updateEnabled = true;
    config.systemControl.updateCommand = 'echo update';
    const audit = makeAudit();
    let seenCommand = null;
    let seenCwd = null;

    const svc = new SystemControlService({
      config,
      authService: { verifyDeployReauth: async () => ({ ok: true, sub: 'u1' }) },
      auditService: audit,
      runner: (command, { cwd }) => {
        seenCommand = command;
        seenCwd = cwd;
        return { pid: 4242, once: () => {} };
      },
      now: () => new Date('2026-07-06T10:00:00.000Z'),
    });

    const result = await svc.triggerAction('app-update', {
      actor: { id: 'u1', label: 'admin@x' },
      reauthToken: 'ok',
      ip: '127.0.0.1',
    });

    expect(result).toMatchObject({
      ok: true,
      accepted: true,
      actionId: 'app-update',
      executionMode: 'detached',
      pid: 4242,
    });
    expect(seenCommand).toBe('echo update');
    expect(seenCwd).toBe(process.cwd());
    expect(audit.entries.find((e) => e.action === 'SYSTEM_UPDATE_REQUESTED')).toBeDefined();
  });
});
