import { describe, test, expect } from 'vitest';
import {
  statusLabel, statusTone, evidenceTypeLabel, controlSignal, isAddressedWithoutEvidence,
  formatDate, coverageTone, NIS2_HEADER_SUBTITLE,
  // P_NIS2_2 additions:
  STATUS_ORDER, reportStatusRows, incidentCoverageText, formatGeneratedAt, reportControlTone,
} from './nis2View';
import type { AssessmentStatus } from './nis2Api';

describe('Status-Darstellung', () => {
  test('Label + Tone', () => {
    expect(statusLabel('addressed')).toBe('Bearbeitet');
    expect(statusTone('needs_review')).toBe('warning');
    expect(statusTone('addressed')).toBe('success');
    expect(evidenceTypeLabel('gitops_profile')).toBe('GitOps-Profil');
  });
});

describe('controlSignal — dringendstes ehrliches Signal', () => {
  test('overdue gewinnt vor allem', () => {
    expect(controlSignal({ overdue: true, needsReview: true, missingEvidence: true, reviewDue: false, status: 'in_progress' }))
      .toEqual({ tone: 'danger', label: 'Überfällig' });
  });
  test('needsReview vor missingEvidence', () => {
    expect(controlSignal({ overdue: false, needsReview: true, missingEvidence: true, reviewDue: false, status: 'addressed' }).label).toBe('Review nötig');
  });
  test('keine Evidence', () => {
    expect(controlSignal({ overdue: false, needsReview: false, missingEvidence: true, reviewDue: false, status: 'in_progress' }).label).toBe('Keine Evidence');
  });
  test('reviewDue → „Review fällig" (nach den dringenderen Signalen)', () => {
    expect(controlSignal({ overdue: false, needsReview: false, missingEvidence: false, reviewDue: true, status: 'addressed' }))
      .toEqual({ tone: 'warning', label: 'Review fällig' });
  });
  test('alles ok → OK/success', () => {
    expect(controlSignal({ overdue: false, needsReview: false, missingEvidence: false, reviewDue: false, status: 'addressed' }))
      .toEqual({ tone: 'success', label: 'OK' });
  });
  test('not_applicable', () => {
    expect(controlSignal({ overdue: false, needsReview: false, missingEvidence: false, reviewDue: false, status: 'not_applicable' }).label).toBe('Nicht anwendbar');
  });
});

describe('Ehrlichkeit', () => {
  test('addressed ohne Evidence ist kein Voll-Nachweis', () => {
    expect(isAddressedWithoutEvidence('addressed', 0)).toBe(true);
    expect(isAddressedWithoutEvidence('addressed', 2)).toBe(false);
  });
  test('Header-Subtitle behauptet keine Konformität', () => {
    expect(NIS2_HEADER_SUBTITLE.toLowerCase()).not.toMatch(/compliant|zertifiziert|konform(?!itätsnachweis)/);
    expect(NIS2_HEADER_SUBTITLE).toMatch(/kein Konformitätsnachweis/i);
  });
});

describe('Hilfsfunktionen', () => {
  test('formatDate', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatDate('2026-06-18T00:00:00Z')).toMatch(/2026/);
  });
  test('coverageTone', () => {
    expect(coverageTone(90)).toBe('success');
    expect(coverageTone(50)).toBe('warning');
    expect(coverageTone(10)).toBe('danger');
  });
});

// P_NIS2_2 — Management-Report-Helfer.
describe('STATUS_ORDER — alle 6 Status vorhanden, keine Duplikate', () => {
  const ALL_STATUSES: AssessmentStatus[] = [
    'not_started', 'in_progress', 'evidence_collected',
    'needs_review', 'addressed', 'not_applicable',
  ];
  test('enthält alle 6 Status', () => {
    expect(STATUS_ORDER).toHaveLength(6);
    for (const s of ALL_STATUSES) {
      expect(STATUS_ORDER).toContain(s);
    }
  });
  test('keine Duplikate', () => {
    expect(new Set(STATUS_ORDER).size).toBe(STATUS_ORDER.length);
  });
});

describe('reportStatusRows', () => {
  test('liefert eine Zeile pro Status in STATUS_ORDER-Reihenfolge', () => {
    const summary = {
      byStatus: { not_started: 2, addressed: 5 } as Partial<Record<AssessmentStatus, number>>,
    };
    const rows = reportStatusRows(summary);
    expect(rows).toHaveLength(STATUS_ORDER.length);
    // Reihenfolge entspricht STATUS_ORDER
    rows.forEach((r, i) => { expect(r.status).toBe(STATUS_ORDER[i]); });
  });

  test('fehlende byStatus-Keys ergeben count 0, nicht undefined', () => {
    const rows = reportStatusRows({ byStatus: {} });
    for (const r of rows) {
      expect(typeof r.count).toBe('number');
      expect(r.count).toBe(0);
    }
  });

  test('bekannte Counts werden korrekt übernommen', () => {
    const rows = reportStatusRows({ byStatus: { needs_review: 3, overdue: 1 } as Partial<Record<AssessmentStatus, number>> });
    const needsReviewRow = rows.find(r => r.status === 'needs_review');
    expect(needsReviewRow?.count).toBe(3);
  });

  test('jede Zeile enthält status, label und count', () => {
    const rows = reportStatusRows({ byStatus: { in_progress: 1 } as Partial<Record<AssessmentStatus, number>> });
    for (const r of rows) {
      expect(r).toHaveProperty('status');
      expect(r).toHaveProperty('label');
      expect(r).toHaveProperty('count');
      expect(typeof r.label).toBe('string');
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
});

describe('coverageTone — Schwellenwerte', () => {
  test('≥80 → success', () => { expect(coverageTone(80)).toBe('success'); });
  test('79 → warning', () => { expect(coverageTone(79)).toBe('warning'); });
  test('≥40 → warning', () => { expect(coverageTone(40)).toBe('warning'); });
  test('39 → danger', () => { expect(coverageTone(39)).toBe('danger'); });
  test('0 → danger', () => { expect(coverageTone(0)).toBe('danger'); });
  test('100 → success', () => { expect(coverageTone(100)).toBe('success'); });
});

describe('incidentCoverageText', () => {
  test('formatiert "X von Y Controls mit Incident-Nachweis"', () => {
    const text = incidentCoverageText({ incidentEvidenceTotal: 3, controlsTotal: 10 });
    expect(text).toMatch(/3/);
    expect(text).toMatch(/10/);
    expect(text).toMatch(/Incident/i);
    // KEIN Compliance-Claim
    expect(text.toLowerCase()).not.toMatch(/konform|compliant|zertifiziert/);
  });

  test('0 von 0 → korrekte Ausgabe ohne Crash', () => {
    const text = incidentCoverageText({ incidentEvidenceTotal: 0, controlsTotal: 0 });
    expect(text).toMatch(/0/);
  });

  test('Singular und Plural crasht nicht', () => {
    expect(() => incidentCoverageText({ incidentEvidenceTotal: 1, controlsTotal: 10 })).not.toThrow();
  });
});

describe('formatGeneratedAt', () => {
  test('gültiges ISO → enthält Jahr und Uhrzeitteile', () => {
    const result = formatGeneratedAt('2026-06-19T05:30:00Z');
    expect(result).toMatch(/2026/);
    // Nicht leer, nicht Fallback
    expect(result).not.toBe('—');
  });

  test('leerer String → "—"', () => {
    expect(formatGeneratedAt('')).toBe('—');
  });

  test('ungültiges ISO → "—"', () => {
    expect(formatGeneratedAt('not-a-date')).toBe('—');
  });

  test('null-ähnlicher Wert (undefined cast) → "—"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(formatGeneratedAt(undefined as any)).toBe('—');
  });
});

describe('reportControlTone', () => {
  test('overdue → danger', () => {
    expect(reportControlTone({ overdue: true, needsReview: false, missingEvidence: false, reviewDue: false, status: 'in_progress' }))
      .toBe('danger');
  });

  test('needsReview → warning', () => {
    expect(reportControlTone({ overdue: false, needsReview: true, missingEvidence: false, reviewDue: false, status: 'addressed' }))
      .toBe('warning');
  });

  test('missingEvidence → warning', () => {
    expect(reportControlTone({ overdue: false, needsReview: false, missingEvidence: true, reviewDue: false, status: 'in_progress' }))
      .toBe('warning');
  });

  test('reviewDue → warning (stale-Evidence, P_NIS2_3)', () => {
    expect(reportControlTone({ overdue: false, needsReview: false, missingEvidence: false, reviewDue: true, status: 'addressed' }))
      .toBe('warning');
  });

  test('alles ok → success', () => {
    expect(reportControlTone({ overdue: false, needsReview: false, missingEvidence: false, reviewDue: false, status: 'addressed' }))
      .toBe('success');
  });

  test('not_applicable ohne Signale → muted', () => {
    expect(reportControlTone({ overdue: false, needsReview: false, missingEvidence: false, reviewDue: false, status: 'not_applicable' }))
      .toBe('muted');
  });

  test('not_started ohne Signale → muted', () => {
    expect(reportControlTone({ overdue: false, needsReview: false, missingEvidence: false, reviewDue: false, status: 'not_started' }))
      .toBe('muted');
  });
});

describe('Kein Compliance-Claim in Labels', () => {
  const FORBIDDEN = /konform|compliant|zertifiziert|conform|certified/i;

  test('statusLabel liefert keine Compliance-Claims', () => {
    const statuses: AssessmentStatus[] = [
      'not_started', 'in_progress', 'evidence_collected',
      'needs_review', 'addressed', 'not_applicable',
    ];
    for (const s of statuses) {
      expect(statusLabel(s)).not.toMatch(FORBIDDEN);
    }
  });

  test('reportStatusRows-Labels enthalten keine Compliance-Claims', () => {
    const rows = reportStatusRows({ byStatus: {} });
    for (const r of rows) {
      expect(r.label).not.toMatch(FORBIDDEN);
    }
  });

  test('NIS2_HEADER_SUBTITLE enthält keinen Compliance-Claim', () => {
    // „Konformitätsnachweis" ist erlaubt (es ist ein ehrlicher Disclaimer-Begriff).
    // FORBIDDEN darf dort nicht standalone auftauchen → gleiche Logik wie das bestehende Test.
    expect(NIS2_HEADER_SUBTITLE.toLowerCase()).not.toMatch(/compliant|zertifiziert|certified/);
    expect(NIS2_HEADER_SUBTITLE).toMatch(/kein Konformitätsnachweis/i);
  });
});
