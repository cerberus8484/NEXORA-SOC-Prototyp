'use strict';

// P_NIS2_2 — Incident-Evidence-Verknüpfung + Management-Readiness-Report.
// Fokus: Ticket-Validierung, PII-Sicherheit (kein email/user/srcIp im Nachweis/Audit),
// Report-Aggregation, ehrliche Positionierung (kein Konformitäts-Claim).

const { Nis2ReadinessService } = require('../../../src/compliance/nis2/Nis2ReadinessService');
const { InMemoryNis2Repository } = require('../../../src/repositories/InMemoryNis2Repository');
const { ASSESSMENT_STATUS } = require('../../../src/compliance/nis2/Nis2Assessment');
const { NotFoundError } = require('../../../src/errors/AppError');

function fakeAudit() {
  const calls = [];
  return { calls, write: async (e) => { calls.push(e); return e; } };
}
function fakeTicketService(tickets = {}) {
  return {
    findById: async (id) => {
      const t = tickets[id];
      if (!t) throw new NotFoundError('Ticket');
      return t;
    },
  };
}
function wire(tickets) {
  const repo = new InMemoryNis2Repository();
  const audit = fakeAudit();
  const service = new Nis2ReadinessService({ repo, audit, ticketService: fakeTicketService(tickets) });
  return { repo, audit, service };
}
const actor = { userId: 'u1', label: 'admin@x', ip: '127.0.0.1' };

// Ein Ticket mit reichlich PII-/sensiblen Feldern — darf NIE in Evidence/Audit landen.
const PII_TICKET = {
  id: 't-1', ticketNr: 'INC000777', title: 'Phishing <b>alarm</b> on mailbox', priority: 'high', state: 'OPEN',
  email: 'victim@corp.example', user: 'jdoe', dept: 'Finance', srcIp: '10.13.37.5',
  description: 'sensitive internal investigation details', logs: 'raw log dump',
};
const PII_VALUES = ['victim@corp.example', 'jdoe', 'Finance', '10.13.37.5', 'sensitive internal investigation details', 'raw log dump'];

describe('linkIncident — Ticket als Evidence verknüpfen', () => {
  test('legt ticket-Evidence mit INC-Nummer als Ref an + auto-Assessment', async () => {
    const { service, repo } = wire({ 't-1': PII_TICKET });
    const ev = await service.linkIncident('incident_handling', { ticketId: 't-1' }, actor);
    expect(ev.evidenceType).toBe('ticket');
    expect(ev.evidenceRef).toBe('INC000777');
    expect(ev.title).toContain('Phishing'); // Titel-Snapshot
    expect(await repo.getAssessment('incident_handling')).not.toBeNull();
  });

  test('Titel wird sanitisiert (kein < oder >)', async () => {
    const { service } = wire({ 't-1': PII_TICKET });
    const ev = await service.linkIncident('incident_handling', { ticketId: 't-1' }, actor);
    expect(ev.title).not.toMatch(/[<>]/);
  });

  test('KEIN PII im Evidence-Link (nur sichere Snapshot-Felder)', async () => {
    const { service } = wire({ 't-1': PII_TICKET });
    const ev = await service.linkIncident('incident_handling', { ticketId: 't-1' }, actor);
    const dump = JSON.stringify(ev);
    for (const v of PII_VALUES) expect(dump).not.toContain(v);
  });

  test('KEIN PII + kein Secret im Audit; nur ticketRef = INC-Nummer', async () => {
    const { service, audit } = wire({ 't-1': PII_TICKET });
    await service.linkIncident('incident_handling', { ticketId: 't-1' }, actor);
    const linked = audit.calls.find((c) => c.action === 'NIS2_EVIDENCE_LINKED');
    expect(linked).toBeTruthy();
    expect(linked.metadata.evidenceType).toBe('ticket');
    expect(linked.metadata.ticketRef).toBe('INC000777');
    expect(linked.metadata).not.toHaveProperty('notes');
    expect(linked.metadata).not.toHaveProperty('title');
    const dump = JSON.stringify(audit.calls);
    for (const v of PII_VALUES) expect(dump).not.toContain(v);
  });

  test('unbekanntes Ticket → NotFoundError (→ 404)', async () => {
    const { service } = wire({ 't-1': PII_TICKET });
    await expect(service.linkIncident('incident_handling', { ticketId: 'does-not-exist' }, actor))
      .rejects.toThrow(NotFoundError);
  });

  test('unbekannter Control-Key → NotFoundError', async () => {
    const { service } = wire({ 't-1': PII_TICKET });
    await expect(service.linkIncident('not_a_control', { ticketId: 't-1' }, actor))
      .rejects.toThrow(NotFoundError);
  });
});

describe('getManagementReport — Aggregat', () => {
  test('Grundform: meta + summary + controls, byStatus summiert zu controlsTotal', async () => {
    const { service } = wire({});
    const report = await service.getManagementReport();
    expect(report.meta.catalogVersion).toBeTruthy();
    expect(report.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(report.controls)).toBe(true);
    expect(report.summary.controlsTotal).toBe(report.controls.length);
    const sum = ASSESSMENT_STATUS.reduce((acc, s) => acc + (report.summary.byStatus[s] || 0), 0);
    expect(sum).toBe(report.summary.controlsTotal);
  });

  test('ehrliche Positionierung: Disclaimer ohne "konform/compliant/zertifiziert"', async () => {
    const { service } = wire({});
    const report = await service.getManagementReport();
    expect(report.meta.disclaimer).toMatch(/kein Konformitätsnachweis/i);
    expect(JSON.stringify(report)).not.toMatch(/\b(konform|compliant|zertifiziert|rechtssicher)\b/i);
  });

  test('incidentEvidenceTotal zählt verknüpfte Tickets; addressedWithEvidence korrekt', async () => {
    const { service } = wire({ 't-1': PII_TICKET });
    // ohne Incident: 0
    let report = await service.getManagementReport();
    expect(report.summary.incidentEvidenceTotal).toBe(0);
    // ein Incident verknüpfen
    await service.linkIncident('incident_handling', { ticketId: 't-1' }, actor);
    report = await service.getManagementReport();
    expect(report.summary.incidentEvidenceTotal).toBe(1);
    const ih = report.controls.find((c) => c.key === 'incident_handling');
    expect(ih.incidentEvidenceCount).toBe(1);
    expect(ih.evidenceCount).toBeGreaterThanOrEqual(1);
  });

  test('addressed ohne Evidence zählt NICHT als addressedWithEvidence (Ehrlichkeit)', async () => {
    const { service } = wire({});
    await service.upsertAssessment('incident_handling', { status: 'addressed' }, actor);
    const report = await service.getManagementReport();
    expect(report.summary.addressedWithEvidence).toBe(0);
    const ih = report.controls.find((c) => c.key === 'incident_handling');
    expect(ih.needsReview).toBe(true); // addressed ohne Evidence ⇒ needsReview
  });
});
