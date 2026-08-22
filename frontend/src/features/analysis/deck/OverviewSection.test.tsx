import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverviewSection } from './OverviewSection';
import { EMPTY_EVIDENCE } from '../analysisModel';
import type { CorrelationStatusInfo } from '../analysisModel';
import type { Ticket } from '../../../lib/types';

// Minimales Ticket-Fixture ohne Fake-Werte.
const TICKET = {
  id: 'T1', ticketNr: 'INC000001', title: 'Test Alert', priority: 'medium',
  status: 'open', analyst: 'analyst@nexora.example', assignedTo: null, srcIp: null, dstIp: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
} as unknown as Ticket;

// Engine-Ergebnis: ParsedEvidence mit correlation-Meta (wie CorrelationEngine.correlate()).
function makeResult(eventCount: number, sources: { source: string; count: number }[]): unknown {
  return { correlation: { eventCount, sources } };
}

function makeStatus(
  status: CorrelationStatusInfo['status'],
  result: unknown,
  resultCreatedAt: string | null = null,
  lastFailureReason: string | null = null,
): CorrelationStatusInfo {
  return { status, result, resultCreatedAt, sourceRevision: 'rev1', lastFailureReason };
}

describe('OverviewSection — Korrelations-Provenance (P_CORR_1c.4)', () => {
  it('current: rendert ausschließlich aus correlationStatus.result, nicht aus ev.correlation', () => {
    // ev.correlation hat eventCount=99 — darf NICHT angezeigt werden.
    const ev = { ...EMPTY_EVIDENCE, correlation: { eventCount: 99, sources: [{ source: 'OldSource', count: 99 }] } };
    const cs = makeStatus('current', makeResult(3, [{ source: 'Wazuh', count: 3 }]), '2026-01-01T10:00:00Z');
    render(<OverviewSection t={TICKET} ev={ev} tl={null} tlLoading={false} onOpenSection={vi.fn()} correlationStatus={cs} />);
    expect(screen.getByText(/3 Events/)).toBeTruthy();
    expect(screen.getByText(/Wazuh ×3/)).toBeTruthy();
    expect(screen.queryByText(/99 Events/)).toBeNull();
    expect(screen.queryByText(/OldSource/)).toBeNull();
  });

  it('running + altes Ergebnis: Ergebnis sichtbar + Stale-Marker mit Zeitstempel', () => {
    const cs = makeStatus('running', makeResult(5, [{ source: 'Sysmon', count: 5 }]), '2026-01-01T10:00:00Z');
    render(<OverviewSection t={TICKET} ev={EMPTY_EVIDENCE} tl={null} tlLoading={false} onOpenSection={vi.fn()} correlationStatus={cs} />);
    expect(screen.getByText(/5 Events/)).toBeTruthy();
    expect(screen.getByText(/Sysmon ×5/)).toBeTruthy();
    expect(screen.getByText(/Letzter Stand/)).toBeTruthy();
  });

  it('retrying + altes Ergebnis: Stale-Marker vorhanden', () => {
    const cs = makeStatus('retrying', makeResult(2, [{ source: 'Firewall', count: 2 }]), '2026-01-01T09:00:00Z');
    render(<OverviewSection t={TICKET} ev={EMPTY_EVIDENCE} tl={null} tlLoading={false} onOpenSection={vi.fn()} correlationStatus={cs} />);
    expect(screen.getByText(/Letzter Stand/)).toBeTruthy();
  });

  it('failed + kein Ergebnis: zeigt Fehlermeldung — KEIN "keine Erkenntnisse"-Leerzustand', () => {
    const cs = makeStatus('failed', null, null, 'Worker timeout');
    render(<OverviewSection t={TICKET} ev={EMPTY_EVIDENCE} tl={null} tlLoading={false} onOpenSection={vi.fn()} correlationStatus={cs} />);
    expect(screen.getByText(/Korrelationsberechnung fehlgeschlagen/)).toBeTruthy();
    // kein leerer Erfolgszustand, kein "keine Erkenntnisse" im Provenance-Bereich
    expect(screen.queryByText(/Korreliert aus/)).toBeNull();
  });

  it('failed + altes Ergebnis: Ergebnis sichtbar + Stale-Marker (Fehler im Banner, nicht hier)', () => {
    const cs = makeStatus('failed', makeResult(4, [{ source: 'Wazuh', count: 4 }]), '2026-01-01T08:00:00Z', 'Timeout');
    render(<OverviewSection t={TICKET} ev={EMPTY_EVIDENCE} tl={null} tlLoading={false} onOpenSection={vi.fn()} correlationStatus={cs} />);
    expect(screen.getByText(/4 Events/)).toBeTruthy();
    expect(screen.getByText(/Letzter Stand/)).toBeTruthy();
    // Kein separater Failed-Block (Fehler kommt aus Banner — OverviewSection zeigt nur Stale-Inhalt)
    expect(screen.queryByText(/fehlgeschlagen/)).toBeNull();
  });

  it('superseded: zeigt Warnung — NICHT das alte Resultat als aktuelles Ergebnis', () => {
    const cs = makeStatus('superseded', makeResult(7, [{ source: 'Wazuh', count: 7 }]), '2026-01-01T06:00:00Z');
    render(<OverviewSection t={TICKET} ev={EMPTY_EVIDENCE} tl={null} tlLoading={false} onOpenSection={vi.fn()} correlationStatus={cs} />);
    expect(screen.getByText(/geändert/)).toBeTruthy();
    // Das alte Resultat (7 Events) darf NICHT als aktuelles Resultat erscheinen.
    expect(screen.queryByText(/7 Events/)).toBeNull();
  });

  it('pending + kein Ergebnis: zeigt Lade-Hinweis, kein falscher Erfolgszustand', () => {
    const cs = makeStatus('pending', null);
    render(<OverviewSection t={TICKET} ev={EMPTY_EVIDENCE} tl={null} tlLoading={false} onOpenSection={vi.fn()} correlationStatus={cs} />);
    expect(screen.getByText(/berechnet/)).toBeTruthy();
    expect(screen.queryByText(/Korreliert aus/)).toBeNull();
  });

  it('unavailable: sanfter Hinweis, andere Karten bleiben intakt', () => {
    const cs = makeStatus('unavailable', null);
    render(<OverviewSection t={TICKET} ev={EMPTY_EVIDENCE} tl={null} tlLoading={false} onOpenSection={vi.fn()} correlationStatus={cs} />);
    expect(screen.getByText(/nicht verfügbar/)).toBeTruthy();
    // Communication Map soll weiterhin gerendert werden.
    expect(screen.getByText('Communication Map')).toBeTruthy();
  });

  it('kein correlationStatus: kein Provenance-Block gerendert, Karten bleiben intakt', () => {
    render(<OverviewSection t={TICKET} ev={EMPTY_EVIDENCE} tl={null} tlLoading={false} onOpenSection={vi.fn()} />);
    expect(screen.queryByText(/Korreliert aus/)).toBeNull();
    expect(screen.queryByText(/fehlgeschlagen/)).toBeNull();
    expect(screen.queryByText(/berechnet/)).toBeNull();
    expect(screen.getByText('Communication Map')).toBeTruthy();
  });

  it('Render von OverviewSection löst keinen Fetch / POST / Recompute aus', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const cs = makeStatus('current', makeResult(3, [{ source: 'Wazuh', count: 3 }]), '2026-01-01T10:00:00Z');
    render(<OverviewSection t={TICKET} ev={EMPTY_EVIDENCE} tl={null} tlLoading={false} onOpenSection={vi.fn()} correlationStatus={cs} />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  // ── Edge Cases ──────────────────────────────────────────────────────────────

  it('result=null + ev.correlation mit Werten → ev.correlation darf NICHT erscheinen', () => {
    // Klassischer Fallback-Trap: result ist null (z.B. Erstanlage), aber ev.correlation
    // hat noch Werte aus einem früheren Sync-Engine-Lauf.
    const ev = { ...EMPTY_EVIDENCE, correlation: { eventCount: 10, sources: [{ source: 'GhostSource', count: 10 }] } };
    // pending ohne result → loading-Hinweis, aber kein ev.correlation-Inhalt
    const cs = makeStatus('pending', null);
    render(<OverviewSection t={TICKET} ev={ev} tl={null} tlLoading={false} onOpenSection={vi.fn()} correlationStatus={cs} />);
    expect(screen.queryByText(/GhostSource/)).toBeNull();
    expect(screen.queryByText(/10 Events/)).toBeNull();
    // Loading-Hinweis soll erscheinen
    expect(screen.getByText(/berechnet/)).toBeTruthy();
  });

  it('result hat unerwartete Form → kein Crash, neutraler Zustand', () => {
    // Engine gibt ein unbekanntes Objekt zurück (zukünftige Format-Änderung / Fehler).
    const cs = makeStatus('current', { unexpectedField: 42 }, '2026-01-01T10:00:00Z');
    // Darf nicht werfen; kein Provenance-Block (eventCount nicht lesbar).
    expect(() => {
      render(<OverviewSection t={TICKET} ev={EMPTY_EVIDENCE} tl={null} tlLoading={false} onOpenSection={vi.fn()} correlationStatus={cs} />);
    }).not.toThrow();
    expect(screen.queryByText(/Korreliert aus/)).toBeNull();
    // Andere Karten bleiben sichtbar
    expect(screen.getByText('Communication Map')).toBeTruthy();
  });

  it('result ist primitiver Wert → kein Crash', () => {
    const cs = makeStatus('current', 'not-an-object', '2026-01-01T10:00:00Z');
    expect(() => {
      render(<OverviewSection t={TICKET} ev={EMPTY_EVIDENCE} tl={null} tlLoading={false} onOpenSection={vi.fn()} correlationStatus={cs} />);
    }).not.toThrow();
    expect(screen.queryByText(/Korreliert aus/)).toBeNull();
  });
});
