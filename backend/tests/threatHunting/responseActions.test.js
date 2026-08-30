'use strict';

const { ResponseAction } = require('../../src/threatHunting/domain/ResponseAction');
const { HuntService } = require('../../src/threatHunting/services/HuntService');
const { InMemoryHuntRepository } = require('../../src/threatHunting/repositories/InMemoryHuntRepository');

async function setup() {
  const s = new HuntService(new InMemoryHuntRepository());
  const session = await s.createSession({ analystId: 'analyst-1', targetHost: 'Windows-01' });
  return { s, sessionId: session.id };
}

afterEach(() => {
  delete process.env.HUNT_RESPONSE_AUTO_EXECUTE_MOCK;
});

// ── Real-Exec (Stufe 3, ADR-042) — HuntService mit injizierten Gates/Runner ──
function makeExecService({ enabled = true, reauthOk = true, runner, runnerFactory, omitFactory = false } = {}) {
  const audits = [];
  const fakeAudit = { write: async (e) => { audits.push(e); } };
  const auth = { verifyDeployReauth: async () => ({ ok: reauthOk }) };
  const defaultRunner = async () => ({ code: 0 });
  const opts = { auditService: fakeAudit, authService: auth, isRealExecEnabled: () => enabled };
  if (!omitFactory) opts.responseRunnerFactory = runnerFactory !== undefined ? runnerFactory : (() => runner || defaultRunner);
  const s = new HuntService(new InMemoryHuntRepository(), opts);
  return { s, audits };
}

async function approvedAction(s, { kind = 'isolate_host', requestedBy = 'analyst-1', approvedBy = 'admin-9' } = {}) {
  const session = await s.createSession({ analystId: requestedBy, targetHost: 'Windows-01' });
  const a = await s.requestResponseAction(session.id, { kind, command: kind === 'privileged_command' ? 'Stop-Service x' : '' }, requestedBy);
  await s.approveResponseAction(session.id, a.id, approvedBy, 'Betriebsrat BR-2026-04');
  return { sessionId: session.id, actionId: a.id };
}

const EXEC = { actor: { id: 'exec-admin' }, reauthToken: 'good' };

describe('ResponseAction domain', () => {
  it('isolate_host -> riskTier containment, status requested', () => {
    const a = ResponseAction.create({ huntSessionId: 'x', kind: 'isolate_host', requestedBy: 'u1' });
    expect(a.riskTier).toBe('containment');
    expect(a.status).toBe('requested');
  });

  it('privileged_command ohne command -> 400', () => {
    expect(() => ResponseAction.create({ huntSessionId: 'x', kind: 'privileged_command', requestedBy: 'u1' }))
      .toThrow();
  });

  it('approve durch Anforderer -> 403 (Vier-Augen)', () => {
    const a = ResponseAction.create({ huntSessionId: 'x', kind: 'isolate_host', requestedBy: 'u1' });
    expect(() => a.approve('u1', 'Betriebsrat BR-1')).toThrow(/Vier-Augen/);
  });

  it('approve OHNE Rechtsgrundlage -> 400 (Betriebsrat/Notfall Pflicht), bleibt requested', () => {
    const a = ResponseAction.create({ huntSessionId: 'x', kind: 'isolate_host', requestedBy: 'u1' });
    expect(() => a.approve('admin-9')).toThrow(/Grundlage|Betriebsrat/i);
    expect(() => a.approve('admin-9', '   ')).toThrow(/Grundlage|Betriebsrat/i);
    expect(a.status).toBe('requested');
  });

  it('approve MIT Grundlage -> approved, Grundlage gespeichert + in toJSON', () => {
    const a = ResponseAction.create({ huntSessionId: 'x', kind: 'isolate_host', requestedBy: 'u1' });
    a.approve('admin-9', '  Betriebsrat-Zustimmung BR-2026-04  ');
    expect(a.status).toBe('approved');
    expect(a.authorizationBasis).toBe('Betriebsrat-Zustimmung BR-2026-04');
    expect(a.toJSON().authorizationBasis).toBe('Betriebsrat-Zustimmung BR-2026-04');
  });

  it('executedBy: default null, in toJSON (ADR-042 Drei-Parteien-Audit)', () => {
    const a = ResponseAction.create({ huntSessionId: 'x', kind: 'isolate_host', requestedBy: 'u1' });
    expect(a.executedBy).toBeNull();
    expect(a.toJSON()).toHaveProperty('executedBy', null);
  });
});

describe('HuntService - Response Actions', () => {
  it('Anfrage erzeugt requested-Aktion + Console-Log', async () => {
    const { s, sessionId } = await setup();
    const a = await s.requestResponseAction(sessionId, { kind: 'isolate_host', reason: 'C2 vermutet' }, 'analyst-1');
    expect(a.status).toBe('requested');
    expect(a.kind).toBe('isolate_host');
    const logs = await s.getLogs(sessionId);
    expect(logs.some((l) => /Response action requested/i.test(l.message))).toBe(true);
  });

  it('privileged_command ohne command -> 400', async () => {
    const { s, sessionId } = await setup();
    await expect(s.requestResponseAction(sessionId, { kind: 'privileged_command' }, 'analyst-1'))
      .rejects.toMatchObject({ status: 400 });
  });

  it('Genehmigung durch zweite Person MIT Grundlage -> approved (pending agent)', async () => {
    const { s, sessionId } = await setup();
    const a = await s.requestResponseAction(sessionId, { kind: 'isolate_host' }, 'analyst-1');
    const approved = await s.approveResponseAction(sessionId, a.id, 'admin-9', 'Notfall-Freigabe + Betriebsrat BR-2026-04');
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe('admin-9');
    expect(approved.authorizationBasis).toMatch(/Betriebsrat/);
    expect(approved.note).toMatch(/Agent/i);
  });

  it('Mock-Auto-Exec schliesst genehmigte Containment-Aktion direkt ab', async () => {
    process.env.HUNT_RESPONSE_AUTO_EXECUTE_MOCK = 'true';
    const { s, sessionId } = await setup();
    const a = await s.requestResponseAction(sessionId, { kind: 'isolate_host' }, 'analyst-1');
    const approved = await s.approveResponseAction(sessionId, a.id, 'admin-9', 'Betriebsrat BR-2026-04');
    expect(approved.status).toBe('completed');
    expect(approved.note).toMatch(/Mock-Containment abgeschlossen/i);

    const logs = await s.getLogs(sessionId);
    expect(logs.some((l) => /Response action executing \(mock\)/i.test(l.message))).toBe(true);
    expect(logs.some((l) => /Response action completed \(mock\)/i.test(l.message))).toBe(true);
  });

  it('Mock-Auto-Exec laesst privilegierte Commands weiter auf Agent warten', async () => {
    process.env.HUNT_RESPONSE_AUTO_EXECUTE_MOCK = 'true';
    const { s, sessionId } = await setup();
    const a = await s.requestResponseAction(
      sessionId,
      { kind: 'privileged_command', command: 'Stop-Service suspicious' },
      'analyst-1',
    );
    const approved = await s.approveResponseAction(sessionId, a.id, 'admin-9', 'Notfall-Freigabe BR-2026-04');
    expect(approved.status).toBe('approved');
    expect(approved.note).toMatch(/kein Agent|Stufe 3/i);
  });

  it('Genehmigung OHNE Grundlage -> 400, Aktion bleibt requested', async () => {
    const { s, sessionId } = await setup();
    const a = await s.requestResponseAction(sessionId, { kind: 'isolate_host' }, 'analyst-1');
    await expect(s.approveResponseAction(sessionId, a.id, 'admin-9')).rejects.toMatchObject({ status: 400 });
    expect((await s.getResponseAction(sessionId, a.id)).status).toBe('requested');
  });

  it('Selbst-Genehmigung blockiert (Vier-Augen, 403)', async () => {
    const { s, sessionId } = await setup();
    const a = await s.requestResponseAction(sessionId, { kind: 'isolate_host' }, 'analyst-1');
    await expect(s.approveResponseAction(sessionId, a.id, 'analyst-1', 'Betriebsrat BR-1')).rejects.toMatchObject({ status: 403 });
  });

  it('Ablehnen setzt rejected + Grund', async () => {
    const { s, sessionId } = await setup();
    const a = await s.requestResponseAction(sessionId, { kind: 'privileged_command', command: 'Stop-Service x' }, 'analyst-1');
    const r = await s.rejectResponseAction(sessionId, a.id, 'admin-9', 'nicht noetig');
    expect(r.status).toBe('rejected');
    expect(r.rejectionReason).toBe('nicht noetig');
  });

  it('doppelte Beurteilung -> 409', async () => {
    const { s, sessionId } = await setup();
    const a = await s.requestResponseAction(sessionId, { kind: 'isolate_host' }, 'analyst-1');
    await s.approveResponseAction(sessionId, a.id, 'admin-9', 'Betriebsrat BR-2026-04');
    await expect(s.approveResponseAction(sessionId, a.id, 'admin-9', 'Betriebsrat BR-2026-04')).rejects.toMatchObject({ status: 409 });
  });

  it('list + 404 fuer unbekannte Aktion', async () => {
    const { s, sessionId } = await setup();
    await s.requestResponseAction(sessionId, { kind: 'isolate_host' }, 'analyst-1');
    expect(await s.listResponseActions(sessionId)).toHaveLength(1);
    await expect(s.getResponseAction(sessionId, 'nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('HuntService - Response Execution (Stufe 3, ADR-042, fail-closed)', () => {
  it('Gate AUS (HUNT_RESPONSE_REAL_EXEC_ENABLED) -> E_REAL_EXEC_DISABLED (503), Aktion bleibt approved', async () => {
    const { s } = makeExecService({ enabled: false });
    const { sessionId, actionId } = await approvedAction(s);
    await expect(s.executeResponseAction(sessionId, actionId, EXEC)).rejects.toMatchObject({ status: 503, code: 'E_REAL_EXEC_DISABLED' });
    expect((await s.getResponseAction(sessionId, actionId)).status).toBe('approved');
  });

  it('ohne frische Reauth -> E_REAUTH (401), Runner NICHT gerufen', async () => {
    let called = 0;
    const { s } = makeExecService({ reauthOk: false, runner: async () => { called += 1; return { code: 0 }; } });
    const { sessionId, actionId } = await approvedAction(s);
    await expect(s.executeResponseAction(sessionId, actionId, EXEC)).rejects.toMatchObject({ status: 401, code: 'E_REAUTH' });
    expect(called).toBe(0);
  });

  it('nicht-umkehrbare Aktion (privileged_command) -> E_UNSUPPORTED_REAL_EXEC (400)', async () => {
    const { s } = makeExecService();
    const { sessionId, actionId } = await approvedAction(s, { kind: 'privileged_command' });
    await expect(s.executeResponseAction(sessionId, actionId, EXEC)).rejects.toMatchObject({ status: 400, code: 'E_UNSUPPORTED_REAL_EXEC' });
  });

  it('Ausführender == Anforderer -> E_SELF_EXECUTE (403, Drei-Parteien-Trennung)', async () => {
    const { s } = makeExecService();
    const { sessionId, actionId } = await approvedAction(s, { requestedBy: 'same-person', approvedBy: 'admin-9' });
    await expect(s.executeResponseAction(sessionId, actionId, { actor: { id: 'same-person' }, reauthToken: 'good' }))
      .rejects.toMatchObject({ status: 403, code: 'E_SELF_EXECUTE' });
  });

  it('nicht genehmigte Aktion (noch requested) -> 409', async () => {
    const { s } = makeExecService();
    const session = await s.createSession({ analystId: 'analyst-1', targetHost: 'H' });
    const a = await s.requestResponseAction(session.id, { kind: 'isolate_host' }, 'analyst-1');
    await expect(s.executeResponseAction(session.id, a.id, EXEC)).rejects.toMatchObject({ status: 409 });
  });

  it('ohne konfigurierten Runner -> Fail-safe E_NO_CHANNEL (erst NACH Gates), Aktion bleibt approved', async () => {
    const { s } = makeExecService({ omitFactory: true });
    const { sessionId, actionId } = await approvedAction(s);
    await expect(s.executeResponseAction(sessionId, actionId, EXEC)).rejects.toMatchObject({ code: 'E_NO_CHANNEL' });
    expect((await s.getResponseAction(sessionId, actionId)).status).toBe('approved');
  });

  it('Happy: injizierter Runner code:0 -> completed, executedBy gesetzt, RESPONSE_EXECUTED(mode ssh)+HOST_ISOLATED', async () => {
    let seen = null;
    const { s, audits } = makeExecService({ runner: async (job) => { seen = job; return { code: 0 }; } });
    const { sessionId, actionId } = await approvedAction(s);
    const res = await s.executeResponseAction(sessionId, actionId, EXEC);
    expect(res.status).toBe('completed');
    expect(res.executedBy).toBe('exec-admin');
    expect(seen.action.kind).toBe('isolate_host');
    expect(audits.some((e) => e.action === 'RESPONSE_EXECUTED' && e.metadata.mode === 'ssh' && e.metadata.executedBy === 'exec-admin')).toBe(true);
    expect(audits.some((e) => e.action === 'HOST_ISOLATED')).toBe(true);
  });

  it('Runner nonzero -> E_EXEC_FAILED + failed + RESPONSE_EXECUTION_FAILED (kein Roh-Detail)', async () => {
    const { s, audits } = makeExecService({ runner: async () => ({ code: 1, stderr: '/secret/path' }) });
    const { sessionId, actionId } = await approvedAction(s);
    await expect(s.executeResponseAction(sessionId, actionId, EXEC)).rejects.toMatchObject({ status: 502, code: 'E_EXEC_FAILED' });
    expect((await s.getResponseAction(sessionId, actionId)).status).toBe('failed');
    expect(audits.some((e) => e.action === 'RESPONSE_EXECUTION_FAILED')).toBe(true);
    expect(JSON.stringify(audits)).not.toContain('secret');
  });

  it('release_isolation (umkehrbar) ist ebenfalls real ausführbar -> HOST_ISOLATION_RELEASED', async () => {
    const { s, audits } = makeExecService({ runner: async () => ({ code: 0 }) });
    const { sessionId, actionId } = await approvedAction(s, { kind: 'release_isolation' });
    const res = await s.executeResponseAction(sessionId, actionId, EXEC);
    expect(res.status).toBe('completed');
    expect(audits.some((e) => e.action === 'HOST_ISOLATION_RELEASED')).toBe(true);
  });

  it('parallele Ausführung gegen denselben Ziel-Host -> zweiter Aufruf fail-closed (E_EXEC_IN_PROGRESS)', async () => {
    // Runner-Build blockiert → der erste Aufruf hält den Host-Lock, während der zweite eintrifft.
    let release;
    const gate = new Promise((r) => { release = r; });
    const runnerFactory = async () => { await gate; return async () => ({ code: 0 }); };
    const { s, audits } = makeExecService({ runnerFactory });
    const { sessionId, actionId } = await approvedAction(s);

    const p1 = s.executeResponseAction(sessionId, actionId, EXEC);
    await new Promise((r) => setImmediate(r)); // p1 durch alle Gates bis in den (blockierenden) Runner-Build → Lock gehalten

    await expect(s.executeResponseAction(sessionId, actionId, EXEC))
      .rejects.toMatchObject({ status: 409, code: 'E_EXEC_IN_PROGRESS' });
    expect(audits.some((e) => e.action === 'RESPONSE_EXECUTION_DENIED' && e.metadata.reason === 'in_progress')).toBe(true);

    release(); // p1 weiterlaufen lassen
    expect((await p1).status).toBe('completed');

    // Nach Freigabe des Locks ist der Host wieder ausführbar (kein Dauer-Lock).
    const again = await approvedAction(s);
    const res2 = await s.executeResponseAction(again.sessionId, again.actionId, { actor: { id: 'exec-admin2' }, reauthToken: 'good' });
    expect(res2.status).toBe('completed');
  });

  it('Circuit-Breaker: 3 Fehler in Folge sperren den Kanal (E_CIRCUIT_OPEN); Admin-Reset entsperrt', async () => {
    const { s, audits } = makeExecService({ runner: async () => ({ code: 1 }) }); // immer nonzero → Fehler
    for (let i = 0; i < 3; i += 1) {
      const { sessionId, actionId } = await approvedAction(s);
      await expect(s.executeResponseAction(sessionId, actionId, EXEC)).rejects.toMatchObject({ code: 'E_EXEC_FAILED' });
    }
    expect(s.getResponseCircuit().open).toBe(true);
    expect(audits.some((e) => e.action === 'RESPONSE_CIRCUIT_OPENED')).toBe(true);

    // Kanal offen → nächster Exec wird VOR dem Runner fail-closed geblockt.
    const blocked = await approvedAction(s);
    await expect(s.executeResponseAction(blocked.sessionId, blocked.actionId, EXEC))
      .rejects.toMatchObject({ status: 503, code: 'E_CIRCUIT_OPEN' });

    // Admin-Reset schließt den Kanal → Exec läuft wieder bis zum Runner (kein E_CIRCUIT_OPEN mehr).
    await s.resetResponseCircuit({ actor: { id: 'admin-reset' } });
    expect(s.getResponseCircuit().open).toBe(false);
    expect(audits.some((e) => e.action === 'RESPONSE_CIRCUIT_RESET')).toBe(true);
    const after = await approvedAction(s);
    await expect(s.executeResponseAction(after.sessionId, after.actionId, EXEC)).rejects.toMatchObject({ code: 'E_EXEC_FAILED' });
  });

  it('Circuit-Breaker: ein Erfolg setzt die Fehlerserie zurück (kein Auslösen bei verteilten Fehlern)', async () => {
    const seq = [1, 1, 0, 1, 1]; // fail, fail, success, fail, fail → nie 3 in Folge
    let call = 0;
    const { s } = makeExecService({ runner: async () => ({ code: seq[call++] }) });
    for (let i = 0; i < seq.length; i += 1) {
      const { sessionId, actionId } = await approvedAction(s);
      const p = s.executeResponseAction(sessionId, actionId, EXEC);
      if (seq[i] === 0) await expect(p).resolves.toMatchObject({ status: 'completed' });
      else await expect(p).rejects.toMatchObject({ code: 'E_EXEC_FAILED' });
    }
    expect(s.getResponseCircuit().open).toBe(false);
  });
});
