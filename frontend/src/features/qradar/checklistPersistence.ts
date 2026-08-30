// Persistenz der QRadar-Investigation-Checkliste je Offense-ID (#2).
// Problem: Die 8 Haken lagen als reiner useState → beim Offense-Wechsel/Reload
// verloren, ohne Warnung. Hier: Laden/Speichern eines boolean[] in localStorage,
// defensiv gegen JSON-Fehler, fehlenden Storage und Schema-Drift (Länge wechselt).
// Reine Funktionen — testbar ohne DOM; der Storage wird injizierbar übergeben.

const KEY_PREFIX = 'nexora.qradar.checklist.';

/** Minimaler Storage-Vertrag (localStorage-kompatibel, injizierbar für Tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function checklistKey(offenseId: string | number): string {
  return `${KEY_PREFIX}${offenseId}`;
}

/** Default-Zustand: `length` ungehakte Einträge. */
export function emptyChecks(length: number): boolean[] {
  return Array.from({ length }, () => false);
}

/**
 * Lädt den Checklisten-Zustand für eine Offense. Garantiert immer ein boolean[]
 * der gewünschten Länge:
 *  - kein/leerer Wert        → alles ungehakt
 *  - korrupter JSON-Wert     → alles ungehakt (kein Crash)
 *  - falscher Typ            → alles ungehakt
 *  - abweichende Länge       → auf `length` zugeschnitten/aufgefüllt (Schema-Drift)
 */
export function loadChecks(store: KeyValueStore | null | undefined, offenseId: string | number, length: number): boolean[] {
  const fallback = emptyChecks(length);
  if (!store) return fallback;
  let raw: string | null;
  try {
    raw = store.getItem(checklistKey(offenseId));
  } catch {
    return fallback;
  }
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    // Auf gewünschte Länge normalisieren: jeder Eintrag strikt zu boolean.
    return Array.from({ length }, (_, i) => parsed[i] === true);
  } catch {
    return fallback;
  }
}

/** Speichert den Checklisten-Zustand. Storage-Fehler (z. B. Quota) werden geschluckt,
 *  ohne den Analyse-Flow zu unterbrechen — der lokale State bleibt führend. */
export function saveChecks(store: KeyValueStore | null | undefined, offenseId: string | number, checks: readonly boolean[]): void {
  if (!store) return;
  try {
    store.setItem(checklistKey(offenseId), JSON.stringify(checks.map((v) => v === true)));
  } catch {
    /* best effort — Persistenz darf den Ablauf nie blockieren */
  }
}
