'use strict';

// TDD: CrowdSec-Adapter — normalisiert WAN-Alerts vom Webserver-CrowdSec
// (LAPI /v1/alerts bzw. `cscli alerts list -o json`) in den Nexora-Ticket-Vertrag.
// Reiner Adapter (validate → normalize → toTicketDraft), kein Netz.

const { CrowdsecAdapter } = require('../../src/integrations/adapters/crowdsec/CrowdsecAdapter');
const { ValidationError } = require('../../src/errors/AppError');

function bruteforceAlert(overrides = {}) {
  return {
    id: 42,
    scenario: 'crowdsecurity/http-bruteforce',
    message: "Ip 185.10.20.30 performed 'crowdsecurity/http-bruteforce' (6 events over 4s)",
    events_count: 6,
    start_at: '2026-06-19T20:00:00.000Z',
    stop_at: '2026-06-19T20:00:04.000Z',
    created_at: '2026-06-19T20:00:05.000Z',
    simulated: false,
    source: {
      scope: 'Ip', value: '185.10.20.30', ip: '185.10.20.30',
      as_number: '12345', as_name: 'EVIL-AS', cn: 'RU',
    },
    decisions: [
      { id: 1, origin: 'crowdsec', type: 'ban', scope: 'Ip', value: '185.10.20.30', duration: '4h', scenario: 'crowdsecurity/http-bruteforce', simulated: false },
    ],
    ...overrides,
  };
}

describe('CrowdsecAdapter.validate', () => {
  const adapter = new CrowdsecAdapter();

  test('akzeptiert ein gültiges Alert', () => {
    expect(() => adapter.validate(bruteforceAlert())).not.toThrow();
  });

  test('wirft ohne Objekt', () => {
    expect(() => adapter.validate(null)).toThrow(ValidationError);
    expect(() => adapter.validate('x')).toThrow(ValidationError);
  });

  test('wirft ohne scenario', () => {
    const a = bruteforceAlert(); delete a.scenario;
    expect(() => adapter.validate(a)).toThrow(ValidationError);
  });

  test('wirft ohne source.value (kein Indikator)', () => {
    const a = bruteforceAlert(); a.source = { scope: 'Ip' };
    expect(() => adapter.validate(a)).toThrow(ValidationError);
  });
});

describe('CrowdsecAdapter.normalize', () => {
  const adapter = new CrowdsecAdapter();

  test('mappt Kernfelder (IP, Zeit, externalId, source)', () => {
    const n = adapter.normalize(bruteforceAlert());
    expect(n.srcIp).toBe('185.10.20.30');
    expect(n.dstIp).toBe('');
    expect(n.datetime).toBe('2026-06-19T20:00:00.000Z');
    expect(n.externalId).toBe('crowdsec:alert:42');
    expect(n.source).toBe('crowdsec');
  });

  test('bruteforce → Kategorie Brute Force, MITRE T1110, priority high', () => {
    const n = adapter.normalize(bruteforceAlert());
    expect(n.category).toMatch(/brute/i);
    expect(n.mitre).toEqual({ id: 'T1110', name: 'Brute Force' });
    expect(n.priority).toBe('high');
  });

  test('CVE-/Exploit-Szenario → Exploitation, T1190, critical', () => {
    const n = adapter.normalize(bruteforceAlert({ scenario: 'crowdsecurity/http-cve-2021-41773' }));
    expect(n.category).toMatch(/exploit/i);
    expect(n.mitre.id).toBe('T1190');
    expect(n.priority).toBe('critical');
  });

  test('Probing/Scan-Szenario → Reconnaissance, T1595, low', () => {
    const n = adapter.normalize(bruteforceAlert({ scenario: 'crowdsecurity/http-probing' }));
    expect(n.category).toMatch(/recon/i);
    expect(n.mitre.id).toBe('T1595');
    expect(n.priority).toBe('low');
  });

  test('unbekanntes Szenario → Web Attack, kein MITRE, medium', () => {
    const n = adapter.normalize(bruteforceAlert({ scenario: 'custom/something-new' }));
    expect(n.category).toMatch(/web attack/i);
    expect(n.mitre).toBeNull();
    expect(n.priority).toBe('medium');
  });

  test('simuliertes Alert → priority info (Dry-Run, kein Fehlalarm-Eskalieren)', () => {
    const n = adapter.normalize(bruteforceAlert({ simulated: true }));
    expect(n.priority).toBe('info');
  });

  test('erkennt aktive Ban-Decision + Dauer', () => {
    const n = adapter.normalize(bruteforceAlert());
    expect(n.banned).toBe(true);
    expect(n.banDuration).toBe('4h');
  });

  test('ohne Decision → banned false', () => {
    const n = adapter.normalize(bruteforceAlert({ decisions: [] }));
    expect(n.banned).toBe(false);
  });

  test('Description enthält IP, Szenario, AS/Land und ist frei von HTML', () => {
    const n = adapter.normalize(bruteforceAlert());
    expect(n.description).toContain('185.10.20.30');
    expect(n.description).toContain('crowdsecurity/http-bruteforce');
    expect(n.description).toMatch(/AS12345|EVIL-AS/);
    expect(n.description).not.toMatch(/[<>]/);
  });

  test('Titel ist menschlich lesbar mit IP', () => {
    const n = adapter.normalize(bruteforceAlert());
    expect(n.title).toMatch(/185\.10\.20\.30/);
  });

  test('toleriert fehlende optionale Felder (events_count, as_*, message)', () => {
    const a = bruteforceAlert();
    delete a.events_count; delete a.message;
    a.source = { scope: 'Ip', value: '9.9.9.9' };
    a.created_at = '2026-06-19T21:00:00.000Z';
    delete a.start_at;
    const n = adapter.normalize(a);
    expect(n.srcIp).toBe('9.9.9.9');
    expect(n.datetime).toBe('2026-06-19T21:00:00.000Z'); // Fallback auf created_at
  });
});

describe('CrowdsecAdapter.toTicketDraft', () => {
  const adapter = new CrowdsecAdapter();

  test('erzeugt einen offenen, zugewiesenen Case mit Pflichtfeldern', () => {
    const draft = adapter.toTicketDraft(adapter.normalize(bruteforceAlert()));
    expect(draft.source).toBe('crowdsec');
    expect(draft.state).toBe('OPEN');
    expect(draft.status).toBe('assigned');
    expect(draft.srcIp).toBe('185.10.20.30');
    expect(draft.priority).toBe('high');
    expect(draft.offenseId).toBe('crowdsec:alert:42');
    expect(typeof draft.title).toBe('string');
    expect(typeof draft.description).toBe('string');
  });
});
