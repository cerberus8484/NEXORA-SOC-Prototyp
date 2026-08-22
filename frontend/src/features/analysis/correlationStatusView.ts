import type { CorrelationJobStatus, CorrelationMeta } from './analysisModel';

export const INITIAL_DELAY_MS = 2_000;
const MAX_DELAY_MS = 15_000;

// Aktive Status → Polling läuft weiter.
// Terminale Status → Polling stoppt.
const ACTIVE_STATUSES: ReadonlySet<CorrelationJobStatus> = new Set(['pending', 'running', 'retrying']);
const TERMINAL_STATUSES: ReadonlySet<CorrelationJobStatus> = new Set(['current', 'failed', 'superseded', 'unavailable']);

const LABELS: Record<CorrelationJobStatus, string> = {
  current:     'Aktuell',
  pending:     'Noch nicht berechnet',
  running:     'Wird aktualisiert',
  retrying:    'Wiederholung geplant',
  failed:      'Berechnung fehlgeschlagen',
  superseded:  'Daten haben sich geändert – Ergebnis wird ersetzt',
  unavailable: 'Korrelationsstatus derzeit nicht verfügbar',
};

type Tone = 'success' | 'warning' | 'danger' | 'muted';
const TONES: Record<CorrelationJobStatus, Tone> = {
  current:     'success',
  pending:     'muted',
  running:     'muted',
  retrying:    'warning',
  failed:      'danger',
  superseded:  'warning',
  unavailable: 'muted',
};

export function corrStatusLabel(status: CorrelationJobStatus): string {
  return LABELS[status];
}

export function corrStatusTone(status: CorrelationJobStatus): Tone {
  return TONES[status];
}

export function isCorrActive(status: CorrelationJobStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function isCorrTerminal(status: CorrelationJobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** True wenn ein vorhandenes Resultat als „Letzter Stand" angezeigt werden soll. */
export function hasStaleResult(corr: {
  status: CorrelationJobStatus;
  result: unknown;
  resultCreatedAt: string | null;
}): boolean {
  const showOld = isCorrActive(corr.status) || corr.status === 'failed';
  return showOld && corr.result !== null && corr.resultCreatedAt !== null;
}

// Sanitierung: nur druckbare Zeichen, max. 100 Zeichen — kein Stack-/DB-Inhalt.
const SAFE_PATTERN = /^[\w\s\-äöüÄÖÜß.,;:!()[\]]+$/u;
const MAX_LEN = 100;

/** Gibt einen sicheren Anzeigetext für lastFailureReason zurück. */
export function sanitizeFailureReason(reason: string | null): string {
  if (!reason) return 'Berechnung fehlgeschlagen';
  const t = reason.trim();
  if (!t || !SAFE_PATTERN.test(t)) return 'Berechnung fehlgeschlagen';
  return t.length > MAX_LEN ? t.slice(0, MAX_LEN) + '…' : t;
}

/**
 * Zustandsmaschine für den Polling-Rhythmus.
 * Kein Fetch, kein React — vollständig unit-testbar.
 *
 * Invariante: canStart() === false solange ein Request läuft ODER der Warte-Timer
 * noch nicht abgelaufen ist. Das verhindert parallele Requests.
 */
export class CorrelationPollingController {
  private _inFlight = false;
  private _delayMs = INITIAL_DELAY_MS;

  canStart(): boolean { return !this._inFlight; }
  nextDelay(): number { return this._delayMs; }

  onRequestStart(): void {
    this._inFlight = true;
  }

  /**
   * Wird nach Abschluss eines Requests aufgerufen.
   * Gibt zurück, ob ein Folge-Request nach dem Warte-Delay gestartet werden soll.
   * _inFlight bleibt bis zum Timer-Ablauf true (→ kein paralleler Start).
   */
  onRequestEnd(status: CorrelationJobStatus): { shouldContinue: boolean; nextDelay: number } {
    const shouldContinue = isCorrActive(status);
    const nextDelay = this._delayMs;
    if (shouldContinue) {
      this._delayMs = Math.min(this._delayMs * 2, MAX_DELAY_MS);
    }
    return { shouldContinue, nextDelay };
  }

  /** Timer hat gefeuert → nächster Fetch darf starten. */
  resetForTimer(): void {
    this._inFlight = false;
  }

  /**
   * Netzwerkfehler bei aktivem Job: Backoff weiterführen wie bei einem aktiven Status.
   * _inFlight bleibt true — Aufrufer setzt Timer und ruft resetForTimer() beim Feuern.
   */
  onNetworkError(): { nextDelay: number } {
    const nextDelay = this._delayMs;
    this._delayMs = Math.min(this._delayMs * 2, MAX_DELAY_MS);
    return { nextDelay };
  }

  /** Vollständiges Reset bei Ticketwechsel / Unmount / Tab-Pause. */
  reset(): void {
    this._inFlight = false;
    this._delayMs = INITIAL_DELAY_MS;
  }
}

/**
 * Extrahiert CorrelationMeta sicher aus correlationStatus.result (unknown).
 * result ist in der Praxis eine ParsedEvidence aus der CorrelationEngine,
 * die ein `correlation`-Objekt mit eventCount/sources trägt.
 */
export function extractCorrMeta(result: unknown): CorrelationMeta | null {
  if (result === null || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const corr = r['correlation'];
  if (corr === null || typeof corr !== 'object') return null;
  const c = corr as Record<string, unknown>;
  const eventCount = typeof c['eventCount'] === 'number' ? c['eventCount'] : 0;
  const rawSources = c['sources'];
  if (!Array.isArray(rawSources)) return null;
  const sources = (rawSources as unknown[]).filter(
    (s): s is { source: string; count: number } =>
      s !== null && typeof s === 'object' &&
      'source' in (s as object) &&
      'count' in (s as object),
  );
  return { eventCount, sources };
}

/** Beschreibt, was der Provenance-Block im Overview rendern soll. */
export type CorrProvenanceRender =
  | { kind: 'meta'; meta: CorrelationMeta; stale: boolean; staleAt: string | null }
  | { kind: 'loading' }
  | { kind: 'failed_no_result' }
  | { kind: 'superseded' }
  | { kind: 'unavailable' }
  | { kind: 'none' };

/**
 * Leitet aus CorrelationStatusInfo ab, was der Provenance-Block zeigen soll.
 * Einzige Entscheidungsquelle: correlationStatus.result (P_CORR_1c.4).
 * Kein ev.correlation, kein Recompute.
 */
export function deriveCorrProvenance(
  correlationStatus: {
    status: CorrelationJobStatus;
    result: unknown;
    resultCreatedAt: string | null;
  } | null | undefined,
): CorrProvenanceRender {
  if (!correlationStatus) return { kind: 'none' };
  const { status } = correlationStatus;
  const hasResult = correlationStatus.result !== null;
  const meta = extractCorrMeta(correlationStatus.result);
  const hasMeta = meta !== null && meta.eventCount > 1;
  const stale = hasStaleResult(correlationStatus);

  if (status === 'unavailable') return { kind: 'unavailable' };
  if (status === 'superseded') return { kind: 'superseded' };
  if (status === 'failed' && !hasResult) return { kind: 'failed_no_result' };
  if (isCorrActive(status) && !hasResult) return { kind: 'loading' };
  if (hasMeta) return { kind: 'meta', meta, stale, staleAt: correlationStatus.resultCreatedAt };
  return { kind: 'none' };
}
