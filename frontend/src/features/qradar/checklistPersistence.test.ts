import { describe, it, expect, vi } from 'vitest';
import { loadChecks, saveChecks, checklistKey, emptyChecks, type KeyValueStore } from './checklistPersistence';

/** In-Memory-Store für deterministische Tests. */
function memStore(seed: Record<string, string> = {}): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe('checklistKey', () => {
  it('baut einen offense-spezifischen Key', () => {
    expect(checklistKey(42)).toBe('nexora.qradar.checklist.42');
    expect(checklistKey('abc')).toBe('nexora.qradar.checklist.abc');
  });
});

describe('loadChecks', () => {
  it('liefert bei fehlendem Wert lauter ungehakte Einträge', () => {
    expect(loadChecks(memStore(), 1, 8)).toEqual(emptyChecks(8));
  });

  it('lädt gespeicherte Werte', () => {
    const store = memStore({ [checklistKey(7)]: JSON.stringify([true, false, true]) });
    expect(loadChecks(store, 7, 3)).toEqual([true, false, true]);
  });

  it('ist robust gegen korruptes JSON (kein Crash, Fallback)', () => {
    const store = memStore({ [checklistKey(7)]: '{ kaputt' });
    expect(loadChecks(store, 7, 4)).toEqual(emptyChecks(4));
  });

  it('ignoriert falschen Typ (kein Array)', () => {
    const store = memStore({ [checklistKey(7)]: JSON.stringify({ a: 1 }) });
    expect(loadChecks(store, 7, 3)).toEqual(emptyChecks(3));
  });

  it('schneidet/füllt bei Längen-Drift auf die gewünschte Länge', () => {
    const store = memStore({ [checklistKey(7)]: JSON.stringify([true, true, true, true, true]) });
    expect(loadChecks(store, 7, 3)).toEqual([true, true, true]);          // gekürzt
    const store2 = memStore({ [checklistKey(7)]: JSON.stringify([true]) });
    expect(loadChecks(store2, 7, 3)).toEqual([true, false, false]);       // aufgefüllt
  });

  it('wertet nur strikt true als gehakt (truthy-Schutz)', () => {
    const store = memStore({ [checklistKey(7)]: JSON.stringify([1, 'x', null]) });
    expect(loadChecks(store, 7, 3)).toEqual([false, false, false]);
  });

  it('liefert Fallback, wenn kein Store vorhanden ist', () => {
    expect(loadChecks(null, 1, 2)).toEqual([false, false]);
  });

  it('schluckt getItem-Fehler und liefert Fallback', () => {
    const throwing: KeyValueStore = {
      getItem: () => { throw new Error('no access'); },
      setItem: () => {}, removeItem: () => {},
    };
    expect(loadChecks(throwing, 1, 2)).toEqual([false, false]);
  });
});

describe('saveChecks', () => {
  it('speichert den Zustand abrufbar', () => {
    const store = memStore();
    saveChecks(store, 9, [true, false, true]);
    expect(loadChecks(store, 9, 3)).toEqual([true, false, true]);
  });

  it('normalisiert nicht-strikte Werte zu false (nur true bleibt true)', () => {
    const store = memStore();
    // @ts-expect-error — bewusst unsaubere Eingabe für den Normalisierungstest
    saveChecks(store, 9, [true, 1, 'x']);
    // saveChecks normalisiert strikt: nur echtes `true` bleibt true.
    expect(loadChecks(store, 9, 3)).toEqual([true, false, false]);
  });

  it('ohne Store passiert nichts (kein Crash)', () => {
    expect(() => saveChecks(null, 9, [true])).not.toThrow();
  });

  it('schluckt setItem-Fehler (z. B. Quota) ohne zu werfen', () => {
    const throwing: KeyValueStore = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
      removeItem: () => {},
    };
    const spy = vi.spyOn(throwing, 'setItem');
    expect(() => saveChecks(throwing, 9, [true])).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });
});
