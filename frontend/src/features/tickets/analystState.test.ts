// Unit-Tests für den analystState-Typ und ticketApi-Verdrahtung (Block B1).
// Kein Buffer/Node-APIs — reines Web-kompatibles Vitest.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { AnalystState, ChecklistItem, PlaybookState } from '../../lib/types';

// ticketApi.update mocken — prüfen dass analystState als Body-Feld durchgereicht wird
vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: 'ok' });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { ticketApi } from './ticketApi';

const mPut = api.put as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Typ-Invarianten (Compile-Zeit-Checks als Laufzeit-Checks) ─────────────

describe('AnalystState Typ-Invarianten', () => {
  test('leeres AnalystState ist valide', () => {
    const s: AnalystState = { checklist: [], playbook: {} };
    expect(s.checklist).toHaveLength(0);
    expect(s.playbook).toEqual({});
  });

  test('ChecklistItem kann mit done=true und done=false erstellt werden', () => {
    const unchecked: ChecklistItem = { id: 'c1', label: 'IoCs prüfen', done: false };
    const checked: ChecklistItem = { id: 'c2', label: 'VT prüfen', done: true };
    expect(unchecked.done).toBe(false);
    expect(checked.done).toBe(true);
    expect(checked.id).toBe('c2');
  });

  test('PlaybookState enthält gültige Status-Werte', () => {
    const statuses: Array<PlaybookState['status']> = ['', 'in_progress', 'done', 'skipped'];
    statuses.forEach((s) => {
      const pb: PlaybookState = { id: 'susp-ip', step: 0, status: s };
      expect(pb.status).toBe(s);
    });
  });

  test('AnalystState mit vollständiger Checkliste + Playbook', () => {
    const state: AnalystState = {
      checklist: [
        { id: 'c1', label: 'IoCs prüfen', done: true },
        { id: 'c2', label: 'VT prüfen', done: false },
      ],
      playbook: { id: 'malware', step: 1, status: 'in_progress' } as PlaybookState,
    };
    expect(state.checklist).toHaveLength(2);
    expect(state.checklist[0].done).toBe(true);
    const pb = state.playbook as PlaybookState;
    expect(pb.status).toBe('in_progress');
    expect(pb.step).toBe(1);
  });
});

// ── API-Vertrag: ticketApi.update leitet analystState korrekt weiter ──────

describe('ticketApi — analystState Verdrahtung (PUT-Körper)', () => {
  test('update sendet analystState im Body (nicht undefined)', async () => {
    const state: AnalystState = {
      checklist: [{ id: 'c1', label: 'A', done: true }],
      playbook: { id: 'susp-ip', step: 2, status: 'done' } as PlaybookState,
    };
    ticketApi.update('t1', { analystState: state });
    expect(mPut).toHaveBeenCalledWith('/tickets/t1', { analystState: state });
  });

  test('update mit leerem analystState sendet leeres Objekt', () => {
    const state: AnalystState = { checklist: [], playbook: {} };
    ticketApi.update('t1', { analystState: state });
    expect(mPut).toHaveBeenCalledWith('/tickets/t1', { analystState: state });
  });

  test('update mit analystState UND anderen Feldern sendet alles zusammen', () => {
    const state: AnalystState = {
      checklist: [{ id: 'c1', label: 'IoCs', done: false }],
      playbook: {},
    };
    ticketApi.update('t1', { title: 'Updated', analystState: state });
    expect(mPut).toHaveBeenCalledWith('/tickets/t1', { title: 'Updated', analystState: state });
  });
});

// ── Immutable-Update-Logik (wie in AnalysisPage.saveAnalystState) ─────────

describe('analystState — immutable Toggle-Logik', () => {
  test('Checkliste togglen erzeugt neue Referenz (immutable)', () => {
    const original: AnalystState = {
      checklist: [
        { id: 'c1', label: 'A', done: false },
        { id: 'c2', label: 'B', done: false },
      ],
      playbook: {},
    };
    // Simuliert die toggleCheck-Logik aus AnalysisPage NotesTabView
    const toggled: AnalystState = {
      ...original,
      checklist: original.checklist.map((item) =>
        item.id === 'c1' ? { ...item, done: true } : item
      ),
    };
    expect(toggled.checklist[0].done).toBe(true);
    expect(toggled.checklist[1].done).toBe(false);
    // Ursprünglicher Zustand unverändert (immutable)
    expect(original.checklist[0].done).toBe(false);
  });

  test('max 100 Items — Grenze simulieren', () => {
    const items: ChecklistItem[] = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`, label: `Item ${i}`, done: false,
    }));
    const state: AnalystState = { checklist: items, playbook: {} };
    expect(state.checklist).toHaveLength(100);
    // 101. Item würde Backend-Validation verwerfen
    expect(items.length).toBeLessThanOrEqual(100);
  });
});
