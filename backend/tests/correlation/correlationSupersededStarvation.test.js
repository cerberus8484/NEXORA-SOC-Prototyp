'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Starvation-Fix: „superseded" darf ein Ticket nicht dauerhaft OHNE Ergebnis lassen.
//
// Produktionsbefund (2026-08-01): Bei aktiv aggregierenden Tickets (Honeypot —
// im Sekundentakt neue Alerts) ändert sich `ticket.updatedAt`, WÄHREND der
// Korrelations-Job rechnet. Der Worker verwarf daraufhin sein fertiges Ergebnis
// („KEIN veraltetes Resultat schreiben"), der Trigger plante einen neuen Job —
// der wieder superseded wurde. Ergebnis: **50.478 von 50.599 Tickets (99,8 %)
// hatten NIE ein Resultat**, das Analysis-Deck fiel auf die flachen Ticketfelder
// zurück und der Commands-Tab zeigte „Noch keine Command-Evidence vorhanden",
// obwohl der Befehl im Roh-Alert (data.input) steht.
//
// Der Lesepfad ist auf veraltete Ergebnisse VORBEREITET: er vergleicht den
// inputHash und labelt sie ehrlich als `superseded`. Ein ehrlich gekennzeichnetes
// Ergebnis ist also allemal besser als ein dauerhaft leeres Deck.
//
// Regel: Existiert für das Ticket noch KEIN Resultat, wird das berechnete
// (mit seiner eigenen sourceRevision/inputHash getaggte) Resultat gespeichert.
// Existiert bereits eines, bleibt es beim bisherigen Verwerfen — ein alter Job
// darf ein neueres Resultat NIE verdrängen (Monotonie).
// ─────────────────────────────────────────────────────────────────────────

const { InMemoryCorrelationRepository } = require('../../src/repositories/InMemoryCorrelationRepository');
const { CorrelationWorker } = require('../../src/correlation/CorrelationWorker');
const { CorrelationJob, CorrelationResult } = require('../../src/correlation/correlationJobDomain');

const makeTicket = (id, rev, kind = 'alert') => ({ id, kind, updatedAt: rev, raw: `evt-${id}` });
const msg = (id) => ({ data: { correlationJobId: id } });

let repo; let engine; let tickets; let queue; let worker;

beforeEach(() => {
  repo = new InMemoryCorrelationRepository();
  engine = { correlate: jest.fn(() => ({ merged: true, process: { commandLine: 'netstat -tulpn' } })) };
  tickets = {
    getById:      jest.fn(async (id) => makeTicket(id, 'rev1')),
    findChildren: jest.fn(async () => []),
    // Revision wandert WÄHREND des Jobs weiter (aggregierendes Honeypot-Ticket).
    getRevision:  jest.fn(async () => 'rev2'),
  };
  queue = { registerWorker: jest.fn(async () => {}) };
  worker = new CorrelationWorker({ repo, queue, engine, tickets, queueName: 'correlation.process', maxRetries: 3 });
});

const seedJob = async ({ ticketId = 'T-1', sourceRevision = 'rev1' } = {}) => {
  const job = CorrelationJob.create({ ticketId, sourceRevision });
  await repo.createJob(job.toJSON());
  return job;
};

describe('CorrelationWorker — superseded ohne vorhandenes Resultat (Starvation)', () => {
  test('speichert das berechnete Resultat, statt das Deck leer zu lassen', async () => {
    const job = await seedJob();

    await worker.process(msg(job.id));

    const result = await repo.findLatestResultByTicket('T-1');
    expect(result).toBeTruthy();                                  // vorher: null → leeres Deck
    expect(result.result).toMatchObject({ process: { commandLine: 'netstat -tulpn' } });
    // Ehrlich getaggt mit der Revision, aus der gerechnet wurde → der Lesepfad
    // erkennt daran selbst, dass es `superseded` ist.
    expect(result.sourceRevision).toBe('rev1');
    expect(result.inputHash).toBe(job.inputHash);
  });

  test('Job bleibt als superseded gekennzeichnet (keine falsche current-Zusage)', async () => {
    const job = await seedJob();

    await worker.process(msg(job.id));

    const stored = await repo.findJobById(job.id);
    expect(stored.failureReason).toMatch(/superseded/);
  });

  test('überschreibt ein bereits vorhandenes Resultat NICHT (Monotonie)', async () => {
    // Bereits ein neueres Resultat vorhanden → alter Job darf es nicht verdrängen.
    const prior = new CorrelationResult({
      ticketId: 'T-1', jobId: 'older', inputHash: 'hash-neu', sourceRevision: 'rev2',
      engineVersion: 'v1', result: { merged: 'NEUER' }, evidenceRefs: [],
    });
    await repo.saveResult(prior.toJSON());

    const job = await seedJob();
    await worker.process(msg(job.id));

    const result = await repo.findLatestResultByTicket('T-1');
    expect(result.result).toEqual({ merged: 'NEUER' });            // unverändert
  });

  test('unveränderte Revision bleibt der normale Erfolgspfad (completed)', async () => {
    tickets.getRevision.mockResolvedValue('rev1');                 // nichts hat sich geändert
    const job = await seedJob();

    await worker.process(msg(job.id));

    const stored = await repo.findJobById(job.id);
    expect(stored.status).toBe('completed');
    expect(stored.resultReference).toBeTruthy();
  });
});
