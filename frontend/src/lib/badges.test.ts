import { describe, it, expect } from 'vitest';
import { badge } from './badges';

describe('badge mapping', () => {
  it('session-Status liefert Label + Tone', () => {
    expect(badge.sessionStatus('active')).toEqual({ label: 'Aktiv', tone: 'success' });
    expect(badge.sessionStatus('completed').label).toBe('Abgeschlossen');
  });

  it('command-Status liefert Label + Tone', () => {
    expect(badge.commandStatus('blocked')).toEqual({ label: 'Blockiert', tone: 'warning' });
    expect(badge.commandStatus('running').tone).toBe('accent');
  });

  it('severity liefert Label + Tone', () => {
    expect(badge.severity('critical')).toEqual({ label: 'Critical', tone: 'danger' });
    expect(badge.severity('low').tone).toBe('accent');
  });

  it('ticket-State liefert Label + Tone', () => {
    expect(badge.ticketState('OPEN')).toEqual({ label: 'Open', tone: 'success' });
    expect(badge.ticketState('CLOSED').tone).toBe('muted');
  });

  it('ticket-Status liefert Label + Tone', () => {
    expect(badge.ticketStatus('in_progress')).toEqual({ label: 'In Progress', tone: 'accent' });
    expect(badge.ticketStatus('awaiting_customer').tone).toBe('purple');
  });

  it('close-Reason liefert Label + Tone', () => {
    expect(badge.closeReason('false_positive').label).toBe('False Positive');
  });

  it('unbekannter Wert → Fallback mit Originalwert + muted', () => {
    expect(badge.sessionStatus('weird')).toEqual({ label: 'weird', tone: 'muted' });
    expect(badge.severity('')).toEqual({ label: '—', tone: 'muted' });
  });
});
