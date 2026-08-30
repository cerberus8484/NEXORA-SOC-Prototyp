'use strict';

// ── Block A: Silent-Failures sichtbar machen ────────────────────────────────
// Best-effort-Cleanup-Queries (.catch) dürfen das Hauptverhalten nicht blockieren,
// MÜSSEN aber bei Fehler einen warn-Log absetzen (kein stilles Schlucken).
// Jeder Test simuliert einen Query-Fehler und prüft via Logger-Spy, dass warn
// mit nur Metadaten (err.message) aufgerufen wird — niemals PII/Secrets.

const logger = require('../../src/logger');

// Wartet, bis fire-and-forget-Promises (kein await im Produktivcode) abgearbeitet sind.
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe('AuthService — Cleanup-Fehler werden geloggt statt geschluckt', () => {
  const { AuthService } = require('../../src/services/AuthService');
  let warnSpy;

  beforeEach(() => { warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  test('jwt_blocklist-Cleanup-Fehler → warn (verifyToken bleibt funktionsfähig)', async () => {
    // queryFn: CREATE TABLE ok; DELETE-Cleanup wirft; SELECT (revoke-Check) liefert leer.
    const queryFn = jest.fn(async (sql) => {
      if (/DELETE FROM jwt_blocklist/.test(sql)) throw new Error('cleanup boom');
      if (/SELECT 1 FROM jwt_blocklist/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const auth = new AuthService(undefined, queryFn);
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../../src/services/AuthService');
    const token = jwt.sign({ sub: 'u1', jti: 'j1', role: 'analyst' }, JWT_SECRET, { expiresIn: '5m' });

    const payload = await auth.verifyToken(token); // darf NICHT werfen
    await flushMicrotasks();

    expect(payload.sub).toBe('u1');
    expect(warnSpy).toHaveBeenCalledWith('jwt_blocklist_cleanup_failed', { message: 'cleanup boom' });
  });

  test('lockout-Cleanup-Fehler → warn (Lockout-Check bleibt funktionsfähig)', async () => {
    const queryFn = jest.fn(async (sql) => {
      if (/UPDATE login_lockouts/.test(sql)) throw new Error('lockout boom');
      if (/SELECT locked_until/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const auth = new AuthService(undefined, queryFn);

    // _isLockedOut läuft über den DB-Pfad → triggert die UPDATE-Cleanup-Query.
    const locked = await auth._isLockedOut('victim@test.io');
    await flushMicrotasks();

    expect(locked).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('lockout_cleanup_failed', { message: 'lockout boom' });
  });

  test('session-Cleanup-Fehler → warn (Session-Registrierung bleibt funktionsfähig)', async () => {
    const queryFn = jest.fn(async (sql) => {
      if (/DELETE FROM user_sessions WHERE expires_at/.test(sql)) throw new Error('session boom');
      return { rows: [] };
    });
    const auth = new AuthService(undefined, queryFn);

    await auth._recordSession('jti-1', 'u1', Date.now() + 60_000); // darf NICHT werfen
    await flushMicrotasks();

    expect(warnSpy).toHaveBeenCalledWith('session_cleanup_failed', { message: 'session boom' });
  });
});

describe('ApiTokenService — updateLastUsed-Fehler wird geloggt statt geschluckt', () => {
  const { ApiTokenService } = require('../../src/services/ApiTokenService');
  const { ApiToken } = require('../../src/domain/ApiToken');
  let warnSpy;

  beforeEach(() => { warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  test('authenticate() liefert weiter { userId, tokenId }, loggt aber den Update-Fehler', async () => {
    const { token, domain } = await ApiToken.create({ userId: 'u1', name: 'T' });
    const tokenRepo = {
      findByHash: jest.fn(async () => domain),
      updateLastUsed: jest.fn(async () => { throw new Error('update boom'); }),
    };
    const service = new ApiTokenService({ tokenRepo });

    const result = await service.authenticate(token); // darf NICHT werfen
    await flushMicrotasks();

    expect(result).toEqual({ userId: 'u1', tokenId: domain.id });
    expect(warnSpy).toHaveBeenCalledWith('api_token_last_used_update_failed', { message: 'update boom' });
  });
});

describe('PostgresThreatIntelCache — Cleanup-Fehler wird geloggt statt geschluckt', () => {
  let warnSpy;

  beforeEach(() => {
    jest.resetModules();
    warnSpy = jest.spyOn(require('../../src/logger'), 'warn').mockImplementation(() => {});
  });
  afterEach(() => { warnSpy.mockRestore(); jest.resetModules(); });

  test('get() auf abgelaufenem Key gibt null, loggt den DELETE-Fehler', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const query = jest.fn(async (sql) => {
      if (/^\s*CREATE TABLE/.test(sql)) return { rows: [] };
      if (/SELECT value, expires_at/.test(sql)) return { rows: [{ value: { v: 1 }, expires_at: past }] };
      if (/DELETE FROM threat_intel_cache/.test(sql)) throw new Error('ti cleanup boom');
      return { rows: [] };
    });
    jest.doMock('../../src/db/pool', () => ({ query }));
    const { PostgresThreatIntelCache } = require('../../src/integrations/threatIntel/PostgresThreatIntelCache');

    const cache = new PostgresThreatIntelCache();
    const value = await cache.get('ip:1.2.3.4'); // darf NICHT werfen
    await flushMicrotasks();

    expect(value).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('threat_intel_cache_cleanup_failed', { message: 'ti cleanup boom' });
  });
});

describe('QRadarDashboardProvider — getStats()-Fehler wird geloggt statt geschluckt', () => {
  let warnSpy;
  let QRadarDashboardProvider;

  const ORIG = { url: process.env.QRADAR_BASE_URL, token: process.env.QRADAR_TOKEN };
  beforeEach(() => {
    jest.resetModules(); // sicherstellen: Provider + Logger teilen denselben Modul-Cache
    warnSpy = jest.spyOn(require('../../src/logger'), 'warn').mockImplementation(() => {});
    ({ QRadarDashboardProvider } = require('../../src/integrations/adapters/qradar/QRadarDashboardProvider'));
  });
  afterEach(() => {
    warnSpy.mockRestore();
    jest.resetModules();
    if (ORIG.url == null) delete process.env.QRADAR_BASE_URL; else process.env.QRADAR_BASE_URL = ORIG.url;
    if (ORIG.token == null) delete process.env.QRADAR_TOKEN; else process.env.QRADAR_TOKEN = ORIG.token;
  });

  test('getStats() liefert connected:false UND loggt den Fehler (kein lautloses leeres Dashboard)', async () => {
    process.env.QRADAR_BASE_URL = 'https://qradar.example';
    process.env.QRADAR_TOKEN = 'secret';
    const provider = new QRadarDashboardProvider();
    // _fetchRawOffenses fängt seine eigenen HTTP-Fehler ab. Um den getStats()-catch
    // selbst zu treffen, lassen wir die Roh-Fetch-Stufe direkt werfen.
    provider._fetchRawOffenses = async () => { throw new Error('stats boom'); };

    const stats = await provider.getStats();

    expect(stats.connected).toBe(false);
    expect(stats.openCount).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith('qradar_stats_failed', { message: 'stats boom' });
  });
});
