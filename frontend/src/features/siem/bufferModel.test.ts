import { describe, test, expect } from 'vitest';
import { deriveBuffer, resolveBufferTile } from './bufferModel';

describe('deriveBuffer — Agent-Buffer-KPI', () => {
  test('null (SIEM nicht erreichbar) → muted "—", kein falsches OK', () => {
    expect(deriveBuffer(null)).toEqual({ value: '—', tone: 'muted', hint: 'SIEM nicht erreichbar', dot: false });
  });

  test('leere Liste → grün, alle Agents OK', () => {
    expect(deriveBuffer([])).toEqual({ value: 0, tone: 'success', hint: 'Alle Agents OK', dot: true });
  });

  test('Agents ohne Treffer zählen nicht als betroffen', () => {
    const r = deriveBuffer([{ name: 'WEC01', warn: 0, full: 0 }]);
    expect(r).toMatchObject({ value: 0, tone: 'success' });
  });

  test('nur 202-Warnungen → orange, Queue ~90% voll', () => {
    const r = deriveBuffer([{ name: 'OPNsense', warn: 4, full: 0 }]);
    expect(r).toEqual({ value: 1, tone: 'warning', hint: 'OPNsense · Queue ~90% voll', dot: true });
  });

  test('203 (geflutet) → rot, Events verworfen — schlägt reine Warnung', () => {
    const r = deriveBuffer([
      { name: 'OPNsense', warn: 9, full: 0 },
      { name: 'DC01', warn: 1, full: 1 },
    ]);
    expect(r).toEqual({ value: 2, tone: 'danger', hint: 'DC01 · Events verworfen', dot: true });
  });

  test('value = Anzahl betroffener Agents, nicht Summe der Treffer', () => {
    const r = deriveBuffer([
      { name: 'A', warn: 5, full: 0 },
      { name: 'B', warn: 3, full: 0 },
    ]);
    expect(r.value).toBe(2);
  });
});

describe('resolveBufferTile — Teilquelle: leer vs. deaktiviert vs. Fehler', () => {
  test('Abruf-Fehler → warning "nicht ladbar" (kein stilles OK/0)', () => {
    const r = resolveBufferTile({ kind: 'error' });
    expect(r.tone).toBe('warning');
    expect(r.hint).toBe('Telemetrie nicht ladbar');
    expect(r.value).not.toBe(0);
  });

  test('deaktiviert → neutraler Leerzustand "—", nicht aktiviert', () => {
    expect(resolveBufferTile({ kind: 'disabled' })).toEqual({
      value: '—', tone: 'muted', hint: 'Telemetrie nicht aktiviert', dot: false,
    });
  });

  test('ok mit leerer Liste → grün, alle Agents OK (echte Daten)', () => {
    expect(resolveBufferTile({ kind: 'ok', bufferAgents: [] })).toEqual({
      value: 0, tone: 'success', hint: 'Alle Agents OK', dot: true,
    });
  });

  test('ok mit geflutetem Agent → rot (delegiert an deriveBuffer)', () => {
    const r = resolveBufferTile({ kind: 'ok', bufferAgents: [{ name: 'DC01', warn: 0, full: 1 }] });
    expect(r.tone).toBe('danger');
  });
});
