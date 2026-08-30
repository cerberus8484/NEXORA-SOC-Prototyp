'use strict';

const { HuntService } = require('../../src/threatHunting/services/HuntService');
const { InMemoryHuntRepository } = require('../../src/threatHunting/repositories/InMemoryHuntRepository');
const { TicketService } = require('../../src/services/TicketService');
const { EvidenceService } = require('../../src/services/EvidenceService');
const { InMemoryEvidenceRepository } = require('../../src/repositories/InMemoryEvidenceRepository');
const { InMemoryCustodyRepository } = require('../../src/repositories/InMemoryCustodyRepository');

function build() {
  const ticketService   = new TicketService();
  const evidenceService = new EvidenceService({
    repo: new InMemoryEvidenceRepository(),
    custodyRepo: new InMemoryCustodyRepository(),
  });
  const huntService = new HuntService(new InMemoryHuntRepository(), { ticketService, evidenceService });
  return { huntService, ticketService, evidenceService };
}

async function huntWithFinding(huntService) {
  const session = await huntService.createSession({
    analystId: 'analyst-1', targetHost: 'Windows-01', huntType: 'suspicious_powershell_hunt',
  });
  await huntService.startHunt(session.id, 'analyst-1');   // sync
  const findings = await huntService.getFindings(session.id);
  return { sessionId: session.id, finding: findings[0] };
}

describe('createTicketFromFinding', () => {
  it('erzeugt echtes Ticket aus Finding (Severity → Priority) und verknüpft es', async () => {
    const { huntService, ticketService } = build();
    const { sessionId, finding } = await huntWithFinding(huntService);

    const ticket = await huntService.createTicketFromFinding(sessionId, finding.id, 'analyst-1');
    expect(ticket.id).toBeDefined();
    expect(ticket.title).toBe('Suspicious PowerShell Execution');
    expect(ticket.priority).toBe('high');
    expect(ticket.source).toBe('threat_hunt');
    expect(ticket.process).toBe('powershell.exe');

    // Ticket existiert im TicketService …
    const stored = await ticketService.findById(ticket.id);
    expect(stored.id).toBe(ticket.id);

    // … und das Finding ist jetzt verknüpft.
    const reloaded = await huntService.getFinding(sessionId, finding.id);
    expect(reloaded.ticketId).toBe(ticket.id);
  });

  it('503 wenn kein TicketService injiziert', async () => {
    const hs = new HuntService(new InMemoryHuntRepository());
    const { sessionId, finding } = await huntWithFinding(hs);
    await expect(hs.createTicketFromFinding(sessionId, finding.id, 'a1'))
      .rejects.toMatchObject({ status: 503 });
  });
});

describe('addFindingToEvidence', () => {
  it('legt Evidence an und erzeugt fehlendes Ticket automatisch', async () => {
    const { huntService, evidenceService } = build();
    const { sessionId, finding } = await huntWithFinding(huntService);

    const { evidence, ticketId } = await huntService.addFindingToEvidence(sessionId, finding.id, 'analyst-1');
    expect(evidence?.id).toBeDefined();
    expect(ticketId).toBeDefined();
    expect(evidence.ticketId).toBe(ticketId);

    const list = await evidenceService.findByTicket(ticketId);
    expect(list.length).toBe(1);
    expect(list[0].title).toBe('Suspicious PowerShell Execution');
  });

  it('nutzt bestehendes Ticket, wenn Finding bereits verknüpft', async () => {
    const { huntService } = build();
    const { sessionId, finding } = await huntWithFinding(huntService);

    const ticket = await huntService.createTicketFromFinding(sessionId, finding.id, 'a1');
    const { ticketId } = await huntService.addFindingToEvidence(sessionId, finding.id, 'a1');
    expect(ticketId).toBe(ticket.id);
  });

  it('503 wenn kein EvidenceService injiziert', async () => {
    const ticketService = new TicketService();
    const hs = new HuntService(new InMemoryHuntRepository(), { ticketService });
    const { sessionId, finding } = await huntWithFinding(hs);
    await expect(hs.addFindingToEvidence(sessionId, finding.id, 'a1'))
      .rejects.toMatchObject({ status: 503 });
  });
});

// ─── setFindingVerdict (Block B2) ─────────────────────────────────────────────

describe('setFindingVerdict', () => {
  it('setzt Verdict, persistiert und schreibt Audit-Log', async () => {
    const auditLog = [];
    const mockAudit = { write: async (e) => auditLog.push(e) };
    const { huntService } = build();
    // Audit-Service durch Mock ersetzen
    huntService._auditSvc = mockAudit;

    const { sessionId, finding } = await huntWithFinding(huntService);

    const updated = await huntService.setFindingVerdict(sessionId, finding.id, 'suspicious', 'analyst-1');
    expect(updated.verdict).toBe('suspicious');

    // Persistenz prüfen: laden und vergleichen
    const reloaded = await huntService.getFinding(sessionId, finding.id);
    expect(reloaded.verdict).toBe('suspicious');

    // Audit-Log prüfen
    const verdictAudit = auditLog.find(e => e.action === 'HUNT_FINDING_VERDICT_SET');
    expect(verdictAudit).toBeDefined();
    expect(verdictAudit.metadata.verdict).toBe('suspicious');
    expect(verdictAudit.metadata.findingId).toBe(finding.id);
    expect(verdictAudit.actorId).toBe('analyst-1');
  });

  it('wirft 404 wenn Finding nicht existiert', async () => {
    const { huntService } = build();
    const session = await huntService.createSession({ analystId: 'a1', targetHost: 'h1' });
    await expect(huntService.setFindingVerdict(session.id, 'non-existent-id', 'benign', 'a1'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('wirft bei ungültigem Verdict', async () => {
    const { huntService } = build();
    const { sessionId, finding } = await huntWithFinding(huntService);
    await expect(huntService.setFindingVerdict(sessionId, finding.id, 'INVALID', 'a1'))
      .rejects.toThrow(/Ungültiges Verdict/);
  });

  it('wirft 404 wenn Session nicht existiert', async () => {
    const { huntService } = build();
    await expect(huntService.setFindingVerdict('ghost-session', 'ghost-finding', 'benign', 'a1'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('Verdict kann von suspicious auf benign geändert werden', async () => {
    const { huntService } = build();
    const { sessionId, finding } = await huntWithFinding(huntService);

    await huntService.setFindingVerdict(sessionId, finding.id, 'suspicious', 'a1');
    const updated = await huntService.setFindingVerdict(sessionId, finding.id, 'benign', 'a1');
    expect(updated.verdict).toBe('benign');
  });

  it('leerer String setzt Verdict zurück', async () => {
    const { huntService } = build();
    const { sessionId, finding } = await huntWithFinding(huntService);
    await huntService.setFindingVerdict(sessionId, finding.id, 'malicious', 'a1');
    const reset = await huntService.setFindingVerdict(sessionId, finding.id, '', 'a1');
    expect(reset.verdict).toBe('');
  });
});
