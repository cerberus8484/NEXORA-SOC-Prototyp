'use strict';

const { HuntService }              = require('../../src/threatHunting/services/HuntService');
const { InMemoryHuntRepository }   = require('../../src/threatHunting/repositories/InMemoryHuntRepository');
const { SESSION_STATUS }           = require('../../src/threatHunting/domain/ThreatHuntSession');
const { NotFoundError, ConflictError } = require('../../src/errors/AppError');

function makeService() {
  return new HuntService(new InMemoryHuntRepository());
}

const BASE_DTO = { analystId: 'analyst-1', targetHost: '192.168.241.50', scope: 'Lateral Movement' };

// ─── HuntService ──────────────────────────────────────────────────────────────

describe('HuntService — createSession', () => {
  it('erstellt Session und gibt ThreatHuntSession zurück', async () => {
    const svc     = makeService();
    const session = await svc.createSession(BASE_DTO);
    expect(session.status).toBe(SESSION_STATUS.PLANNED);
    expect(session.analystId).toBe('analyst-1');
  });

  it('schlägt fehl ohne analystId', async () => {
    const svc = makeService();
    await expect(svc.createSession({ targetHost: 'h1' })).rejects.toThrow(/analystId ist Pflichtfeld/);
  });

  it('schlägt fehl ohne targetHost', async () => {
    const svc = makeService();
    await expect(svc.createSession({ analystId: 'a1' })).rejects.toThrow(/targetHost ist Pflichtfeld/);
  });
});

describe('HuntService — getSession', () => {
  it('liefert Session zurück', async () => {
    const svc     = makeService();
    const created = await svc.createSession(BASE_DTO);
    const found   = await svc.getSession(created.id);
    expect(found.id).toBe(created.id);
  });

  it('wirft NotFoundError für unbekannte ID', async () => {
    const svc = makeService();
    await expect(svc.getSession('does-not-exist')).rejects.toThrow(NotFoundError);
  });
});

describe('HuntService — listSessions', () => {
  it('filtert nach ticketId', async () => {
    const svc = makeService();
    await svc.createSession({ ...BASE_DTO, ticketId: 'ticket-A' });
    await svc.createSession({ ...BASE_DTO, ticketId: 'ticket-B' });
    const results = await svc.listSessions({ ticketId: 'ticket-A' });
    expect(results.length).toBe(1);
    expect(results[0].ticketId).toBe('ticket-A');
  });

  it('filtert nach analystId', async () => {
    const svc = makeService();
    await svc.createSession({ ...BASE_DTO, analystId: 'analyst-X' });
    await svc.createSession({ ...BASE_DTO, analystId: 'analyst-Y' });
    const results = await svc.listSessions({ analystId: 'analyst-X' });
    expect(results.length).toBe(1);
  });
});

describe('HuntService — Lifecycle', () => {
  it('activateSession: planned → active', async () => {
    const svc     = makeService();
    const session = await svc.createSession(BASE_DTO);
    const updated = await svc.activateSession(session.id, 'analyst-1');
    expect(updated.status).toBe(SESSION_STATUS.ACTIVE);
    expect(updated.startedAt).toBeInstanceOf(Date);
  });

  it('completeSession: active → completed', async () => {
    const svc     = makeService();
    const session = await svc.createSession(BASE_DTO);
    await svc.activateSession(session.id, 'analyst-1');
    const updated = await svc.completeSession(session.id, 'analyst-1');
    expect(updated.status).toBe(SESSION_STATUS.COMPLETED);
    expect(updated.closedAt).toBeInstanceOf(Date);
  });

  it('failSession: active → failed mit Grund', async () => {
    const svc     = makeService();
    const session = await svc.createSession(BASE_DTO);
    await svc.activateSession(session.id, 'analyst-1');
    const updated = await svc.failSession(session.id, 'admin-1', 'Timeout beim Host');
    expect(updated.status).toBe(SESSION_STATUS.FAILED);
  });

  it('cancelSession: planned → cancelled', async () => {
    const svc     = makeService();
    const session = await svc.createSession(BASE_DTO);
    const updated = await svc.cancelSession(session.id, 'admin-1');
    expect(updated.status).toBe(SESSION_STATUS.CANCELLED);
    expect(updated.closedAt).toBeInstanceOf(Date);
  });

  it('cancelSession: active → cancelled', async () => {
    const svc     = makeService();
    const session = await svc.createSession(BASE_DTO);
    await svc.activateSession(session.id, 'analyst-1');
    const updated = await svc.cancelSession(session.id, 'admin-1');
    expect(updated.status).toBe(SESSION_STATUS.CANCELLED);
  });

  it('ungültiger Übergang wirft ConflictError', async () => {
    const svc     = makeService();
    const session = await svc.createSession(BASE_DTO);
    await svc.activateSession(session.id, 'analyst-1');
    await svc.completeSession(session.id, 'analyst-1');
    await expect(svc.activateSession(session.id, 'analyst-1')).rejects.toThrow(ConflictError);
  });

  it('activateSession auf unbekannte Session wirft NotFoundError', async () => {
    const svc = makeService();
    await expect(svc.activateSession('ghost-id', 'analyst-1')).rejects.toThrow(NotFoundError);
  });
});

describe('HuntService — addNote / getNotes', () => {
  it('Note wird hinzugefügt und zurückgegeben', async () => {
    const svc     = makeService();
    const session = await svc.createSession(BASE_DTO);
    const note    = await svc.addNote(session.id, { content: 'Verdächtiger Prozess', analystId: 'analyst-1' });
    expect(note.id).toBeTruthy();
    expect(note.content).toBe('Verdächtiger Prozess');
  });

  it('getNotes gibt alle Notizen zurück', async () => {
    const svc     = makeService();
    const session = await svc.createSession(BASE_DTO);
    await svc.addNote(session.id, { content: 'Notiz 1', analystId: 'a1' });
    await svc.addNote(session.id, { content: 'Notiz 2', analystId: 'a1' });
    const notes = await svc.getNotes(session.id);
    expect(notes.length).toBe(2);
  });

  it('addNote auf unbekannte Session wirft NotFoundError', async () => {
    const svc = makeService();
    await expect(svc.addNote('ghost', { content: 'x', analystId: 'a1' })).rejects.toThrow(NotFoundError);
  });
});

describe('HuntService — Read-Only Endpunkte', () => {
  it('getCommands / getArtifacts / getFindings geben leere Arrays zurück wenn keine Daten', async () => {
    const svc     = makeService();
    const session = await svc.createSession(BASE_DTO);

    const [cmds, arts, finds] = await Promise.all([
      svc.getCommands(session.id),
      svc.getArtifacts(session.id),
      svc.getFindings(session.id),
    ]);

    expect(cmds).toEqual([]);
    expect(arts).toEqual([]);
    expect(finds).toEqual([]);
  });

  it('getCommands auf unbekannte Session wirft NotFoundError', async () => {
    const svc = makeService();
    await expect(svc.getCommands('ghost')).rejects.toThrow(NotFoundError);
  });
});

describe('HuntService — Konstruktor', () => {
  it('wirft ohne Repository', () => {
    expect(() => new HuntService()).toThrow(/huntRepository ist Pflichtfeld/);
  });
});
