import { describe, it, expect } from 'vitest';
import { appendNote, buildKiNoteText } from './kiNote';

describe('appendNote', () => {
  const at = new Date('2026-06-27T09:30:00Z');

  it('gibt vorhandene Notizen unverändert zurück, wenn nichts hinzugefügt wird', () => {
    expect(appendNote('alt', '   ', { label: 'X', at })).toBe('alt');
  });

  it('setzt bei leeren Notizen keinen führenden Trenner', () => {
    const out = appendNote('', 'neuer Text', { label: 'KI', at });
    expect(out.startsWith('— KI')).toBe(true);
    expect(out).toContain('neuer Text');
  });

  it('hängt mit Leerzeile + Herkunftszeile an vorhandene Notizen an', () => {
    const out = appendNote('Bestehende Notiz', 'Zusatz', { label: 'KI', at });
    expect(out).toBe('Bestehende Notiz\n\n— KI (2026-06-27 09:30) —\nZusatz');
  });

  it('trimmt den Zusatz', () => {
    const out = appendNote('', '  Zusatz  ', { label: 'KI', at });
    expect(out.endsWith('Zusatz')).toBe(true);
    expect(out).not.toContain('  Zusatz');
  });
});

describe('buildKiNoteText', () => {
  it('kombiniert Verdict und Assessment', () => {
    expect(buildKiNoteText({ verdict: 'malicious', assessment: 'Sieht böse aus.' }))
      .toBe('Verdict: malicious\nSieht böse aus.');
  });

  it('liefert nur das Assessment, wenn kein Verdict da ist', () => {
    expect(buildKiNoteText({ assessment: 'Nur Text' })).toBe('Nur Text');
  });

  it('liefert leeren String, wenn nichts da ist', () => {
    expect(buildKiNoteText({})).toBe('');
  });
});
