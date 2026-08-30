// TDD RED: Reine Logiktests für securityEventsFormat.
// Kein Buffer, kein @types/node — no JSX, no DOM.

import { describe, test, expect } from 'vitest';
import {
  formatSecurityEvent,
  filterSecurityEvents,
  SECURITY_ACTIONS,
  type FormattedSecurityEvent,
} from './securityEventsFormat';
import type { AuditEntry } from '../audit/auditApi';

// ── Hilfsfunktion: Minimaler AuditEntry ──────────────────────────────────────

function makeEntry(action: string, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: `test-${action}`,
    action,
    actorLabel: 'admin@nexora.example',
    targetType: 'user',
    targetId: 'usr-1',
    ip: '10.99.99.5',
    createdAt: '2026-06-15T10:30:00Z',
    metadata: {},
    ...overrides,
  };
}

// ── SECURITY_ACTIONS: enthält die relevanten Actions ─────────────────────────

describe('SECURITY_ACTIONS', () => {
  test('enthält LOGIN', () => {
    expect(SECURITY_ACTIONS).toContain('LOGIN');
  });

  test('enthält LOGIN_FAILED', () => {
    expect(SECURITY_ACTIONS).toContain('LOGIN_FAILED');
  });

  test('enthält USER_ACTIVE_CHANGE', () => {
    expect(SECURITY_ACTIONS).toContain('USER_ACTIVE_CHANGE');
  });

  test('enthält USER_PASSWORD_RESET', () => {
    expect(SECURITY_ACTIONS).toContain('USER_PASSWORD_RESET');
  });

  test('enthält USER_ROLE_CHANGE', () => {
    expect(SECURITY_ACTIONS).toContain('USER_ROLE_CHANGE');
  });
});

// ── filterSecurityEvents ──────────────────────────────────────────────────────

describe('filterSecurityEvents', () => {
  test('gibt nur Security-Actions zurück', () => {
    const entries: AuditEntry[] = [
      makeEntry('LOGIN'),
      makeEntry('TICKET_CREATE'),
      makeEntry('LOGIN_FAILED'),
      makeEntry('HUNT_CREATE'),
      makeEntry('USER_ROLE_CHANGE'),
    ];
    const filtered = filterSecurityEvents(entries);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((e) => e.action)).toEqual(['LOGIN', 'LOGIN_FAILED', 'USER_ROLE_CHANGE']);
  });

  test('leere Liste → leere Liste', () => {
    expect(filterSecurityEvents([])).toHaveLength(0);
  });

  test('keine Security-Events → leere Liste', () => {
    const entries: AuditEntry[] = [makeEntry('TICKET_CREATE'), makeEntry('HUNT_CREATE')];
    expect(filterSecurityEvents(entries)).toHaveLength(0);
  });

  test('alle Security-Actions → alle zurück', () => {
    const entries = SECURITY_ACTIONS.map((a) => makeEntry(a));
    expect(filterSecurityEvents(entries)).toHaveLength(SECURITY_ACTIONS.length);
  });
});

// ── formatSecurityEvent: LOGIN ────────────────────────────────────────────────

describe('formatSecurityEvent – LOGIN', () => {
  test('Beschreibung enthält "Anmeldung erfolgreich"', () => {
    const r: FormattedSecurityEvent = formatSecurityEvent(makeEntry('LOGIN'));
    expect(r.description).toMatch(/anmeldung erfolgreich/i);
  });

  test('isSuccess ist true', () => {
    const r = formatSecurityEvent(makeEntry('LOGIN'));
    expect(r.isSuccess).toBe(true);
  });

  test('actor ist übernommen', () => {
    const r = formatSecurityEvent(makeEntry('LOGIN', { actorLabel: 'alice@nexora.example' }));
    expect(r.actor).toBe('alice@nexora.example');
  });

  test('createdAt ist übernommen', () => {
    const r = formatSecurityEvent(makeEntry('LOGIN', { createdAt: '2026-06-15T10:30:00Z' }));
    expect(r.createdAt).toBe('2026-06-15T10:30:00Z');
  });

  test('action ist übernommen', () => {
    const r = formatSecurityEvent(makeEntry('LOGIN'));
    expect(r.action).toBe('LOGIN');
  });
});

// ── formatSecurityEvent: LOGIN_FAILED ────────────────────────────────────────

describe('formatSecurityEvent – LOGIN_FAILED', () => {
  test('Beschreibung enthält "fehlgeschlagen" oder "Anmeldung"', () => {
    const r = formatSecurityEvent(makeEntry('LOGIN_FAILED'));
    expect(r.description).toMatch(/fehlgeschlagen|anmeldung|login/i);
  });

  test('isSuccess ist false', () => {
    const r = formatSecurityEvent(makeEntry('LOGIN_FAILED'));
    expect(r.isSuccess).toBe(false);
  });
});

// ── formatSecurityEvent: USER_ACTIVE_CHANGE ───────────────────────────────────

describe('formatSecurityEvent – USER_ACTIVE_CHANGE', () => {
  test('Beschreibung enthält "Konto" oder "gesperrt" oder "aktiviert"', () => {
    const r = formatSecurityEvent(makeEntry('USER_ACTIVE_CHANGE'));
    expect(r.description).toMatch(/konto|gesperrt|aktiviert|deaktiviert/i);
  });

  test('isSuccess ist true (Status-Änderung ist eine normale Admin-Aktion)', () => {
    const r = formatSecurityEvent(makeEntry('USER_ACTIVE_CHANGE'));
    expect(r.isSuccess).toBe(true);
  });
});

// ── formatSecurityEvent: USER_PASSWORD_RESET ──────────────────────────────────

describe('formatSecurityEvent – USER_PASSWORD_RESET', () => {
  test('Beschreibung enthält "Passwort" oder "Reset"', () => {
    const r = formatSecurityEvent(makeEntry('USER_PASSWORD_RESET'));
    expect(r.description).toMatch(/passwort|reset/i);
  });

  test('isSuccess ist true', () => {
    const r = formatSecurityEvent(makeEntry('USER_PASSWORD_RESET'));
    expect(r.isSuccess).toBe(true);
  });
});

// ── formatSecurityEvent: USER_ROLE_CHANGE ─────────────────────────────────────

describe('formatSecurityEvent – USER_ROLE_CHANGE', () => {
  test('Beschreibung enthält "Rolle" oder "Berechtigung"', () => {
    const r = formatSecurityEvent(makeEntry('USER_ROLE_CHANGE'));
    expect(r.description).toMatch(/rolle|berechtigung|rechte/i);
  });

  test('isSuccess ist true', () => {
    const r = formatSecurityEvent(makeEntry('USER_ROLE_CHANGE'));
    expect(r.isSuccess).toBe(true);
  });
});

// ── formatSecurityEvent: Fallback ────────────────────────────────────────────

describe('formatSecurityEvent – Fallback / unbekannte Action', () => {
  test('unbekannte Action → Beschreibung enthält die Action als Text', () => {
    const r = formatSecurityEvent(makeEntry('SOME_UNKNOWN_ACTION'));
    expect(r.description.length).toBeGreaterThan(0);
  });

  test('unbekannte Action → isSuccess ist true (kein spezifisches Wissen)', () => {
    const r = formatSecurityEvent(makeEntry('SOME_UNKNOWN_ACTION'));
    expect(typeof r.isSuccess).toBe('boolean');
  });
});

// ── FormattedSecurityEvent: Vollständige Felder ───────────────────────────────

describe('FormattedSecurityEvent – Feldvollständigkeit', () => {
  test('alle Pflichtfelder sind belegt', () => {
    const r = formatSecurityEvent(makeEntry('LOGIN'));
    expect(r.id).toBeDefined();
    expect(r.action).toBeDefined();
    expect(r.description).toBeDefined();
    expect(r.actor).toBeDefined();
    expect(r.createdAt).toBeDefined();
    expect(typeof r.isSuccess).toBe('boolean');
  });

  test('ip aus Eintrag übernommen (für alle Actions)', () => {
    const r = formatSecurityEvent(makeEntry('LOGIN', { ip: '192.168.241.5' }));
    expect(r.ip).toBe('192.168.241.5');
  });

  test('metadata aus Eintrag verfügbar', () => {
    const r = formatSecurityEvent(makeEntry('USER_ROLE_CHANGE', { metadata: { oldRole: 'analyst', newRole: 'engineer' } }));
    expect(r.metadata).toBeDefined();
  });
});

// ── Edge-Cases ────────────────────────────────────────────────────────────────

describe('formatSecurityEvent – Edge-Cases', () => {
  test('leeres actorLabel → keine Exception', () => {
    expect(() => formatSecurityEvent(makeEntry('LOGIN', { actorLabel: '' }))).not.toThrow();
  });

  test('leere ip → keine Exception', () => {
    expect(() => formatSecurityEvent(makeEntry('LOGIN', { ip: '' }))).not.toThrow();
  });

  test('leeres createdAt → keine Exception', () => {
    expect(() => formatSecurityEvent(makeEntry('LOGIN', { createdAt: '' }))).not.toThrow();
  });

  test('metadata mit Sonderzeichen/Unicode → keine Exception', () => {
    const meta = { note: 'Ändere Rolle auf 管理員 🔐' };
    expect(() => formatSecurityEvent(makeEntry('USER_ROLE_CHANGE', { metadata: meta }))).not.toThrow();
  });
});
