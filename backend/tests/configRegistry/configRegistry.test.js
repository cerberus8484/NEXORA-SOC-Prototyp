'use strict';

const fs = require('fs');
const path = require('path');
const { ConfigRegistryService } = require('../../src/configRegistry/ConfigRegistryService');
const { InMemoryConfigRepository } = require('../../src/configRegistry/InMemoryConfigRepository');
const { AUDIT_EVENTS } = require('../../src/configRegistry/configDomain');

const ENGINEER = { role: 'engineer', label: 'eng@nexora' };
const ADMIN = { role: 'admin', label: 'adm@nexora' };
const ANALYST = { role: 'analyst', label: 'ana@nexora' };

function svc() { return new ConfigRegistryService({ repo: new InMemoryConfigRepository() }); }
const CAP = 'correlator.worker.maxChildren';
const TARGET = 'correlation-worker';

async function newDraft(s, actor = ENGINEER, value = { maxChildren: 50 }) {
  return s.createDraft({ capabilityId: CAP, targetId: TARGET, value, actor });
}

describe('ConfigRegistry — Allowlist (unknown = deny)', () => {
  test('unbekannte Capability wird abgelehnt', async () => {
    await expect(svc().createDraft({ capabilityId: 'anything.free.key', targetId: TARGET, value: {}, actor: ENGINEER }))
      .rejects.toMatchObject({ status: 400 });
  });
  test('reservierte/nicht-editierbare Capability (host) wird abgelehnt', async () => {
    await expect(svc().createDraft({ capabilityId: 'host.network.allowlist', targetId: 'host-fw', value: { cidrs: [] }, actor: ADMIN }))
      .rejects.toMatchObject({ status: 403 });
  });
  test('unbekanntes/ungültiges Ziel wird abgelehnt', async () => {
    await expect(svc().createDraft({ capabilityId: CAP, targetId: 'free-target', value: { maxChildren: 5 }, actor: ENGINEER }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('ConfigRegistry — Schema-Validierung + Defaults', () => {
  test('out-of-range Wert wird abgelehnt', async () => {
    await expect(newDraft(svc(), ENGINEER, { maxChildren: 99999 })).rejects.toMatchObject({ status: 400 });
  });
  test('freie/unbekannte Keys werden abgelehnt', async () => {
    await expect(newDraft(svc(), ENGINEER, { maxChildren: 5, evil: 'x' })).rejects.toBeTruthy();
  });
  test('leerer Wert füllt Default (maxChildren=200)', async () => {
    const d = await newDraft(svc(), ENGINEER, {});
    expect(d.value.maxChildren).toBe(200);
  });
});

describe('ConfigRegistry — Draft-Versionierung / Optimistic Locking', () => {
  test('neuer Draft startet bei version 1 / revision 1, Status draft', async () => {
    const d = await newDraft(svc());
    expect(d.status).toBe('draft'); expect(d.version).toBe(1); expect(d.revision).toBe(1);
  });
  test('Wertänderung erhöht version + revision', async () => {
    const s = svc(); const d = await newDraft(s);
    const d2 = await s.updateDraftValue({ draftId: d.id, value: { maxChildren: 77 }, expectedVersion: d.version, actor: ENGINEER });
    expect(d2.version).toBe(2); expect(d2.revision).toBe(2); expect(d2.value.maxChildren).toBe(77);
  });
  test('falsche expectedVersion → 409 (kein stilles Überschreiben)', async () => {
    const s = svc(); const d = await newDraft(s);
    await s.updateDraftValue({ draftId: d.id, value: { maxChildren: 10 }, expectedVersion: 1, actor: ENGINEER });
    await expect(s.updateDraftValue({ draftId: d.id, value: { maxChildren: 20 }, expectedVersion: 1, actor: ENGINEER }))
      .rejects.toMatchObject({ status: 409 });
  });
  test('jede Revision wird historisiert', async () => {
    const s = svc(); const d = await newDraft(s);
    await s.updateDraftValue({ draftId: d.id, value: { maxChildren: 11 }, expectedVersion: 1, actor: ENGINEER });
    const revs = await s._repo.listRevisions(d.id);
    expect(revs.map((r) => r.revision)).toEqual([1, 2]);
  });
});

describe('ConfigRegistry — RBAC-Grenzen', () => {
  test('analyst darf keinen Draft anlegen (read-only)', async () => {
    await expect(newDraft(svc(), ANALYST)).rejects.toMatchObject({ status: 403 });
  });
  test('engineer darf nicht freigeben (nur admin)', async () => {
    const s = svc(); const d = await newDraft(s);
    const sub = await s.submitForApproval({ draftId: d.id, expectedVersion: d.version, actor: ENGINEER });
    await expect(s.decide({ draftId: d.id, decision: 'approved', expectedVersion: sub.version, actor: ENGINEER }))
      .rejects.toMatchObject({ status: 403 });
  });
  test('Vier-Augen-Prinzip: Ersteller darf nicht selbst freigeben', async () => {
    const s = svc();
    const d = await s.createDraft({ capabilityId: CAP, targetId: TARGET, value: { maxChildren: 5 }, actor: ADMIN });
    const sub = await s.submitForApproval({ draftId: d.id, expectedVersion: d.version, actor: ADMIN });
    await expect(s.decide({ draftId: d.id, decision: 'approved', expectedVersion: sub.version, actor: ADMIN }))
      .rejects.toMatchObject({ status: 403 });
  });
});

describe('ConfigRegistry — Approval ohne Apply (approved ≠ applied)', () => {
  test('Freigabe setzt Status approved, löst KEIN Apply aus', async () => {
    const s = svc(); const d = await newDraft(s);
    const sub = await s.submitForApproval({ draftId: d.id, expectedVersion: d.version, actor: ENGINEER });
    const appr = await s.decide({ draftId: d.id, decision: 'approved', expectedVersion: sub.version, note: 'ok', actor: ADMIN });
    expect(appr.status).toBe('approved');
    expect(appr).not.toHaveProperty('applied');
    expect(appr).not.toHaveProperty('appliedAt');
    // Service besitzt keine Apply-Methode.
    expect(typeof s.apply).toBe('undefined');
    expect(typeof s.applyDraft).toBe('undefined');
  });
});

describe('ConfigRegistry — Redaction sensibler Felder', () => {
  test('sensitives Feld ist in Draft-Ausgabe + Audit redigiert', async () => {
    const s = svc();
    const d = await s.createDraft({ capabilityId: 'integration.notify.targetRef', targetId: 'notify', value: { targetRef: 'channel://ops-secret' }, actor: ENGINEER });
    expect(d.value.targetRef).toBe('***redacted***');
    const audit = await s.listAudit({ draftId: d.id });
    expect(JSON.stringify(audit)).not.toContain('ops-secret');
    expect(JSON.stringify(audit)).toContain('***redacted***');
  });
});

describe('ConfigRegistry — Audit je Lifecycle-Übergang', () => {
  test('created → revised → submitted → approved erzeugt je ein Audit-Event', async () => {
    const s = svc(); const d = await newDraft(s);
    const d2 = await s.updateDraftValue({ draftId: d.id, value: { maxChildren: 9 }, expectedVersion: d.version, actor: ENGINEER });
    const sub = await s.submitForApproval({ draftId: d.id, expectedVersion: d2.version, actor: ENGINEER });
    await s.decide({ draftId: d.id, decision: 'approved', expectedVersion: sub.version, actor: ADMIN });
    const types = (await s.listAudit({ draftId: d.id })).map((a) => a.type);
    expect(types).toEqual([
      AUDIT_EVENTS.DRAFT_CREATED, AUDIT_EVENTS.DRAFT_REVISED, AUDIT_EVENTS.DRAFT_SUBMITTED, AUDIT_EVENTS.DRAFT_APPROVED,
    ]);
  });
});

describe('ConfigRegistry — No-Apply/No-Network/No-File-Safety (Quell-Scan)', () => {
  const dir = path.join(__dirname, '../../src/configRegistry');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));

  test('keine apply/exec/shell/ssh/restart/reload/spawn-METHODE in Domain/Service/Repo', () => {
    // 'apply' nur als AKTION verbieten — read-only Getter applyStatus/applyImpact/applyEligible sind erlaubt.
    const forbidden = /^(apply(?!status|impact|eligible)|exec|execsync|spawn|shell|ssh|restart|reload|sniff|connect|remote)/i;
    const mods = [
      require('../../src/configRegistry/ConfigRegistryService').ConfigRegistryService,
      require('../../src/configRegistry/InMemoryConfigRepository').InMemoryConfigRepository,
      ...Object.values(require('../../src/configRegistry/configDomain')).filter((v) => typeof v === 'function'),
      ...Object.values(require('../../src/configRegistry/configCapabilityCatalog')).filter((v) => typeof v === 'function'),
    ];
    for (const M of mods) {
      const names = Object.getOwnPropertyNames(M.prototype || {});
      const bad = names.filter((n) => forbidden.test(n));
      expect(bad).toEqual([]);
    }
  });

  test('keine gefährlichen Imports/Calls (child_process/fs-write/net/http/exec/spawn/connect)', () => {
    const DANGER = /(child_process|require\(['"]fs['"]\)|require\(['"]net['"]\)|require\(['"]https?['"]\)|\.writeFile|\.appendFile|\.exec\(|\bspawn\(|execSync|\.connect\()/;
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      expect(DANGER.test(src)).toBe(false);
    }
  });

  test('Forbidden-Regex schlägt bei echter Gefahr an (Selbsttest)', () => {
    const DANGER = /(child_process|\.writeFile|\.exec\()/;
    expect(DANGER.test("const cp = require('child_process')")).toBe(true);
    expect(DANGER.test('fs.writeFileSync(p, x)')).toBe(true);
    expect(DANGER.test('await this._repo.listDrafts()')).toBe(false);
  });
});
