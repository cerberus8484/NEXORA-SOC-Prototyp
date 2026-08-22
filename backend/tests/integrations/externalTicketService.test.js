'use strict';

// ── Fokus-Tests für ExternalTicketService.exportTicket() ─────────────────────
// Insbesondere die Audit-Resilienz: ein fehlschlagender Audit-Write darf den
// Export-Ausgang (Erfolg ODER Original-Fehler) niemals überlagern (_writeAudit).

const { ExternalTicketService } = require('../../src/integrations/ExternalTicketService');
const { auditService } = require('../../src/services/AuditService');
const { Ticket } = require('../../src/domain/Ticket');

const TICKET = new Ticket({
  id: 't-1', ticketNr: 'INC-1', title: 'Export-Test',
  priority: 'high', status: 'progress', source: 'manual',
});

function fakeAdapter(over = {}) {
  return {
    mapToExternal: () => ({ short_description: 'x' }),
    validateExternalPayload: () => {},
    async sendTicket() { return { externalId: 'E1', externalRef: 'R1', externalUrl: 'https://ext/E1' }; },
    ...over,
  };
}

function fakeLinkRepo() {
  const saved = [];
  return { _saved: saved, save: async (link) => { saved.push(link); return link; } };
}

describe('ExternalTicketService.exportTicket', () => {
  afterEach(() => jest.restoreAllMocks());

  test('Erfolg: exported, Link gespeichert, SUCCESS-Audit mit Actor', async () => {
    const repo = fakeLinkRepo();
    const writeSpy = jest.spyOn(auditService, 'write').mockResolvedValue({});
    const svc = new ExternalTicketService({ servicenow: fakeAdapter() }, repo);

    const res = await svc.exportTicket(TICKET, 'servicenow', { actorUserId: 'u1', actorLabel: 'a@b' });

    expect(res.status).toBe('exported');
    expect(res.externalId).toBe('E1');
    expect(repo._saved).toHaveLength(1);
    expect(writeSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXTERNAL_TICKET_EXPORT_SUCCESS', actorUserId: 'u1', actorLabel: 'a@b',
    }));
  });

  test('Adapter-Fehler: rethrow + FAILED-Audit', async () => {
    const writeSpy = jest.spyOn(auditService, 'write').mockResolvedValue({});
    const svc = new ExternalTicketService(
      { servicenow: fakeAdapter({ sendTicket: async () => { throw new Error('send boom'); } }) },
      fakeLinkRepo(),
    );

    await expect(svc.exportTicket(TICKET, 'servicenow')).rejects.toThrow('send boom');
    expect(writeSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXTERNAL_TICKET_EXPORT_FAILED' }));
  });

  test('Audit-Fehler im Erfolgspfad überlagert NICHT: Export bleibt exported', async () => {
    jest.spyOn(auditService, 'write').mockRejectedValue(new Error('DB down'));
    const svc = new ExternalTicketService({ servicenow: fakeAdapter() }, fakeLinkRepo());

    const res = await svc.exportTicket(TICKET, 'servicenow');

    expect(res.status).toBe('exported'); // Audit-Fehler geschluckt, kein 500/Retry → kein Doppel-Ticket
  });

  test('Audit-Fehler im Fehlerpfad überlagert NICHT: Original-Fehler wird geworfen', async () => {
    jest.spyOn(auditService, 'write').mockRejectedValue(new Error('DB down'));
    const svc = new ExternalTicketService(
      { servicenow: fakeAdapter({ sendTicket: async () => { throw new Error('send boom'); } }) },
      fakeLinkRepo(),
    );

    // 'send boom' (Original), NICHT 'DB down' (Audit)
    await expect(svc.exportTicket(TICKET, 'servicenow')).rejects.toThrow('send boom');
  });

  test('FAILED-Audit reason wird auf 200 Zeichen begrenzt (externe Strings)', async () => {
    const writeSpy = jest.spyOn(auditService, 'write').mockResolvedValue({});
    const longMsg = 'E'.repeat(500);
    const svc = new ExternalTicketService(
      { servicenow: fakeAdapter({ sendTicket: async () => { throw new Error(longMsg); } }) },
      fakeLinkRepo(),
    );

    await expect(svc.exportTicket(TICKET, 'servicenow')).rejects.toThrow();

    const failedCall = writeSpy.mock.calls.find((c) => c[0].action === 'EXTERNAL_TICKET_EXPORT_FAILED');
    expect(failedCall[0].metadata.reason).toHaveLength(200);
  });

  test('unbekanntes System: NotFoundError + FAILED-Audit (Fehlversuch hinterlässt Spur)', async () => {
    const writeSpy = jest.spyOn(auditService, 'write').mockResolvedValue({});
    const svc = new ExternalTicketService({ servicenow: fakeAdapter() }, fakeLinkRepo());

    await expect(svc.exportTicket(TICKET, 'unknown')).rejects.toThrow();
    expect(writeSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXTERNAL_TICKET_EXPORT_FAILED' }));
  });
});
