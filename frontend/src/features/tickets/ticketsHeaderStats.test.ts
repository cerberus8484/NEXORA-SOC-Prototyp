import { describe, it, expect } from 'vitest';
import { computeHeaderStats, PRIORITY_ORDER } from './ticketsHeaderStats';
import type { Ticket } from '../../lib/types';

function mk(p: Partial<Ticket>): Ticket {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    ticketNr: p.ticketNr ?? '',
    title: p.title ?? '',
    priority: p.priority ?? 'medium',
    status: p.status ?? '',
    analyst: p.analyst ?? '',
    createdAt: p.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: p.updatedAt ?? '2026-01-01T00:00:00Z',
    state: p.state,
    ...p,
  };
}

describe('computeHeaderStats', () => {
  it('returns all-zero stats for an empty list', () => {
    const s = computeHeaderStats([]);
    expect(s.total).toBe(0);
    expect(s.open).toBe(0);
    expect(s.assigned).toBe(0);
    expect(s.unassigned).toBe(0);
    expect(s.priority).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
  });

  it('counts only OPEN tickets as open (state defaults to OPEN when missing)', () => {
    const list = [
      mk({ state: 'OPEN' }),
      mk({ state: 'CLOSED' }),
      mk({ state: undefined }), // missing state → treated as OPEN
    ];
    const s = computeHeaderStats(list);
    expect(s.total).toBe(3);
    expect(s.open).toBe(2);
  });

  it('splits assigned vs unassigned by non-empty analyst', () => {
    const list = [
      mk({ analyst: 'alice' }),
      mk({ analyst: '' }),
      mk({ analyst: '   ' }), // whitespace-only counts as unassigned
      mk({ analyst: 'bob' }),
    ];
    const s = computeHeaderStats(list);
    expect(s.assigned).toBe(2);
    expect(s.unassigned).toBe(2);
  });

  it('tallies the priority distribution and buckets unknown priorities into info', () => {
    const list = [
      mk({ priority: 'critical' }),
      mk({ priority: 'critical' }),
      mk({ priority: 'high' }),
      mk({ priority: 'medium' }),
      mk({ priority: 'low' }),
      mk({ priority: 'info' }),
      mk({ priority: 'weird-unknown' }), // unknown → info
    ];
    const s = computeHeaderStats(list);
    expect(s.priority).toEqual({ critical: 2, high: 1, medium: 1, low: 1, info: 2 });
  });

  it('is case-insensitive on priority', () => {
    const s = computeHeaderStats([mk({ priority: 'CRITICAL' }), mk({ priority: 'High' })]);
    expect(s.priority.critical).toBe(1);
    expect(s.priority.high).toBe(1);
  });

  it('exposes a stable priority ordering for rendering', () => {
    expect(PRIORITY_ORDER).toEqual(['critical', 'high', 'medium', 'low', 'info']);
  });
});
