'use strict';

// ── TDD RED: Repository-Tests für InMemoryNotificationRepository ──

const { InMemoryNotificationRepository } = require('../../src/repositories/InMemoryNotificationRepository');
const { Notification } = require('../../src/domain/Notification');

function makeNotif(overrides = {}) {
  return Notification.create({
    userId: 'user-a',
    title: 'Test-Notification',
    severity: 'info',
    ...overrides,
  });
}

describe('InMemoryNotificationRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new InMemoryNotificationRepository();
  });

  describe('create()', () => {
    test('speichert eine Notification und gibt sie zurück', async () => {
      const n = makeNotif();
      const saved = await repo.create(n);
      expect(saved.id).toBe(n.id);
      expect(saved.userId).toBe('user-a');
      expect(saved.title).toBe('Test-Notification');
    });

    test('akzeptiert auch plain-Objekte (Domain-create hat schon validiert)', async () => {
      const n = makeNotif().toJSON();
      const saved = await repo.create(n);
      expect(saved.id).toBe(n.id);
    });
  });

  describe('listForUser()', () => {
    test('gibt nur Notifications des eigenen Users zurück', async () => {
      await repo.create(makeNotif({ userId: 'user-a', title: 'A1' }));
      await repo.create(makeNotif({ userId: 'user-b', title: 'B1' }));
      await repo.create(makeNotif({ userId: 'user-a', title: 'A2' }));

      const result = await repo.listForUser('user-a', {});
      expect(result).toHaveLength(2);
      expect(result.every((n) => n.userId === 'user-a')).toBe(true);
    });

    test('gibt leere Liste zurück wenn User keine Notifications hat', async () => {
      const result = await repo.listForUser('nobody', {});
      expect(result).toEqual([]);
    });

    test('sortiert neueste zuerst', async () => {
      const n1 = makeNotif({ title: 'Erste' });
      await repo.create(n1);
      // Kleine Verzögerung damit createdAt sich unterscheidet
      await new Promise((r) => setTimeout(r, 2));
      const n2 = makeNotif({ title: 'Zweite' });
      await repo.create(n2);

      const result = await repo.listForUser('user-a', {});
      expect(result[0].title).toBe('Zweite');
      expect(result[1].title).toBe('Erste');
    });

    test('filtert ungelesene mit unreadOnly:true', async () => {
      const nRead = makeNotif({ title: 'Gelesen' });
      const saved = await repo.create(nRead);
      await repo.markRead(saved.id, 'user-a');

      await repo.create(makeNotif({ title: 'Ungelesen' }));

      const result = await repo.listForUser('user-a', { unreadOnly: true });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Ungelesen');
    });

    test('respektiert limit', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create(makeNotif({ title: `N${i}` }));
      }
      const result = await repo.listForUser('user-a', { limit: 3 });
      expect(result).toHaveLength(3);
    });
  });

  describe('unreadCount()', () => {
    test('gibt 0 zurück wenn keine Notifications', async () => {
      const count = await repo.unreadCount('user-a');
      expect(count).toBe(0);
    });

    test('zählt nur ungelesene Notifications des Users', async () => {
      await repo.create(makeNotif({ userId: 'user-a', title: 'U1' }));
      await repo.create(makeNotif({ userId: 'user-a', title: 'U2' }));
      const read = await repo.create(makeNotif({ userId: 'user-a', title: 'R1' }));
      await repo.markRead(read.id, 'user-a');
      await repo.create(makeNotif({ userId: 'user-b', title: 'Other' }));

      const count = await repo.unreadCount('user-a');
      expect(count).toBe(2);
    });
  });

  describe('markRead()', () => {
    test('markiert eine eigene Notification als gelesen', async () => {
      const n = await repo.create(makeNotif({ userId: 'user-a' }));
      const updated = await repo.markRead(n.id, 'user-a');
      expect(updated.read).toBe(true);
    });

    test('gibt null zurück wenn Notification nicht dem User gehört (Fremdzugriff)', async () => {
      const n = await repo.create(makeNotif({ userId: 'user-a' }));
      const result = await repo.markRead(n.id, 'user-b');
      expect(result).toBeNull();
    });

    test('gibt null zurück wenn Notification nicht existiert', async () => {
      const result = await repo.markRead('nonexistent-id', 'user-a');
      expect(result).toBeNull();
    });

    test('Notification bleibt ungelesen wenn Fremdzugriff versucht wird', async () => {
      const n = await repo.create(makeNotif({ userId: 'user-a' }));
      await repo.markRead(n.id, 'user-b'); // Fremdzugriff — sollte nichts tun
      const list = await repo.listForUser('user-a', {});
      expect(list[0].read).toBe(false);
    });
  });

  describe('markAllRead()', () => {
    test('markiert alle ungelesenen Notifications eines Users als gelesen', async () => {
      await repo.create(makeNotif({ userId: 'user-a', title: 'A1' }));
      await repo.create(makeNotif({ userId: 'user-a', title: 'A2' }));
      await repo.create(makeNotif({ userId: 'user-b', title: 'B1' }));

      const updated = await repo.markAllRead('user-a');
      expect(updated).toBe(2);

      const countA = await repo.unreadCount('user-a');
      const countB = await repo.unreadCount('user-b');
      expect(countA).toBe(0);
      expect(countB).toBe(1); // unberührt
    });

    test('gibt 0 zurück wenn keine ungelesenen vorhanden', async () => {
      const updated = await repo.markAllRead('user-a');
      expect(updated).toBe(0);
    });
  });
});
