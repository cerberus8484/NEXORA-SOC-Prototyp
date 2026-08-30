import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toggle } from './Toggle';

// Regressions-Guard für den Sichtbarkeits-Bug: der OFF-Track darf NICHT --bg-input (weiß auf
// weißer Card → unsichtbar) sein, sondern ein gedecktes Grau; ON = Akzent. So ist der
// An/Aus-Zustand immer erkennbar.
describe('Toggle — Sichtbarkeit an/aus', () => {
  it('OFF-Track nutzt gedecktes Grau (--text-dim), nicht das unsichtbare --bg-input', () => {
    render(<Toggle checked={false} label="x" />);
    const track = screen.getByRole('switch');
    expect(track.style.background).toContain('--text-dim');
    expect(track.style.background).not.toContain('--bg-input');
  });

  it('ON-Track nutzt den Akzent', () => {
    render(<Toggle checked label="x" />);
    expect(screen.getByRole('switch').style.background).toContain('--accent');
  });

  it('spiegelt den Zustand in aria-checked', () => {
    const { rerender } = render(<Toggle checked={false} label="x" />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    rerender(<Toggle checked label="x" />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('meldet die Umschaltung an onChange', () => {
    let next: boolean | null = null;
    render(<Toggle checked={false} onChange={(v) => { next = v; }} label="x" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(next).toBe(true);
  });
});
