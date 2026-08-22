'use strict';

const { HuntService }            = require('../../src/threatHunting/services/HuntService');
const { InMemoryHuntRepository } = require('../../src/threatHunting/repositories/InMemoryHuntRepository');
const { TicketService }          = require('../../src/services/TicketService');
const { InMemoryTicketRepository } = require('../../src/repositories/InMemoryTicketRepository');
const { HuntTicketLink, LINK_SOURCE_TYPE } = require('../../src/threatHunting/domain/HuntTicketLink');
const { NotFoundError }          = require('../../src/errors/AppError');

const SESSION_DTO  = { analystId: 'analyst-1', targetHost: '10.0.0.5', scope: 'Hunt' };
const FINDING_DTO  = { title: 'Reverse Shell', severity: 'high', confidence: 'high', analystId: 'analyst-1' };
const ARTIFACT_DTO = { type: 'ioc', value: '185.220.101.5', analystId: 'analyst-1' };

async function setup() {
  const ticketService = new TicketService(new InMemoryTicketRepository());
  const huntService   = new HuntService(new InMemoryHuntRepository(), { ticketService });
  const ticket        = await ticketService.create({ title: 'SOC Ticket', priority: 'high' });
  return { ticketService, huntService, ticket };
}

// ─── HuntTicketLink Domain ────────────────────────────────────────────────────

describe('HuntTicketLink Domain', () => {
  it('erstellt Link mit Dedup-Key', () => {
    const link = HuntTicketLink.create({
      huntSessionId: 's1', ticketId: 't1',
      sourceType: LINK_SOURCE_TYPE.FINDING, sourceId: 'f1', linkedBy: 'a1',
    });
    expect(link.deduplicationKey).toBe('s1:finding:f1:t1');
    expect(link.linkedAt).toBeInstanceOf(Date);
  });

  it('schlägt fehl ohne ticketId', () => {
    expect(() => HuntTicketLink.create({ huntSessionId: 's1', sourceType: 'finding', sourceId: 'f1', linkedBy: 'a1' }))
      .toThrow(/ticketId ist Pflichtfeld/);
  });

  it('schlägt fehl bei ungültigem sourceType', () => {
    expect(() => HuntTicketLink.create({ huntSessionId: 's1', ticketId: 't1', sourceType: 'bogus', sourceId: 'f1', linkedBy: 'a1' }))
      .toThrow(/Ungültiger sourceType/);
  });
});

// ─── linkFindingToTicket ──────────────────────────────────────────────────────

describe('HuntService — linkFindingToTicket', () => {
  it('verlinkt Finding und setzt ticketId auf dem Finding', async () => {
    const { huntService, ticket } = await setup();
    const session = await huntService.createSession(SESSION_DTO);
    const finding = await huntService.addFinding(session.id, FINDING_DTO);

    const link = await huntService.linkFindingToTicket(session.id, finding.id, ticket.id, 'analyst-1');
    expect(link.sourceType).toBe(LINK_SOURCE_TYPE.FINDING);
    expect(link.ticketId).toBe(ticket.id);
    expect(link.summary).toBe('Reverse Shell');

    const reloaded = await huntService.getFinding(session.id, finding.id);
    expect(reloaded.ticketId).toBe(ticket.id);
  });

  it('ist idempotent — doppelter Link erzeugt keinen zweiten Datensatz', async () => {
    const { huntService, ticket } = await setup();
    const session = await huntService.createSession(SESSION_DTO);
    const finding = await huntService.addFinding(session.id, FINDING_DTO);

    await huntService.linkFindingToTicket(session.id, finding.id, ticket.id, 'analyst-1');
    await huntService.linkFindingToTicket(session.id, finding.id, ticket.id, 'analyst-1');

    const links = await huntService.getTicketLinks(session.id);
    expect(links.length).toBe(1);
  });

  it('wirft NotFoundError bei unbekanntem Finding', async () => {
    const { huntService, ticket } = await setup();
    const session = await huntService.createSession(SESSION_DTO);
    await expect(huntService.linkFindingToTicket(session.id, 'ghost', ticket.id, 'a1'))
      .rejects.toThrow(NotFoundError);
  });

  it('wirft NotFoundError bei unbekanntem Ticket', async () => {
    const { huntService } = await setup();
    const session = await huntService.createSession(SESSION_DTO);
    const finding = await huntService.addFinding(session.id, FINDING_DTO);
    await expect(huntService.linkFindingToTicket(session.id, finding.id, 'no-such-ticket', 'a1'))
      .rejects.toThrow(NotFoundError);
  });
});

// ─── linkArtifactToTicket ─────────────────────────────────────────────────────

describe('HuntService — linkArtifactToTicket', () => {
  it('verlinkt Artifact mit Ticket', async () => {
    const { huntService, ticket } = await setup();
    const session  = await huntService.createSession(SESSION_DTO);
    const artifact = await huntService.addArtifact(session.id, ARTIFACT_DTO);

    const link = await huntService.linkArtifactToTicket(session.id, artifact.id, ticket.id, 'analyst-1');
    expect(link.sourceType).toBe(LINK_SOURCE_TYPE.ARTIFACT);
    expect(link.ticketId).toBe(ticket.id);
    expect(link.summary).toContain('185.220.101.5');
  });

  it('idempotent bei doppeltem Artifact-Link', async () => {
    const { huntService, ticket } = await setup();
    const session  = await huntService.createSession(SESSION_DTO);
    const artifact = await huntService.addArtifact(session.id, ARTIFACT_DTO);
    await huntService.linkArtifactToTicket(session.id, artifact.id, ticket.id, 'a1');
    await huntService.linkArtifactToTicket(session.id, artifact.id, ticket.id, 'a1');
    const links = await huntService.getTicketLinks(session.id);
    expect(links.length).toBe(1);
  });

  it('wirft NotFoundError bei unbekanntem Artifact', async () => {
    const { huntService, ticket } = await setup();
    const session = await huntService.createSession(SESSION_DTO);
    await expect(huntService.linkArtifactToTicket(session.id, 'ghost', ticket.id, 'a1'))
      .rejects.toThrow(NotFoundError);
  });
});

// ─── linkSummaryToTicket ──────────────────────────────────────────────────────

describe('HuntService — linkSummaryToTicket', () => {
  it('verlinkt Session-Summary mit Ticket', async () => {
    const { huntService, ticket } = await setup();
    const session = await huntService.createSession(SESSION_DTO);
    await huntService.addFinding(session.id, FINDING_DTO);
    await huntService.addArtifact(session.id, ARTIFACT_DTO);

    const link = await huntService.linkSummaryToTicket(session.id, ticket.id, 'analyst-1');
    expect(link.sourceType).toBe(LINK_SOURCE_TYPE.SUMMARY);
    expect(link.sourceId).toBe(session.id);
    expect(link.summary).toContain('Findings: 1');
    expect(link.summary).toContain(session.targetHost);
  });

  it('idempotent bei doppelter Summary-Verlinkung', async () => {
    const { huntService, ticket } = await setup();
    const session = await huntService.createSession(SESSION_DTO);
    await huntService.linkSummaryToTicket(session.id, ticket.id, 'a1');
    await huntService.linkSummaryToTicket(session.id, ticket.id, 'a1');
    const links = await huntService.getTicketLinks(session.id);
    expect(links.length).toBe(1);
  });
});

// ─── getTicketLinks + Mehrfach-Links ──────────────────────────────────────────

describe('HuntService — getTicketLinks', () => {
  it('listet Finding-, Artifact- und Summary-Links zusammen', async () => {
    const { huntService, ticket } = await setup();
    const session  = await huntService.createSession(SESSION_DTO);
    const finding  = await huntService.addFinding(session.id, FINDING_DTO);
    const artifact = await huntService.addArtifact(session.id, ARTIFACT_DTO);

    await huntService.linkFindingToTicket(session.id, finding.id, ticket.id, 'a1');
    await huntService.linkArtifactToTicket(session.id, artifact.id, ticket.id, 'a1');
    await huntService.linkSummaryToTicket(session.id, ticket.id, 'a1');

    const links = await huntService.getTicketLinks(session.id);
    expect(links.length).toBe(3);
    const types = links.map(l => l.sourceType).sort();
    expect(types).toEqual(['artifact', 'finding', 'summary']);
  });
});

// ─── Ohne ticketService (isolierte Unit-Tests) ────────────────────────────────

describe('HuntService — ohne ticketService', () => {
  it('überspringt Ticket-Existenzprüfung wenn kein ticketService injiziert', async () => {
    const huntService = new HuntService(new InMemoryHuntRepository());   // kein ticketService
    const session = await huntService.createSession(SESSION_DTO);
    const finding = await huntService.addFinding(session.id, FINDING_DTO);
    const link = await huntService.linkFindingToTicket(session.id, finding.id, 'fake-ticket', 'a1');
    expect(link.ticketId).toBe('fake-ticket');
  });
});
