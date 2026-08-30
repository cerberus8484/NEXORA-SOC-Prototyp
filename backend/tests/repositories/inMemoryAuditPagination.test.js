'use strict';

// TDD RED: Tests für AuditService.findRecent mit offset+total-Envelope.
// Der AuditService nutzt bei DB_ENABLED=false seinen internen _log (InMemory-Pfad).
// Diese Tests verifizieren, dass findRecent ein { data, total, limit, offset }-Objekt
// zurückgibt — identisch mit dem PostgresAuditRepository-Vertrag.

const { AuditService } = require('../../src/services/AuditService');

/** Hilfsfunktion: N Einträge in den Service schreiben. */
async function seedEntries(svc, count, actionBase = 'LOGIN') {
  for (let i = 0; i < count; i++) {
    await svc.write({ action: actionBase, actorLabel: `user${i}`, targetId: String(i) });
  }
}

describe('AuditService (InMemory) — findRecent Pagination Envelope', () => {
  test('gibt { data, total, limit, offset } zurück (nicht nacktes Array)', async () => {
    const svc = new AuditService();
    await seedEntries(svc, 3);

    const result = await svc.findRecent({ limit: 10, offset: 0 });

    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('limit');
    expect(result).toHaveProperty('offset');
    expect(Array.isArray(result.data)).toBe(true);
  });

  test('total ist Gesamtanzahl aller Einträge (ohne Limit/Offset)', async () => {
    const svc = new AuditService();
    await seedEntries(svc, 5);

    const result = await svc.findRecent({ limit: 2, offset: 0 });

    expect(result.total).toBe(5);
    expect(result.data).toHaveLength(2);
  });

  test('offset verschiebt den Startpunkt (Seite 2)', async () => {
    const svc = new AuditService();
    await seedEntries(svc, 5);

    const page1 = await svc.findRecent({ limit: 3, offset: 0 });
    const page2 = await svc.findRecent({ limit: 3, offset: 3 });

    expect(page1.data).toHaveLength(3);
    expect(page2.data).toHaveLength(2); // nur 2 verbleibende
    expect(page1.data[0].id).not.toBe(page2.data[0].id);
  });

  test('offset größer als total → leere data, total stimmt', async () => {
    const svc = new AuditService();
    await seedEntries(svc, 3);

    const result = await svc.findRecent({ limit: 10, offset: 100 });

    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(3);
    expect(result.offset).toBe(100);
  });

  test('leerer Log → total 0, leere data', async () => {
    const svc = new AuditService();

    const result = await svc.findRecent({ limit: 50, offset: 0 });

    expect(result.total).toBe(0);
    expect(result.data).toHaveLength(0);
  });

  test('limit und offset werden im Envelope gespiegelt', async () => {
    const svc = new AuditService();
    await seedEntries(svc, 10);

    const result = await svc.findRecent({ limit: 7, offset: 3 });

    expect(result.limit).toBe(7);
    expect(result.offset).toBe(3);
  });

  test('Filter (action) kombiniert mit Pagination: total spiegelt nur gefilterte Einträge', async () => {
    const svc = new AuditService();
    await seedEntries(svc, 5, 'LOGIN');
    await seedEntries(svc, 3, 'TICKET_CREATE');

    const result = await svc.findRecent({ limit: 2, offset: 0, action: 'LOGIN' });

    expect(result.total).toBe(5);   // 5 LOGIN-Einträge
    expect(result.data).toHaveLength(2);
  });

  test('Filter (targetType) kombiniert mit offset', async () => {
    const svc = new AuditService();
    for (let i = 0; i < 4; i++) {
      await svc.write({ action: 'TICKET_VIEW', actorLabel: 'a', targetType: 'ticket', targetId: String(i) });
    }
    for (let i = 0; i < 2; i++) {
      await svc.write({ action: 'TICKET_VIEW', actorLabel: 'a', targetType: 'user', targetId: String(i) });
    }

    const result = await svc.findRecent({ limit: 2, offset: 2, targetType: 'ticket' });

    expect(result.total).toBe(4);
    expect(result.data).toHaveLength(2);
  });

  test('Sortierung ist DESC (neueste zuerst) unabhängig von offset', async () => {
    const svc = new AuditService();
    await seedEntries(svc, 3);

    const all = await svc.findRecent({ limit: 100, offset: 0 });
    for (let i = 0; i < all.data.length - 1; i++) {
      expect(all.data[i].createdAt >= all.data[i + 1].createdAt).toBe(true);
    }
  });

  test('limit cap: Werte > 200 werden auf 200 begrenzt', async () => {
    const svc = new AuditService();
    await seedEntries(svc, 3);

    const result = await svc.findRecent({ limit: 999 });

    expect(result.limit).toBeLessThanOrEqual(200);
  });

  test('offset < 0 wird auf 0 normalisiert', async () => {
    const svc = new AuditService();
    await seedEntries(svc, 3);

    const result = await svc.findRecent({ limit: 10, offset: -5 });

    expect(result.offset).toBeGreaterThanOrEqual(0);
    expect(result.data).toHaveLength(3);
  });
});

// A6a — serverseitige Volltext-Suche über erlaubte Felder (Actor/Action/Target).
describe('AuditService (InMemory) — findRecent Suche (A6a)', () => {
  test('search findet über actorLabel (Teilstring, case-insensitive)', async () => {
    const svc = new AuditService();
    await svc.write({ action: 'LOGIN', actorLabel: 'alice@firma.de', targetId: '1' });
    await svc.write({ action: 'LOGIN', actorLabel: 'bob@firma.de', targetId: '2' });

    const r = await svc.findRecent({ limit: 50, offset: 0, search: 'ALICE' });
    expect(r.total).toBe(1);
    expect(r.data[0].actorLabel).toBe('alice@firma.de');
  });

  test('search findet über action', async () => {
    const svc = new AuditService();
    await svc.write({ action: 'TICKET_DELETE', actorLabel: 'a', targetId: '1' });
    await svc.write({ action: 'LOGIN', actorLabel: 'a', targetId: '2' });

    const r = await svc.findRecent({ limit: 50, offset: 0, search: 'delete' });
    expect(r.total).toBe(1);
    expect(r.data[0].action).toBe('TICKET_DELETE');
  });

  test('search findet über targetId (Ticket-/Target-Referenz)', async () => {
    const svc = new AuditService();
    await svc.write({ action: 'TICKET_VIEW', actorLabel: 'a', targetType: 'ticket', targetId: 'INC000457' });
    await svc.write({ action: 'TICKET_VIEW', actorLabel: 'a', targetType: 'ticket', targetId: 'INC000999' });

    const r = await svc.findRecent({ limit: 50, offset: 0, search: 'inc000457' });
    expect(r.total).toBe(1);
    expect(r.data[0].targetId).toBe('INC000457');
  });

  test('search kombiniert mit action-Filter — beide greifen zusammen', async () => {
    const svc = new AuditService();
    await svc.write({ action: 'LOGIN', actorLabel: 'alice', targetId: '1' });
    await svc.write({ action: 'LOGIN', actorLabel: 'bob', targetId: '2' });
    await svc.write({ action: 'TICKET_CREATE', actorLabel: 'alice', targetId: '3' });

    const r = await svc.findRecent({ limit: 50, offset: 0, action: 'LOGIN', search: 'alice' });
    expect(r.total).toBe(1); // nur LOGIN UND alice
    expect(r.data[0].action).toBe('LOGIN');
    expect(r.data[0].actorLabel).toBe('alice');
  });

  test('search mit Pagination — total spiegelt NUR Treffer (nicht nur die geladene Seite)', async () => {
    const svc = new AuditService();
    for (let i = 0; i < 5; i++) await svc.write({ action: 'LOGIN', actorLabel: `match-${i}`, targetId: String(i) });
    for (let i = 0; i < 3; i++) await svc.write({ action: 'LOGIN', actorLabel: `other-${i}`, targetId: String(i) });

    const r = await svc.findRecent({ limit: 2, offset: 0, search: 'match' });
    expect(r.total).toBe(5);
    expect(r.data).toHaveLength(2);
  });

  test('search ohne Treffer → total 0, leere data', async () => {
    const svc = new AuditService();
    await svc.write({ action: 'LOGIN', actorLabel: 'alice', targetId: '1' });

    const r = await svc.findRecent({ limit: 50, offset: 0, search: 'zzz-nichts' });
    expect(r.total).toBe(0);
    expect(r.data).toHaveLength(0);
  });
});
