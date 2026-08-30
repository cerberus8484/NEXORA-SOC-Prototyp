import { describe, test, expect } from 'vitest';
import { filterUsers, paginateUsers, type UserFilter } from './userTableHelpers';
import type { ManagedUser } from './userMgmtModel';

const USERS: ManagedUser[] = [
  { id: '1', email: 'admin@nexora.example',    displayName: 'Alice Admin',   role: 'admin',    isActive: true  },
  { id: '2', email: 'eng@nexora.example',      displayName: 'Bob Engineer',  role: 'engineer', isActive: true  },
  { id: '3', email: 'analyst@nexora.example',  displayName: 'Carol Analyst', role: 'analyst',  isActive: false },
  { id: '4', email: 'viewer@nexora.example',   displayName: 'Dave Viewer',   role: 'viewer',   isActive: true  },
  { id: '5', email: 'analyst2@nexora.example', displayName: 'Eve Analyst',   role: 'analyst',  isActive: true  },
];

// ─── filterUsers ──────────────────────────────────────────────────────────────

describe('filterUsers — Suche', () => {
  test('leere Suche → alle Benutzer', () => {
    const result = filterUsers(USERS, { search: '', role: '' });
    expect(result).toHaveLength(5);
  });

  test('sucht case-insensitiv in email', () => {
    const result = filterUsers(USERS, { search: 'ADMIN', role: '' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  test('sucht in displayName', () => {
    const result = filterUsers(USERS, { search: 'carol', role: '' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });

  test('sucht gleichzeitig in email + displayName', () => {
    const result = filterUsers(USERS, { search: 'analyst', role: '' });
    // analyst@nexora.example, Carol Analyst (displayName), analyst2@nexora.example, Eve Analyst
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  test('keine Treffer → leeres Array', () => {
    const result = filterUsers(USERS, { search: 'zzz_nobody', role: '' });
    expect(result).toHaveLength(0);
  });
});

describe('filterUsers — Rollen-Filter', () => {
  test('Rollen-Filter auf analyst', () => {
    const result = filterUsers(USERS, { search: '', role: 'analyst' });
    expect(result.every((u) => u.role === 'analyst')).toBe(true);
    expect(result).toHaveLength(2);
  });

  test('Rollen-Filter + Suche kombiniert', () => {
    const result = filterUsers(USERS, { search: 'analyst2', role: 'analyst' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('5');
  });

  test('leerer Rollen-Filter → alle Rollen', () => {
    const result = filterUsers(USERS, { search: '', role: '' });
    expect(result).toHaveLength(5);
  });
});

describe('filterUsers — Edge Cases', () => {
  test('leere User-Liste → leeres Ergebnis', () => {
    const result = filterUsers([], { search: 'admin', role: '' });
    expect(result).toHaveLength(0);
  });

  test('User ohne displayName → kein Crash', () => {
    const users: ManagedUser[] = [
      { id: '99', email: 'no-name@t.c', role: 'viewer', isActive: true },
    ];
    expect(() => filterUsers(users, { search: 'no-name', role: '' })).not.toThrow();
    expect(filterUsers(users, { search: 'no-name', role: '' })).toHaveLength(1);
  });
});

// ─── paginateUsers ────────────────────────────────────────────────────────────

describe('paginateUsers', () => {
  test('erste Seite mit 2 Einträgen', () => {
    const result = paginateUsers(USERS, 1, 2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe('1');
    expect(result.totalPages).toBe(3);
    expect(result.totalCount).toBe(5);
  });

  test('letzte Seite kann weniger Einträge haben', () => {
    const result = paginateUsers(USERS, 3, 2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('5');
  });

  test('Seite 2', () => {
    const result = paginateUsers(USERS, 2, 2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe('3');
  });

  test('pageSize größer als Liste → eine Seite', () => {
    const result = paginateUsers(USERS, 1, 100);
    expect(result.items).toHaveLength(5);
    expect(result.totalPages).toBe(1);
  });

  test('leere Liste → 0 Seiten, leere Items', () => {
    const result = paginateUsers([], 1, 5);
    expect(result.items).toHaveLength(0);
    expect(result.totalPages).toBe(0);
    expect(result.totalCount).toBe(0);
  });

  test('pageIndex außerhalb → leeres items-Array, kein Crash', () => {
    const result = paginateUsers(USERS, 99, 5);
    expect(result.items).toHaveLength(0);
  });

  test('fromIndex und toIndex werden korrekt berechnet', () => {
    const result = paginateUsers(USERS, 2, 2);
    expect(result.fromIndex).toBe(3); // 1-basiert
    expect(result.toIndex).toBe(4);
  });
});

// ─── Typ-Kompilierung ─────────────────────────────────────────────────────────

describe('UserFilter-Typ', () => {
  test('Typ lässt sich korrekt verwenden', () => {
    const f: UserFilter = { search: 'test', role: 'admin' };
    expect(f.search).toBe('test');
    expect(f.role).toBe('admin');
  });
});
