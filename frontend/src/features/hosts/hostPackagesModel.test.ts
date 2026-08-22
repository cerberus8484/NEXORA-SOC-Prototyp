import { describe, test, expect } from 'vitest';
import {
  initialPackagesState,
  nextQuery,
  startLoad,
  applyResponse,
  applyError,
  applySearch,
  hasMore,
  PACKAGES_PAGE_SIZE,
  type HostPackage,
  type PackagesResponse,
} from './hostPackagesModel';

const pkg = (name: string): HostPackage => ({
  name,
  version: '1.0',
  vendor: 'ACME',
  architecture: 'x86_64',
});

const okRes = (data: HostPackage[], total: number): PackagesResponse => ({
  enabled: true,
  data,
  total,
});

describe('initialPackagesState', () => {
  test('startet idle, leer, ohne Suche', () => {
    const s = initialPackagesState();
    expect(s.phase).toBe('idle');
    expect(s.items).toEqual([]);
    expect(s.total).toBe(0);
    expect(s.search).toBe('');
    expect(s.offset).toBe(0);
  });
});

describe('nextQuery', () => {
  test('leitet limit/offset/search aus dem State ab', () => {
    const s = { ...initialPackagesState(), offset: 50, search: 'ssh' };
    expect(nextQuery(s)).toEqual({ limit: PACKAGES_PAGE_SIZE, offset: 50, search: 'ssh' });
  });
});

describe('startLoad', () => {
  test('reset leert Liste und Offset und setzt loading', () => {
    const s = applyResponse(initialPackagesState(), okRes([pkg('a')], 1), false);
    const next = startLoad(s, true);
    expect(next.phase).toBe('loading');
    expect(next.items).toEqual([]);
    expect(next.offset).toBe(0);
  });

  test('ohne reset bleibt die bisherige Liste erhalten (mehr laden)', () => {
    const s = applyResponse(initialPackagesState(), okRes([pkg('a')], 5), false);
    const next = startLoad(s, false);
    expect(next.phase).toBe('loading');
    expect(next.items).toHaveLength(1);
  });
});

describe('applyResponse', () => {
  test('erste Seite ersetzt Liste, setzt total und nächsten Offset', () => {
    const s = applyResponse(initialPackagesState(), okRes([pkg('a'), pkg('b')], 10), false);
    expect(s.phase).toBe('loaded');
    expect(s.items.map((p) => p.name)).toEqual(['a', 'b']);
    expect(s.total).toBe(10);
    expect(s.offset).toBe(2);
  });

  test('append hängt weitere Seite an und schiebt Offset weiter', () => {
    const first = applyResponse(initialPackagesState(), okRes([pkg('a')], 3), false);
    const second = applyResponse(first, okRes([pkg('b'), pkg('c')], 3), true);
    expect(second.items.map((p) => p.name)).toEqual(['a', 'b', 'c']);
    expect(second.offset).toBe(3);
  });

  test('enabled:false → disabled, Liste geleert (Wazuh nicht verbunden)', () => {
    const s = applyResponse(initialPackagesState(), { enabled: false, data: [], total: 0 }, false);
    expect(s.phase).toBe('disabled');
    expect(s.items).toEqual([]);
  });
});

describe('applyError', () => {
  test('setzt error-Phase, behält bereits geladene Items (Fehler ≠ leer)', () => {
    const loaded = applyResponse(initialPackagesState(), okRes([pkg('a')], 5), false);
    const errored = applyError(loaded, 'Netzwerkfehler');
    expect(errored.phase).toBe('error');
    expect(errored.error).toBe('Netzwerkfehler');
    expect(errored.items).toHaveLength(1);
  });

  test('leere Meldung bekommt einen Fallback-Text', () => {
    expect(applyError(initialPackagesState(), '').error).toBe('Laden fehlgeschlagen');
  });
});

describe('applySearch', () => {
  test('neuer Suchbegriff setzt Offset zurück und leert Liste', () => {
    const loaded = applyResponse(initialPackagesState(), okRes([pkg('a')], 5), false);
    const searched = applySearch(loaded, 'nginx');
    expect(searched.search).toBe('nginx');
    expect(searched.offset).toBe(0);
    expect(searched.items).toEqual([]);
    expect(searched.total).toBe(0);
  });
});

describe('hasMore', () => {
  test('true wenn geladene Items < total', () => {
    const s = applyResponse(initialPackagesState(), okRes([pkg('a')], 5), false);
    expect(hasMore(s)).toBe(true);
  });

  test('false wenn alle geladen', () => {
    const s = applyResponse(initialPackagesState(), okRes([pkg('a')], 1), false);
    expect(hasMore(s)).toBe(false);
  });

  test('false in nicht-geladenen Phasen (loading/error/disabled)', () => {
    const loading = startLoad(initialPackagesState(), true);
    expect(hasMore(loading)).toBe(false);
    const disabled = applyResponse(initialPackagesState(), { enabled: false, data: [], total: 0 }, false);
    expect(hasMore(disabled)).toBe(false);
  });
});
