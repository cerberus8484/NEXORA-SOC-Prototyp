import { describe, it, expect } from 'vitest';
import { canDeleteTicket } from './ticketDeleteGate';

describe('canDeleteTicket', () => {
  it('allows delete for admin', () => {
    expect(canDeleteTicket('admin')).toBe(true);
  });

  it('denies delete for engineer', () => {
    expect(canDeleteTicket('engineer')).toBe(false);
  });

  it('denies delete for analyst', () => {
    expect(canDeleteTicket('analyst')).toBe(false);
  });

  it('denies delete for viewer', () => {
    expect(canDeleteTicket('viewer')).toBe(false);
  });

  it('denies delete for agent', () => {
    expect(canDeleteTicket('agent')).toBe(false);
  });

  it('denies delete for unknown role', () => {
    expect(canDeleteTicket('something-else')).toBe(false);
  });

  it('denies delete when role is undefined', () => {
    expect(canDeleteTicket(undefined)).toBe(false);
  });
});
