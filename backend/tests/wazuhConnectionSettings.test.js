'use strict';

// wazuhConnectionSettings — Layer 2: Wazuh-Verbindung (API + Indexer) aus der DB
// verwalten, ENV bleibt Fallback (Boot-Automatisierung bricht nicht).
//
// Sichert:
//   - Auflösung: DB-Sektion gewinnt, wenn deren URL gesetzt ist; sonst ENV,
//   - Passwörter liegen NIE im Klartext in der DB (enc:v1:-Prefix),
//   - maskierte Sicht gibt NIE ein Passwort heraus (nur passwordSet-Boolean),
//   - Save-Semantik: leeres Passwort = altes behalten · leere URL = Sektion löschen (→ ENV).

const { InMemorySettingsRepository } = require('../src/repositories/InMemorySettingsRepository');
const { isEncrypted, decryptSecret } = require('../src/config/secretsCrypto');
const {
  WAZUH_CONNECTION_KEY,
  resolveWazuhConnection,
  saveWazuhConnection,
  maskedWazuhConnection,
} = require('../src/services/wazuhConnectionSettings');

const config = require('../src/config');

let repo;
const originalApi     = { ...config.wazuhApi };
const originalIndexer = { ...config.wazuhIndexer };

beforeEach(() => {
  repo = new InMemorySettingsRepository();
  // Definierter ENV-Zustand für jeden Test (config direkt, wie services.test.js es macht).
  config.wazuhApi.url          = 'https://env-wazuh:55000';
  config.wazuhApi.user         = 'env-api-user';
  config.wazuhApi.password     = 'env-api-pass';
  config.wazuhIndexer.url      = 'https://env-indexer:9200';
  config.wazuhIndexer.user     = 'env-idx-user';
  config.wazuhIndexer.password = 'env-idx-pass';
});

afterAll(() => {
  Object.assign(config.wazuhApi, originalApi);
  Object.assign(config.wazuhIndexer, originalIndexer);
});

describe('resolveWazuhConnection', () => {
  test('ohne DB-Eintrag → ENV-Werte, source=env', async () => {
    const conn = await resolveWazuhConnection(repo);
    expect(conn.api).toMatchObject({ url: 'https://env-wazuh:55000', user: 'env-api-user', password: 'env-api-pass', source: 'env' });
    expect(conn.indexer).toMatchObject({ url: 'https://env-indexer:9200', user: 'env-idx-user', password: 'env-idx-pass', source: 'env' });
  });

  test('DB-Sektion mit URL gewinnt über ENV (Passwort entschlüsselt), source=db', async () => {
    await saveWazuhConnection(repo, {
      api: { url: 'https://10.0.10.99:55000', user: 'db-user', password: 'db-pass' },
    });
    const conn = await resolveWazuhConnection(repo);
    expect(conn.api).toMatchObject({ url: 'https://10.0.10.99:55000', user: 'db-user', password: 'db-pass', source: 'db' });
    // Indexer nicht in DB → weiter ENV.
    expect(conn.indexer.source).toBe('env');
  });

  test('weder DB noch ENV → leere Sektion, source=none', async () => {
    config.wazuhApi.url = ''; config.wazuhApi.user = ''; config.wazuhApi.password = '';
    const conn = await resolveWazuhConnection(repo);
    expect(conn.api).toMatchObject({ url: '', user: '', password: '', source: 'none' });
  });

  test('Indexer-Auflösung liefert index/vulnIndex aus der Config mit', async () => {
    const conn = await resolveWazuhConnection(repo);
    expect(conn.indexer.index).toBe(config.wazuhIndexer.index);
    expect(conn.indexer.vulnIndex).toBe(config.wazuhIndexer.vulnIndex);
  });
});

describe('saveWazuhConnection', () => {
  test('Passwort liegt verschlüsselt in der DB (enc:v1:), nie Klartext', async () => {
    await saveWazuhConnection(repo, {
      api: { url: 'https://10.0.10.99:55000', user: 'u', password: 'super-geheim' },
    });
    const stored = await repo.get(WAZUH_CONNECTION_KEY);
    expect(isEncrypted(stored.api.password)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('super-geheim');
    expect(decryptSecret(stored.api.password)).toBe('super-geheim');
  });

  test('leeres Passwort im Patch behält das gespeicherte Passwort', async () => {
    await saveWazuhConnection(repo, { api: { url: 'https://10.0.10.99:55000', user: 'u', password: 'altes-pw' } });
    await saveWazuhConnection(repo, { api: { url: 'https://10.0.10.99:55000', user: 'u2', password: '' } });
    const conn = await resolveWazuhConnection(repo);
    expect(conn.api.user).toBe('u2');
    expect(conn.api.password).toBe('altes-pw');
  });

  test('leere URL löscht die Sektion → Auflösung fällt auf ENV zurück (keine Creds-Leiche in DB)', async () => {
    await saveWazuhConnection(repo, { api: { url: 'https://10.0.10.99:55000', user: 'u', password: 'pw' } });
    await saveWazuhConnection(repo, { api: { url: '', user: '', password: '' } });
    const stored = await repo.get(WAZUH_CONNECTION_KEY);
    expect(stored.api).toBeUndefined();
    const conn = await resolveWazuhConnection(repo);
    expect(conn.api.source).toBe('env');
  });

  test('Sektionen sind unabhängig: Indexer speichern lässt API unangetastet', async () => {
    await saveWazuhConnection(repo, { api: { url: 'https://10.0.10.99:55000', user: 'a', password: 'pa' } });
    await saveWazuhConnection(repo, { indexer: { url: 'https://10.0.10.98:9200', user: 'i', password: 'pi' } });
    const conn = await resolveWazuhConnection(repo);
    expect(conn.api.source).toBe('db');
    expect(conn.indexer.source).toBe('db');
    expect(conn.indexer.password).toBe('pi');
  });

  test('Sektion ohne verfügbares Passwort → Fehler WAZUH_SECTION_INCOMPLETE (verhindert kaputte DB-Config)', async () => {
    // Kein gespeichertes Passwort + leeres Patch-Passwort → die Sektion würde die
    // Verbindung brechen (DB gewinnt, aber ohne Creds). Muss sichtbar scheitern.
    await expect(saveWazuhConnection(repo, {
      api: { url: 'https://10.0.10.99:55000', user: 'u', password: '' },
    })).rejects.toMatchObject({ code: 'WAZUH_SECTION_INCOMPLETE' });
    // Nichts halb gespeichert.
    const stored = await repo.get(WAZUH_CONNECTION_KEY);
    expect(stored?.api).toBeUndefined();
  });

  test('Sektion ohne Benutzer → Fehler WAZUH_SECTION_INCOMPLETE', async () => {
    await expect(saveWazuhConnection(repo, {
      api: { url: 'https://10.0.10.99:55000', user: '', password: 'pw' },
    })).rejects.toMatchObject({ code: 'WAZUH_SECTION_INCOMPLETE' });
  });

  test('fehlende Sektion im Patch = unverändert (kein implizites Löschen)', async () => {
    await saveWazuhConnection(repo, { api: { url: 'https://10.0.10.99:55000', user: 'a', password: 'pa' } });
    await saveWazuhConnection(repo, {});
    const conn = await resolveWazuhConnection(repo);
    expect(conn.api.source).toBe('db');
  });
});

describe('maskedWazuhConnection', () => {
  test('gibt NIE Passwörter heraus — nur passwordSet-Boolean + Quelle', async () => {
    await saveWazuhConnection(repo, { api: { url: 'https://10.0.10.99:55000', user: 'u', password: 'geheim' } });
    const masked = await maskedWazuhConnection(repo);
    expect(masked.api).toEqual({ url: 'https://10.0.10.99:55000', user: 'u', passwordSet: true, source: 'db' });
    expect(masked.indexer).toEqual({ url: 'https://env-indexer:9200', user: 'env-idx-user', passwordSet: true, source: 'env' });
    expect(JSON.stringify(masked)).not.toContain('geheim');
    expect(JSON.stringify(masked)).not.toContain('env-idx-pass');
  });

  test('unkonfigurierte Sektion → passwordSet=false, source=none', async () => {
    config.wazuhApi.url = ''; config.wazuhApi.user = ''; config.wazuhApi.password = '';
    const masked = await maskedWazuhConnection(repo);
    expect(masked.api).toEqual({ url: '', user: '', passwordSet: false, source: 'none' });
  });
});
