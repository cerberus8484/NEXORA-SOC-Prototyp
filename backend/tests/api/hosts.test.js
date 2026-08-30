'use strict';

const request = require('supertest');
const app     = require('../../src/app');
const { ticketService }  = require('../../src/services/TicketService');
const { authService }    = require('../../src/services/AuthService');
const { wazuhApiClient } = require('../../src/integrations/adapters/wazuh/wazuhApiInstance');

let token;

beforeEach(async () => {
  ticketService._repo.clear();
  authService._users.clear();
  authService._blocklist.clear();

  const email = `hosts-${Date.now()}@test.soc`;
  await authService.register({ email, password: 'Test1234!', displayName: 'A', role: 'analyst' });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  token = res.body.token;
});

const auth = {
  get:  (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url) => request(app).post(url).set('Authorization', `Bearer ${token}`),
};

// ── TicketService.findByHost (Alert-History-Logik) ────────────────────
describe('TicketService.findByHost', () => {
  test('findet Tickets über agentId im offenseId (:agent:<id>)', async () => {
    await ticketService.create({ title: 'Alert A', offenseId: 'wazuh:rule:5710:agent:004', source: 'webhook' });
    await ticketService.create({ title: 'Alert B', offenseId: 'wazuh:rule:5712:agent:099', source: 'webhook' });

    const rows = await ticketService.findByHost({ agentId: '004' });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Alert A');
    expect(rows[0]).toHaveProperty('priority');
    expect(rows[0]).toHaveProperty('createdAt');
  });

  test('findet Tickets über exakten hostname (case-insensitive)', async () => {
    await ticketService.create({ title: 'Host-Match', hostname: 'WINCLIENT' });
    await ticketService.create({ title: 'Andrer', hostname: 'OTHER' });

    const rows = await ticketService.findByHost({ hostname: 'winclient' });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Host-Match');
  });

  test('ohne agentId und hostname → leere Liste; respektiert limit', async () => {
    expect(await ticketService.findByHost({})).toEqual([]);

    for (let i = 0; i < 5; i++) {
      await ticketService.create({ title: `A${i}`, offenseId: 'wazuh:rule:1:agent:004' });
    }
    const rows = await ticketService.findByHost({ agentId: '004', limit: 3 });
    expect(rows).toHaveLength(3);
  });
});

// ── GET /api/v1/hosts/:agentId/alerts ─────────────────────────────────
describe('GET /api/v1/hosts/:agentId/alerts', () => {
  test('liefert Alert-History des Hosts (neueste zuerst)', async () => {
    await ticketService.create({ title: 'Erst', offenseId: 'wazuh:rule:1:agent:004' });
    await new Promise((r) => setTimeout(r, 5));
    await ticketService.create({ title: 'Spaeter', offenseId: 'wazuh:rule:2:agent:004' });

    const res = await auth.get('/api/v1/hosts/004/alerts');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].title).toBe('Spaeter');
    expect(res.body.total).toBe(2);
  });

  test('ohne Auth → 401', async () => {
    const res = await request(app).get('/api/v1/hosts/004/alerts');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/hosts/:agentId (Inventory-Detail) ─────────────────────
describe('GET /api/v1/hosts/:agentId', () => {
  test('ohne konfigurierte Wazuh-API → enabled:false, data:null', async () => {
    // In der Test-Umgebung sind keine WAZUH_API_*-Credentials gesetzt.
    const res = await auth.get('/api/v1/hosts/004');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.data).toBeNull();
  });

  test('ohne Auth → 401', async () => {
    const res = await request(app).get('/api/v1/hosts/004');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/hosts/:agentId/packages (Software-Liste) ──────────────
describe('GET /api/v1/hosts/:agentId/packages', () => {
  test('ohne Auth → 401', async () => {
    const res = await request(app).get('/api/v1/hosts/004/packages');
    expect(res.status).toBe(401);
  });

  test('ohne konfigurierte Wazuh-API → enabled:false, data:[], total:0', async () => {
    // In der Test-Umgebung sind keine WAZUH_API_*-Credentials gesetzt.
    const res = await auth.get('/api/v1/hosts/004/packages');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  test('enabled → liefert Paketliste + total und cappt limit auf 200', async () => {
    const items = [{ name: 'curl', version: '8.5.0', vendor: 'Ubuntu', architecture: 'amd64' }];
    const origEnabled  = wazuhApiClient.isEnabled;
    const origPackages = wazuhApiClient.getAgentPackages;
    let capturedOpts = null;
    wazuhApiClient.isEnabled = () => true;
    wazuhApiClient.getAgentPackages = async (_agentId, opts) => {
      capturedOpts = opts;
      return { items, total: 710 };
    };
    try {
      const res = await auth.get('/api/v1/hosts/004/packages?limit=9999&offset=20&search=open ssl');
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.data).toEqual(items);
      expect(res.body.total).toBe(710);
      // Route cappt limit vor Weitergabe an den Client (Defense-in-Depth).
      expect(capturedOpts.limit).toBe(200);
      expect(capturedOpts.offset).toBe(20);
      expect(capturedOpts.search).toBe('open ssl');
    } finally {
      wazuhApiClient.isEnabled = origEnabled;
      wazuhApiClient.getAgentPackages = origPackages;
    }
  });
});

// ── POST /api/v1/hosts/:agentId/collect (Auth-Regression) ─────────────
describe('POST /api/v1/hosts/:agentId/collect', () => {
  test('ohne Auth → 401', async () => {
    const res = await request(app).post('/api/v1/hosts/004/collect').send({ ticketId: 'INC1' });
    expect(res.status).toBe(401);
  });

  // Regression: vorher fehlte requireAuth → req.user nie gesetzt → requireRole
  // verweigerte JEDEN Request mit 401, auch authentifizierte Analysten.
  test('authentifizierter Analyst passiert die Auth (kein 401) und erreicht die Validierung', async () => {
    const res = await auth.post('/api/v1/hosts/004/collect').send({});
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(400); // "ticketId fehlt" → beweist: requireAuth lief, req.user gesetzt
  });
});
