'use strict';

// ── TDD RED: Service-Tests für NotificationService ──

const { NotificationService } = require('../../src/services/NotificationService');
const { InMemoryNotificationRepository } = require('../../src/repositories/InMemoryNotificationRepository');
const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');
const { User } = require('../../src/domain/User');

// Baut einen Test-User mit gegebener Rolle
async function addUser(userRepo, { id, email, role }) {
  const u = new User({ id, email, passwordHash: 'x', role, displayName: email, isActive: true });
  await userRepo.save(u);
  return u;
}

describe('NotificationService', () => {
  let repo;
  let userRepo;
  let svc;

  beforeEach(() => {
    repo     = new InMemoryNotificationRepository();
    userRepo = new InMemoryUserRepository();
    svc      = new NotificationService({ repo, userRepo });
  });

  describe('create()', () => {
    test('legt eine Notification an und gibt sie zurück', async () => {
      const n = await svc.create({ userId: 'u1', title: 'Alert', severity: 'high', source: 'ticket' });
      expect(n.id).toBeDefined();
      expect(n.userId).toBe('u1');
      expect(n.severity).toBe('high');
      expect(n.read).toBe(false);
    });

    test('wirft bei fehlendem userId', async () => {
      await expect(svc.create({ title: 'x' })).rejects.toThrow(/userId/i);
    });

    test('wirft bei fehlendem title', async () => {
      await expect(svc.create({ userId: 'u1' })).rejects.toThrow(/title/i);
    });
  });

  describe('listForUser()', () => {
    test('gibt nur Notifications des eigenen Users zurück', async () => {
      await svc.create({ userId: 'u1', title: 'A' });
      await svc.create({ userId: 'u2', title: 'B' });
      await svc.create({ userId: 'u1', title: 'C' });

      const { data, total, unreadCount } = await svc.listForUser('u1', {});
      expect(total).toBe(2);
      expect(data.every((n) => n.userId === 'u1')).toBe(true);
      expect(unreadCount).toBe(2);
    });

    test('filtert ungelesene mit unreadOnly', async () => {
      const n = await svc.create({ userId: 'u1', title: 'Ungelesen' });
      const r = await svc.create({ userId: 'u1', title: 'Gelesen' });
      await svc.markRead(r.id, 'u1');

      const { data } = await svc.listForUser('u1', { unreadOnly: true });
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(n.id);
    });
  });

  describe('unreadCount()', () => {
    test('gibt korrekte Anzahl ungelesener zurück', async () => {
      await svc.create({ userId: 'u1', title: 'A' });
      await svc.create({ userId: 'u1', title: 'B' });

      expect(await svc.unreadCount('u1')).toBe(2);
    });
  });

  describe('markRead()', () => {
    test('markiert eigene Notification als gelesen', async () => {
      const n = await svc.create({ userId: 'u1', title: 'X' });
      const updated = await svc.markRead(n.id, 'u1');
      expect(updated.read).toBe(true);
    });

    test('verweigert markRead für fremde Notification — gibt null zurück', async () => {
      const n = await svc.create({ userId: 'u1', title: 'X' });
      const result = await svc.markRead(n.id, 'u2'); // anderer User
      expect(result).toBeNull();
    });
  });

  describe('markAllRead()', () => {
    test('markiert alle ungelesenen eines Users als gelesen', async () => {
      await svc.create({ userId: 'u1', title: 'A' });
      await svc.create({ userId: 'u1', title: 'B' });
      await svc.create({ userId: 'u2', title: 'C' });

      const { updated } = await svc.markAllRead('u1');
      expect(updated).toBe(2);

      expect(await svc.unreadCount('u1')).toBe(0);
      expect(await svc.unreadCount('u2')).toBe(1); // unberührt
    });
  });

  describe('broadcastToRoles()', () => {
    test('erzeugt je passenden User eine Notification', async () => {
      await addUser(userRepo, { id: 'a1', email: 'analyst@x.io', role: 'analyst' });
      await addUser(userRepo, { id: 'a2', email: 'engineer@x.io', role: 'engineer' });
      await addUser(userRepo, { id: 'a3', email: 'admin@x.io', role: 'admin' });
      await addUser(userRepo, { id: 'v1', email: 'viewer@x.io', role: 'viewer' });

      await svc.broadcastToRoles(['analyst', 'engineer', 'admin'], {
        severity: 'critical',
        title: 'Kritischer Vorfall',
        body: 'Sofortige Reaktion erforderlich',
        source: 'ticket',
        link: '/analysis?ticket=t1',
      });

      // analyst, engineer, admin bekommen je eine → viewer nicht
      const a1Notifs = await svc.listForUser('a1', {});
      const a2Notifs = await svc.listForUser('a2', {});
      const a3Notifs = await svc.listForUser('a3', {});
      const v1Notifs = await svc.listForUser('v1', {});

      expect(a1Notifs.total).toBe(1);
      expect(a2Notifs.total).toBe(1);
      expect(a3Notifs.total).toBe(1);
      expect(v1Notifs.total).toBe(0); // viewer bekommt nichts
    });

    test('stürzt NICHT ab wenn userRepo.findAll() wirft (best-effort)', async () => {
      const brokenUserRepo = { findAll: async () => { throw new Error('DB down'); } };
      const safeSvc = new NotificationService({ repo, userRepo: brokenUserRepo });

      // Kein throw erwartet
      await expect(
        safeSvc.broadcastToRoles(['analyst'], { severity: 'high', title: 'X', source: 'system' })
      ).resolves.not.toThrow();
    });

    test('stürzt NICHT ab wenn einzelne Notification-create() wirft (best-effort)', async () => {
      await addUser(userRepo, { id: 'u1', email: 'u1@x.io', role: 'analyst' });

      let callCount = 0;
      const flakyRepo = {
        create: async (n) => {
          callCount++;
          if (callCount === 1) throw new Error('Transient DB error');
          return n;
        },
        listForUser: repo.listForUser.bind(repo),
        unreadCount: repo.unreadCount.bind(repo),
        markRead: repo.markRead.bind(repo),
        markAllRead: repo.markAllRead.bind(repo),
      };
      const svc2 = new NotificationService({ repo: flakyRepo, userRepo });

      // Kein throw erwartet — best-effort
      await expect(
        svc2.broadcastToRoles(['analyst'], { severity: 'high', title: 'X', source: 'system' })
      ).resolves.not.toThrow();
    });

    test('broadcastToRoles mit leerer Rollen-Liste erzeugt keine Notifications', async () => {
      await addUser(userRepo, { id: 'u1', email: 'u1@x.io', role: 'analyst' });
      await svc.broadcastToRoles([], { severity: 'info', title: 'Ignored', source: 'system' });
      const { total } = await svc.listForUser('u1', {});
      expect(total).toBe(0);
    });

    test('broadcastToRoles ignoriert inaktive User', async () => {
      const inactiveUser = new User({
        id: 'inactive1',
        email: 'inactive@x.io',
        passwordHash: 'x',
        role: 'analyst',
        displayName: 'Inactive',
        isActive: false,
      });
      await userRepo.save(inactiveUser);

      await svc.broadcastToRoles(['analyst'], { severity: 'high', title: 'X', source: 'system' });
      const { total } = await svc.listForUser('inactive1', {});
      expect(total).toBe(0);
    });
  });
});
