'use strict';

// ── TDD RED: broadcastToRoles + Outbound-Integration ────────────────────────
// Prüft:
//   1. Outbound wird genau EINMAL pro Broadcast aufgerufen (nicht pro User)
//   2. In-App-Notifications bleiben unverändert
//   3. Outbound-Fehler bricht den Broadcast / das Ticket-Anlegen NICHT

const { NotificationService } = require('../../src/services/NotificationService');
const { InMemoryNotificationRepository } = require('../../src/repositories/InMemoryNotificationRepository');
const { InMemoryUserRepository }         = require('../../src/repositories/InMemoryUserRepository');
const { User }                           = require('../../src/domain/User');

async function addUser(userRepo, { id, email, role }) {
  const u = new User({ id, email, passwordHash: 'x', role, displayName: email, isActive: true });
  await userRepo.save(u);
  return u;
}

describe('broadcastToRoles + Outbound', () => {
  let repo, userRepo, deliverOutboundMock, svc;

  beforeEach(() => {
    repo     = new InMemoryNotificationRepository();
    userRepo = new InMemoryUserRepository();

    deliverOutboundMock = jest.fn().mockResolvedValue({ sent: ['slack'] });

    svc = new NotificationService({ repo, userRepo, deliverOutbound: deliverOutboundMock });
  });

  test('Outbound wird genau EINMAL aufgerufen, unabhängig von der User-Anzahl', async () => {
    await addUser(userRepo, { id: 'a1', email: 'a1@x.io', role: 'analyst' });
    await addUser(userRepo, { id: 'a2', email: 'a2@x.io', role: 'analyst' });
    await addUser(userRepo, { id: 'a3', email: 'a3@x.io', role: 'engineer' });

    const payload = { severity: 'critical', title: 'Alarm', source: 'system' };
    await svc.broadcastToRoles(['analyst', 'engineer'], payload);

    expect(deliverOutboundMock).toHaveBeenCalledTimes(1);
    expect(deliverOutboundMock).toHaveBeenCalledWith(payload);
  });

  test('In-App-Notifications werden trotzdem für alle User erzeugt', async () => {
    await addUser(userRepo, { id: 'a1', email: 'a1@x.io', role: 'analyst' });
    await addUser(userRepo, { id: 'a2', email: 'a2@x.io', role: 'analyst' });

    const payload = { severity: 'high', title: 'Test', source: 'system' };
    await svc.broadcastToRoles(['analyst'], payload);

    const n1 = await svc.listForUser('a1', {});
    const n2 = await svc.listForUser('a2', {});

    expect(n1.total).toBe(1);
    expect(n2.total).toBe(1);
  });

  test('Outbound-Fehler bricht den Broadcast NICHT — In-App bleibt intakt', async () => {
    await addUser(userRepo, { id: 'a1', email: 'a1@x.io', role: 'analyst' });

    deliverOutboundMock.mockRejectedValueOnce(new Error('HTTP 500 vom Slack-Server'));

    const payload = { severity: 'critical', title: 'Kritisch', source: 'system' };

    // broadcastToRoles darf NICHT werfen
    await expect(
      svc.broadcastToRoles(['analyst'], payload)
    ).resolves.not.toThrow();

    // In-App-Notification muss trotzdem angekommen sein
    const n1 = await svc.listForUser('a1', {});
    expect(n1.total).toBe(1);
  });

  test('Outbound wird NICHT aufgerufen wenn keine User passen (leere Rollen)', async () => {
    await addUser(userRepo, { id: 'a1', email: 'a1@x.io', role: 'analyst' });

    await svc.broadcastToRoles([], { severity: 'info', title: 'X', source: 'system' });

    expect(deliverOutboundMock).not.toHaveBeenCalled();
  });

  test('Outbound wird NICHT aufgerufen wenn kein userRepo vorhanden', async () => {
    const noUserSvc = new NotificationService({ repo, userRepo: null, deliverOutbound: deliverOutboundMock });

    await noUserSvc.broadcastToRoles(['analyst'], { severity: 'info', title: 'X', source: 'system' });

    expect(deliverOutboundMock).not.toHaveBeenCalled();
  });

  test('Outbound-Aufruf enthält das übergebene Payload (Inhalt-Vertrag)', async () => {
    await addUser(userRepo, { id: 'a1', email: 'a1@x.io', role: 'admin' });

    const payload = { severity: 'critical', title: 'Payload-Test', source: 'ticket', body: 'Details hier', link: '/t/42' };
    await svc.broadcastToRoles(['admin'], payload);

    expect(deliverOutboundMock).toHaveBeenCalledWith(payload);
  });

  test('Outbound wird auch bei inaktiven-User-Ausschluss korrekt EINMAL aufgerufen', async () => {
    // Nur aktiver User — inaktiver User wird ausgeschlossen
    await addUser(userRepo, { id: 'active1', email: 'active@x.io', role: 'analyst' });
    const inactive = new User({
      id: 'inactive1', email: 'inactive@x.io', passwordHash: 'x',
      role: 'analyst', displayName: 'Inactive', isActive: false,
    });
    await userRepo.save(inactive);

    await svc.broadcastToRoles(['analyst'], { severity: 'info', title: 'X', source: 'system' });

    expect(deliverOutboundMock).toHaveBeenCalledTimes(1);
  });
});
