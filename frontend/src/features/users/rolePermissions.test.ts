import { describe, test, expect } from 'vitest';
import {
  ROLE_PERMISSION_MATRIX,
  PERMISSION_LABELS,
  hasPermission,
  getRoleCounts,
  type RoleName,
} from './rolePermissions';
import type { ManagedUser } from './userMgmtModel';

// ─── rolePermissionMatrix ────────────────────────────────────────────────────

describe('ROLE_PERMISSION_MATRIX', () => {
  test('alle 4 Rollen sind vorhanden', () => {
    const roles: RoleName[] = ['viewer', 'analyst', 'engineer', 'admin'];
    for (const role of roles) {
      expect(ROLE_PERMISSION_MATRIX[role]).toBeDefined();
    }
  });

  test('viewer hat nur Lese-Zugriff (keine Schreib/Admin-Rechte)', () => {
    const v = ROLE_PERMISSION_MATRIX.viewer;
    expect(v.readTickets).toBe(true);
    expect(v.createTicket).toBe(false);
    expect(v.runHunts).toBe(false);
    expect(v.manageSettings).toBe(false);
  });

  test('analyst kann Tickets anlegen, Hunts starten, KI nutzen', () => {
    const a = ROLE_PERMISSION_MATRIX.analyst;
    expect(a.readTickets).toBe(true);
    expect(a.createTicket).toBe(true);
    expect(a.runHunts).toBe(true);
    expect(a.generateAiAnalysis).toBe(true);
    expect(a.manageSettings).toBe(false);
  });

  test('engineer kann alles des analysts plus FP-Ausnahmen anwenden', () => {
    const e = ROLE_PERMISSION_MATRIX.engineer;
    expect(e.readTickets).toBe(true);
    expect(e.createTicket).toBe(true);
    expect(e.runHunts).toBe(true);
    expect(e.applyFpException).toBe(true);
    expect(e.manageSettings).toBe(false);
  });

  test('admin hat alle Berechtigungen', () => {
    const a = ROLE_PERMISSION_MATRIX.admin;
    for (const key of Object.keys(a) as (keyof typeof a)[]) {
      expect(a[key]).toBe(true);
    }
  });

  test('Hierarchie: jede höhere Rolle hat mindestens so viele Rechte wie die niedrigere', () => {
    const hierarchy: RoleName[] = ['viewer', 'analyst', 'engineer', 'admin'];
    const keys = Object.keys(ROLE_PERMISSION_MATRIX.viewer) as (keyof typeof ROLE_PERMISSION_MATRIX.viewer)[];
    for (let i = 0; i < hierarchy.length - 1; i++) {
      const lower = ROLE_PERMISSION_MATRIX[hierarchy[i]];
      const higher = ROLE_PERMISSION_MATRIX[hierarchy[i + 1]];
      for (const key of keys) {
        // Wenn lower true hat, muss higher auch true haben.
        if (lower[key]) {
          expect(higher[key]).toBe(true);
        }
      }
    }
  });
});

describe('PERMISSION_LABELS', () => {
  test('jede Berechtigung hat ein deutsches Label', () => {
    const keys = Object.keys(ROLE_PERMISSION_MATRIX.viewer);
    for (const key of keys) {
      expect(PERMISSION_LABELS[key as keyof typeof PERMISSION_LABELS]).toBeDefined();
      expect(PERMISSION_LABELS[key as keyof typeof PERMISSION_LABELS].length).toBeGreaterThan(0);
    }
  });
});

describe('hasPermission', () => {
  test('viewer darf lesen, nicht erstellen', () => {
    expect(hasPermission('viewer', 'readTickets')).toBe(true);
    expect(hasPermission('viewer', 'createTicket')).toBe(false);
  });

  test('admin darf alles', () => {
    const keys = Object.keys(ROLE_PERMISSION_MATRIX.viewer) as (keyof typeof ROLE_PERMISSION_MATRIX.viewer)[];
    for (const key of keys) {
      expect(hasPermission('admin', key)).toBe(true);
    }
  });

  test('unbekannte Rolle → false (kein Crash)', () => {
    expect(hasPermission('superuser' as RoleName, 'readTickets')).toBe(false);
  });
});

describe('getRoleCounts', () => {
  const users: ManagedUser[] = [
    { id: '1', email: 'a@t.c', role: 'admin',    isActive: true },
    { id: '2', email: 'b@t.c', role: 'analyst',  isActive: true },
    { id: '3', email: 'c@t.c', role: 'analyst',  isActive: false },
    { id: '4', email: 'd@t.c', role: 'viewer',   isActive: true },
  ];

  test('zählt Benutzer je Rolle korrekt', () => {
    const counts = getRoleCounts(users);
    expect(counts.admin).toBe(1);
    expect(counts.analyst).toBe(2);
    expect(counts.viewer).toBe(1);
    expect(counts.engineer).toBe(0);
  });

  test('leere Liste → alle Counts 0', () => {
    const counts = getRoleCounts([]);
    expect(counts.admin).toBe(0);
    expect(counts.analyst).toBe(0);
    expect(counts.engineer).toBe(0);
    expect(counts.viewer).toBe(0);
  });

  test('unbekannte Rolle in Daten wird ignoriert, kein Crash', () => {
    const weirdUsers: ManagedUser[] = [
      { id: '5', email: 'e@t.c', role: 'superadmin', isActive: true },
    ];
    expect(() => getRoleCounts(weirdUsers)).not.toThrow();
  });
});
