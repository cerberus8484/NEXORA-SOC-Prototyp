// Reine Logik für die QRadar-Offense-Panels (Events / Notes) — kein React, kein DOM.
//
// Hardrule (CLAUDE.md): „leer" ≠ „Fehler". Bisher kollabierte ein fehlgeschlagener
// Events-/Notes-Abruf via `.catch(() => setState([]))` in denselben Leerzustand wie
// „0 Treffer". Der Analyst konnte einen kaputten Abruf nicht von „diese Offense hat
// keine Events" unterscheiden — und übersieht so eventuell echte Telemetrie.
//
// Dieses Modell trennt die drei Zustände sauber:
//   loading  → Spinner
//   error    → ehrlicher Fehlerhinweis ("nicht ladbar")
//   empty    → echter Leerzustand ("keine Daten")
//   ready    → Liste rendern

export type PanelState = 'loading' | 'error' | 'empty' | 'ready';

export interface PanelInputs {
  loading: boolean;
  /** true, wenn der letzte Abruf fehlgeschlagen ist (≠ leeres Ergebnis). */
  hasError: boolean;
  /** Anzahl geladener Einträge (nur relevant, wenn kein Fehler und fertig geladen). */
  itemCount: number;
}

/**
 * Bildet die Lade-/Fehler-/Datenlage auf den anzuzeigenden Panel-Zustand ab.
 * Reihenfolge ist bewusst: Laden vor Fehler vor Leerstand.
 */
export function resolvePanelState({ loading, hasError, itemCount }: PanelInputs): PanelState {
  if (loading) return 'loading';
  if (hasError) return 'error';
  if (itemCount <= 0) return 'empty';
  return 'ready';
}
