import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCorrelationPolling } from './useCorrelationPolling';
import { ticketApi } from '../tickets/ticketApi';
import type { EvidenceApiResponse, CorrelationJobStatus } from './analysisModel';

vi.mock('../tickets/ticketApi', () => ({
  ticketApi: { evidence: vi.fn() },
}));

const mockEvidence = vi.mocked(ticketApi.evidence);

function makeResponse(status: CorrelationJobStatus): EvidenceApiResponse {
  return {
    data: null,
    source: 'test',
    correlation: {
      status,
      result: null,
      resultCreatedAt: null,
      sourceRevision: 'rev-1',
      lastFailureReason: null,
    },
  };
}

// Flusht ausstehende Promises innerhalb von act() — überlebt mehrere await-Ebenen.
async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Rückt Fake-Timer vor UND flusht anschließend Promises + React-State.
async function advanceAndFlush(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useCorrelationPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ─── 1. Terminal Status → kein Polling ────────────────────────────────────
  describe('Test 1 – Terminal Status → kein weiteres Polling', () => {
    const terminalCases: CorrelationJobStatus[] = [
      'current', 'failed', 'superseded', 'unavailable',
    ];

    it.each(terminalCases)('%s → genau ein Request, danach Stopp', async (status) => {
      mockEvidence.mockResolvedValue(makeResponse(status));
      const { result, unmount } = renderHook(() => useCorrelationPolling('t1'));

      await flushAsync();
      expect(mockEvidence).toHaveBeenCalledTimes(1);
      expect(result.current.correlationStatus?.status).toBe(status);

      await advanceAndFlush(60_000);
      expect(mockEvidence).toHaveBeenCalledTimes(1); // kein zweiter Fetch

      unmount();
      mockEvidence.mockClear();
    });
  });

  // ─── 2. Aktiver Status → Polling mit exponentiellem Backoff ───────────────
  it('Test 2 – pending → Polling mit Backoff 2 → 4 → 8s bis current', async () => {
    mockEvidence
      .mockResolvedValueOnce(makeResponse('pending'))   // initial
      .mockResolvedValueOnce(makeResponse('running'))   // +2s
      .mockResolvedValueOnce(makeResponse('retrying'))  // +4s
      .mockResolvedValueOnce(makeResponse('current'));   // +8s → Stop

    const { result, unmount } = renderHook(() => useCorrelationPolling('t2'));

    await flushAsync();
    expect(result.current.correlationStatus?.status).toBe('pending');
    expect(mockEvidence).toHaveBeenCalledTimes(1);

    await advanceAndFlush(2_000); // 2s → running
    expect(result.current.correlationStatus?.status).toBe('running');
    expect(mockEvidence).toHaveBeenCalledTimes(2);

    await advanceAndFlush(4_000); // 4s → retrying
    expect(result.current.correlationStatus?.status).toBe('retrying');
    expect(mockEvidence).toHaveBeenCalledTimes(3);

    await advanceAndFlush(8_000); // 8s → current → Stop
    expect(result.current.correlationStatus?.status).toBe('current');
    expect(mockEvidence).toHaveBeenCalledTimes(4);

    await advanceAndFlush(60_000); // kein weiterer Fetch
    expect(mockEvidence).toHaveBeenCalledTimes(4);

    unmount();
  });

  // ─── 3. Kein paralleler Fetch bei langsamer Antwort ───────────────────────
  it('Test 3 – kein zweiter Fetch solange erster in-flight ist', async () => {
    let resolveFirst!: (r: EvidenceApiResponse) => void;
    mockEvidence.mockImplementationOnce(
      () => new Promise<EvidenceApiResponse>((res) => { resolveFirst = res; }),
    );

    const { unmount } = renderHook(() => useCorrelationPolling('t3'));
    await flushAsync();
    expect(mockEvidence).toHaveBeenCalledTimes(1); // in-flight

    // Viel Zeit vergeht — zweiter Request durch canStart()-Guard blockiert
    await advanceAndFlush(30_000);
    expect(mockEvidence).toHaveBeenCalledTimes(1);

    // Ersten Request auflösen (terminal) → Polling stoppt
    resolveFirst(makeResponse('current'));
    await flushAsync();
    await advanceAndFlush(30_000);
    expect(mockEvidence).toHaveBeenCalledTimes(1);

    unmount();
  });

  // ─── 4. Unmount → Abort + kein weiterer Timer ─────────────────────────────
  it('Test 4 – Unmount bricht laufenden Fetch ab, kein weiterer Request', async () => {
    mockEvidence.mockResolvedValue(makeResponse('pending'));
    const { unmount } = renderHook(() => useCorrelationPolling('t4'));

    await flushAsync();
    expect(mockEvidence).toHaveBeenCalledTimes(1); // Timer auf 2s gesetzt

    unmount(); // Cleanup: Timer löschen, Abort senden

    await advanceAndFlush(60_000); // kein weiterer Fetch nach Unmount
    expect(mockEvidence).toHaveBeenCalledTimes(1);
  });

  // ─── 5. Ticketwechsel → alter Request abgebrochen, neuer Status sofort ────
  it('Test 5 – Ticketwechsel bricht alten Request ab und lädt neuen Status sofort', async () => {
    mockEvidence
      .mockResolvedValueOnce(makeResponse('current'))  // ticket-a
      .mockResolvedValueOnce(makeResponse('running')); // ticket-b

    const { result, rerender, unmount } = renderHook(
      ({ id }: { id: string }) => useCorrelationPolling(id),
      { initialProps: { id: 'ticket-a' } },
    );

    await flushAsync();
    expect(mockEvidence).toHaveBeenCalledWith('ticket-a');
    expect(result.current.correlationStatus?.status).toBe('current');

    rerender({ id: 'ticket-b' });
    await flushAsync();

    expect(mockEvidence).toHaveBeenCalledWith('ticket-b');
    expect(mockEvidence).toHaveBeenCalledTimes(2);
    expect(result.current.correlationStatus?.status).toBe('running');

    unmount();
  });

  // ─── 6. Terminalstatus → Polling stoppt sofort nach erstem Read ───────────
  it('Test 6 – superseded → ein Read, sofortiger Stopp, kein Backoff', async () => {
    mockEvidence.mockResolvedValue(makeResponse('superseded'));
    const { result, unmount } = renderHook(() => useCorrelationPolling('t6'));

    await flushAsync();
    expect(result.current.correlationStatus?.status).toBe('superseded');
    expect(mockEvidence).toHaveBeenCalledTimes(1);

    await advanceAndFlush(30_000);
    expect(mockEvidence).toHaveBeenCalledTimes(1); // Polling läuft nicht

    unmount();
  });

  // ─── 7. Netzwerkfehler bei aktivem Job → Backoff weiter, UI zeigt unavailable
  it('Test 7 – Netzwerkfehler bei pending → unavailable anzeigen, Backoff weiterführen', async () => {
    mockEvidence
      .mockResolvedValueOnce(makeResponse('pending'))       // initial → aktiv
      .mockRejectedValueOnce(new Error('network timeout'))  // +2s → Fehler
      .mockResolvedValueOnce(makeResponse('current'));       // +4s → Erfolg → Stop

    const { result, unmount } = renderHook(() => useCorrelationPolling('t7'));

    // Initial fetch → pending
    await flushAsync();
    expect(result.current.correlationStatus?.status).toBe('pending');
    expect(mockEvidence).toHaveBeenCalledTimes(1);

    // +2s → Netzwerkfehler
    await advanceAndFlush(2_000);
    expect(mockEvidence).toHaveBeenCalledTimes(2);
    // Ehrliche Fehlermeldung — kein Fake-Erfolg
    expect(result.current.correlationStatus?.status).toBe('unavailable');

    // Backoff läuft weiter (letzter bekannter Status war aktiv): +4s → Erfolg
    await advanceAndFlush(4_000);
    expect(mockEvidence).toHaveBeenCalledTimes(3);
    expect(result.current.correlationStatus?.status).toBe('current');

    // Kein weiterer Fetch nach current
    await advanceAndFlush(30_000);
    expect(mockEvidence).toHaveBeenCalledTimes(3);

    unmount();
  });

  // ─── 8. AbortError wird nicht als Fehlerstate angezeigt ──────────────────
  it('Bonus 8 – AbortError bleibt intern, kein sichtbarer Fehlerstatus', async () => {
    const abortError = new DOMException('Operation aborted', 'AbortError');
    mockEvidence.mockRejectedValueOnce(abortError);

    const { result, unmount } = renderHook(() => useCorrelationPolling('t8'));

    await flushAsync();
    // AbortError → kein Status-Update (kein unavailable)
    expect(result.current.correlationStatus).toBeNull();

    unmount();
  });

  // ─── 9. Tab-Pause → kein Polling; Rückkehr → sofortiger Read ─────────────
  it('Bonus 9 – Tab unsichtbar pausiert Polling; Rückkehr triggert sofortigen Read', async () => {
    mockEvidence
      .mockResolvedValueOnce(makeResponse('pending'))  // initial
      .mockResolvedValueOnce(makeResponse('current')); // nach Tab-Rückkehr

    const { result, unmount } = renderHook(() => useCorrelationPolling('t9'));

    await flushAsync();
    expect(result.current.correlationStatus?.status).toBe('pending');
    expect(mockEvidence).toHaveBeenCalledTimes(1);
    // Timer auf 2s gesetzt — wird durch Tab-Pause abgebrochen

    // Tab wird unsichtbar
    await act(async () => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Während Tab unsichtbar: kein weiterer Fetch, egal wie viel Zeit vergeht
    await advanceAndFlush(30_000);
    expect(mockEvidence).toHaveBeenCalledTimes(1);

    // Tab wieder sichtbar → sofortiger Read
    await act(async () => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockEvidence).toHaveBeenCalledTimes(2);
    expect(result.current.correlationStatus?.status).toBe('current');

    unmount();
  });
});
