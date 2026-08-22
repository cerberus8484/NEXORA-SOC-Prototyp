'use strict';

// P_NIS2_1 — Catalog + Domain-Validierung + computeFlags.
const { NIS2_CONTROLS, CONTROL_KEYS, isKnownControlKey } = require('../../../src/compliance/nis2/nis2ControlCatalog');
const { Nis2Assessment, ASSESSMENT_STATUS } = require('../../../src/compliance/nis2/Nis2Assessment');
const { Nis2EvidenceLink } = require('../../../src/compliance/nis2/Nis2EvidenceLink');
const { computeFlags } = require('../../../src/compliance/nis2/Nis2ReadinessService');

describe('NIS2 Control Catalog', () => {
  test('liefert genau zehn Controls mit stabilen Keys + deutschen Titeln', () => {
    expect(NIS2_CONTROLS).toHaveLength(10);
    expect(CONTROL_KEYS).toContain('risk_analysis_and_information_security');
    expect(CONTROL_KEYS).toContain('mfa_and_secure_communications');
    expect(new Set(CONTROL_KEYS).size).toBe(10); // eindeutig
    for (const c of NIS2_CONTROLS) {
      expect(typeof c.key).toBe('string');
      expect(typeof c.title).toBe('string');
      expect(Array.isArray(c.evidenceHints)).toBe(true);
      expect(typeof c.sourceReference).toBe('string');
      expect(typeof c.version).toBe('string');
    }
  });
  test('sourceReference enthält keinen Compliance-/Konformitäts-Claim', () => {
    const dump = JSON.stringify(NIS2_CONTROLS).toLowerCase();
    expect(dump).not.toMatch(/compliant|zertifiziert|konformitätsnachweis|rechtssicher/);
  });
});

describe('Nis2Assessment — Validierung', () => {
  test('akzeptiert nur bekannte controlKeys', () => {
    expect(isKnownControlKey('incident_handling')).toBe(true);
    expect(() => Nis2Assessment.create({ controlKey: 'nope' })).toThrow(/controlKey/);
  });
  test('validiert das Status-Enum', () => {
    expect(ASSESSMENT_STATUS).toContain('addressed');
    expect(() => Nis2Assessment.create({ controlKey: 'incident_handling', status: 'magic' })).toThrow(/status/);
  });
  test('not_applicable benötigt eine Begründung (notes)', () => {
    expect(() => Nis2Assessment.create({ controlKey: 'incident_handling', status: 'not_applicable' })).toThrow(/begründung|not_applicable/i);
    const ok = Nis2Assessment.create({ controlKey: 'incident_handling', status: 'not_applicable', notes: 'Nicht anwendbar, weil ...' });
    expect(ok.status).toBe('not_applicable');
  });
  test('lehnt HTML in owner/notes ab (Defense-in-Depth)', () => {
    expect(() => Nis2Assessment.create({ controlKey: 'incident_handling', owner: '<script>x' })).toThrow(/unerlaubte/i);
  });
  test('update lässt controlKey unverändert + setzt updatedBy', () => {
    const a = Nis2Assessment.create({ controlKey: 'incident_handling' }, 'admin@x');
    const u = a.update({ status: 'in_progress', owner: 'SecTeam' }, 'admin2@x');
    expect(u.controlKey).toBe('incident_handling');
    expect(u.status).toBe('in_progress');
    expect(u.updatedBy).toBe('admin2@x');
    expect(u.createdBy).toBe('admin@x'); // unverändert
    expect(u.id).toBe(a.id);
  });
});

describe('Nis2EvidenceLink — Validierung', () => {
  const base = { assessmentId: 'a1', evidenceType: 'ticket', evidenceRef: 'INC000460', title: 'Incident Ticket' };

  test('evidenceRef + title sind Pflicht', () => {
    expect(() => Nis2EvidenceLink.create({ ...base, evidenceRef: '' })).toThrow(/evidenceRef/);
    expect(() => Nis2EvidenceLink.create({ ...base, title: '' })).toThrow(/title/);
  });
  test('unbekannter evidenceType wird abgelehnt', () => {
    expect(() => Nis2EvidenceLink.create({ ...base, evidenceType: 'hack' })).toThrow(/evidenceType/);
  });
  test('Plain-Ref (kein URL) ist erlaubt', () => {
    const e = Nis2EvidenceLink.create(base);
    expect(e.evidenceRef).toBe('INC000460');
  });
  test('http/https-URL ist erlaubt', () => {
    const e = Nis2EvidenceLink.create({ ...base, evidenceType: 'external_reference', evidenceRef: 'https://wiki.local/policy' });
    expect(e.evidenceRef).toBe('https://wiki.local/policy');
  });
  test('nicht-http(s)-Schema wird abgelehnt', () => {
    expect(() => Nis2EvidenceLink.create({ ...base, evidenceRef: 'javascript:alert(1)' })).toThrow();
    expect(() => Nis2EvidenceLink.create({ ...base, evidenceRef: 'ftp://x/y' })).toThrow(/http/);
  });
  test('Secret-artige URL-Parameter werden abgelehnt', () => {
    for (const u of [
      'https://x.local/a?token=abc',
      'https://x.local/a?api_key=abc',
      'https://x.local/a?secret=abc',
      'https://x.local/a?password=abc',
      'https://x.local/a?bearer=abc',
      'https://x.local/a?authorization=abc',
    ]) {
      expect(() => Nis2EvidenceLink.create({ ...base, evidenceRef: u })).toThrow(/secret-artig|query/i);
    }
  });
  test('Secret im URL-Fragment (#token=...) wird abgelehnt (OAuth-Implicit-Bypass)', () => {
    for (const u of ['https://x.local/p#token=abc', 'https://x.local/p#access_token=eyJ', 'https://x.local/p#secret=s']) {
      expect(() => Nis2EvidenceLink.create({ ...base, evidenceRef: u })).toThrow(/secret-artig|parameter/i);
    }
  });
  test('Steuerzeichen in einer URL werden abgelehnt', () => {
    expect(() => Nis2EvidenceLink.create({ ...base, evidenceRef: 'https://x.local/a\nb' })).toThrow(/steuerzeichen/i);
  });
  test('eingebettete Zugangsdaten (user:password@) werden abgelehnt', () => {
    expect(() => Nis2EvidenceLink.create({ ...base, evidenceRef: 'https://user:pass@x.local/a' })).toThrow(/zugangsdaten|user:password/i);
  });
});

describe('computeFlags', () => {
  const now = new Date('2026-06-18T00:00:00Z').getTime();
  const past = '2026-06-01T00:00:00Z';
  const future = '2026-12-01T00:00:00Z';

  test('overdue: Fälligkeit überschritten + nicht addressed/not_applicable', () => {
    expect(computeFlags('in_progress', 0, past, now).overdue).toBe(true);
    expect(computeFlags('addressed', 1, past, now).overdue).toBe(false);
    expect(computeFlags('not_applicable', 0, past, now).overdue).toBe(false);
    expect(computeFlags('in_progress', 0, future, now).overdue).toBe(false);
  });
  test('missingEvidence: keine Evidence + nicht not_applicable', () => {
    expect(computeFlags('in_progress', 0, null, now).missingEvidence).toBe(true);
    expect(computeFlags('in_progress', 2, null, now).missingEvidence).toBe(false);
    expect(computeFlags('not_applicable', 0, null, now).missingEvidence).toBe(false);
  });
  test('addressed ohne Evidence → needsReview (ehrlich, kein Voll-Nachweis)', () => {
    expect(computeFlags('addressed', 0, null, now).needsReview).toBe(true);
    expect(computeFlags('addressed', 1, null, now).needsReview).toBe(false);
    expect(computeFlags('needs_review', 5, null, now).needsReview).toBe(true);
  });
});
