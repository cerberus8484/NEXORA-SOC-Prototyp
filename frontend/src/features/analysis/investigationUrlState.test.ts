import { describe, expect, it } from 'vitest';
import {
  readInvestigationEvent,
  readInvestigationTab,
  writeInvestigationEvent,
  writeInvestigationTab,
} from './investigationUrlState';

describe('investigation URL state', () => {
  it('reads a supported tab from a ticket URL', () => {
    expect(readInvestigationTab(new URLSearchParams('ticket=tkt-1&tab=timeline'))).toBe('timeline');
  });

  it('falls back to the overview for absent or unsupported tabs', () => {
    expect(readInvestigationTab(new URLSearchParams('ticket=tkt-1&tab=unknown'))).toBe('overview');
    expect(readInvestigationTab(new URLSearchParams('ticket=tkt-1'))).toBe('overview');
  });

  it('keeps the selected ticket when changing tabs', () => {
    expect(writeInvestigationTab(new URLSearchParams('ticket=tkt-1'), 'network').toString())
      .toBe('ticket=tkt-1&tab=network');
  });

  it('keeps ticket and tab context when selecting a timeline event', () => {
    const selected = writeInvestigationEvent(
      new URLSearchParams('ticket=tkt-1&tab=timeline'),
      'network',
    );

    expect(selected.toString()).toBe('ticket=tkt-1&tab=timeline&event=network');
    expect(readInvestigationEvent(selected)).toBe('network');
  });

  it('returns no selected event when the context is absent', () => {
    expect(readInvestigationEvent(new URLSearchParams('ticket=tkt-1&tab=timeline'))).toBeNull();
  });
});
