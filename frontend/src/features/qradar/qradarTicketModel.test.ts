import { describe, test, expect } from 'vitest';
import { offenseToTicketDraft } from './qradarTicketModel';
import type { QRadarOffense } from './qradarApi';

const offense: QRadarOffense = {
  id: 4711,
  offenseName: 'Multiple Failed Logins — RDP Brute Force',
  description: 'Wiederholte fehlgeschlagene RDP-Logins von einer externen IP.',
  status: 'OPEN',
  priority: 'high',
  severity: 8,
  credibility: 7,
  relevance: 6,
  magnitude: 7,
  categories: ['Authentication Failure', 'Brute Force'],
  eventCount: 142,
  flowCount: 12,
  sourceCount: 1,
  sourceIps: ['185.220.101.5', '185.220.101.6'],
  destIps: ['10.99.99.11'],
  assignedTo: null,
  mitreT: ['T1110.001', 'T1078'],
  logSources: ['Windows Security', 'OPNsense'],
  startTime: '2026-06-12T18:00:00.000Z',
  lastUpdated: '2026-06-12T18:42:00.000Z',
};

describe('offenseToTicketDraft', () => {
  test('mappt Kernfelder Offense → Ticket-Draft', () => {
    const d = offenseToTicketDraft(offense);
    expect(d.title).toBe('Multiple Failed Logins — RDP Brute Force');
    expect(d.offenseId).toBe('qradar:offense:4711');
    expect(d.source).toBe('qradar');
    expect(d.priority).toBe('high'); // QRadarPriority == Ticket-Priority
    expect(d.category).toBe('Authentication Failure, Brute Force');
    expect(d.mitre).toBe('T1110.001, T1078');
    expect(d.datetime).toBe('2026-06-12T18:00:00.000Z');
  });

  test('nimmt erste Source-/Dest-IP', () => {
    const d = offenseToTicketDraft(offense);
    expect(d.srcIp).toBe('185.220.101.5');
    expect(d.dstIp).toBe('10.99.99.11');
  });

  test('logs-Feld enthält QRadar-Scores + Kontext (Nachvollziehbarkeit)', () => {
    const d = offenseToTicketDraft(offense);
    const logs = String(d.logs);
    expect(logs).toContain('QRadar Offense #4711');
    expect(logs).toContain('Severity 8/10');
    expect(logs).toContain('Events: 142');
    expect(logs).toContain('Log Sources: Windows Security, OPNsense');
  });

  test('Standard: kein Schließen (Ticket bleibt offen)', () => {
    const d = offenseToTicketDraft(offense);
    expect(d.state).toBeUndefined();
    expect(d.closeReason).toBeUndefined();
  });

  test('asFalsePositive: Ticket direkt geschlossen mit Grund false_positive', () => {
    const d = offenseToTicketDraft(offense, { asFalsePositive: true });
    expect(d.state).toBe('CLOSED');
    expect(d.closeReason).toBe('false_positive');
    expect(d.decision).toBe('fp');
    // Kernfelder bleiben erhalten
    expect(d.offenseId).toBe('qradar:offense:4711');
    expect(d.source).toBe('qradar');
  });

  test('leere IP-/MITRE-Listen → leere Strings, kein Crash', () => {
    const bare: QRadarOffense = { ...offense, sourceIps: [], destIps: [], mitreT: [], categories: [] };
    const d = offenseToTicketDraft(bare);
    expect(d.srcIp).toBe('');
    expect(d.dstIp).toBe('');
    expect(d.mitre).toBe('');
    expect(d.category).toBe('');
  });
});
