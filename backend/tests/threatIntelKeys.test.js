'use strict';

// threatIntelKeys — TI-Provider-Keys (VirusTotal + AbuseIPDB) aus der DB verwalten,
// ENV bleibt Fallback (DB > ENV, dokumentierte Layer-2-Konvention).
//
// Sichert:
//   - resolve: DB gewinnt (entschlüsselt), sonst ENV, sonst none,
//   - save: Keys AES-256-GCM verschlüsselt; leerer Wert = unverändert (maskiertes Feld),
//   - masked: NIE ein Key-Wert, nur keySet-Boolean + Quelle.

const { InMemorySettingsRepository } = require('../src/repositories/InMemorySettingsRepository');
const { isEncrypted, decryptSecret } = require('../src/config/secretsCrypto');
const {
  TI_PROVIDERS,
  KEY_SETTING_KEY,
  resolveTiKey,
  saveTiKeys,
  maskedTiKeys,
} = require('../src/services/threatIntelKeys');

let repo;
const ENV_BACKUP = {};

beforeEach(() => {
  repo = new InMemorySettingsRepository();
  ENV_BACKUP.vt = process.env.VIRUSTOTAL_API_KEY;
  ENV_BACKUP.abuse = process.env.ABUSEIPDB_API_KEY;
  delete process.env.VIRUSTOTAL_API_KEY;
  delete process.env.ABUSEIPDB_API_KEY;
});

afterEach(() => {
  if (ENV_BACKUP.vt === undefined) delete process.env.VIRUSTOTAL_API_KEY; else process.env.VIRUSTOTAL_API_KEY = ENV_BACKUP.vt;
  if (ENV_BACKUP.abuse === undefined) delete process.env.ABUSEIPDB_API_KEY; else process.env.ABUSEIPDB_API_KEY = ENV_BACKUP.abuse;
});

describe('TI_PROVIDERS / KEY_SETTING_KEY', () => {
  test('deckt genau virustotal + abuseipdb ab', () => {
    expect(TI_PROVIDERS.sort()).toEqual(['abuseipdb', 'virustotal']);
    expect(KEY_SETTING_KEY.virustotal).toBe('virusTotalApiKey');
    expect(KEY_SETTING_KEY.abuseipdb).toBe('abuseIpDbApiKey');
  });
});

describe('resolveTiKey', () => {
  test('DB-Key gewinnt über ENV (entschlüsselt), source=db', async () => {
    process.env.VIRUSTOTAL_API_KEY = 'env-vt';
    await saveTiKeys(repo, { virustotal: 'db-vt' });
    expect(await resolveTiKey('virustotal', repo)).toEqual({ key: 'db-vt', source: 'db' });
  });

  test('ohne DB-Key → ENV, source=env', async () => {
    process.env.ABUSEIPDB_API_KEY = 'env-abuse';
    expect(await resolveTiKey('abuseipdb', repo)).toEqual({ key: 'env-abuse', source: 'env' });
  });

  test('weder DB noch ENV → leer, source=none', async () => {
    expect(await resolveTiKey('virustotal', repo)).toEqual({ key: '', source: 'none' });
  });

  test('unbekannter Provider → wirft', async () => {
    await expect(resolveTiKey('shodan', repo)).rejects.toThrow(/unbekannt/i);
  });
});

describe('saveTiKeys', () => {
  test('Key liegt verschlüsselt in der DB (enc:v1:), nie Klartext', async () => {
    await saveTiKeys(repo, { virustotal: 'super-geheim' });
    const stored = await repo.get(KEY_SETTING_KEY.virustotal);
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain('super-geheim');
    expect(decryptSecret(stored)).toBe('super-geheim');
  });

  test('leerer Wert lässt den gespeicherten Key unverändert (maskiertes Feld überschreibt nicht)', async () => {
    await saveTiKeys(repo, { abuseipdb: 'erster-key' });
    await saveTiKeys(repo, { abuseipdb: '' });
    expect(await resolveTiKey('abuseipdb', repo)).toEqual({ key: 'erster-key', source: 'db' });
  });

  test('nicht angegebener Provider bleibt unangetastet + liefert die geänderten Provider-Namen', async () => {
    await saveTiKeys(repo, { virustotal: 'vt1' });
    const changed = await saveTiKeys(repo, { abuseipdb: 'ab1' });
    expect(changed).toEqual(['abuseipdb']);
    expect(await resolveTiKey('virustotal', repo)).toEqual({ key: 'vt1', source: 'db' });
  });

  test('unbekannter Provider im Patch wird ignoriert (kein Crash)', async () => {
    const changed = await saveTiKeys(repo, { shodan: 'x', virustotal: 'vt' });
    expect(changed).toEqual(['virustotal']);
  });
});

describe('maskedTiKeys', () => {
  test('gibt NIE Key-Werte heraus — nur keySet + Quelle', async () => {
    process.env.ABUSEIPDB_API_KEY = 'env-abuse';
    await saveTiKeys(repo, { virustotal: 'geheim' });
    const masked = await maskedTiKeys(repo);
    const vt = masked.find((m) => m.provider === 'virustotal');
    const ab = masked.find((m) => m.provider === 'abuseipdb');
    expect(vt).toEqual({ provider: 'virustotal', keySet: true, source: 'db' });
    expect(ab).toEqual({ provider: 'abuseipdb', keySet: true, source: 'env' });
    expect(JSON.stringify(masked)).not.toContain('geheim');
    expect(JSON.stringify(masked)).not.toContain('env-abuse');
  });

  test('unkonfiguriert → keySet=false, source=none', async () => {
    const masked = await maskedTiKeys(repo);
    expect(masked.every((m) => m.keySet === false && m.source === 'none')).toBe(true);
  });
});
