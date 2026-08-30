import { describe, test, expect } from 'vitest';
import { auditEntriesToCsv, escapeCsvField, auditCsvFilename, AUDIT_CSV_COLUMNS } from './auditExport';
import type { AuditEntry } from './auditApi';

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'a1', action: 'LOGIN', actorLabel: 'admin@x', targetType: 'user',
    targetId: 'u1', ip: '10.0.0.1', createdAt: '2026-06-19T15:00:00.000Z',
    metadata: {}, ...over,
  };
}

describe('escapeCsvField', () => {
  test('einfacher Wert bleibt unverändert', () => {
    expect(escapeCsvField('LOGIN')).toBe('LOGIN');
  });
  test('null/undefined → leerer String', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });
  test('Komma/Anführungszeichen → gequotet, " verdoppelt', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
  });
  test('Zeilenumbruch → gequotet', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });
  test('CSV-Injection: führende = + - @ werden mit \' neutralisiert', () => {
    expect(escapeCsvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeCsvField('+1')).toBe("'+1");
    expect(escapeCsvField('-2')).toBe("'-2");
    expect(escapeCsvField('@cmd')).toBe("'@cmd");
  });
  test('Injection + Sonderzeichen kombiniert (erst neutralisieren, dann quoten)', () => {
    expect(escapeCsvField('=1,2')).toBe('"\'=1,2"');
  });
});

describe('auditEntriesToCsv', () => {
  test('Header entspricht den Spalten', () => {
    const csv = auditEntriesToCsv([]);
    expect(csv).toBe(AUDIT_CSV_COLUMNS.join(','));
  });
  test('eine Zeile je Eintrag, CRLF-getrennt', () => {
    const csv = auditEntriesToCsv([entry(), entry({ action: 'LOGOUT' })]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3); // Header + 2
    expect(lines[1]).toContain('LOGIN');
    expect(lines[2]).toContain('LOGOUT');
  });
  test('metadata wird als JSON serialisiert + gequotet', () => {
    const csv = auditEntriesToCsv([entry({ metadata: { controlKey: 'incident_handling', n: 1 } })]);
    expect(csv).toContain('"{""controlKey"":""incident_handling"",""n"":1}"');
  });
  test('PII/Sonderzeichen im actorLabel werden korrekt escaped, kein Spaltenbruch', () => {
    const csv = auditEntriesToCsv([entry({ actorLabel: 'a,b@x' })]);
    const dataLine = csv.split('\r\n')[1];
    // Genau 7 Spalten trotz Komma im Wert (gequotet).
    expect(dataLine.startsWith('2026-06-19T15:00:00.000Z,LOGIN,"a,b@x",user,u1,10.0.0.1,')).toBe(true);
  });
});

describe('auditCsvFilename', () => {
  test('Format nexora-audit-YYYYMMDD-HHMM.csv', () => {
    const name = auditCsvFilename(new Date('2026-06-19T15:30:00'));
    expect(name).toBe('nexora-audit-20260619-1530.csv');
  });
});
