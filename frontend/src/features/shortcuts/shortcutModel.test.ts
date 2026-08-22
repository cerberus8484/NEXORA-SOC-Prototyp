import { describe, it, expect } from 'vitest';
import {
  resolveKey, shouldIgnoreTarget, NAV_SHORTCUTS, ACTION_SHORTCUTS, LEADER_KEY,
} from './shortcutModel';

describe('resolveKey — Leader-Navigation', () => {
  it('der Leader g öffnet den Pending-Modus ohne zu navigieren', () => {
    const r = resolveKey('g', false);
    expect(r.resolution).toEqual({ type: 'pending' });
    expect(r.pendingLeader).toBe(true);
  });

  it('g dann t navigiert zu /tickets', () => {
    expect(resolveKey('t', true).resolution).toEqual({ type: 'navigate', to: '/tickets' });
  });

  it('g dann d navigiert zu /dashboard und verlässt den Pending-Modus', () => {
    const r = resolveKey('d', true);
    expect(r.resolution).toEqual({ type: 'navigate', to: '/dashboard' });
    expect(r.pendingLeader).toBe(false);
  });

  it('eine unbekannte Folgetaste bricht den Leader-Modus folgenlos ab', () => {
    const r = resolveKey('x', true);
    expect(r.resolution).toEqual({ type: 'none' });
    expect(r.pendingLeader).toBe(false);
  });

  it('ist case-insensitiv (G dann T)', () => {
    expect(resolveKey('G', false).pendingLeader).toBe(true);
    expect(resolveKey('T', true).resolution).toEqual({ type: 'navigate', to: '/tickets' });
  });
});

describe('resolveKey — Direkt-Aktionen', () => {
  it('? öffnet die Hilfe', () => {
    expect(resolveKey('?', false).resolution).toEqual({ type: 'action', id: 'help' });
  });

  it('n legt ein neues Ticket an', () => {
    expect(resolveKey('n', false).resolution).toEqual({ type: 'action', id: 'newTicket' });
  });

  it('[ schaltet die Sidebar um', () => {
    expect(resolveKey('[', false).resolution).toEqual({ type: 'action', id: 'toggleSidebar' });
  });

  it('eine nicht zugeordnete Taste liefert none', () => {
    expect(resolveKey('z', false).resolution).toEqual({ type: 'none' });
  });

  it('Aktionstasten lösen im Leader-Modus NICHT aus (n bricht ab)', () => {
    expect(resolveKey('n', true).resolution).toEqual({ type: 'none' });
  });
});

describe('Registry-Konsistenz', () => {
  it('Navigations- und Aktionstasten kollidieren nicht', () => {
    const navKeys = new Set(NAV_SHORTCUTS.map((s) => s.key));
    for (const a of ACTION_SHORTCUTS) expect(navKeys.has(a.key)).toBe(false);
  });

  it('keine doppelten Navigationstasten', () => {
    const keys = NAV_SHORTCUTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keine Navigationstaste kollidiert mit dem Leader g', () => {
    expect(NAV_SHORTCUTS.some((s) => s.key === LEADER_KEY)).toBe(false);
  });
});

describe('shouldIgnoreTarget', () => {
  const make = (tag: string, attrs: Record<string, unknown> = {}) =>
    ({ tagName: tag, isContentEditable: false, getAttribute: () => null, ...attrs }) as unknown as EventTarget;

  it('ignoriert INPUT, TEXTAREA, SELECT', () => {
    expect(shouldIgnoreTarget(make('INPUT'))).toBe(true);
    expect(shouldIgnoreTarget(make('TEXTAREA'))).toBe(true);
    expect(shouldIgnoreTarget(make('SELECT'))).toBe(true);
  });

  it('ignoriert contentEditable und role=textbox', () => {
    expect(shouldIgnoreTarget(make('DIV', { isContentEditable: true }))).toBe(true);
    expect(shouldIgnoreTarget(make('DIV', { getAttribute: (n: string) => (n === 'role' ? 'textbox' : null) }))).toBe(true);
  });

  it('fängt normale Elemente NICHT ab', () => {
    expect(shouldIgnoreTarget(make('DIV'))).toBe(false);
    expect(shouldIgnoreTarget(make('BUTTON'))).toBe(false);
    expect(shouldIgnoreTarget(null)).toBe(false);
  });
});
