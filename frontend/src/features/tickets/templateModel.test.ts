import { describe, test, expect } from 'vitest';
import { generateTemplate, wrapLine, type TemplatePayload } from './templateModel';

const NOW = new Date('2026-06-12T10:00:00');

const fullForm = {
  ticketNr: 'INC000142',
  offenseId: 'wazuh:rule:87702:agent:003',
  customer: 'Nexora Lab',
  analyst: 'Thorsten',
  datetime: '2026-06-11T22:15',
  priority: 'high',
  state: 'OPEN',
  status: 'in_progress',
  title: 'Multicast-Traffic von Workstation',
  category: 'Network Anomaly',
  useCase: 'UC-007 – mDNS Flood',
  mitre: 'T1046',
  description: 'Workstation sendet ungewöhnlich viel Multicast.\n\nZweiter Absatz.',
  srcIp: '192.168.240.109',
  srcFqdn: 'pc01.lab.local',
  dstIp: '224.0.0.7',
  port: '5353',
  protocol: 'UDP',
  user: 'jdoe',
  email: 'jdoe@firma.de',
  dept: 'IT',
  os: 'Windows 11 24H2',
  process: 'svchost.exe',
  iocs: '224.0.0.7\n192.168.240.109',
  actions: 'Host isoliert',
  recommendation: 'Regel tunen',
};

describe('generateTemplate — Incident-Report (Box-Drawing)', () => {
  test('Header enthält Analyst + Erstellt-Zeit (injizierbar)', () => {
    const t = generateTemplate(fullForm, { now: NOW });
    expect(t).toContain('SOC ANALYST — INCIDENT REPORT');
    expect(t).toContain('Analyst: Thorsten');
    expect(t).toContain('Erstellt: 12.6.2026');
  });

  test('alle befüllten Sektionen erscheinen in der richtigen Reihenfolge', () => {
    const t = generateTemplate(fullForm, { now: NOW });
    const order = ['BESCHREIBUNG / ANALYSE', 'OFFENSE', 'NOTIZEN / ERGÄNZUNGEN',
      'NETZWERK & GERÄTE', 'BENUTZER / IDENTITY', 'SYSTEM & ASSET',
      'IOCs (INDICATORS OF COMPROMISE)', 'MASSNAHMEN', 'EMPFEHLUNG / NEXT STEPS'];
    let last = -1;
    for (const s of order) {
      const i = t.indexOf(s);
      expect(i, `Sektion fehlt: ${s}`).toBeGreaterThan(last);
      last = i;
    }
  });

  test('leere Sektionen werden komplett weggelassen', () => {
    const t = generateTemplate({ description: 'nur Text', analyst: 'A' }, { now: NOW });
    expect(t).not.toContain('BENUTZER / IDENTITY');
    expect(t).not.toContain('SYSTEM & ASSET');
    expect(t).not.toContain('NETZWERK & GERÄTE');
    expect(t).not.toContain('THREAT INTEL');
    expect(t).not.toContain('OFFENSE');
  });

  test('IP + FQDN auf einer Zeile mit Pfeil', () => {
    const t = generateTemplate(fullForm, { now: NOW });
    expect(t).toContain('192.168.240.109  →  pc01.lab.local');
  });

  test('Zwei-Feld-Status: OPEN zeigt Bearbeitungs-Status', () => {
    const t = generateTemplate(fullForm, { now: NOW });
    expect(t).toContain('[ OPEN · IN PROGRESS ]');
  });

  test('Zwei-Feld-Status: CLOSED zeigt Schließgrund', () => {
    const t = generateTemplate({ ...fullForm, state: 'CLOSED', closeReason: 'false_positive' }, { now: NOW });
    expect(t).toContain('[ CLOSED · FALSE POSITIVE ]');
  });

  test('Priorität wird gemappt (high → 🔴 HIGH)', () => {
    const t = generateTemplate(fullForm, { now: NOW });
    expect(t).toContain('🔴 HIGH');
  });

  test('jede Boxzeile hält die Rahmenbreite ein (keine Zeile > 74 Zeichen)', () => {
    const long = { ...fullForm, description: `${'EinSehrLangesWort '.repeat(20)}\n${'x'.repeat(200)}` };
    const t = generateTemplate(long, { now: NOW });
    for (const line of t.split('\n')) {
      // Nur Inhalt-Zeilen mit │-Prefix prüfen (Wort-Umbruch bricht keine Wörter,
      // einzelne überlange "Wörter" wie der 200x-Block dürfen überstehen)
      if (line.startsWith('│  ') && !line.includes('x'.repeat(80))) {
        expect(line.length, line).toBeLessThanOrEqual(76);
      }
    }
  });

  test('Notizfeld ist immer enthalten und leer (zum manuellen Ausfüllen)', () => {
    const t = generateTemplate({}, { now: NOW });
    expect(t).toContain('NOTIZEN / ERGÄNZUNGEN');
  });

  test('interne Notizen (form.notes) erscheinen NICHT im Report', () => {
    const t = generateTemplate({ ...fullForm, notes: 'STRENG-INTERN-XYZ' }, { now: NOW });
    expect(t).not.toContain('STRENG-INTERN-XYZ');
  });

  test('Threat-Intel-Sektion nur bei befüllten TI-Feldern', () => {
    const t1 = generateTemplate(fullForm, { now: NOW });
    expect(t1).not.toContain('THREAT INTEL');
    const t2 = generateTemplate({ ...fullForm, threatActor: 'APT29', threatCategory: 'Command & Control' }, { now: NOW });
    expect(t2).toContain('THREAT INTEL');
    expect(t2).toContain('APT29');
  });

  test('TI-Einträge (Array): mehrere werden nummeriert gerendert', () => {
    const tiEntries = [
      { id: '1', category: 'Command & Control', actor: 'APT29', malware: 'Cobalt Strike', confidence: 'High' },
      { id: '2', category: 'Exfiltration', actor: 'FIN7', malware: '', confidence: 'Medium' },
    ];
    const t = generateTemplate(fullForm, { now: NOW, tiEntries });
    expect(t).toContain('THREAT INTEL');
    expect(t).toContain('APT29');
    expect(t).toContain('FIN7');
    expect(t).toContain('[ 01 ]');
    expect(t).toContain('[ 02 ]');
  });

  test('einzelner TI-Eintrag ohne Nummerierung', () => {
    const tiEntries = [{ id: '1', category: 'Impact', actor: 'LockBit', malware: '', confidence: 'High' }];
    const t = generateTemplate({}, { now: NOW, tiEntries });
    expect(t).toContain('THREAT INTEL');
    expect(t).toContain('LockBit');
    expect(t).not.toContain('[ 01 ]');
  });

  test('leere TI-Einträge erzeugen keine Sektion', () => {
    const tiEntries = [{ id: '1', category: '', actor: '', malware: '', confidence: '' }];
    expect(generateTemplate({}, { now: NOW, tiEntries })).not.toContain('THREAT INTEL');
  });

  test('Payload-Block: nummerierte Artefakte mit Typ + Feldern', () => {
    const payloads: TemplatePayload[] = [
      { type: 'Hash', fields: [{ label: 'Algorithmus', value: 'MD5' }, { label: 'Hashwert', value: 'd41d8cd98f00b204e9800998ecf8427e' }] },
      { type: 'URL', fields: [{ label: 'URL', value: 'https://evil.example/x.exe' }, { label: 'Leer', value: '' }] },
    ];
    const t = generateTemplate(fullForm, { now: NOW, payloads });
    expect(t).toContain('PAYLOAD / ARTEFAKTE');
    expect(t).toContain('[01]  HASH');
    expect(t).toContain('[02]  URL');
    expect(t).toContain('d41d8cd98f00b204e9800998ecf8427e');
    expect(t).not.toContain('Leer'); // leere Felder weggelassen
  });

  test('ohne Payloads kein Payload-Block', () => {
    expect(generateTemplate(fullForm, { now: NOW })).not.toContain('PAYLOAD / ARTEFAKTE');
  });
});

describe('wrapLine', () => {
  test('kurze Zeile bleibt unverändert', () => {
    expect(wrapLine('hallo welt', 20)).toEqual(['hallo welt']);
  });
  test('bricht an Wortgrenzen, trennt keine Wörter', () => {
    expect(wrapLine('eins zwei drei vier', 9)).toEqual(['eins zwei', 'drei vier']);
  });
  test('überlanges Einzelwort bleibt ganz', () => {
    expect(wrapLine('Supercalifragilistic', 5)).toEqual(['Supercalifragilistic']);
  });
});
