import { describe, test, expect } from 'vitest';
import { formatUserAuditEntry, USER_AUDIT_ACTIONS, type UserAuditEntry } from './userAuditFormat';

// Hilfsfunktion für Test-Entries
function makeEntry(overrides: Partial<UserAuditEntry> = {}): UserAuditEntry {
  return {
    id: 'evt-1',
    action: 'USER_CREATED',
    actorLabel: 'admin@nexora.example',
    targetType: 'user',
    targetId: 'u-42',
    ip: '10.99.99.1',
    createdAt: '2026-06-15T10:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

describe('formatUserAuditEntry', () => {
  test('USER_CREATED liefert lesbare Beschreibung mit E-Mail aus metadata', () => {
    const entry = makeEntry({
      action: 'USER_CREATED',
      metadata: { email: 'analyst@nexora.example', role: 'analyst' },
    });
    const result = formatUserAuditEntry(entry);
    expect(result.description).toContain('angelegt');
    expect(result.description).toContain('analyst@nexora.example');
  });

  test('USER_ROLE_CHANGE zeigt fromRole → toRole', () => {
    const entry = makeEntry({
      action: 'USER_ROLE_CHANGE',
      metadata: { email: 'bob@nexora.example', fromRole: 'viewer', toRole: 'analyst' },
    });
    const result = formatUserAuditEntry(entry);
    expect(result.description).toContain('viewer');
    expect(result.description).toContain('analyst');
    expect(result.description).toContain('bob@nexora.example');
  });

  test('USER_ACTIVE_CHANGE aktiviert', () => {
    const entry = makeEntry({
      action: 'USER_ACTIVE_CHANGE',
      metadata: { email: 'carol@nexora.example', isActive: true },
    });
    const result = formatUserAuditEntry(entry);
    expect(result.description.toLowerCase()).toContain('aktiviert');
    expect(result.description).toContain('carol@nexora.example');
  });

  test('USER_ACTIVE_CHANGE deaktiviert', () => {
    const entry = makeEntry({
      action: 'USER_ACTIVE_CHANGE',
      metadata: { email: 'carol@nexora.example', isActive: false },
    });
    const result = formatUserAuditEntry(entry);
    expect(result.description.toLowerCase()).toContain('deaktiviert');
  });

  test('USER_PASSWORD_RESET', () => {
    const entry = makeEntry({
      action: 'USER_PASSWORD_RESET',
      metadata: { email: 'dave@nexora.example' },
    });
    const result = formatUserAuditEntry(entry);
    expect(result.description.toLowerCase()).toContain('passwort');
    expect(result.description).toContain('dave@nexora.example');
  });

  test('Unbekanntes action → Fallback ohne Crash', () => {
    const entry = makeEntry({ action: 'SOME_UNKNOWN_EVENT', metadata: {} });
    const result = formatUserAuditEntry(entry);
    expect(result.description).toBeTruthy();
    expect(typeof result.description).toBe('string');
  });

  test('gibt actorLabel zurück', () => {
    const entry = makeEntry({ actorLabel: 'sysadmin@nexora.example' });
    const result = formatUserAuditEntry(entry);
    expect(result.actorLabel).toBe('sysadmin@nexora.example');
  });

  test('gibt createdAt ISO zurück', () => {
    const entry = makeEntry({ createdAt: '2026-06-15T10:00:00.000Z' });
    const result = formatUserAuditEntry(entry);
    expect(result.createdAt).toBe('2026-06-15T10:00:00.000Z');
  });

  test('fehlende metadata-Felder → kein Crash (Robustheit)', () => {
    const entry = makeEntry({
      action: 'USER_ROLE_CHANGE',
      metadata: {},  // fromRole/toRole fehlen
    });
    expect(() => formatUserAuditEntry(entry)).not.toThrow();
    const result = formatUserAuditEntry(entry);
    expect(typeof result.description).toBe('string');
  });

  test('USER_AUDIT_ACTIONS enthält alle 4 bekannten Event-Typen', () => {
    expect(USER_AUDIT_ACTIONS).toContain('USER_CREATED');
    expect(USER_AUDIT_ACTIONS).toContain('USER_ROLE_CHANGE');
    expect(USER_AUDIT_ACTIONS).toContain('USER_ACTIVE_CHANGE');
    expect(USER_AUDIT_ACTIONS).toContain('USER_PASSWORD_RESET');
  });
});

describe('filterHelpers', () => {
  test('formatUserAuditEntry Rückgabe hat alle Pflichtfelder', () => {
    const result = formatUserAuditEntry(makeEntry());
    expect(typeof result.description).toBe('string');
    expect(typeof result.actorLabel).toBe('string');
    expect(typeof result.createdAt).toBe('string');
  });
});
