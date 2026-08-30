'use strict';

// ── TDD RED: API-Tests für /api/v1/notifications ──

const request = require('supertest');
const app     = require('../../src/app');
const { authService }        = require('../../src/services/AuthService');
const { notificationService } = require('../../src/services/NotificationService');
const { ticketService }       = require('../../src/services/TicketService');

let analystAToken, analystAId;
let analystBToken, analystBId;
let viewerToken;

beforeEach(async () => {
  // Stores bereinigen
  notificationService._repo.clear();
  authService._users.clear();
  authService._blocklist.clear();
  ticketService._repo.clear();

  // Analyst A
  const aEmail = `notif-analyst-a-${Date.now()}@x.io`;
  await authService.register({ email: aEmail, password: 'Test1234!', displayName: 'A', role: 'analyst' });
  const aLogin = await request(app).post('/api/v1/auth/login').send({ email: aEmail, password: 'Test1234!' });
  analystAToken = aLogin.body.token;
  analystAId    = aLogin.body.user?.id || (await authService._users.findByEmail(aEmail))?.id;

  // Analyst B (anderer User — für Scoping-Tests)
  const bEmail = `notif-analyst-b-${Date.now()}@x.io`;
  await authService.register({ email: bEmail, password: 'Test1234!', displayName: 'B', role: 'analyst' });
  const bLogin = await request(app).post('/api/v1/auth/login').send({ email: bEmail, password: 'Test1234!' });
  analystBToken = bLogin.body.token;
  analystBId    = bLogin.body.user?.id || (await authService._users.findByEmail(bEmail))?.id;

  // Viewer
  const vEmail = `notif-viewer-${Date.now()}@x.io`;
  await authService.register({ email: vEmail, password: 'Test1234!', displayName: 'V', role: 'viewer' });
  const vLogin = await request(app).post('/api/v1/auth/login').send({ email: vEmail, password: 'Test1234!' });
  viewerToken = vLogin.body.token;
});

const getAs  = (tok) => (url)  => request(app).get(url).set('Authorization',  `Bearer ${tok}`);
const postAs = (tok) => (url)  => request(app).post(url).set('Authorization', `Bearer ${tok}`);

describe('GET /api/v1/notifications', () => {
  test('401 ohne Auth', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  test('gibt leere Liste zurück wenn keine Notifications', async () => {
    const res = await getAs(analystAToken)('/api/v1/notifications');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.unreadCount).toBe(0);
    expect(res.body.requestId).toBeDefined();
  });

  test('gibt NUR eigene Notifications zurück (User-Scoping)', async () => {
    // Notification direkt für analystA anlegen
    await notificationService.create({ userId: analystAId, title: 'Nur für A', source: 'system', severity: 'info' });
    // Notification für analystB anlegen
    await notificationService.create({ userId: analystBId, title: 'Nur für B', source: 'system', severity: 'info' });

    const resA = await getAs(analystAToken)('/api/v1/notifications');
    expect(resA.status).toBe(200);
    expect(resA.body.total).toBe(1);
    expect(resA.body.data[0].title).toBe('Nur für A');

    const resB = await getAs(analystBToken)('/api/v1/notifications');
    expect(resB.status).toBe(200);
    expect(resB.body.total).toBe(1);
    expect(resB.body.data[0].title).toBe('Nur für B');
  });

  test('filtert ungelesene mit ?unreadOnly=true', async () => {
    const n = await notificationService.create({ userId: analystAId, title: 'Ungelesen', source: 'system', severity: 'info' });
    const r = await notificationService.create({ userId: analystAId, title: 'Gelesen', source: 'system', severity: 'info' });
    await notificationService.markRead(r.id, analystAId);

    const res = await getAs(analystAToken)('/api/v1/notifications?unreadOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].id).toBe(n.id);
  });

  test('respektiert ?limit=', async () => {
    for (let i = 0; i < 5; i++) {
      await notificationService.create({ userId: analystAId, title: `N${i}`, source: 'system', severity: 'info' });
    }
    const res = await getAs(analystAToken)('/api/v1/notifications?limit=3');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });

  test('viewer darf eigene Notifications sehen (kein Rollenfilter auf GET)', async () => {
    const viewerUser = await authService._users.findByEmail(
      (await request(app).post('/api/v1/auth/login').send({ email: 'nonexistent', password: 'x' })).body?.email
    ).catch(() => null);
    // Viewer-Token ist valide — nur Lesen, kein Rollenfilter
    const res = await getAs(viewerToken)('/api/v1/notifications');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/notifications/unread-count', () => {
  test('401 ohne Auth', async () => {
    const res = await request(app).get('/api/v1/notifications/unread-count');
    expect(res.status).toBe(401);
  });

  test('gibt korrekten unread-count zurück', async () => {
    await notificationService.create({ userId: analystAId, title: 'A1', source: 'system', severity: 'info' });
    await notificationService.create({ userId: analystAId, title: 'A2', source: 'system', severity: 'info' });

    const res = await getAs(analystAToken)('/api/v1/notifications/unread-count');
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);
    expect(res.body.requestId).toBeDefined();
  });

  test('gibt 0 zurück wenn keine ungelesenen', async () => {
    const res = await getAs(analystBToken)('/api/v1/notifications/unread-count');
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(0);
  });
});

describe('POST /api/v1/notifications/:id/read', () => {
  test('401 ohne Auth', async () => {
    const res = await request(app).post('/api/v1/notifications/some-id/read');
    expect(res.status).toBe(401);
  });

  test('markiert eigene Notification als gelesen', async () => {
    const n = await notificationService.create({ userId: analystAId, title: 'X', source: 'system', severity: 'info' });

    const res = await postAs(analystAToken)(`/api/v1/notifications/${n.id}/read`);
    expect(res.status).toBe(200);
    expect(res.body.data.read).toBe(true);
    expect(res.body.requestId).toBeDefined();
  });

  test('404 wenn Notification einem anderen User gehört (User-Scoping)', async () => {
    const n = await notificationService.create({ userId: analystBId, title: 'Gehört B', source: 'system', severity: 'info' });

    // analystA versucht, Notification von analystB zu lesen → 404
    const res = await postAs(analystAToken)(`/api/v1/notifications/${n.id}/read`);
    expect(res.status).toBe(404);
  });

  test('404 wenn Notification nicht existiert', async () => {
    const res = await postAs(analystAToken)('/api/v1/notifications/nonexistent-id/read');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/notifications/read-all', () => {
  test('401 ohne Auth', async () => {
    const res = await request(app).post('/api/v1/notifications/read-all');
    expect(res.status).toBe(401);
  });

  test('markiert alle eigenen Notifications als gelesen', async () => {
    await notificationService.create({ userId: analystAId, title: 'A1', source: 'system', severity: 'info' });
    await notificationService.create({ userId: analystAId, title: 'A2', source: 'system', severity: 'info' });
    await notificationService.create({ userId: analystBId, title: 'B1', source: 'system', severity: 'info' });

    const res = await postAs(analystAToken)('/api/v1/notifications/read-all');
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(2);
    expect(res.body.requestId).toBeDefined();

    // Analyt B unberührt
    const countB = await notificationService.unreadCount(analystBId);
    expect(countB).toBe(1);
  });

  test('gibt updated:0 zurück wenn keine ungelesenen', async () => {
    const res = await postAs(analystAToken)('/api/v1/notifications/read-all');
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(0);
  });
});

describe('Ticket-Trigger: kritisches Ticket erzeugt Notifications', () => {
  test('POST critical Ticket → Notifications für analyst/engineer/admin (best-effort)', async () => {
    // Analyst A ist bereits registriert — er sollte eine Notification bekommen
    const createRes = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${analystAToken}`)
      .send({ title: 'Kritischer Ransomware-Angriff', priority: 'critical' });

    expect(createRes.status).toBe(201);

    // Kleine Pause da der Trigger fire-and-forget ist
    await new Promise((r) => setTimeout(r, 50));

    // analystA (Ersteller) soll eine Notification bekommen
    const notifRes = await getAs(analystAToken)('/api/v1/notifications');
    expect(notifRes.status).toBe(200);
    // Mindestens 1 Notification (broadcast an sich selbst als analyst)
    expect(notifRes.body.total).toBeGreaterThanOrEqual(1);
    const titles = notifRes.body.data.map((n) => n.title);
    expect(titles.some((t) => t.includes('Kritischer Ransomware-Angriff') || t.includes('Vorfall'))).toBe(true);
  });

  test('Fehler im Notification-Pfad bricht Ticket-Anlegen NICHT', async () => {
    // Wir mocken notificationService.broadcastToRoles so dass es wirft
    const original = notificationService.broadcastToRoles.bind(notificationService);
    notificationService.broadcastToRoles = async () => { throw new Error('Simulated failure'); };

    try {
      const res = await request(app)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${analystAToken}`)
        .send({ title: 'High-Ticket', priority: 'high' });

      // Ticket muss trotzdem 201 zurückgeben
      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe('High-Ticket');
    } finally {
      notificationService.broadcastToRoles = original;
    }
  });

  test('medium Ticket erzeugt KEINE Notifications', async () => {
    await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${analystAToken}`)
      .send({ title: 'Normales Ticket', priority: 'medium' });

    await new Promise((r) => setTimeout(r, 50));

    const notifRes = await getAs(analystAToken)('/api/v1/notifications');
    expect(notifRes.body.total).toBe(0);
  });
});
