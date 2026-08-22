import { describe, test, expect } from 'vitest';
import { buildReportText, wrapLine } from './reportTextModel';
import type { Ticket } from '../../lib/types';
import type { SummaryBullet, EntityItem } from './deckModel';
import type { TicketTimeline } from './analysisModel';

const ticket = {
  id: 'abc-123', ticketNr: 'INC000007', title: 'Verdächtige PowerShell',
  priority: 'high', state: 'OPEN', status: 'in_progress',
  analyst: 'tic', customer: 'Nexora', source: 'wazuh',
  decision: 'incident', recommendation: 'Host isolieren',
} as unknown as Ticket;

describe('wrapLine', () => {
  test('bricht lange Zeilen ohne Wort-Trennung um', () => {
    const lines = wrapLine('aaaa bbbb cccc dddd', 9);
    expect(lines.every((l) => l.length <= 9)).toBe(true);
    expect(lines.join(' ')).toBe('aaaa bbbb cccc dddd');
  });
});

describe('buildReportText', () => {
  const bullets: SummaryBullet[] = [{ kind: 'process', text: 'powershell.exe ausgeführt.' }];
  const entities: EntityItem[] = [{ kind: 'ip', value: '8.8.8.8', note: 'Destination' }];
  const tl: TicketTimeline = {
    count: 1, first: '2026-06-13T10:00:00Z', last: '2026-06-13T10:00:00Z',
    actions: [], dstPorts: [],
    events: [{ time: '2026-06-13T10:00:00Z', action: 'block', srcIp: '1.1.1.1', dstIp: '8.8.8.8', dstPort: 443, protocol: 'tcp' } as TicketTimeline['events'][number]],
  } as TicketTimeline;

  test('leitet vom gemeinsamen ReportDoc ab (gleiche Bereiche/Begriffe)', () => {
    const txt = buildReportText(ticket, bullets, entities, tl);
    expect(txt).toContain('INCIDENT-REPORT');
    expect(txt).toContain('INC000007');
    expect(txt).toContain('== Bestätigte Fakten ==');
    expect(txt).toContain('powershell.exe ausgeführt.');     // Fakt
    expect(txt).toContain('== Maßnahmen & Empfehlungen ==');
    expect(txt).toContain('Host isolieren');                  // Recommendation
    expect(txt).toContain('== Traceability / Quellen ==');    // Traceability sichtbar
    expect(txt).toContain('(Quelle:');                        // Quellen-Referenzen
  });

  test('rendert ohne Daten gefahrlos (keine erfundenen Werte, kein Wurf)', () => {
    const txt = buildReportText(ticket, [], [], null);
    expect(txt).toContain('== Bestätigte Fakten ==');   // immer vorhanden
    expect(txt).toContain('== Traceability / Quellen =='); // immer vorhanden
    expect(txt).not.toContain('undefined');
  });
});
