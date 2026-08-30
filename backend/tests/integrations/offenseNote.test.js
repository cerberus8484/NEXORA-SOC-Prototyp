'use strict';

/**
 * Tests — OffenseNote Domain + InMemoryOffenseNoteRepository
 *
 * TDD RED → GREEN
 * Testet:
 *   - OffenseNote.create() Pflichtfeld-Validierung
 *   - OffenseNote.toJSON() Ausgabe-Form
 *   - InMemoryOffenseNoteRepository: add / listByOffense / chronologische Reihenfolge
 */

const { OffenseNote } = require('../../src/integrations/adapters/qradar/OffenseNote');
const { InMemoryOffenseNoteRepository } = require('../../src/integrations/adapters/qradar/InMemoryOffenseNoteRepository');

// ── OffenseNote Domain ──────────────────────────────────────────────────────

describe('OffenseNote.create()', () => {
  test('erzeugt gültige Notiz mit allen Feldern', () => {
    const note = OffenseNote.create({
      offenseId: '42',
      content:   'Analyst-Notiz zur Offense',
      author:    'analyst@test.soc',
    });
    expect(note.id).toBeTruthy();
    expect(note.offenseId).toBe('42');
    expect(note.content).toBe('Analyst-Notiz zur Offense');
    expect(note.author).toBe('analyst@test.soc');
    expect(note.createdAt).toBeInstanceOf(Date);
  });

  test('trimmt content und author', () => {
    const note = OffenseNote.create({
      offenseId: '42',
      content:   '  Notiz mit Leerzeichen  ',
      author:    '  analyst@test.soc  ',
    });
    expect(note.content).toBe('Notiz mit Leerzeichen');
    expect(note.author).toBe('analyst@test.soc');
  });

  test('jede Instanz bekommt eine eindeutige ID', () => {
    const a = OffenseNote.create({ offenseId: '1', content: 'A', author: 'x' });
    const b = OffenseNote.create({ offenseId: '1', content: 'B', author: 'x' });
    expect(a.id).not.toBe(b.id);
  });

  test('wirft Fehler wenn offenseId fehlt', () => {
    expect(() => OffenseNote.create({ offenseId: '', content: 'x', author: 'a' }))
      .toThrow('offenseId');
  });

  test('wirft Fehler wenn offenseId nur Whitespace ist', () => {
    expect(() => OffenseNote.create({ offenseId: '   ', content: 'x', author: 'a' }))
      .toThrow('offenseId');
  });

  test('wirft Fehler wenn content fehlt', () => {
    expect(() => OffenseNote.create({ offenseId: '42', content: '', author: 'a' }))
      .toThrow('content');
  });

  test('wirft Fehler wenn content nur Whitespace ist', () => {
    expect(() => OffenseNote.create({ offenseId: '42', content: '   ', author: 'a' }))
      .toThrow('content');
  });

  test('wirft Fehler wenn content länger als 5000 Zeichen ist', () => {
    const lang = 'x'.repeat(5001);
    expect(() => OffenseNote.create({ offenseId: '42', content: lang, author: 'a' }))
      .toThrow('content');
  });

  test('akzeptiert content mit exakt 5000 Zeichen', () => {
    const maxContent = 'x'.repeat(5000);
    const note = OffenseNote.create({ offenseId: '42', content: maxContent, author: 'a' });
    expect(note.content.length).toBe(5000);
  });

  test('wirft Fehler wenn author fehlt', () => {
    expect(() => OffenseNote.create({ offenseId: '42', content: 'x', author: '' }))
      .toThrow('author');
  });

  test('wirft Fehler bei null-Werten', () => {
    expect(() => OffenseNote.create({ offenseId: null, content: 'x', author: 'a' }))
      .toThrow();
    expect(() => OffenseNote.create({ offenseId: '42', content: null, author: 'a' }))
      .toThrow();
  });
});

describe('OffenseNote.toJSON()', () => {
  test('liefert flaches Objekt mit ISO-Datum', () => {
    const note = OffenseNote.create({
      offenseId: '99',
      content:   'Test',
      author:    'u@soc',
    });
    const json = note.toJSON();
    expect(json).toEqual({
      id:        note.id,
      offenseId: '99',
      content:   'Test',
      author:    'u@soc',
      createdAt: note.createdAt.toISOString(),
    });
  });

  test('createdAt ist ISO-String (String, kein Date-Objekt)', () => {
    const note = OffenseNote.create({ offenseId: '1', content: 'x', author: 'a' });
    expect(typeof note.toJSON().createdAt).toBe('string');
  });
});

describe('OffenseNote.fromPersistence()', () => {
  test('rekonstruiert Objekt aus Rohdaten', () => {
    const raw = {
      id:        'fixed-uuid',
      offenseId: '42',
      content:   'Gespeichert',
      author:    'user@soc',
      createdAt: new Date('2026-06-14T10:00:00Z'),
    };
    const note = OffenseNote.fromPersistence(raw);
    expect(note.id).toBe('fixed-uuid');
    expect(note.content).toBe('Gespeichert');
    expect(note.createdAt).toBeInstanceOf(Date);
  });
});

// ── InMemoryOffenseNoteRepository ───────────────────────────────────────────

describe('InMemoryOffenseNoteRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new InMemoryOffenseNoteRepository();
  });

  test('add() gibt die Notiz zurück', async () => {
    const note = OffenseNote.create({ offenseId: '1', content: 'Test', author: 'a' });
    const saved = await repo.add(note);
    expect(saved.id).toBe(note.id);
    expect(saved.content).toBe('Test');
  });

  test('listByOffense() gibt leere Liste zurück wenn keine Notizen vorhanden', async () => {
    const notes = await repo.listByOffense('99');
    expect(notes).toEqual([]);
  });

  test('listByOffense() gibt nur Notizen der angegebenen Offense zurück', async () => {
    const n1 = OffenseNote.create({ offenseId: '10', content: 'Für Offense 10', author: 'a' });
    const n2 = OffenseNote.create({ offenseId: '20', content: 'Für Offense 20', author: 'a' });
    await repo.add(n1);
    await repo.add(n2);
    const result = await repo.listByOffense('10');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Für Offense 10');
  });

  test('listByOffense() sortiert chronologisch (älteste zuerst)', async () => {
    // Füge Notizen in umgekehrter zeitlicher Reihenfolge ein
    const old = OffenseNote.fromPersistence({
      id: 'old', offenseId: '5', content: 'Alte Notiz', author: 'a',
      createdAt: new Date('2026-06-01T10:00:00Z'),
    });
    const neu = OffenseNote.fromPersistence({
      id: 'new', offenseId: '5', content: 'Neue Notiz', author: 'a',
      createdAt: new Date('2026-06-14T10:00:00Z'),
    });
    await repo.add(neu); // neue zuerst einfügen
    await repo.add(old); // alte danach
    const result = await repo.listByOffense('5');
    expect(result[0].content).toBe('Alte Notiz');
    expect(result[1].content).toBe('Neue Notiz');
  });

  test('mehrere Notizen zur selben Offense werden alle zurückgegeben', async () => {
    for (let i = 0; i < 3; i++) {
      await repo.add(OffenseNote.create({ offenseId: '7', content: `Notiz ${i}`, author: 'a' }));
    }
    const result = await repo.listByOffense('7');
    expect(result).toHaveLength(3);
  });

  test('Notizen isoliert nach offenseId — andere Offenses bleiben unberührt', async () => {
    await repo.add(OffenseNote.create({ offenseId: 'A', content: 'x', author: 'a' }));
    await repo.add(OffenseNote.create({ offenseId: 'B', content: 'y', author: 'a' }));
    expect(await repo.listByOffense('A')).toHaveLength(1);
    expect(await repo.listByOffense('B')).toHaveLength(1);
    expect(await repo.listByOffense('C')).toHaveLength(0);
  });
});
