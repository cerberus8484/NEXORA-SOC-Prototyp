'use strict';

const { WazuhFpExceptionService } = require('../../src/services/WazuhFpExceptionService');
const { InMemoryWazuhFpExceptionRepository } = require('../../src/repositories/InMemoryWazuhFpExceptionRepository');
const B = require('../../src/integrations/adapters/wazuh/wazuhRuleExceptionBuilder');

const scopeA = { ruleId: '87702', srcips: ['192.168.240.109'], dstips: ['224.0.0.0/24'], reason: 'multicast fp' };
const scopeB = { ruleId: '5555', srcips: ['10.0.0.5'], dstips: ['10.0.0.6'], reason: 'b' };
const actor = { id: 'u1', role: 'admin', label: 'admin@x' };

class FakeApi {
  constructor() { this.file = ''; this.enabled = true; this.validateOk = true; this.throwPut = false; this.throwRestart = false; this.calls = []; }
  isEnabled() { return this.enabled; }
  async getRuleFile() { this.calls.push('get'); return this.file; }
  async putRuleFile(_f, c) {
    this.calls.push('put');
    if (this.throwPut) throw new Error('put boom');
    // Realistisch: Wazuh lehnt eine Regelgruppe OHNE <rule> ab (code 1113).
    if (!/<rule\b/i.test(String(c))) throw Object.assign(new Error('Wazuh: leere Regelgruppe abgelehnt (1113)'), { status: 502 });
    this.file = c; return {};
  }
  async deleteRuleFile() { this.calls.push('delete'); this.file = ''; return {}; }
  async validateConfiguration() { this.calls.push('validate'); return this.validateOk ? { ok: true, status: 'OK' } : { ok: false, status: 'KO' }; }
  async restartManager() { this.calls.push('restart'); if (this.throwRestart) throw new Error('restart boom'); return {}; }
}
const fakeAudit = () => { const events = []; return { events, write: async (e) => { events.push(e); } }; };
// Stage-4-Tests laufen mit aktiviertem Safety-Gate (applyEnabled: true).
const svc = (api, audit) => new WazuhFpExceptionService({ repo: new InMemoryWazuhFpExceptionRepository(), apiClient: api, audit, applyEnabled: true });

describe('WazuhFpExceptionService', () => {
  test('apply: schreibt + validiert, KEIN Restart, status=restart_required, ID aus leerer Datei=900000', async () => {
    const api = new FakeApi(); const audit = fakeAudit();
    const r = await svc(api, audit).apply({ ticketId: 't1', scope: scopeA, actor });
    expect(r.ok).toBe(true);
    expect(r.restartRequired).toBe(true);
    expect(r.exception.status).toBe('restart_required');
    expect(r.exception.generatedRuleId).toBe(900000);
    expect(api.calls).toContain('put');
    expect(api.calls).not.toContain('restart');           // KEIN Auto-Restart
    expect(api.file).toContain('<if_sid>87702</if_sid>');
    expect(audit.events.some((e) => e.action === 'FP_APPLY')).toBe(true);
  });

  test('forward: Analyst erstellt + leitet weiter → status submitted, KEIN Write', async () => {
    const api = new FakeApi(); const audit = fakeAudit();
    // forward ist auch ohne Safety-Gate erlaubt (kein Wazuh-Write):
    const s = new WazuhFpExceptionService({ repo: new InMemoryWazuhFpExceptionRepository(), apiClient: api, audit, applyEnabled: false });
    const r = await s.forward({ ticketId: 't1', scope: scopeA, actor: { id: 'analyst-1', role: 'analyst' } });
    expect(r.ok).toBe(true);
    expect(r.exception.status).toBe('submitted');
    expect(r.exception.xml).toContain('87702');
    expect(api.calls).not.toContain('put');                 // KEIN Wazuh-Write
    expect(audit.events.some((e) => e.action === 'FP_FORWARD')).toBe(true);
  });

  test('forward: ungültiger/globaler Scope → kein submitted', async () => {
    const s = new WazuhFpExceptionService({ repo: new InMemoryWazuhFpExceptionRepository(), apiClient: new FakeApi(), audit: fakeAudit(), applyEnabled: false });
    const r = await s.forward({ ticketId: 't', scope: { ruleId: '87702', reason: 'x' }, actor });
    expect(r.ok).toBe(false);
  });

  test('GUARDRAIL: globaler/ungültiger Scope schreibt NIE', async () => {
    const api = new FakeApi();
    const r = await svc(api).apply({ ticketId: 't', scope: { ruleId: '87702', reason: 'x' }, actor });
    expect(r.ok).toBe(false);
    expect(api.calls.length).toBe(0);
  });

  test('GUARDRAIL: Service-Schicht blockiert apply fuer Analyst auch bei scharfem Gate', async () => {
    const api = new FakeApi();
    const r = await svc(api).apply({ ticketId: 't', scope: scopeA, actor: { id: 'a1', role: 'analyst' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Rolle/);
    expect(api.calls.length).toBe(0);
  });

  test('GUARDRAIL: Agent-Scope ohne Agent-Name (kein hostname-Selector) → Apply blockiert, KEIN Write', async () => {
    const api = new FakeApi(); const audit = fakeAudit();
    const r = await svc(api, audit).apply({ ticketId: 't', scope: { ruleId: '52502', agentId: '005', reason: 'ClamAV FP' }, actor });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Selector/);
    expect(api.calls).not.toContain('put');
    expect(audit.events.some((e) => e.action === 'FP_APPLY_BLOCKED')).toBe(true);
  });

  test('apply: Agent-Scope MIT Agent-Name schreibt hostname-Selektor-Regel', async () => {
    const api = new FakeApi();
    const r = await svc(api, fakeAudit()).apply({ ticketId: 't', scope: { ruleId: '52502', agentId: '005', agentName: 'Proxmox', reason: 'ClamAV FP' }, actor });
    expect(r.ok).toBe(true);
    expect(api.file).toContain('<hostname>Proxmox</hostname>');
    expect(api.file).toContain('<if_sid>52502</if_sid>');
  });

  test('Idempotenz: zweites apply gleichen Scopes erzeugt keine zweite Regel', async () => {
    const api = new FakeApi(); const s = svc(api);
    await s.apply({ ticketId: 't', scope: scopeA, actor });
    const putCount1 = api.calls.filter((c) => c === 'put').length;
    const r2 = await s.apply({ ticketId: 't', scope: scopeA, actor });
    expect(r2.idempotent).toBe(true);
    expect(api.calls.filter((c) => c === 'put').length).toBe(putCount1); // kein weiterer Write
    expect(B.parseRuleIds(api.file).length).toBe(1);
  });

  test('validateConfiguration KO → Rollback auf beforeContent, status=failed, kein Restart', async () => {
    const api = new FakeApi(); api.validateOk = false; const audit = fakeAudit();
    const r = await svc(api, audit).apply({ ticketId: 't', scope: scopeA, actor });
    expect(r.ok).toBe(false);
    expect(r.exception.status).toBe('failed');
    expect(api.calls.filter((c) => c === 'put').length).toBe(1); // initialer Write
    expect(api.calls).toContain('delete');                       // Rollback: before war leer → Datei löschen (kein PUT leerer Gruppe)
    expect(api.calls).not.toContain('restart');
    expect(api.file).toBe('');                                  // zurückgerollt
    expect(audit.events.some((e) => e.action === 'FP_APPLY_ROLLBACK')).toBe(true);
  });

  test('Manager-/Schreibfehler → status=failed, retryable, Audit', async () => {
    const api = new FakeApi(); api.throwPut = true; const audit = fakeAudit();
    const r = await svc(api, audit).apply({ ticketId: 't', scope: scopeA, actor });
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(true);
    expect(r.exception.status).toBe('failed');
    expect(audit.events.some((e) => e.action === 'FP_APPLY_FAILED')).toBe(true);
  });

  test('restart ruft restartManager nur über restart() → status=active', async () => {
    const api = new FakeApi(); const s = svc(api);
    const r = await s.apply({ ticketId: 't', scope: scopeA, actor });
    expect(api.calls).not.toContain('restart');
    const rr = await s.restart({ exceptionId: r.exception.id, actor });
    expect(rr.ok).toBe(true);
    expect(rr.exception.status).toBe('active');
    expect(api.calls).toContain('restart');
  });

  test('GUARDRAIL: restart/revert bleiben admin-only in der Service-Schicht', async () => {
    const api = new FakeApi(); const s = svc(api);
    const r = await s.apply({ ticketId: 't', scope: scopeA, actor });
    const engineer = { id: 'e1', role: 'engineer' };
    const restart = await s.restart({ exceptionId: r.exception.id, actor: engineer });
    const revert = await s.revert({ exceptionId: r.exception.id, actor: engineer });
    expect(restart.ok).toBe(false);
    expect(revert.ok).toBe(false);
    expect(api.calls).not.toContain('restart');
  });

  test('revert entfernt nur die passende Regel (ID + Marker), restartRequired', async () => {
    const api = new FakeApi(); const s = svc(api);
    const r = await s.apply({ ticketId: 't', scope: scopeA, actor });
    // zweite, unabhängige Regel hinzufügen
    api.file = B.insertRule(api.file, B.buildRuleElement(scopeB, 100200, B.scopeHash(scopeB)));
    const rev = await s.revert({ exceptionId: r.exception.id, actor });
    expect(rev.ok).toBe(true);
    expect(rev.restartRequired).toBe(true);
    expect(rev.exception.status).toBe('reverted');
    expect(B.parseRuleIds(api.file)).toEqual([100200]);          // nur scopeA entfernt
  });

  // Regression: Wazuh lehnt eine leere Regelgruppe ab. Beim Entfernen der LETZTEN
  // Regel muss die Datei GELÖSCHT werden — sonst bleibt die Regel still stehen
  // (Apply→Revert ließ die Regel auf dem Manager; Live-E2E 2026-06-13).
  test('revert der letzten Regel LÖSCHT die Datei (kein PUT leerer Gruppe)', async () => {
    const api = new FakeApi(); const s = svc(api);
    const r = await s.apply({ ticketId: 't', scope: scopeA, actor });
    expect(B.parseRuleIds(api.file)).toEqual([900000]);          // genau eine Regel
    const rev = await s.revert({ exceptionId: r.exception.id, actor });
    expect(rev.ok).toBe(true);
    expect(rev.exception.status).toBe('reverted');
    expect(api.calls).toContain('delete');                       // Datei gelöscht
    expect(api.file).toBe('');                                   // wirklich leer
    expect(B.parseRuleIds(api.file)).toEqual([]);                // Regel ist WEG
  });

  // Regression: putRuleFile-Fehler (z.B. leere Gruppe) darf NICHT still durchgehen.
  test('apply: putRuleFile-Fehler → ok:false, status failed (kein Silent-Success)', async () => {
    const api = new FakeApi(); api.throwPut = true; const audit = fakeAudit();
    const r = await svc(api, audit).apply({ ticketId: 't', scope: scopeA, actor });
    expect(r.ok).toBe(false);
    expect(r.exception.status).toBe('failed');
    expect(audit.events.some((e) => e.action === 'FP_APPLY_FAILED')).toBe(true);
  });

  test('apply ohne konfigurierte API → ok:false, kein Write', async () => {
    const api = new FakeApi(); api.enabled = false;
    const r = await svc(api).apply({ ticketId: 't', scope: scopeA, actor });
    expect(r.ok).toBe(false);
    expect(api.calls.length).toBe(0);
  });

  // ── QUICK: rollenabhängiger Ein-Klick aus dem Ticket ─────────────────────
  describe('quick (rollenabhängiger Ein-Klick)', () => {
    test('admin + applyEnabled → apply (Write), action=applied, restartRequired', async () => {
      const api = new FakeApi(); const audit = fakeAudit();
      const r = await svc(api, audit).quick({ ticketId: 't', scope: scopeA, actor }); // actor = admin
      expect(r.ok).toBe(true);
      expect(r.action).toBe('applied');
      expect(r.restartRequired).toBe(true);
      expect(api.calls).toContain('put');
    });

    test('analyst → forward (KEIN Write), action=forwarded, status submitted', async () => {
      const api = new FakeApi(); const audit = fakeAudit();
      const r = await svc(api, audit).quick({ ticketId: 't', scope: scopeA, actor: { id: 'a1', role: 'analyst' } });
      expect(r.ok).toBe(true);
      expect(r.action).toBe('forwarded');
      expect(r.exception.status).toBe('submitted');
      expect(api.calls).not.toContain('put');
    });

    test('engineer aber Safety-Gate AUS → fällt auf forward zurück (kein Dead-End, kein Write)', async () => {
      const api = new FakeApi();
      const gated = new WazuhFpExceptionService({ repo: new InMemoryWazuhFpExceptionRepository(), apiClient: api, audit: fakeAudit(), applyEnabled: false });
      const r = await gated.quick({ ticketId: 't', scope: scopeA, actor: { id: 'e1', role: 'engineer' } });
      expect(r.ok).toBe(true);
      expect(r.action).toBe('forwarded');
      expect(api.calls).not.toContain('put');
    });

    test('ungültiger/globaler Scope → ok:false, KEIN Write (auch als admin)', async () => {
      const api = new FakeApi();
      const r = await svc(api).quick({ ticketId: 't', scope: { ruleId: '87702', reason: 'x' }, actor });
      expect(r.ok).toBe(false);
      expect(api.calls).not.toContain('put');
    });
  });

  describe('Safety Gate (WAZUH_FP_APPLY_ENABLED)', () => {
    const gated = (api) => new WazuhFpExceptionService({ repo: new InMemoryWazuhFpExceptionRepository(), apiClient: api, audit: fakeAudit(), applyEnabled: false });

    test('Default false blockiert apply/restart/revert — KEIN Write', async () => {
      const api = new FakeApi(); const s = gated(api);
      const a = await s.apply({ ticketId: 't', scope: scopeA, actor });
      expect(a.ok).toBe(false); expect(a.disabled).toBe(true);
      expect(a.errors.join(' ')).toMatch(/disabled by configuration/);
      expect((await s.restart({ exceptionId: 'x', actor })).disabled).toBe(true);
      expect((await s.revert({ exceptionId: 'x', actor })).disabled).toBe(true);
      expect(api.calls.length).toBe(0); // nichts gerufen
    });

    test('capabilities spiegelt Flag + API-Config', () => {
      const api = new FakeApi();
      expect(gated(api).capabilities()).toEqual({ applyEnabled: false, apiConfigured: true });
      expect(svc(api).capabilities()).toEqual({ applyEnabled: true, apiConfigured: true });
    });
  });
});
