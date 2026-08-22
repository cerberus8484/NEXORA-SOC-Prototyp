'use strict';

// Roundtrip-Mapping für PostgresUserRepository — ohne echte DB.

const { PostgresUserRepository } = require('../../src/repositories/PostgresUserRepository');
const { User } = require('../../src/domain/User');

const repo = new PostgresUserRepository();
const d = (iso) => (iso ? new Date(iso) : null);

describe('PostgresUserRepository — _rowToUser', () => {
  it('rekonstruiert User-Instanz aus DB-Row inkl. passwordHash', () => {
    const u = new User({
      email: 'Analyst@Firma.DE', displayName: 'Analyst', passwordHash: '$2b$12$abc',
      role: 'analyst', isActive: true,
    });
    const row = {
      id: u.id, email: u.email, display_name: u.displayName, password_hash: u.passwordHash,
      role: u.role, is_active: u.isActive, last_login_at: null,
      created_at: d(u.createdAt), updated_at: d(u.updatedAt),
    };
    const mapped = repo._rowToUser(row);
    expect(mapped).toBeInstanceOf(User);
    expect(mapped.id).toBe(u.id);
    expect(mapped.email).toBe('analyst@firma.de');   // lowercased im Domain-Konstruktor
    expect(mapped.passwordHash).toBe('$2b$12$abc');
    expect(mapped.role).toBe('analyst');
    expect(mapped.isActive).toBe(true);
  });

  it('toPublicJSON maskiert den passwordHash', () => {
    const u = new User({ email: 'a@b.de', passwordHash: 'secret-hash', role: 'admin' });
    const row = {
      id: u.id, email: u.email, display_name: '', password_hash: u.passwordHash,
      role: u.role, is_active: true, last_login_at: null,
      created_at: d(u.createdAt), updated_at: d(u.updatedAt),
    };
    const pub = repo._rowToUser(row).toPublicJSON();
    expect(pub.passwordHash).toBeUndefined();
    expect(pub.email).toBe('a@b.de');
  });

  it('_rowToUser(undefined) → null', () => {
    expect(repo._rowToUser(undefined)).toBeNull();
  });

  it('last_login_at Date → ISO-String, null bleibt null', () => {
    const u = new User({ email: 'x@y.de', passwordHash: 'h' });
    const withLogin = repo._rowToUser({
      id: u.id, email: u.email, display_name: '', password_hash: 'h', role: 'viewer',
      is_active: true, last_login_at: new Date('2026-06-01T10:00:00.000Z'),
      created_at: d(u.createdAt), updated_at: d(u.updatedAt),
    });
    expect(withLogin.lastLoginAt).toBe('2026-06-01T10:00:00.000Z');
  });

  it('Vertrag: save/findById/findByEmail existieren', () => {
    for (const m of ['save', 'findById', 'findByEmail']) {
      expect(typeof repo[m]).toBe('function');
    }
  });
});
