import { beforeEach, describe, it, expect } from 'vitest';
import { buildIncidentReport, buildCustomerReport, customerStatusLabel, priorityLabel } from './reportModel';
import i18n from '../../i18n';
import type { Ticket } from '../../lib/types';
import type { SummaryBullet } from './deckModel';
import type { NetworkCorrelation, TicketTimeline } from './analysisModel';

const TICKET: Ticket = {
  id: 't-1', ticketNr: 'INC000042', title: 'Verdächtige PowerShell-Ausführung',
  priority: 'high', status: 'open', analyst: 'j.mueller', createdAt: '2026-06-20T08:00:00Z',
  updatedAt: '2026-06-20T09:00:00Z', state: 'OPEN', customer: 'ACME GmbH', source: 'wazuh',
  datetime: '2026-06-20T07:55:00Z',
  description: 'Auf WEC01 wurde eine verdächtige PowerShell-Sitzung erkannt.',
  recommendation: 'Endpoint isolieren und Passwörter zurücksetzen.',
  actions: '08:12 Endpoint isoliert\n08:30 Forensik gestartet',
  decision: 'incident', mitre: 'T1059.001', srcIp: '10.99.99.11', dstIp: '185.220.101.47',
  iocs: '185.220.101.47\nsvcupdate.ps1',
};

const BULLETS: SummaryBullet[] = [
  { kind: 'process', text: 'powershell.exe wurde auf WEC01 ausgeführt.' },
  { kind: 'network', text: 'Outbound-Verbindung zu 185.220.101.47:443 (TCP).' },
  { kind: 'c2', text: 'Mögliche Command-and-Control-Kommunikation.' },
  { kind: 'recommend', text: 'Empfehlung: Commands und Payloads prüfen.' },
];
const TIMELINE = {
  events: [{ time: '07:55', action: 'connect', srcIp: '10.99.99.11', srcPort: 49888, dstIp: '185.220.101.47', dstPort: 443, protocol: 'tcp' }],
} as unknown as TicketTimeline;
const NETWORK = {
  flows: [{ sourceIp: '10.99.99.11', destinationIp: '185.220.101.47', sourceType: 'firewall' }],
  gaps: [{ field: 'fqdn', missingReason: 'dns_no_record', count: 2 }],
} as unknown as NetworkCorrelation;

function sectionByCategory(r: ReturnType<typeof buildIncidentReport>, cat: string) {
  return r.sections.find((s) => s.category === cat);
}
const text = (items?: { text: string }[]) => (items ?? []).map((i) => i.text).join(' || ');

beforeEach(async () => {
  await i18n.changeLanguage('de');
});

describe('buildIncidentReport — evidence-gradiert', () => {
  const full = buildIncidentReport({
    ticket: TICKET, summary: BULLETS, timeline: TIMELINE, network: NETWORK,
    correlation: { status: 'current', resultCreatedAt: '2026-06-20T09:01:00Z' },
    entities: [{ kind: 'ip', value: '185.220.101.47', note: 'C2' }],
  });

  it('hat die sechs gradierten Bereiche', () => {
    expect(full.kind).toBe('incident');
    const cats = full.sections.map((s) => s.category);
    expect(cats).toEqual(expect.arrayContaining([
      'facts', 'indicators', 'gaps', 'assessment', 'actions', 'traceability',
    ]));
  });

  it('vermischt Fakten NICHT mit Indikatoren', () => {
    const facts = text(sectionByCategory(full, 'facts')?.items);
    const indicators = text(sectionByCategory(full, 'indicators')?.items);
    // C2-Interpretation + File-IOC gehören zu Indikatoren, nicht zu Fakten.
    expect(facts).not.toContain('Command-and-Control');
    expect(facts).not.toContain('svcupdate.ps1');     // File-IOC nur als Indikator
    expect(indicators).toContain('Command-and-Control');
    expect(indicators).toContain('svcupdate.ps1');
    expect(indicators).toContain('T1059.001');         // MITRE
    // Fakt enthält die neutrale Beobachtung.
    expect(facts).toContain('Outbound-Verbindung');
  });

  it('zeigt Gaps NUR bei echter fehlender Evidence', () => {
    expect(text(sectionByCategory(full, 'gaps')?.items)).toContain('dns_no_record');
    const noGaps = buildIncidentReport({ ticket: TICKET, summary: [{ kind: 'process', text: 'x' }] });
    expect(sectionByCategory(noGaps, 'gaps')).toBeUndefined();
  });

  it('labelt die Analystenbewertung klar als Einschätzung', () => {
    const a = sectionByCategory(full, 'assessment');
    expect(a?.paragraphs?.join(' ')).toMatch(/keine bestätigte Tatsache/i);
    expect(text(a?.items)).toContain('Einstufung durch Analyst');
  });

  it('hält Traceability mit konkreten Quellen', () => {
    const tr = text(sectionByCategory(full, 'traceability')?.items);
    expect(tr).toContain('Ticket: INC000042');
    expect(tr).toContain('Korrelation: current');
    expect(tr).toContain('Timeline: 1 Events');
  });

  it('erfindet bei fehlenden Daten nichts (leere Bereiche ausgelassen)', () => {
    const bare: Ticket = { id: 't-2', ticketNr: 'INC000043', title: 'X', priority: 'low', status: 'open', analyst: '', createdAt: '', updatedAt: '' };
    const r = buildIncidentReport({ ticket: bare });
    expect(sectionByCategory(r, 'indicators')).toBeUndefined();
    expect(sectionByCategory(r, 'gaps')).toBeUndefined();
    expect(sectionByCategory(r, 'assessment')).toBeUndefined();
    expect(sectionByCategory(r, 'actions')).toBeUndefined();
    expect(sectionByCategory(r, 'facts')).toBeDefined();
    expect(sectionByCategory(r, 'traceability')).toBeDefined();
    // Kein erfundener Wert im JSON.
    expect(JSON.stringify(r)).not.toContain('undefined');
  });
});

describe('buildCustomerReport — sicher reduziert', () => {
  it('uebersetzt die Prioritaet anhand der aktuell gewaehlten Sprache', async () => {
    await i18n.changeLanguage('en');
    expect(priorityLabel('high')).toBe('High');

    await i18n.changeLanguage('de');
    expect(priorityLabel('high')).toBe('Hoch');
  });

  it('uebersetzt den Bearbeitungsstatus anhand der aktuell gewaehlten Sprache', async () => {
    await i18n.changeLanguage('en');
    expect(customerStatusLabel('open')).toBe('In progress');
    expect(customerStatusLabel('closed')).toBe('Closed');

    await i18n.changeLanguage('de');
    expect(customerStatusLabel('open')).toBe('In Bearbeitung');
    expect(customerStatusLabel('closed')).toBe('Geschlossen');
  });

  it('nutzt Kunden-Sprache (Schweregrad/Status) statt interner Codes', () => {
    const r = buildCustomerReport(TICKET, BULLETS);
    expect(r.kind).toBe('customer');
    const einstufung = r.sections.find((s) => s.heading === 'Einstufung');
    const vals = einstufung?.fields?.map((f) => f.value) ?? [];
    expect(vals).toContain('Hoch');
    expect(vals).toContain('In Bearbeitung');
  });

  it('LEAKT KEINE technischen Internas (IP/MITRE/IOC)', () => {
    const json = JSON.stringify(buildCustomerReport(TICKET, BULLETS));
    expect(json).not.toContain('185.220.101.47');
    expect(json).not.toContain('10.99.99.11');
    expect(json).not.toContain('T1059.001');
    expect(json).not.toContain('svcupdate.ps1');
    expect(json).not.toContain('Command-and-Control');
  });

  it('zeigt durchgeführte Maßnahmen + Empfehlung', () => {
    const r = buildCustomerReport(TICKET, BULLETS);
    const headings = r.sections.map((s) => s.heading);
    expect(headings).toEqual(expect.arrayContaining(['Zusammenfassung', 'Einstufung', 'Durchgeführte Maßnahmen', 'Empfehlung']));
    const massnahmen = r.sections.find((s) => s.heading === 'Durchgeführte Maßnahmen');
    expect(massnahmen?.bullets?.length).toBe(2);
  });
});
