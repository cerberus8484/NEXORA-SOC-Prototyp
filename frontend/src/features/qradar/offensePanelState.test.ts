import { describe, test, expect } from 'vitest';
import { resolvePanelState } from './offensePanelState';

describe('resolvePanelState — leer vs. Fehler sauber trennen', () => {
  test('laden hat Vorrang vor allem', () => {
    expect(resolvePanelState({ loading: true, hasError: true, itemCount: 0 })).toBe('loading');
  });

  test('Fehler nach dem Laden → error (NICHT empty)', () => {
    expect(resolvePanelState({ loading: false, hasError: true, itemCount: 0 })).toBe('error');
  });

  test('kein Fehler, keine Einträge → empty (echter Leerzustand)', () => {
    expect(resolvePanelState({ loading: false, hasError: false, itemCount: 0 })).toBe('empty');
  });

  test('kein Fehler, Einträge vorhanden → ready', () => {
    expect(resolvePanelState({ loading: false, hasError: false, itemCount: 3 })).toBe('ready');
  });

  test('Fehler schlägt vorhandene (veraltete) Einträge → error', () => {
    expect(resolvePanelState({ loading: false, hasError: true, itemCount: 5 })).toBe('error');
  });
});
