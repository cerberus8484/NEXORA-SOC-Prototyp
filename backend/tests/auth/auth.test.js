'use strict';

const request     = require('supertest');
const app         = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { ticketService } = require('../../src/services/TicketService');

// Hilfsfunktion: User anlegen + Token holen
async function getToken(role = 'analyst') {
  const email = `${role}-${Date.now()}@test.soc`;
  await authService.register({ email, displayName: role, password: 'Test1234!', role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  return { token: res.body.token, email };
}

beforeEach(() => {
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();
  ticketService._repo.clear();
});

// ── P6.1 Auth ─────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  test('erfolgreich → gibt token zurück', async () => {
    await authService.register({ email: 'a@test.soc', password: 'Test1234!', displayName: 'A' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@test.soc', password: 'Test1234!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('a@test.soc');
    expect(res.body.user.passwordHash).toBeUndefined(); // NIEMALS exponieren
  });

  test('falsches Passwort → 401', async () => {
    await authService.register({ email: 'b@test.soc', password: 'Test1234!', displayName: 'B' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'b@test.soc', password: 'Wrong!' });
    expect(res.status).toBe(401);
  });

  test('unbekannter User → 401', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'noone@test.soc', password: 'x' });
    expect(res.status).toBe(401);
  });

  test('fehlgeschlagener Login wird im Audit Log gespeichert', async () => {
    await request(app).post('/api/v1/auth/login').send({ email: 'noone@test.soc', password: 'x' });
    const log = auditService.getLog();
    expect(log.some(e => e.action === 'LOGIN_FAILED')).toBe(true);
  });
});

describe('GET /api/v1/auth/me', () => {
  test('gibt aktuellen User zurück', async () => {
    const { token } = await getToken('analyst');
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('analyst');
  });

  test('ohne Token → 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  test('Token wird invalidiert', async () => {
    const { token } = await getToken('analyst');
    await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`);
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

// ── P6.2 RBAC ─────────────────────────────────────────────

describe('RBAC — Ticket-Schutz', () => {
  test('viewer kann Tickets lesen', async () => {
    const { token } = await getToken('viewer');
    const res = await request(app).get('/api/v1/tickets').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('viewer kann KEIN Ticket erstellen → 403', async () => {
    const { token } = await getToken('viewer');
    const res = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${token}`).send({ title: 'Test' });
    expect(res.status).toBe(403);
  });

  test('analyst kann Ticket erstellen', async () => {
    const { token } = await getToken('analyst');
    const res = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${token}`).send({ title: 'C2 Beacon' });
    expect(res.status).toBe(201);
  });

  test('analyst kann Ticket NICHT löschen → 403', async () => {
    const { token } = await getToken('analyst');
    const create = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${token}`).send({ title: 'T' });
    const id     = create.body.data.id;
    const del    = await request(app).delete(`/api/v1/tickets/${id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(403);
  });

  test('admin kann Ticket löschen', async () => {
    const { token: analyst } = await getToken('analyst');
    const { token: admin }   = await getToken('admin');
    const create = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${analyst}`).send({ title: 'T' });
    const id     = create.body.data.id;
    const del    = await request(app).delete(`/api/v1/tickets/${id}`).set('Authorization', `Bearer ${admin}`);
    expect(del.status).toBe(204);
  });

  test('kein Token → 401', async () => {
    const res = await request(app).get('/api/v1/tickets');
    expect(res.status).toBe(401);
  });
});

// ── P6.3 Audit ────────────────────────────────────────────

describe('Audit Log', () => {
  test('Login schreibt Audit-Eintrag', async () => {
    await authService.register({ email: 'audit@test.soc', password: 'Test1234!', displayName: 'A' });
    await request(app).post('/api/v1/auth/login').send({ email: 'audit@test.soc', password: 'Test1234!' });
    const log = auditService.getLog();
    expect(log.some(e => e.action === 'LOGIN' && e.actorLabel === 'audit@test.soc')).toBe(true);
  });

  test('Ticket-Erstellung schreibt Audit-Eintrag', async () => {
    const { token } = await getToken('analyst');
    await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${token}`).send({ title: 'Audit Test' });
    const log = auditService.getLog();
    expect(log.some(e => e.action === 'TICKET_CREATE')).toBe(true);
  });

  test('Ticket-Löschung schreibt Audit-Eintrag', async () => {
    const { token: analyst } = await getToken('analyst');
    const { token: admin }   = await getToken('admin');
    const create = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${analyst}`).send({ title: 'T' });
    await request(app).delete(`/api/v1/tickets/${create.body.data.id}`).set('Authorization', `Bearer ${admin}`);
    const log = auditService.getLog();
    expect(log.some(e => e.action === 'TICKET_DELETE')).toBe(true);
  });
});

// ── Passwort ändern ───────────────────────────────────────
describe('POST /api/v1/auth/change-password', () => {
  async function freshUser() {
    const email = `pw-${Date.now()}@test.soc`;
    await authService.register({ email, displayName: 'PW', password: 'Test1234!' });
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
    return { token: res.body.token, email };
  }
  const change = (token, body) =>
    request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${token}`).send(body);

  test('ändert das Passwort → danach Login mit neuem Passwort', async () => {
    const { token, email } = await freshUser();
    const res = await change(token, { currentPassword: 'Test1234!', newPassword: 'NeuPass99!' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const old = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
    expect(old.status).toBe(401);
    const neu = await request(app).post('/api/v1/auth/login').send({ email, password: 'NeuPass99!' });
    expect(neu.status).toBe(200);
  });

  test('falsches aktuelles Passwort → 401', async () => {
    const { token } = await freshUser();
    const res = await change(token, { currentPassword: 'Falsch!', newPassword: 'NeuPass99!' });
    expect(res.status).toBe(401);
  });

  test('zu kurzes neues Passwort → 400', async () => {
    const { token } = await freshUser();
    const res = await change(token, { currentPassword: 'Test1234!', newPassword: 'kurz' });
    expect(res.status).toBe(400);
  });

  test('gleiches Passwort → 400', async () => {
    const { token } = await freshUser();
    const res = await change(token, { currentPassword: 'Test1234!', newPassword: 'Test1234!' });
    expect(res.status).toBe(400);
  });

  test('ohne Token → 401', async () => {
    const res = await request(app).post('/api/v1/auth/change-password').send({ currentPassword: 'x', newPassword: 'yyyyyyyy' });
    expect(res.status).toBe(401);
  });

  test('schreibt Audit-Eintrag', async () => {
    const { token } = await freshUser();
    await change(token, { currentPassword: 'Test1234!', newPassword: 'NeuPass99!' });
    expect(auditService.getLog().some((e) => e.action === 'auth.password_change')).toBe(true);
  });
});
