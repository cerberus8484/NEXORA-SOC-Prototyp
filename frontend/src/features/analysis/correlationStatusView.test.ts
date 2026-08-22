import { describe, it, expect } from 'vitest';
import {
  corrStatusLabel, corrStatusTone, isCorrActive, isCorrTerminal,
  hasStaleResult, sanitizeFailureReason, CorrelationPollingController,
  INITIAL_DELAY_MS,
} from './correlationStatusView';
import type { CorrelationJobStatus } from './analysisModel';

// ─── 1. Kein Correlation-Trigger beim Öffnen ────────────────────────────────
// Die View-Logik ist eine reine Funktion ohne Seiteneffekte.
// Das Hook (useCorrelationPolling) ruft nur api.get — niemals api.post/put/del.
// Dieser Test beweist: isCorrActive ist seiteneffektfrei (kein Fetch, kein Trigger).
describe('Req 1 – GET-only, kein Trigger', () => {
  it('isCorrActive macht keinen API-Aufruf und verändert keinen externen Zustand', () => {
    const calls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => { calls.push('fetch'); return Promise.resolve(new Response()); }) as typeof fetch;
    try {
      expect(isCorrActive('pending')).toBe(true);
      expect(isCorrActive('current')).toBe(false);
      expect(calls).toHaveLength(0); // kein Fetch ausgelöst
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ─── 2. current → Aktuell + Tone ────────────────────────────────────────────
describe('Req 2 – current zeigt Resultat und Zeitstempel-Kontext', () => {
  it('corrStatusLabel("current") gibt "Aktuell" zurück', () => {
    expect(corrStatusLabel('current')).toBe('Aktuell');
  });

  it('corrStatusTone("current") ist "success"', () => {
    expect(corrStatusTone('current')).toBe('success');
  });

  it('current ist kein aktiver Status (kein Polling nötig)', () => {
    expect(isCorrActive('current')).toBe(false);
  });
});

// ─── 3. pending und running → klarer Status ──────────────────────────────────
describe('Req 3 – pending und running zeigen klaren Status', () => {
  it('pending-Label ist "Noch nicht berechnet"', () => {
    expect(corrStatusLabel('pending')).toBe('Noch nicht berechnet');
  });

  it('running-Label ist "Wird aktualisiert"', () => {
    expect(corrStatusLabel('running')).toBe('Wird aktualisiert');
  });

  it('pending und running sind aktive Status', () => {
    expect(isCorrActive('pending')).toBe(true);
    expect(isCorrActive('running')).toBe(true);
  });
});

// ─── 4. retrying → Wiederholungsstatus ──────────────────────────────────────
describe('Req 4 – retrying zeigt Wiederholungsstatus', () => {
  it('retrying-Label ist "Wiederholung geplant"', () => {
    expect(corrStatusLabel('retrying')).toBe('Wiederholung geplant');
  });

  it('retrying ist aktiv (Polling läuft weiter)', () => {
    expect(isCorrActive('retrying')).toBe(true);
  });

  it('retrying-Tone ist "warning"', () => {
    expect(corrStatusTone('retrying')).toBe('warning');
  });
});

// ─── 5. failed → keine leere Erfolgsansicht ──────────────────────────────────
describe('Req 5 – failed zeigt keinen Erfolgs-Status', () => {
  it('failed-Tone ist "danger", nicht "success"', () => {
    expect(corrStatusTone('failed')).not.toBe('success');
    expect(corrStatusTone('failed')).toBe('danger');
  });

  it('failed-Label beschreibt Fehler, nicht Erfolg', () => {
    const label = corrStatusLabel('failed');
    expect(label).toBe('Berechnung fehlgeschlagen');
    expect(label.toLowerCase()).not.toContain('aktuell');
    expect(label.toLowerCase()).not.toContain('erfolgreich');
  });

  it('failed ist terminal (Polling stoppt)', () => {
    expect(isCorrTerminal('failed')).toBe(true);
    expect(isCorrActive('failed')).toBe(false);
  });
});

// ─── 6. Vorhandenes altes Resultat bleibt sichtbar ──────────────────────────
describe('Req 6 – altes Resultat bei aktivem/fehlgeschlagenem Lauf als älterer Stand', () => {
  const OLD_RESULT = { eventCount: 5, sources: [] };
  const OLD_TS = '2026-06-20T10:00:00Z';

  it.each<CorrelationJobStatus>(['pending', 'running', 'retrying', 'failed'])(
    'hasStaleResult(%s) + Resultat → true',
    (status) => {
      expect(hasStaleResult({ status, result: OLD_RESULT, resultCreatedAt: OLD_TS })).toBe(true);
    },
  );

  it('hasStaleResult(current) + Resultat → false (aktuell, kein "älterer Stand")', () => {
    expect(hasStaleResult({ status: 'current', result: OLD_RESULT, resultCreatedAt: OLD_TS })).toBe(false);
  });

  it('hasStaleResult(pending) + null → false (kein Resultat vorhanden)', () => {
    expect(hasStaleResult({ status: 'pending', result: null, resultCreatedAt: null })).toBe(false);
  });

  it('sanitizeFailureReason gibt einen sicheren Text zurück (kein Stack/DB)', () => {
    expect(sanitizeFailureReason('timeout after 5000ms')).toBe('timeout after 5000ms');
    // Stack-Trace: wird bereinigt
    expect(sanitizeFailureReason('Error: DB deadlock\n  at Pool.query (/app/db.js:42:5)')).toBe('Berechnung fehlgeschlagen');
    expect(sanitizeFailureReason(null)).toBe('Berechnung fehlgeschlagen');
  });
});

// ─── 7. Polling nur für aktive Status ────────────────────────────────────────
describe('Req 7 – isCorrActive identifiziert Polling-würdige Status korrekt', () => {
  const active: CorrelationJobStatus[] = ['pending', 'running', 'retrying'];
  const inactive: CorrelationJobStatus[] = ['current', 'failed', 'superseded', 'unavailable'];

  it.each(active)('isCorrActive(%s) === true', (s) => {
    expect(isCorrActive(s)).toBe(true);
  });

  it.each(inactive)('isCorrActive(%s) === false', (s) => {
    expect(isCorrActive(s)).toBe(false);
  });
});

// ─── 8. Polling stoppt bei Terminalstatus ────────────────────────────────────
describe('Req 8 – isCorrTerminal markiert Stopp-Status korrekt', () => {
  const terminal: CorrelationJobStatus[] = ['current', 'failed', 'superseded', 'unavailable'];
  const nonTerminal: CorrelationJobStatus[] = ['pending', 'running', 'retrying'];

  it.each(terminal)('isCorrTerminal(%s) === true', (s) => {
    expect(isCorrTerminal(s)).toBe(true);
  });

  it.each(nonTerminal)('isCorrTerminal(%s) === false', (s) => {
    expect(isCorrTerminal(s)).toBe(false);
  });
});

// ─── 9. Kein paralleles Polling bei langsamer API ────────────────────────────
describe('Req 9 – CorrelationPollingController verhindert parallele Requests', () => {
  it('canStart() ist false während ein Request läuft', () => {
    const ctrl = new CorrelationPollingController();
    expect(ctrl.canStart()).toBe(true);
    ctrl.onRequestStart();
    expect(ctrl.canStart()).toBe(false); // in-flight
  });

  it('canStart() bleibt false nach onRequestEnd (aktiver Status), bis Timer feuert', () => {
    const ctrl = new CorrelationPollingController();
    ctrl.onRequestStart();
    const { shouldContinue } = ctrl.onRequestEnd('pending');
    expect(shouldContinue).toBe(true);
    expect(ctrl.canStart()).toBe(false); // Timer noch nicht gefeuert
    ctrl.resetForTimer(); // Timer feuert
    expect(ctrl.canStart()).toBe(true);
  });

  it('Backoff verdoppelt sich: 2→4→8→max 15 Sekunden', () => {
    const ctrl = new CorrelationPollingController();
    expect(ctrl.nextDelay()).toBe(INITIAL_DELAY_MS); // 2000
    ctrl.onRequestStart();
    ctrl.onRequestEnd('pending'); // Delay: 2s → 4s
    ctrl.resetForTimer();
    expect(ctrl.nextDelay()).toBe(4_000);
    ctrl.onRequestStart();
    ctrl.onRequestEnd('running'); // 4s → 8s
    ctrl.resetForTimer();
    expect(ctrl.nextDelay()).toBe(8_000);
    ctrl.onRequestStart();
    ctrl.onRequestEnd('retrying'); // 8s → 15s (cap)
    ctrl.resetForTimer();
    expect(ctrl.nextDelay()).toBe(15_000);
    ctrl.onRequestStart();
    ctrl.onRequestEnd('retrying'); // 15s → bleibt 15s
    ctrl.resetForTimer();
    expect(ctrl.nextDelay()).toBe(15_000);
  });
});

// ─── 10. Ticketwechsel / Unmount bricht Polling ab ───────────────────────────
describe('Req 10 – reset() bereinigt Zustand für Ticketwechsel und Unmount', () => {
  it('reset() nach laufendem Request setzt canStart() und Delay zurück', () => {
    const ctrl = new CorrelationPollingController();
    ctrl.onRequestStart();
    ctrl.onRequestEnd('retrying'); // Delay wurde erhöht
    expect(ctrl.nextDelay()).toBe(4_000);
    ctrl.reset(); // Ticketwechsel / Unmount
    expect(ctrl.canStart()).toBe(true);
    expect(ctrl.nextDelay()).toBe(INITIAL_DELAY_MS); // frischer Start
  });

  it('nach reset() wird kein alter Delay-Zustand weitergeführt', () => {
    const ctrl = new CorrelationPollingController();
    // Mehrere Runden fahren
    for (let i = 0; i < 4; i++) {
      ctrl.onRequestStart();
      ctrl.onRequestEnd('running');
      ctrl.resetForTimer();
    }
    const staleDelay = ctrl.nextDelay();
    expect(staleDelay).toBeGreaterThan(INITIAL_DELAY_MS);
    ctrl.reset(); // Ticketwechsel
    expect(ctrl.nextDelay()).toBe(INITIAL_DELAY_MS); // Delay wieder frisch
  });
});
