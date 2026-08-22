/**
 * Tests für StorageRetentionPanel — reine Helfer-Logik (keine React/DOM).
 * Kein Buffer, kein Node-API — nur pure Funktionen.
 */
import { describe, test, expect } from 'vitest';
import {
  formatBytes,
  tableLabel,
  tableShare,
  totalRecords,
} from './storageRetentionHelpers';

// ── formatBytes ───────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  test('gibt 0 B für 0 zurück', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  test('gibt 0 B für negative Werte zurück', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(-1000)).toBe('0 B');
  });

  test('zeigt Bytes unter 1 KB als "B"', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  test('zeigt 1024 Bytes als 1.0 KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  test('zeigt Megabytes korrekt', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20.0 MB');
  });

  test('rundet Werte >= 100 ohne Nachkommastelle', () => {
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
    expect(formatBytes(200 * 1024 * 1024)).toBe('200 MB');
  });

  test('zeigt Gigabytes korrekt', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatBytes(32 * 1024 * 1024 * 1024)).toBe('32.0 GB');
  });

  test('zeigt Terabytes korrekt', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
  });
});

// ── tableLabel ────────────────────────────────────────────────────────────────

describe('tableLabel', () => {
  test('übersetzt bekannte Tabellennamen ins Deutsche', () => {
    expect(tableLabel('tickets')).toBe('Tickets');
    expect(tableLabel('evidence')).toBe('Beweise');
    expect(tableLabel('audit_log')).toBe('Audit-Log');
    expect(tableLabel('hunt_sessions')).toBe('Hunt-Sessions');
    expect(tableLabel('notifications')).toBe('Benachrichtigungen');
  });

  test('gibt unbekannte Tabellennamen unverändert zurück', () => {
    expect(tableLabel('unknown_table')).toBe('unknown_table');
    expect(tableLabel('')).toBe('');
  });

  test('behandelt users und fp_exceptions', () => {
    expect(tableLabel('users')).toBe('Benutzer');
    expect(tableLabel('fp_exceptions')).toBe('FP-Ausnahmen');
  });
});

// ── tableShare ────────────────────────────────────────────────────────────────

describe('tableShare', () => {
  test('berechnet Anteil korrekt in Prozent', () => {
    expect(tableShare(500, 1000)).toBe(50);
    expect(tableShare(250, 1000)).toBe(25);
    expect(tableShare(1000, 1000)).toBe(100);
  });

  test('gibt 0 zurück wenn Gesamtgröße 0 ist', () => {
    expect(tableShare(100, 0)).toBe(0);
  });

  test('gibt 0 zurück wenn Bytes 0 ist', () => {
    expect(tableShare(0, 1000)).toBe(0);
  });

  test('rundet auf ganze Zahl', () => {
    expect(tableShare(1, 3)).toBe(33);
  });

  test('gibt nie mehr als 100 zurück', () => {
    expect(tableShare(1500, 1000)).toBe(100);
  });
});

// ── totalRecords ──────────────────────────────────────────────────────────────

describe('totalRecords', () => {
  test('summiert alle Count-Werte', () => {
    const counts = {
      tickets: 10, ticketsOpen: 3, evidence: 20, hunts: 5,
      findings: 8, audit24h: 50, fpExceptions: 2, users: 4,
    };
    // Alle 8 Felder: 10 + 3 + 20 + 5 + 8 + 50 + 2 + 4 = 102
    expect(totalRecords(counts)).toBe(102);
  });

  test('gibt 0 für leeres Objekt zurück', () => {
    expect(totalRecords({})).toBe(0);
  });

  test('gibt 0 für undefined zurück', () => {
    expect(totalRecords(undefined)).toBe(0);
  });

  test('ignoriert nicht-numerische Werte nicht — behandelt alle als Zahlen', () => {
    expect(totalRecords({ tickets: 5, users: 3 })).toBe(8);
  });

  test('ignoriert negative Werte nicht (Datenintegrität der API)', () => {
    expect(totalRecords({ tickets: -1, users: 3 })).toBe(2);
  });
});
