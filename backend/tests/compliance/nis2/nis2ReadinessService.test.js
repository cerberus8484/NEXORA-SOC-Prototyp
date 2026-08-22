'use strict';

// P_NIS2_1 — ReadinessService: Upsert, Evidence, Readiness-Berechnung, Audit-Redaction.
// P_NIS2_3 — reviewDue (Stale-Evidence-Governance, Review-Kadenz).
const { Nis2ReadinessService, computeFlags } = require('../../../src/compliance/nis2/Nis2ReadinessService');
const { InMemoryNis2Repository } = require('../../../src/repositories/InMemoryNis2Repository');

function fakeAudit() {
  const calls = [];
  return { calls, write: async (e) => { calls.push(e); return e; } };
}
function wire() {
  const repo = new InMemoryNis2Repository();
  const audit = fakeAudit();
  const service = new Nis2ReadinessService({ repo, audit });
  return { repo, audit, service };
}
const actor = { userId: 'u1', label: 'admin@x', ip: '127.0.0.1' };

describe('ReadinessService — Upsert + Audit', () => {
  test('erstes Upsert legt an, auditiert CREATED + STATUS_CHANGED', async () => {
    const { service, audit } = wire();
    const saved = await service.upsertAssessment('incident_handling', { status: 'in_progress', owner: 'SecTeam' }, actor);
    expect(saved.controlKey).toBe('incident_handling');
    expect(saved.status).toBe('in_progress');
    const actions = audit.calls.map((c) => c.action);
    expect(actions).toContain('NIS2_ASSESSMENT_CREATED');
    expect(actions).toContain('NIS2_STATUS_CHANGED');
  });
  test('zweites Upsert aktualisiert (kein Duplikat), auditiert UPDATED', async () => {
    const { service, repo, audit } = wire();
    await service.upsertAssessment('incident_handling', { status: 'in_progress' }, actor);
    await service.upsertAssessment('incident_handling', { status: 'addressed', owner: 'X' }, actor);
    expect((await repo.listAssessments())).toHaveLength(1);
    expect(audit.calls.map((c) => c.action)).toContain('NIS2_ASSESSMENT_UPDATED');
  });
  test('Audit-Metadaten enthalten NIE notes oder Evidence-Inhalt/URL', async () => {
    const { service, audit } = wire();
    await service.upsertAssessment('incident_handling', { status: 'in_progress', notes: 'GEHEIME interne Notiz', owner: 'SecTeam' }, actor);
    const dump = JSON.stringify(audit.calls);
    expect(dump).not.toContain('GEHEIME');
    for (const c of audit.calls) {
      expect(c.metadata).not.toHaveProperty('notes');
      expect(c.metadata).not.toHaveProperty('evidenceRef');
    }
  });
});

describe('ReadinessService — Evidence', () => {
  test('addEvidence legt fehlendes Assessment automatisch an + auditiert LINKED', async () => {
    const { service, repo, audit } = wire();
    const ev = await service.addEvidence('cryptography_and_encryption',
      { evidenceType: 'document', evidenceRef: 'https://wiki.local/krypto', title: 'Krypto-Konzept' }, actor);
    expect(ev.id).toBeDefined();
    expect(await repo.getAssessment('cryptography_and_encryption')).not.toBeNull();
    expect(audit.calls.map((c) => c.action)).toContain('NIS2_EVIDENCE_LINKED');
    // Audit trägt nur evidenceType, nicht den Ref/Title.
    const linked = audit.calls.find((c) => c.action === 'NIS2_EVIDENCE_LINKED');
    expect(JSON.stringify(linked.metadata)).not.toContain('wiki.local');
  });
  test('Evidence erscheint im Control-Detail', async () => {
    const { service } = wire();
    await service.addEvidence('cryptography_and_encryption', { evidenceType: 'document', evidenceRef: 'ref-1', title: 'T' }, actor);
    const detail = await service.getControlDetail('cryptography_and_encryption');
    expect(detail.evidence).toHaveLength(1);
    expect(detail.evidenceCount).toBe(1);
  });
  test('removeEvidence entfernt + auditiert REMOVED', async () => {
    const { service, audit } = wire();
    const ev = await service.addEvidence('cryptography_and_encryption', { evidenceType: 'document', evidenceRef: 'ref-1', title: 'T' }, actor);
    await service.removeEvidence(ev.id, actor);
    const detail = await service.getControlDetail('cryptography_and_encryption');
    expect(detail.evidence).toHaveLength(0);
    expect(audit.calls.map((c) => c.action)).toContain('NIS2_EVIDENCE_REMOVED');
  });
});

describe('ReadinessService — getReadiness Berechnung', () => {
  test('liefert 10 Controls + Summary mit korrekten Zählern', async () => {
    const { service } = wire();
    // overdue: in_progress mit vergangener Fälligkeit, keine Evidence
    await service.upsertAssessment('incident_handling', { status: 'in_progress', dueDate: '2020-01-01' }, actor);
    // addressed ohne Evidence → needsReview
    await service.upsertAssessment('cyber_hygiene_training', { status: 'addressed' }, actor);
    // mit Evidence → coverage zählt
    await service.addEvidence('cryptography_and_encryption', { evidenceType: 'document', evidenceRef: 'r', title: 'T' }, actor);
    // not_applicable mit Begründung → zählt als coverage, nicht missing
    await service.upsertAssessment('supply_chain_security', { status: 'not_applicable', notes: 'kein Dienstleister' }, actor);

    const { summary, controls } = await service.getReadiness();
    expect(controls).toHaveLength(10);
    expect(summary.controlsTotal).toBe(10);
    expect(summary.overdue).toBeGreaterThanOrEqual(1);
    expect(summary.needsReview).toBeGreaterThanOrEqual(1);
    expect(summary.evidenceCoverage).toBeGreaterThanOrEqual(2); // crypto (evidence) + supply_chain (n/a)

    const incident = controls.find((c) => c.key === 'incident_handling');
    expect(incident.overdue).toBe(true);
    expect(incident.missingEvidence).toBe(true);
    const hygiene = controls.find((c) => c.key === 'cyber_hygiene_training');
    expect(hygiene.needsReview).toBe(true); // addressed ohne Evidence
  });

  test('Summary trägt das reviewDue-Aggregat (Default 0 ohne stale Reviews)', async () => {
    const { service } = wire();
    const { summary } = await service.getReadiness();
    expect(typeof summary.reviewDue).toBe('number');
  });
});

describe('ReadinessService — reviewDue (P_NIS2_3, Review-Kadenz)', () => {
  const now = Date.now();
  const daysAgo = (d) => new Date(now - d * 86_400_000).toISOString();

  test('addressed + Evidence + Review älter als Kadenz → reviewDue true', () => {
    expect(computeFlags('addressed', 2, null, now, daysAgo(400), 365).reviewDue).toBe(true);
  });
  test('addressed + Evidence + frischer Review → reviewDue false', () => {
    expect(computeFlags('addressed', 2, null, now, daysAgo(10), 365).reviewDue).toBe(false);
  });
  test('kein lastReviewedAt → reviewDue false (kein Fehlalarm für „nie reviewed")', () => {
    expect(computeFlags('addressed', 2, null, now, null, 365).reviewDue).toBe(false);
  });
  test('addressed OHNE Evidence → reviewDue false (das ist needsReview, nicht stale)', () => {
    expect(computeFlags('addressed', 0, null, now, daysAgo(400), 365).reviewDue).toBe(false);
  });
  test('nicht-addressed (in_progress) mit altem Review → reviewDue false', () => {
    expect(computeFlags('in_progress', 2, null, now, daysAgo(400), 365).reviewDue).toBe(false);
  });
  test('konfigurierbare Kadenz: 30 Tage → 40 Tage alt ist reviewDue', () => {
    expect(computeFlags('addressed', 1, null, now, daysAgo(40), 30).reviewDue).toBe(true);
  });
});
