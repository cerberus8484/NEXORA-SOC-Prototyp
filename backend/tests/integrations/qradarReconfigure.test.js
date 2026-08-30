'use strict';

// Layer 2: QRadar-Verbindung zur Laufzeit ändern (aus der UI) + ping().
// Der Provider liest sonst ENV zur Call-Zeit — ein gesetztes Override gewinnt.

const { QRadarDashboardProvider } = require('../../src/integrations/adapters/qradar/QRadarDashboardProvider');
const { InMemoryHttpClient } = require('../../src/integrations/http/InMemoryHttpClient');

const envBackup = {};
beforeEach(() => {
  envBackup.url = process.env.QRADAR_BASE_URL;
  envBackup.token = process.env.QRADAR_TOKEN;
  delete process.env.QRADAR_BASE_URL;
  delete process.env.QRADAR_TOKEN;
});
afterEach(() => {
  if (envBackup.url === undefined) delete process.env.QRADAR_BASE_URL; else process.env.QRADAR_BASE_URL = envBackup.url;
  if (envBackup.token === undefined) delete process.env.QRADAR_TOKEN; else process.env.QRADAR_TOKEN = envBackup.token;
});

describe('QRadarDashboardProvider.reconfigure', () => {
  test('Override gewinnt über ENV: isEnabled true + Requests nutzen Override-URL/Token', async () => {
    process.env.QRADAR_BASE_URL = 'https://env-qradar';
    process.env.QRADAR_TOKEN = 'env-token';
    const http = new InMemoryHttpClient();
    http.mockUrl('/api/siem/offenses', 200, []);
    const p = new QRadarDashboardProvider({ http });

    p.reconfigure({ baseUrl: 'https://10.0.10.60/', token: 'db-token' });
    expect(p.isEnabled()).toBe(true);
    await p.getOffenses('OPEN');

    const req = http.getRequests().find((r) => r.url.includes('/api/siem/offenses'));
    expect(req.url.startsWith('https://10.0.10.60/api/siem/offenses')).toBe(true); // trailing slash normalisiert
    expect(req.headers.SEC).toBe('db-token');
  });

  test('reconfigure auf leere Werte → zurück auf ENV', () => {
    process.env.QRADAR_BASE_URL = 'https://env-qradar';
    process.env.QRADAR_TOKEN = 'env-token';
    const p = new QRadarDashboardProvider({ http: new InMemoryHttpClient() });
    p.reconfigure({ baseUrl: 'https://db', token: 'db' });
    p.reconfigure({ baseUrl: '', token: '' });
    expect(p.isEnabled()).toBe(true); // ENV greift wieder
  });

  test('ohne ENV und ohne Override → isEnabled false', () => {
    const p = new QRadarDashboardProvider({ http: new InMemoryHttpClient() });
    expect(p.isEnabled()).toBe(false);
  });
});

describe('QRadarDashboardProvider.ping', () => {
  test('erreichbar → { ok:true }', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/api/siem/offenses', 200, []);
    const p = new QRadarDashboardProvider({ http });
    p.reconfigure({ baseUrl: 'https://10.0.10.60', token: 't' });
    await expect(p.ping()).resolves.toEqual({ ok: true });
  });

  test('401 → Fehler propagiert (kein stilles false)', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/api/siem/offenses', 401, { message: 'unauthorized' });
    const p = new QRadarDashboardProvider({ http });
    p.reconfigure({ baseUrl: 'https://10.0.10.60', token: 'bad' });
    await expect(p.ping()).rejects.toThrow(/401/);
  });

  test('nicht konfiguriert → wirft mit klarer Meldung', async () => {
    const p = new QRadarDashboardProvider({ http: new InMemoryHttpClient() });
    await expect(p.ping()).rejects.toThrow(/nicht konfiguriert/i);
  });
});
