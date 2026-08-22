'use strict';

/**
 * Tests für GET /api/v1/integrations/status + POST /api/v1/integrations/:id/test
 *
 * TDD-Reihenfolge:
 *   1. Tests schreiben (RED)
 *   2. buildIntegrationStatus (pure Mapping-Logik) einzel-testen
 *   3. Routen testen (Auth, Secret-Leak-Schutz)
 */

const request      = require('supertest');
const app          = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');
const { WAZUH_CONNECTION_KEY } = require('../../src/services/wazuhConnectionSettings');
const { KEY_SETTING_KEY } = require('../../src/services/threatIntelKeys');
const { encryptSecret } = require('../../src/config/secretsCrypto');
const { RealHttpClient } = require('../../src/integrations/http/RealHttpClient');
const wazuhConnectionTester = require('../../src/services/wazuhConnectionTester');

// ── Auth-Fixtures ─────────────────────────────────────────────────────────────

let adminToken;
let analystToken;

beforeAll(async () => {
  const adminEmail   = `integ-admin-${Date.now()}@x.test`;
  const analystEmail = `integ-analyst-${Date.now()}@x.test`;

  await authService.register({ email: adminEmail,   password: 'Admin1234!', displayName: 'Admin',   role: 'admin' });
  await authService.register({ email: analystEmail, password: 'Test1234!',  displayName: 'Analyst', role: 'analyst' });

  adminToken   = (await request(app).post('/api/v1/auth/login').send({ email: adminEmail,   password: 'Admin1234!' })).body.token;
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: analystEmail, password: 'Test1234!' })).body.token;
});

beforeEach(async () => {
  const repo = createSettingsRepository();
  await repo.set(WAZUH_CONNECTION_KEY, {});
  await repo.set(KEY_SETTING_KEY.virustotal, '');
  await repo.set(KEY_SETTING_KEY.abuseipdb, '');
  await repo.set('ollamaBaseUrl', '');
  await repo.set('ollamaModel', '');
});

// ── Unit-Tests: buildIntegrationStatus (pure Funktion) ────────────────────────

const { buildIntegrationStatus, buildEffectiveIntegrationStatus } = require('../../src/integrations/integrationStatusMapper');

describe('buildIntegrationStatus — pure Mapping-Logik', () => {
  test('liefert alle erwarteten Integrationen', () => {
    const list = buildIntegrationStatus({});
    const ids = list.map((i) => i.id);
    expect(ids).toContain('wazuh');
    expect(ids).toContain('qradar');
    expect(ids).toContain('splunk');
    expect(ids).toContain('virustotal');
    expect(ids).toContain('abuseipdb');
    expect(ids).toContain('ollama');
    expect(ids).toContain('servicenow');
    expect(ids).toContain('otrs');
    expect(ids).toContain('email');
  });

  test('Pflichtfelder je Integration', () => {
    const list = buildIntegrationStatus({});
    for (const item of list) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('category');
      expect(item).toHaveProperty('configured');
      expect(item).toHaveProperty('endpoint');
      expect(item).toHaveProperty('status');
      expect(['siem', 'ticketing', 'threat_intel', 'llm', 'email']).toContain(item.category);
      expect(['connected', 'configured', 'not_configured']).toContain(item.status);
    }
  });

  test('not_configured wenn ENV fehlt', () => {
    const list = buildIntegrationStatus({ env: {} }); // alle ENV leer
    for (const item of list) {
      expect(item.configured).toBe(false);
      expect(item.status).toBe('not_configured');
    }
  });

  test('configured wenn Wazuh-ENV gesetzt', () => {
    const env = {
      WAZUH_API_URL:      'https://wazuh.example.com:55000',
      WAZUH_API_USER:     'wazuh-admin',
      WAZUH_API_PASSWORD: 'secret-never-leaked',
    };
    const list = buildIntegrationStatus({ env });
    const wazuh = list.find((i) => i.id === 'wazuh');
    expect(wazuh.configured).toBe(true);
    expect(wazuh.status).toBe('configured');
  });

  test('configured wenn QRadar-ENV gesetzt', () => {
    const env = {
      QRADAR_BASE_URL: 'https://qradar.corp.lan',
      QRADAR_TOKEN:    'super-secret-token',
    };
    const list = buildIntegrationStatus({ env });
    const qradar = list.find((i) => i.id === 'qradar');
    expect(qradar.configured).toBe(true);
  });

  // ── Secret-Leak-Tests (KRITISCH) ──────────────────────────────────────────

  test('SECRET-LEAK: endpoint enthält KEINE Credentials (kein user:pass@ in URL)', () => {
    const env = {
      WAZUH_API_URL:      'https://wazuh-user:geheimesPasswort@wazuh.example.com:55000',
      WAZUH_API_USER:     'wazuh-admin',
      WAZUH_API_PASSWORD: 'geheimesPasswort',
      QRADAR_BASE_URL:'https://qradar.corp.lan',
      QRADAR_TOKEN:   'super-secret-token',
      VIRUSTOTAL_API_KEY: 'vt-apikey-12345',
    };
    const list = buildIntegrationStatus({ env });
    for (const item of list) {
      // endpoint darf kein user:pass@host enthalten
      expect(item.endpoint).not.toMatch(/:[^/]*@/);
      // Response-Objekt darf keine Secret-Felder enthalten
      const json = JSON.stringify(item);
      expect(json).not.toContain('geheimesPasswort');
      expect(json).not.toContain('super-secret-token');
      expect(json).not.toContain('vt-apikey-12345');
    }
  });

  test('SECRET-LEAK: keine api_key / password / token / secret Felder im Item', () => {
    const env = {
      WAZUH_API_PASSWORD: 'pw1',
      QRADAR_TOKEN:       'tok1',
      VIRUSTOTAL_API_KEY: 'vt1',
      ABUSEIPDB_API_KEY:  'ab1',
      SPLUNK_TOKEN:       'splunk-tok',
    };
    const list = buildIntegrationStatus({ env });
    for (const item of list) {
      const SECRET_FIELDS = ['api_key', 'apiKey', 'password', 'token', 'secret', 'passwd', 'credential'];
      for (const field of SECRET_FIELDS) {
        expect(item).not.toHaveProperty(field);
      }
    }
  });

  test('endpoint: NUR Host (kein Pfad/Query/Credential) bei Wazuh', () => {
    const env = { WAZUH_API_URL: 'https://wazuh.example.com:55000', WAZUH_API_USER: 'u', WAZUH_API_PASSWORD: 'p' };
    const list = buildIntegrationStatus({ env });
    const wazuh = list.find((i) => i.id === 'wazuh');
    // Nur Host:Port — kein Pfad
    expect(wazuh.endpoint).toBe('wazuh.example.com:55000');
  });

  test('endpoint: leer wenn nicht konfiguriert', () => {
    const list = buildIntegrationStatus({ env: {} });
    for (const item of list) {
      expect(item.endpoint).toBe('');
    }
  });

  test('testable-Feld zeigt an, ob Live-Test möglich', () => {
    const list = buildIntegrationStatus({});
    const wazuh = list.find((i) => i.id === 'wazuh');
    const servicenow = list.find((i) => i.id === 'servicenow');
    expect(wazuh.testable).toBe(true);
    expect(servicenow.testable).toBe(false);
  });

  test('effective status: DB-Wazuh und DB-Threat-Intel werden in der Uebersicht erkannt', async () => {
    const repo = createSettingsRepository();
    await repo.set(WAZUH_CONNECTION_KEY, {
      api: { url: 'https://wazuh.db.local:55000', user: 'nexora', password: encryptSecret('db-secret') },
    });
    await repo.set(KEY_SETTING_KEY.virustotal, encryptSecret('vt-secret'));

    const list = await buildEffectiveIntegrationStatus({ settingsRepo: repo, env: {} });
    expect(list.find((i) => i.id === 'wazuh')).toMatchObject({
      configured: true,
      endpoint: 'wazuh.db.local:55000',
      status: 'configured',
    });
    expect(list.find((i) => i.id === 'virustotal')).toMatchObject({
      configured: true,
      endpoint: 'www.virustotal.com',
      status: 'configured',
    });
  });

  test('effective status: Ollama faellt auf ENV zurueck, wenn keine DB-URL gesetzt ist', async () => {
    const repo = createSettingsRepository();
    const list = await buildEffectiveIntegrationStatus({
      settingsRepo: repo,
      env: { OLLAMA_BASE_URL: 'http://10.0.10.77:11434' },
    });

    expect(list.find((i) => i.id === 'ollama')).toMatchObject({
      configured: true,
      endpoint: '10.0.10.77:11434',
      status: 'configured',
    });
  });
});

// ── API-Tests: GET /api/v1/integrations/status ────────────────────────────────

describe('GET /api/v1/integrations/status', () => {
  test('ohne Auth → 401', async () => {
    const res = await request(app).get('/api/v1/integrations/status');
    expect(res.status).toBe(401);
  });

  test('Analyst (nicht admin) → 403', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/status')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  test('Admin → 200 + Liste', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/status')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test('SECRET-LEAK: Response enthält keine Secret-Felder', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/status')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const body = JSON.stringify(res.body);
    const SECRET_FIELDS = ['api_key', 'apiKey', 'password', 'token', 'secret', 'passwd'];
    for (const field of SECRET_FIELDS) {
      // Wir prüfen, ob das Feld als JSON-Key auftaucht (nicht als zufälliger Teilstring)
      expect(body).not.toMatch(new RegExp(`"${field}"\\s*:`));
    }
  });

  test('Jede Integration hat id, name, category, configured, endpoint, status', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/status')
      .set('Authorization', `Bearer ${adminToken}`);
    for (const item of res.body.data) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.name).toBe('string');
      expect(['siem', 'ticketing', 'threat_intel', 'llm', 'email']).toContain(item.category);
      expect(typeof item.configured).toBe('boolean');
      expect(typeof item.endpoint).toBe('string');
      expect(['connected', 'configured', 'not_configured']).toContain(item.status);
    }
  });

  test('Admin sieht DB-gespeicherte Wazuh/TI-Konfiguration auch ohne passende ENV', async () => {
    const repo = createSettingsRepository();
    await repo.set(WAZUH_CONNECTION_KEY, {
      api: { url: 'https://db-wazuh.local:55000', user: 'nexora', password: encryptSecret('db-secret') },
    });
    await repo.set(KEY_SETTING_KEY.abuseipdb, encryptSecret('abuse-secret'));

    const res = await request(app)
      .get('/api/v1/integrations/status')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.find((item) => item.id === 'wazuh')).toMatchObject({
      configured: true,
      endpoint: 'db-wazuh.local:55000',
    });
    expect(res.body.data.find((item) => item.id === 'abuseipdb')).toMatchObject({
      configured: true,
      endpoint: 'api.abuseipdb.com',
    });
  });
});

// ── API-Tests: POST /api/v1/integrations/:id/test ────────────────────────────

describe('POST /api/v1/integrations/:id/test', () => {
  test('ohne Auth → 401', async () => {
    const res = await request(app).post('/api/v1/integrations/wazuh/test');
    expect(res.status).toBe(401);
  });

  test('Analyst → 403', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/wazuh/test')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  test('Unbekannte id → 400', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/unbekannt-xyz/test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  test('nicht-testbare Integration (servicenow) → 501 + testable:false', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/servicenow/test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(501);
    expect(res.body.testable).toBe(false);
  });

  test('nicht-testbare Integration (otrs) → 501 + testable:false', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/otrs/test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(501);
    expect(res.body.testable).toBe(false);
  });

  test('testbare Integration (wazuh) nicht konfiguriert → reachable:false + testedAt gesetzt', async () => {
    // Im Test-ENV ist Wazuh nicht konfiguriert → reachable:false ist erwartet
    const res = await request(app)
      .post('/api/v1/integrations/wazuh/test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reachable');
    expect(res.body).toHaveProperty('testedAt');
    expect(typeof res.body.testedAt).toBe('string');
  });

  test('Wazuh-Test nutzt DB-Konfiguration statt nur ENV', async () => {
    const repo = createSettingsRepository();
    await repo.set(WAZUH_CONNECTION_KEY, {
      api: { url: 'https://db-wazuh.local:55000', user: 'nexora', password: encryptSecret('db-secret') },
    });

    const testSpy = jest.spyOn(wazuhConnectionTester, 'testConnection').mockResolvedValue({ ok: true });

    try {
      const res = await request(app)
        .post('/api/v1/integrations/wazuh/test')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(testSpy).toHaveBeenCalledWith('api', expect.objectContaining({
        url: 'https://db-wazuh.local:55000',
        user: 'nexora',
        password: 'db-secret',
      }));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('reachable', true);
      expect(res.body).toHaveProperty('testedAt');
      expect(res.body.message).not.toMatch(/nicht konfiguriert/i);
    } finally {
      testSpy.mockRestore();
    }
  });

  test('Threat-Intel-Test nutzt DB-Key statt nur ENV', async () => {
    const repo = createSettingsRepository();
    await repo.set(KEY_SETTING_KEY.virustotal, encryptSecret('vt-secret'));

    const res = await request(app)
      .post('/api/v1/integrations/virustotal/test')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.reachable).toBe(true);
  });

  test('Ollama-Test liefert bei fehlendem Modell reason + modelAvailable', async () => {
    const repo = createSettingsRepository();
    await repo.set('ollamaBaseUrl', 'http://10.0.10.77:11434');
    await repo.set('ollamaModel', 'llama3.2:3b');

    const requestSpy = jest.spyOn(RealHttpClient.prototype, 'request').mockResolvedValue({
      data: { models: [{ name: 'nomic-embed-text' }] },
    });

    try {
      const res = await request(app)
        .post('/api/v1/integrations/ollama/test')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(requestSpy).toHaveBeenCalledWith('http://10.0.10.77:11434/api/tags', { method: 'GET' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        reachable: true,
        modelAvailable: false,
        reason: 'model_missing',
      });
    } finally {
      requestSpy.mockRestore();
    }
  });

  test('SECRET-LEAK: Test-Response enthält keine Secret-Felder', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/wazuh/test')
      .set('Authorization', `Bearer ${adminToken}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/"password"\s*:/);
    expect(body).not.toMatch(/"token"\s*:/);
    expect(body).not.toMatch(/"api_key"\s*:/);
    expect(body).not.toMatch(/"secret"\s*:/);
  });
});
