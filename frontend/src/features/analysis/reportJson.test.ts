import { describe, test, expect } from 'vitest';
import { buildReportJsonEnvelope, renderReportJson, reportJsonFilename, REPORT_JSON_SCHEMA } from './reportJson';
import { buildIncidentReport, buildCustomerReport } from './reportModel';
import type { Ticket } from '../../lib/types';
import type { SummaryBullet, EntityItem } from './deckModel';

const ticket = {
  id: 'abc-123', ticketNr: 'INC000007', title: 'Verdächtige PowerShell',
  priority: 'high', state: 'OPEN', status: 'in_progress',
  analyst: 'tic', customer: 'Nexora', source: 'wazuh',
  decision: 'incident', recommendation: 'Host isolieren',
  mitre: 'T1059.001', iocs: '8.8.8.8',
} as unknown as Ticket;

const bullets: SummaryBullet[] = [{ kind: 'process', text: 'powershell.exe ausgeführt.' }];
const entities: EntityItem[] = [{ kind: 'ip', value: '8.8.8.8', note: 'Destination' }];

describe('reportJsonFilename', () => {
  test('baut deterministischen Dateinamen mit Zeitstempel und .json-Endung', () => {
    const name = reportJsonFilename('incident', new Date('2026-06-23T17:34:00Z'));
    expect(name).toMatch(/^nexora-incident-report-\d{8}-\d{4}\.json$/);
  });

  test('unterscheidet incident und customer', () => {
    const now = new Date('2026-06-23T09:05:00Z');
    expect(reportJsonFilename('incident', now)).toContain('-incident-');
    expect(reportJsonFilename('customer', now)).toContain('-customer-');
  });
});

describe('buildReportJsonEnvelope', () => {
  test('serialisiert das ReportDoc verlustfrei mit Schema-Marker', () => {
    const doc = buildIncidentReport({ ticket, summary: bullets, entities, iocs: [], timeline: null, network: null });
    const env = buildReportJsonEnvelope(doc);
    expect(env.schema).toBe(REPORT_JSON_SCHEMA);
    expect(env.kind).toBe('incident');
    expect(env.title).toBe(doc.title);
    expect(env.subtitle).toBe(doc.subtitle);
    expect(env.sections).toEqual(doc.sections);
  });

  test('ist rein/deterministisch — gleiche Eingabe ergibt identische Ausgabe', () => {
    const doc = buildIncidentReport({ ticket, summary: bullets, entities });
    expect(buildReportJsonEnvelope(doc)).toEqual(buildReportJsonEnvelope(doc));
  });
});

describe('renderReportJson', () => {
  test('erzeugt gültiges, parsebares JSON mit Traceability/Quellen', () => {
    const doc = buildIncidentReport({ ticket, summary: bullets, entities });
    const json = renderReportJson(doc);
    const parsed = JSON.parse(json) as ReturnType<typeof buildReportJsonEnvelope>;
    expect(parsed.schema).toBe(REPORT_JSON_SCHEMA);
    expect(parsed.kind).toBe('incident');
    // Fakten-Sektion mit Quellen-Referenz erhalten (Evidence-Gradierung sichtbar).
    const facts = parsed.sections.find((s) => s.category === 'facts');
    expect(facts?.heading).toBe('Bestätigte Fakten');
    expect(facts?.items?.some((it) => it.source === 'Evidence')).toBe(true);
    // Traceability bleibt erhalten.
    expect(parsed.sections.some((s) => s.category === 'traceability')).toBe(true);
  });

  test('Kunden-Report bleibt als JSON nicht-technisch (kein IP/MITRE-Leak)', () => {
    const json = renderReportJson(buildCustomerReport(ticket, bullets));
    expect(json).toContain('"kind": "customer"');
    expect(json).not.toContain('8.8.8.8');
    expect(json).not.toContain('T1059.001');
  });

  test('rendert ohne Daten gefahrlos (kein undefined, valides JSON)', () => {
    const json = renderReportJson(buildIncidentReport({ ticket: { id: 'x' } as unknown as Ticket }));
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toContain('undefined');
  });
});
