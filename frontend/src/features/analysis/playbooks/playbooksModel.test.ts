import { describe, it, expect } from 'vitest';
import { stepStatus, playbookProgress } from './playbooksModel';

describe('stepStatus', () => {
  it('markiert Steps vor/nach/auf dem aktuellen', () => {
    expect(stepStatus(0, 2)).toBe('done');
    expect(stepStatus(5, 2)).toBe('pending');
    expect(stepStatus(2, 2)).toBe('current');
    expect(stepStatus(2, 2, 'in_progress')).toBe('in_progress');
  });
});

describe('playbookProgress', () => {
  it('zählt done/current/pending + Prozent', () => {
    const p = playbookProgress(8, 3);
    expect(p).toMatchObject({ total: 8, done: 3, current: 1, pending: 4 });
    expect(p.pct).toBe(38);
  });
  it('status done zählt den aktuellen Step mit', () => {
    expect(playbookProgress(4, 1, 'done')).toMatchObject({ done: 2, current: 0, pending: 2 });
  });
  it('status skipped lässt den aktuellen offen (nicht erledigt)', () => {
    expect(playbookProgress(4, 1, 'skipped')).toMatchObject({ done: 1, current: 0, pending: 3 });
  });
  it('ist robust bei 0 Steps', () => {
    expect(playbookProgress(0, 0)).toMatchObject({ total: 0, done: 0, pct: 0 });
  });
});
