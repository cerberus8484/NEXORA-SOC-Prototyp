import { describe, it, expect } from 'vitest';
import { emptyTiEntry, isTiEntryFilled, type TiEntry } from './tiEntry';

describe('emptyTiEntry', () => {
  it('liefert eine frische Struktur mit ID und leeren Feldern', () => {
    const e = emptyTiEntry();
    expect(e.id).toBeTruthy();
    expect(typeof e.id).toBe('string');
    expect(e.category).toBe('');
    expect(e.actor).toBe('');
    expect(e.malware).toBe('');
    expect(e.confidence).toBe('');
  });

  it('vergibt bei jedem Aufruf eine neue, eindeutige ID', () => {
    const a = emptyTiEntry();
    const b = emptyTiEntry();
    expect(a.id).not.toBe(b.id);
  });
});

describe('isTiEntryFilled', () => {
  it('ist false für einen komplett leeren Eintrag', () => {
    expect(isTiEntryFilled(emptyTiEntry())).toBe(false);
  });

  it('ist true sobald ein einzelnes Feld gefüllt ist', () => {
    const fields: (keyof Omit<TiEntry, 'id'>)[] = ['category', 'actor', 'malware', 'confidence'];
    for (const field of fields) {
      const e: TiEntry = { ...emptyTiEntry(), [field]: 'x' };
      expect(isTiEntryFilled(e)).toBe(true);
    }
  });

  it('ist true für einen voll gefüllten Eintrag', () => {
    const e: TiEntry = { id: 'id-1', category: 'Execution', actor: 'APT29', malware: 'Cobalt Strike', confidence: 'High' };
    expect(isTiEntryFilled(e)).toBe(true);
  });

  it('ignoriert die ID — eine ID allein zählt nicht als „gefüllt"', () => {
    const e: TiEntry = { id: 'nur-eine-id', category: '', actor: '', malware: '', confidence: '' };
    expect(isTiEntryFilled(e)).toBe(false);
  });
});
