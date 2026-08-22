// ── Host-Paketliste: reine Such-/Pagination-Logik ──────────────────────────
// Hält den State der installierten Software eines Hosts (Suche + Pagination)
// als pures, framework-freies Modul. Die Komponente HostPackagesTable spiegelt
// diesen State in React und führt die eigentlichen API-Aufrufe aus.
//
// ADR-009-konform: keine erfundenen Werte. "Fehler" (load failed) und "leer"
// (0 Treffer) sind getrennte Zustände — die UI darf sie nie verwechseln.

export interface HostPackage {
  name: string;
  version: string;
  vendor: string;
  architecture: string;
}

/** Lade-/Anzeigestatus der Paketliste — explizit getrennt (Fehler ≠ leer). */
export type PackagesPhase = 'idle' | 'loading' | 'loaded' | 'error' | 'disabled';

export interface HostPackagesState {
  phase: PackagesPhase;
  /** Bereits geladene Pakete (über mehrere Seiten akkumuliert). */
  items: HostPackage[];
  /** Gesamtzahl der Treffer laut Backend (für "N Pakete" + hasMore). */
  total: number;
  /** Aktueller Suchbegriff (server-seitig angewandt). */
  search: string;
  /** Offset der NÄCHSTEN zu ladenden Seite. */
  offset: number;
  /** Fehlermeldung, nur in phase==='error' relevant. */
  error: string;
}

export const PACKAGES_PAGE_SIZE = 50;

export function initialPackagesState(): HostPackagesState {
  return { phase: 'idle', items: [], total: 0, search: '', offset: 0, error: '' };
}

/** Query-Parameter für den nächsten API-Aufruf aus dem State ableiten. */
export interface PackagesQuery {
  limit: number;
  offset: number;
  search: string;
}

export function nextQuery(state: HostPackagesState): PackagesQuery {
  return { limit: PACKAGES_PAGE_SIZE, offset: state.offset, search: state.search };
}

/**
 * Übergang in den Ladezustand.
 * `reset` (neue Suche / erster Load) leert die bisherige Liste und setzt Offset 0
 * zurück; ohne `reset` ("mehr laden") bleibt die Liste erhalten.
 */
export function startLoad(state: HostPackagesState, reset: boolean): HostPackagesState {
  if (reset) {
    return { ...state, phase: 'loading', items: [], offset: 0, error: '' };
  }
  return { ...state, phase: 'loading', error: '' };
}

export interface PackagesResponse {
  enabled: boolean;
  data: HostPackage[];
  total: number;
}

/**
 * Erfolgreiche Antwort einarbeiten.
 * `append=false` (neue Suche) ersetzt die Liste; `append=true` ("mehr laden")
 * hängt an. `enabled:false` → phase 'disabled' (Wazuh nicht verbunden).
 */
export function applyResponse(
  state: HostPackagesState,
  res: PackagesResponse,
  append: boolean,
): HostPackagesState {
  if (!res.enabled) {
    return { ...state, phase: 'disabled', items: [], total: 0, offset: 0, error: '' };
  }
  const items = append ? [...state.items, ...res.data] : [...res.data];
  return {
    ...state,
    phase: 'loaded',
    items,
    total: res.total,
    offset: items.length,
    error: '',
  };
}

/** Fehlerzustand setzen — Liste bleibt unangetastet (ehrlich: Fehler ≠ leer). */
export function applyError(state: HostPackagesState, message: string): HostPackagesState {
  return { ...state, phase: 'error', error: message || 'Laden fehlgeschlagen' };
}

/**
 * Neuen Suchbegriff übernehmen. Gibt einen frischen Lade-Ausgangszustand
 * zurück (offset 0, leere Liste), damit der nächste Load die Suche ersetzt.
 */
export function applySearch(state: HostPackagesState, search: string): HostPackagesState {
  return { ...state, search, offset: 0, items: [], total: 0 };
}

/** Sind weitere Seiten verfügbar? (geladene Items < Gesamtzahl) */
export function hasMore(state: HostPackagesState): boolean {
  return state.phase === 'loaded' && state.items.length < state.total;
}
