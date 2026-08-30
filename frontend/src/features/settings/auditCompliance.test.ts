/**
 * TDD RED: Tests für reine Helfer in auditComplianceHelpers.ts
 * Kein Buffer, kein Node-API — nur pure Funktionen, kein React, kein DOM.
 */
import { describe, test, expect } from 'vitest';
import {
  countByAction,
  actionLabel,
  recentWindowLabel,
} from './auditComplianceHelpers';
import type { AuditEntry } from '../audit/auditApi';

// ── countByAction ─────────────────────────────────────────────────────────────

describe('countByAction', () => {
  test('gibt leeres Objekt für leeres Array zurück', () => {
    expect(countByAction([])).toEqual({});
  });

  test('zählt einzelnen Eintrag je Action', () => {
    const entries: AuditEntry[] = [
      { id: '1', action: 'LOGIN', actorLabel: 'u', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
    ];
    expect(countByAction(entries)).toEqual({ LOGIN: 1 });
  });

  test('aggregiert mehrere Einträge gleicher Action', () => {
    const entries: AuditEntry[] = [
      { id: '1', action: 'LOGIN', actorLabel: 'u1', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
      { id: '2', action: 'LOGIN', actorLabel: 'u2', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
      { id: '3', action: 'TICKET_CREATE', actorLabel: 'u1', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
    ];
    expect(countByAction(entries)).toEqual({ LOGIN: 2, TICKET_CREATE: 1 });
  });

  test('zählt verschiedene Actions korrekt', () => {
    const entries: AuditEntry[] = [
      { id: '1', action: 'LOGIN', actorLabel: 'u', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
      { id: '2', action: 'LOGOUT', actorLabel: 'u', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
      { id: '3', action: 'TICKET_CREATE', actorLabel: 'u', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
      { id: '4', action: 'TICKET_UPDATE', actorLabel: 'u', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
      { id: '5', action: 'LOGIN', actorLabel: 'u', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
    ];
    const result = countByAction(entries);
    expect(result['LOGIN']).toBe(2);
    expect(result['LOGOUT']).toBe(1);
    expect(result['TICKET_CREATE']).toBe(1);
    expect(result['TICKET_UPDATE']).toBe(1);
  });

  test('gibt Summe aller Counts korrekt wieder', () => {
    const entries: AuditEntry[] = [
      { id: '1', action: 'A', actorLabel: '', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
      { id: '2', action: 'A', actorLabel: '', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
      { id: '3', action: 'B', actorLabel: '', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
    ];
    const counts = countByAction(entries);
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    expect(total).toBe(3);
  });

  test('verändert das Eingabe-Array nicht (immutable)', () => {
    const entries: AuditEntry[] = [
      { id: '1', action: 'LOGIN', actorLabel: '', targetType: '', targetId: '', ip: '', createdAt: '', metadata: {} },
    ];
    const before = entries.length;
    countByAction(entries);
    expect(entries.length).toBe(before);
  });
});

// ── actionLabel ───────────────────────────────────────────────────────────────

describe('actionLabel', () => {
  test('übersetzt bekannte Action-Codes ins Deutsche', () => {
    expect(actionLabel('LOGIN')).toBe('Anmeldung');
    expect(actionLabel('LOGOUT')).toBe('Abmeldung');
    expect(actionLabel('TICKET_CREATE')).toBe('Ticket erstellt');
    expect(actionLabel('TICKET_UPDATE')).toBe('Ticket aktualisiert');
    expect(actionLabel('TICKET_DELETE')).toBe('Ticket gelöscht');
    expect(actionLabel('USER_CREATE')).toBe('Benutzer erstellt');
    expect(actionLabel('USER_UPDATE')).toBe('Benutzer aktualisiert');
    expect(actionLabel('USER_DELETE')).toBe('Benutzer gelöscht');
  });

  test('gibt unbekannte Actions unverändert zurück', () => {
    expect(actionLabel('UNKNOWN_ACTION')).toBe('UNKNOWN_ACTION');
    expect(actionLabel('')).toBe('');
    expect(actionLabel('CUSTOM_OP')).toBe('CUSTOM_OP');
  });

  test('gibt für HUNT_START und HUNT_STOP Labels zurück', () => {
    expect(actionLabel('HUNT_START')).toBe('Hunt gestartet');
    expect(actionLabel('HUNT_STOP')).toBe('Hunt gestoppt');
  });

  test('gibt für FP_EXCEPTION einen Label zurück', () => {
    expect(actionLabel('FP_EXCEPTION_CREATE')).toBe('FP-Ausnahme erstellt');
  });
});

// ── recentWindowLabel ─────────────────────────────────────────────────────────

describe('recentWindowLabel', () => {
  test('gibt "letzte 25 Einträge" für Default-Limit 25', () => {
    expect(recentWindowLabel(25)).toBe('Letzte 25 Einträge');
  });

  test('gibt korrekte Bezeichnung für beliebige Limits', () => {
    expect(recentWindowLabel(10)).toBe('Letzte 10 Einträge');
    expect(recentWindowLabel(50)).toBe('Letzte 50 Einträge');
    expect(recentWindowLabel(100)).toBe('Letzte 100 Einträge');
    expect(recentWindowLabel(1)).toBe('Letzter 1 Eintrag');
  });

  test('gibt "Letzter 1 Eintrag" für Limit 1 (Singular)', () => {
    expect(recentWindowLabel(1)).toBe('Letzter 1 Eintrag');
  });

  test('gibt "Letzte 0 Einträge" für Limit 0', () => {
    expect(recentWindowLabel(0)).toBe('Letzte 0 Einträge');
  });
});
