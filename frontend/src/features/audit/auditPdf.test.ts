import { describe, test, expect } from 'vitest';
import {
  auditEntryToPdfRow,
  auditPdfFilename,
  buildAuditPdfDoc,
  formatPdfCell,
  AUDIT_PDF_COLUMNS,
} from './auditPdf';
import type { AuditEntry } from './auditApi';

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'a1', action: 'LOGIN', actorLabel: 'admin@x', targetType: 'user',
    targetId: 'u1', ip: '10.0.0.1', createdAt: '2026-06-19T15:00:00.000Z',
    metadata: {}, ...over,
  };
}

describe('formatPdfCell', () => {
  test('null/undefined → leerer String', () => {
    expect(formatPdfCell(null)).toBe('');
    expect(formatPdfCell(undefined)).toBe('');
  });
  test('kürzt zu lange Werte mit Ellipse', () => {
    expect(formatPdfCell('abcdef', 4)).toBe('abc…');
  });
  test('kurze Werte bleiben unverändert', () => {
    expect(formatPdfCell('abc', 10)).toBe('abc');
  });
});

describe('auditEntryToPdfRow', () => {
  test('eine Zelle je Spalte, Ziel = Typ: Id', () => {
    const row = auditEntryToPdfRow(entry());
    expect(row).toHaveLength(AUDIT_PDF_COLUMNS.length);
    expect(row[1]).toBe('LOGIN');
    expect(row[3]).toBe('user: u1');
  });
  test('metadata wird als JSON serialisiert', () => {
    const row = auditEntryToPdfRow(entry({ metadata: { controlKey: 'incident_handling' } }));
    expect(row[5]).toContain('controlKey');
  });
});

describe('auditPdfFilename', () => {
  test('Format nexora-audit-YYYYMMDD-HHMM.pdf', () => {
    expect(auditPdfFilename(new Date('2026-06-19T16:45:00'))).toBe('nexora-audit-20260619-1645.pdf');
  });
});

describe('buildAuditPdfDoc', () => {
  test('leere Liste → gültiges 1-seitiges Dokument', () => {
    const doc = buildAuditPdfDoc([], new Date('2026-06-19T16:45:00'));
    expect(doc.getNumberOfPages()).toBe(1);
    expect(doc.output('blob').size).toBeGreaterThan(0);
  });
  test('viele Einträge → Pagination über mehrere Seiten', () => {
    const many = Array.from({ length: 200 }, (_, i) => entry({ id: `a${i}`, action: `ACT_${i}` }));
    const doc = buildAuditPdfDoc(many);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});
