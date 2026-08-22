'use strict';

const { HuntService }            = require('../../src/threatHunting/services/HuntService');
const { InMemoryHuntRepository } = require('../../src/threatHunting/repositories/InMemoryHuntRepository');
const { COMMAND_STATUS, COMMAND_TYPE } = require('../../src/threatHunting/domain/HuntCommand');
const { NotFoundError, ConflictError } = require('../../src/errors/AppError');

const SESSION_DTO = { analystId: 'analyst-1', targetHost: '10.0.0.5' };
const CMD_DTO     = { type: COMMAND_TYPE.OSQUERY, command: 'SELECT * FROM processes', description: 'Prozesse auflisten' };

function makeService() { return new HuntService(new InMemoryHuntRepository()); }

// ─── addCommand ───────────────────────────────────────────────────────────────

describe('HuntService — addCommand', () => {
  it('legt Command mit Status queued an', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const command = await svc.addCommand(session.id, { ...CMD_DTO, analystId: 'analyst-1' });

    expect(command.id).toBeTruthy();
    expect(command.sessionId).toBe(session.id);
    expect(command.status).toBe(COMMAND_STATUS.QUEUED);
    expect(command.type).toBe(COMMAND_TYPE.OSQUERY);
  });

  it('wirft NotFoundError für unbekannte Session', async () => {
    const svc = makeService();
    await expect(svc.addCommand('ghost', { ...CMD_DTO, analystId: 'a1' })).rejects.toThrow(NotFoundError);
  });

  it('schlägt fehl bei ungültigem Typ', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    await expect(svc.addCommand(session.id, { type: 'INVALID', command: 'x', analystId: 'a1' }))
      .rejects.toThrow(/Ungültiger Typ/);
  });
});

// ─── getCommand ───────────────────────────────────────────────────────────────

describe('HuntService — getCommand', () => {
  it('gibt Command zurück', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const created = await svc.addCommand(session.id, { ...CMD_DTO, analystId: 'a1' });
    const found   = await svc.getCommand(session.id, created.id);
    expect(found.id).toBe(created.id);
  });

  it('wirft NotFoundError für unbekannte commandId', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    await expect(svc.getCommand(session.id, 'ghost-cmd')).rejects.toThrow(NotFoundError);
  });

  it('wirft NotFoundError wenn commandId zu anderer Session gehört', async () => {
    const svc  = makeService();
    const s1   = await svc.createSession({ analystId: 'a1', targetHost: 'h1' });
    const s2   = await svc.createSession({ analystId: 'a1', targetHost: 'h2' });
    const cmd  = await svc.addCommand(s1.id, { ...CMD_DTO, analystId: 'a1' });
    await expect(svc.getCommand(s2.id, cmd.id)).rejects.toThrow(NotFoundError);
  });
});

// ─── getCommands ──────────────────────────────────────────────────────────────

describe('HuntService — getCommands', () => {
  it('gibt alle Commands einer Session zurück', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    await svc.addCommand(session.id, { type: COMMAND_TYPE.MANUAL, command: 'ls', analystId: 'a1' });
    await svc.addCommand(session.id, { type: COMMAND_TYPE.YARA,   command: 'rule test {}', analystId: 'a1' });
    const commands = await svc.getCommands(session.id);
    expect(commands.length).toBe(2);
  });
});

// ─── startCommand ─────────────────────────────────────────────────────────────

describe('HuntService — startCommand', () => {
  it('queued → running, executedAt wird gesetzt', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const cmd     = await svc.addCommand(session.id, { ...CMD_DTO, analystId: 'a1' });
    const updated = await svc.startCommand(session.id, cmd.id, 'analyst-1');
    expect(updated.status).toBe(COMMAND_STATUS.RUNNING);
    expect(updated.executedAt).toBeInstanceOf(Date);
  });

  it('doppeltes start → ConflictError', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const cmd     = await svc.addCommand(session.id, { ...CMD_DTO, analystId: 'a1' });
    await svc.startCommand(session.id, cmd.id, 'a1');
    await expect(svc.startCommand(session.id, cmd.id, 'a1')).rejects.toThrow(ConflictError);
  });
});

// ─── completeCommand ──────────────────────────────────────────────────────────

describe('HuntService — completeCommand', () => {
  it('running → completed mit stdout/exitCode', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const cmd     = await svc.addCommand(session.id, { ...CMD_DTO, analystId: 'a1' });
    await svc.startCommand(session.id, cmd.id, 'a1');
    const updated = await svc.completeCommand(session.id, cmd.id, 'a1', {
      stdout: 'PID 1234 gefunden', exitCode: 0,
    });
    expect(updated.status).toBe(COMMAND_STATUS.COMPLETED);
    expect(updated.stdout).toBe('PID 1234 gefunden');
    expect(updated.exitCode).toBe(0);
    expect(updated.completedAt).toBeInstanceOf(Date);
  });

  it('queued → complete → ConflictError (muss erst gestartet werden)', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const cmd     = await svc.addCommand(session.id, { ...CMD_DTO, analystId: 'a1' });
    await expect(svc.completeCommand(session.id, cmd.id, 'a1', {})).rejects.toThrow(ConflictError);
  });
});

// ─── failCommand ──────────────────────────────────────────────────────────────

describe('HuntService — failCommand', () => {
  it('running → failed mit reason + stderr', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const cmd     = await svc.addCommand(session.id, { ...CMD_DTO, analystId: 'a1' });
    await svc.startCommand(session.id, cmd.id, 'a1');
    const updated = await svc.failCommand(session.id, cmd.id, 'a1', {
      reason: 'Timeout', stderr: 'Connection refused', exitCode: 1,
    });
    expect(updated.status).toBe(COMMAND_STATUS.FAILED);
    expect(updated.result).toBe('Timeout');
    expect(updated.exitCode).toBe(1);
    expect(updated.completedAt).toBeInstanceOf(Date);
  });
});

// ─── blockCommand ─────────────────────────────────────────────────────────────

describe('HuntService — blockCommand', () => {
  it('queued → blocked mit Grund', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const cmd     = await svc.addCommand(session.id, { ...CMD_DTO, analystId: 'a1' });
    const updated = await svc.blockCommand(session.id, cmd.id, 'admin-1', 'Genehmigung ausstehend');
    expect(updated.status).toBe(COMMAND_STATUS.BLOCKED);
    expect(updated.blockedReason).toBe('Genehmigung ausstehend');
  });

  it('running → blocked → ConflictError', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const cmd     = await svc.addCommand(session.id, { ...CMD_DTO, analystId: 'a1' });
    await svc.startCommand(session.id, cmd.id, 'a1');
    await expect(svc.blockCommand(session.id, cmd.id, 'admin-1', 'blockiert')).rejects.toThrow(ConflictError);
  });
});

// ─── requeueCommand ───────────────────────────────────────────────────────────

describe('HuntService — requeueCommand', () => {
  it('blocked → queued, blockedReason wird geleert', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const cmd     = await svc.addCommand(session.id, { ...CMD_DTO, analystId: 'a1' });
    await svc.blockCommand(session.id, cmd.id, 'admin-1', 'Genehmigung ausstehend');
    const updated = await svc.requeueCommand(session.id, cmd.id, 'admin-1');
    expect(updated.status).toBe(COMMAND_STATUS.QUEUED);
    expect(updated.blockedReason).toBe('');
  });

  it('queued → requeue → ConflictError (muss erst geblockt sein)', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const cmd     = await svc.addCommand(session.id, { ...CMD_DTO, analystId: 'a1' });
    await expect(svc.requeueCommand(session.id, cmd.id, 'a1')).rejects.toThrow(ConflictError);
  });
});

// ─── Vollständiger Command Lifecycle ─────────────────────────────────────────

describe('HuntService — Vollständiger Command Lifecycle', () => {
  it('queued → running → completed → isTerminal()', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const cmd     = await svc.addCommand(session.id, { ...CMD_DTO, analystId: 'a1' });

    expect(cmd.status).toBe(COMMAND_STATUS.QUEUED);
    expect(cmd.isTerminal()).toBe(false);

    const running   = await svc.startCommand(session.id, cmd.id, 'a1');
    expect(running.status).toBe(COMMAND_STATUS.RUNNING);

    const completed = await svc.completeCommand(session.id, cmd.id, 'a1', { stdout: 'OK', exitCode: 0 });
    expect(completed.status).toBe(COMMAND_STATUS.COMPLETED);
    expect(completed.isTerminal()).toBe(true);
  });

  it('queued → blocked → queued → running → failed', async () => {
    const svc     = makeService();
    const session = await svc.createSession(SESSION_DTO);
    const cmd     = await svc.addCommand(session.id, { type: COMMAND_TYPE.POWERSHELL, command: 'Get-Process', analystId: 'a1' });

    await svc.blockCommand(session.id, cmd.id, 'admin', 'Warte auf Approval');
    await svc.requeueCommand(session.id, cmd.id, 'admin');
    await svc.startCommand(session.id, cmd.id, 'a1');
    const failed = await svc.failCommand(session.id, cmd.id, 'a1', { reason: 'Host nicht erreichbar', exitCode: -1 });

    expect(failed.status).toBe(COMMAND_STATUS.FAILED);
    expect(failed.exitCode).toBe(-1);
    expect(failed.isTerminal()).toBe(true);
  });
});
