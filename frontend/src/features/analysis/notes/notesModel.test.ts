import { describe, it, expect } from 'vitest';
import { parseNotes, serializeNote, appendNote, notePreview } from './notesModel';

describe('serializeNote / appendNote', () => {
  it('serialisiert einen lesbaren, parsbaren Block', () => {
    const block = serializeNote({ type: 'investigation', author: 'Alex Smith', at: '2025-05-02T10:48:00Z', tags: ['user-activity', 'mailbox-access'], body: 'Suspicious sign-in.' });
    expect(block).toContain('--- NOTE | investigation | Alex Smith | 2025-05-02T10:48:00Z | user-activity, mailbox-access ---');
    expect(block).toContain('Suspicious sign-in.');
  });
  it('hängt mit Abstand an bestehende Notizen an', () => {
    const merged = appendNote('Alte Freitextnotiz', { type: 'triage', author: 'You', at: 't', tags: [], body: 'Neu' });
    expect(merged.startsWith('Alte Freitextnotiz')).toBe(true);
    expect(merged).toContain('--- NOTE | triage |');
  });
});

describe('parseNotes', () => {
  it('liest neue Blöcke mit Typ/Autor/Zeit/Tags', () => {
    const raw = appendNote('', { type: 'investigation', author: 'Alex Smith', at: '2025-05-02T10:48:00Z', tags: ['user-activity'], body: 'Observed suspicious sign-in.' });
    const notes = parseNotes(raw);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: 'investigation', author: 'Alex Smith', at: '2025-05-02T10:48:00Z', tags: ['user-activity'] });
    expect(notes[0].body).toBe('Observed suspicious sign-in.');
  });

  it('ist rückwärtskompatibel mit Freitext + Customer-/Case-Note-Blöcken', () => {
    const raw = 'Erste interne Notiz.\n\n--- Customer Note (22.06.2026, 20:40) ---\nKunde informiert.\n\n--- Case Note (23.06.2026) ---\nReport angehängt.';
    const notes = parseNotes(raw);
    expect(notes.map((n) => n.type)).toEqual(['note', 'customer', 'note']);
    expect(notes[0].body).toBe('Erste interne Notiz.');
    expect(notes[1].body).toBe('Kunde informiert.');
    expect(notes[1].at).toBe('22.06.2026, 20:40');
  });

  it('ist leer bei leerem Feld', () => {
    expect(parseNotes('')).toHaveLength(0);
    expect(parseNotes('   ')).toHaveLength(0);
  });

  it('Round-Trip: append → parse erhält Reihenfolge (älteste zuerst)', () => {
    let raw = '';
    raw = appendNote(raw, { type: 'triage', author: 'You', at: '2025-05-02T09:57:00Z', tags: [], body: 'Ersttriage.' });
    raw = appendNote(raw, { type: 'investigation', author: 'Alex', at: '2025-05-02T10:48:00Z', tags: ['x'], body: 'Folgeanalyse.' });
    const notes = parseNotes(raw);
    expect(notes.map((n) => n.body)).toEqual(['Ersttriage.', 'Folgeanalyse.']);
  });
});

describe('notePreview', () => {
  it('liefert die erste Zeile gekürzt', () => {
    expect(notePreview('Kurz')).toBe('Kurz');
    expect(notePreview('a'.repeat(200)).endsWith('…')).toBe(true);
    expect(notePreview('Zeile 1\nZeile 2')).toBe('Zeile 1');
  });
});
