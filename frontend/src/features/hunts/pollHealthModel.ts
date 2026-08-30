// Reine Logik für die Poll-Gesundheit von useHuntSession — kein React, kein DOM.
//
// Hardrule (CLAUDE.md): kein still verschluckter Fehler. Bislang verschluckte der
// Hunt-Session-Poll jeden Tick-Fehler (catch{}) und pollte endlos stumm weiter.
// Schlägt das Backend dauerhaft fehl, sah der Analyst eine eingefrorene Console,
// ohne zu wissen, ob „nichts passiert" oder „Abruf kaputt" gilt.
//
// Dieses Modell zählt aufeinanderfolgende Fehler. Ab einer Schwelle gilt der Poll
// als „degraded" → die UI zeigt einen ehrlichen Fehlerhinweis. Ein erfolgreicher
// Tick setzt den Zähler zurück (transiente Aussetzer eskalieren nicht).

/** Schwelle: ab so vielen Fehlern in Folge gilt der Poll als degraded. */
export const POLL_DEGRADED_THRESHOLD = 3;

export interface PollHealth {
  /** Aufeinanderfolgende Fehlversuche seit dem letzten Erfolg. */
  consecutiveFailures: number;
  /** true, sobald die Schwelle erreicht ist (UI zeigt Fehlerzustand). */
  degraded: boolean;
}

export const INITIAL_POLL_HEALTH: PollHealth = { consecutiveFailures: 0, degraded: false };

/** Erfolgreicher Tick: Zähler zurücksetzen, nicht mehr degraded. */
export function recordPollSuccess(): PollHealth {
  return INITIAL_POLL_HEALTH;
}

/**
 * Fehlgeschlagener Tick: Zähler erhöhen; ab Schwelle degraded melden.
 *
 * @param prev      bisheriger Zustand
 * @param threshold Schwelle (default POLL_DEGRADED_THRESHOLD), >=1
 */
export function recordPollFailure(
  prev: PollHealth,
  threshold: number = POLL_DEGRADED_THRESHOLD,
): PollHealth {
  const limit = Math.max(1, Math.floor(threshold) || POLL_DEGRADED_THRESHOLD);
  const consecutiveFailures = prev.consecutiveFailures + 1;
  return { consecutiveFailures, degraded: consecutiveFailures >= limit };
}
