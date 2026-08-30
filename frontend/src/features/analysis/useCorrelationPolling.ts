import { useEffect, useRef, useState } from 'react';
import { ticketApi } from '../tickets/ticketApi';
import type { CorrelationJobStatus, CorrelationStatusInfo, ParsedEvidence } from './analysisModel';
import { CorrelationPollingController, isCorrActive } from './correlationStatusView';

export interface CorrelationPollingResult {
  evidence: ParsedEvidence | null;
  correlationStatus: CorrelationStatusInfo | null;
  loading: boolean;
}

const UNAVAILABLE_STATUS: CorrelationStatusInfo = {
  status: 'unavailable',
  result: null,
  resultCreatedAt: null,
  sourceRevision: '',
  lastFailureReason: null,
};

/**
 * Liest Korrelationsstatus + Evidence per GET und pollt solange der Status aktiv ist.
 *
 * Garantien:
 * - Kein POST / kein Trigger — reiner Read-Pfad.
 * - Genau ein Request gleichzeitig (CorrelationPollingController + inFlight-Guard).
 * - AbortController pro Request; Abort bei Ticketwechsel / Unmount / Tab-Pause.
 * - Backoff: 2 → 4 → 8 → max. 15 Sekunden.
 * - Stoppt bei current, failed, superseded, unavailable.
 * - Netzwerkfehler bei aktivem Job → zeigt unavailable, setzt Backoff fort.
 * - Tab nicht sichtbar → Polling pausiert; Rückkehr → sofortiger Read + Backoff.
 */
export function useCorrelationPolling(ticketId: string | null): CorrelationPollingResult {
  const [evidence, setEvidence] = useState<ParsedEvidence | null>(null);
  const [correlationStatus, setCorrelationStatus] = useState<CorrelationStatusInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const ctrlRef = useRef(new CorrelationPollingController());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Letzter bekannter Status — entscheidet ob bei Fehler/Tab-Rückkehr weitergepollt wird.
  const lastStatusRef = useRef<CorrelationJobStatus | null>(null);

  useEffect(() => {
    if (!ticketId) {
      setEvidence(null);
      setCorrelationStatus(null);
      setLoading(false);
      return;
    }

    const id = ticketId; // string, da oben geprüft
    const poll = ctrlRef.current;
    poll.reset();
    lastStatusRef.current = null;

    function clearTimer(): void {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function abortCurrent(): void {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    }

    let mounted = true;
    let paused = false;
    let wasActiveWhenHidden = false;

    function scheduleNext(nextDelay: number): void {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        poll.resetForTimer();
        void fetchOnce();
      }, nextDelay);
    }

    async function fetchOnce(): Promise<void> {
      if (!mounted || paused || !poll.canStart()) return;

      abortCurrent();
      const ac = new AbortController();
      abortRef.current = ac;
      poll.onRequestStart();

      try {
        const r = await ticketApi.evidence(id);
        if (!mounted || ac.signal.aborted) return;

        setEvidence(r.data);
        setCorrelationStatus(r.correlation ?? null);
        setLoading(false);

        const status = r.correlation?.status ?? 'unavailable';
        lastStatusRef.current = status;

        const { shouldContinue, nextDelay } = poll.onRequestEnd(status);
        if (shouldContinue && mounted && !paused) {
          scheduleNext(nextDelay);
          return; // _inFlight bleibt true bis resetForTimer()
        }
      } catch (err) {
        if (!mounted || (err instanceof DOMException && err.name === 'AbortError')) return;

        // Netzwerkfehler: UI zeigt unavailable, aber wenn der letzte Status aktiv war,
        // läuft der Backoff weiter — der Job könnte noch laufen.
        setCorrelationStatus(UNAVAILABLE_STATUS);
        setLoading(false);

        const hadActiveStatus =
          lastStatusRef.current !== null && isCorrActive(lastStatusRef.current);
        if (hadActiveStatus && mounted && !paused) {
          const { nextDelay } = poll.onNetworkError();
          scheduleNext(nextDelay);
          return;
        }
      }

      poll.resetForTimer();
    }

    function handleVisibilityChange(): void {
      if (document.hidden) {
        wasActiveWhenHidden =
          lastStatusRef.current !== null && isCorrActive(lastStatusRef.current);
        paused = true;
        clearTimer();
        abortCurrent();
        poll.reset(); // Backoff bei Rückkehr frisch starten
      } else {
        paused = false;
        if (wasActiveWhenHidden && mounted) {
          wasActiveWhenHidden = false;
          void fetchOnce(); // sofortiger Read nach Tab-Rückkehr
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    setLoading(true);
    setEvidence(null);
    setCorrelationStatus(null);
    void fetchOnce();

    return () => {
      mounted = false;
      paused = true;
      clearTimer();
      abortCurrent();
      poll.reset();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [ticketId]);

  return { evidence, correlationStatus, loading };
}
