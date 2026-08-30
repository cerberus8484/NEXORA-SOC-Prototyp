'use strict';

const { PostgresAuditRepository } = require('../../src/repositories/PostgresAuditRepository');

const repo = new PostgresAuditRepository();

describe('PostgresAuditRepository — _normalizeActorId', () => {
  it('gültige UUID bleibt erhalten', () => {
    const id = '6b4fe060-7c31-4adb-b500-ed9b47783fb2';
    expect(repo._normalizeActorId(id)).toBe(id);
  });

  it('nicht-UUID (z.B. "system") → null (kein FK-Bruch)', () => {
    expect(repo._normalizeActorId('system')).toBeNull();
    expect(repo._normalizeActorId('analyst-1')).toBeNull();
  });

  it('null/undefined → null', () => {
    expect(repo._normalizeActorId(null)).toBeNull();
    expect(repo._normalizeActorId(undefined)).toBeNull();
  });
});

describe('PostgresAuditRepository — _rowToEntry', () => {
  it('mappt snake_case → camelCase, jsonb-Objekt', () => {
    const row = {
      id: 'a1', actor_user_id: null, actor_label: 'analyst@firma.de',
      action: 'TICKET_CREATE', target_type: 'ticket', target_id: 't-42',
      metadata: { field: 'x' }, ip_address: '10.0.0.1',
      created_at: new Date('2026-06-04T12:00:00.000Z'),
    };
    expect(repo._rowToEntry(row)).toEqual({
      id: 'a1', actorUserId: null, actorLabel: 'analyst@firma.de',
      action: 'TICKET_CREATE', targetType: 'ticket', targetId: 't-42',
      metadata: { field: 'x' }, ip: '10.0.0.1',
      createdAt: '2026-06-04T12:00:00.000Z',
    });
  });

  it('metadata als String wird geparst', () => {
    const row = {
      id: 'a2', actor_user_id: null, actor_label: '', action: 'LOGIN',
      target_type: '', target_id: '', metadata: '{"ok":true}', ip_address: '',
      created_at: new Date('2026-06-04T12:00:00.000Z'),
    };
    expect(repo._rowToEntry(row).metadata).toEqual({ ok: true });
  });

  it('Vertrag: save + findRecent existieren', () => {
    expect(typeof repo.save).toBe('function');
    expect(typeof repo.findRecent).toBe('function');
  });

  it('findRecent akzeptiert offset-Parameter (Signatur-Check ohne DB)', () => {
    // Ohne DB würde findRecent einen Promise zurückgeben der abstürzt —
    // wir prüfen nur die Signatur (Funktion erwartet ein Objekt mit offset).
    // Der eigentliche Rückgabewert-Test liegt in inMemoryAuditPagination.test.js.
    expect(repo.findRecent.length).toBe(0); // Destructuring-Default → length 0
  });
});
