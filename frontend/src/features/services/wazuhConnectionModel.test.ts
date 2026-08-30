import { describe, expect, test } from 'vitest';
import {
  isInternalHttpUrl,
  sectionPatch,
  sectionError,
  sourceLabel,
  type MaskedSection,
  type SectionForm,
} from './wazuhConnectionModel';

const ENV_SECTION: MaskedSection = { url: 'https://10.0.0.1:55000', user: 'env-user', passwordSet: true, source: 'env' };
const DB_SECTION: MaskedSection  = { url: 'https://10.0.10.99:55000', user: 'db-user', passwordSet: true, source: 'db' };
const NONE_SECTION: MaskedSection = { url: '', user: '', passwordSet: false, source: 'none' };

const form = (p: Partial<SectionForm> = {}): SectionForm => ({ url: '', user: '', password: '', ...p });

describe('isInternalHttpUrl', () => {
  test('erlaubt localhost + RFC-1918, blockt externe Hosts', () => {
    expect(isInternalHttpUrl('https://10.0.10.75:55000')).toBe(true);
    expect(isInternalHttpUrl('http://localhost:9200')).toBe(true);
    expect(isInternalHttpUrl('https://192.168.1.5')).toBe(true);
    expect(isInternalHttpUrl('https://evil.example.com')).toBe(false);
    expect(isInternalHttpUrl('ftp://10.0.0.1')).toBe(false);
    expect(isInternalHttpUrl('')).toBe(false);
  });
});

describe('sectionPatch', () => {
  test('unverändertes Formular (Prefill = maskierte Werte, Passwort leer) → undefined (kein No-op-Write)', () => {
    expect(sectionPatch(form({ url: ENV_SECTION.url, user: ENV_SECTION.user }), ENV_SECTION)).toBeUndefined();
  });

  test('geänderte URL/User oder eingegebenes Passwort → Patch mit getrimmten Werten', () => {
    expect(sectionPatch(form({ url: ' https://10.0.10.99:55000 ', user: ' u ', password: 'pw' }), ENV_SECTION))
      .toEqual({ url: 'https://10.0.10.99:55000', user: 'u', password: 'pw' });
  });

  test('nur Passwort neu (Rotation) → Patch enthält bestehende URL/User + neues Passwort', () => {
    expect(sectionPatch(form({ url: DB_SECTION.url, user: DB_SECTION.user, password: 'neu' }), DB_SECTION))
      .toEqual({ url: 'https://10.0.10.99:55000', user: 'db-user', password: 'neu' });
  });

  test('URL geleert bei DB-verwalteter Sektion → Lösch-Patch (zurück zu ENV)', () => {
    expect(sectionPatch(form(), DB_SECTION)).toEqual({ url: '', user: '', password: '' });
  });

  test('leeres Formular bei nicht konfigurierter Sektion → undefined', () => {
    expect(sectionPatch(form(), NONE_SECTION)).toBeUndefined();
  });
});

describe('sectionError', () => {
  test('leere URL → kein Fehler (Sektion bleibt/wird ENV)', () => {
    expect(sectionError(form(), NONE_SECTION)).toBe('');
  });

  test('externe URL → Fehlermeldung (SSRF-Schutz, spiegelt Server)', () => {
    expect(sectionError(form({ url: 'https://evil.example.com', user: 'u', password: 'p' }), NONE_SECTION))
      .toMatch(/internen Host/);
  });

  test('Neu-Konfiguration ohne Passwort → Passwort erforderlich', () => {
    expect(sectionError(form({ url: 'https://10.0.10.99:55000', user: 'u' }), NONE_SECTION))
      .toMatch(/Passwort erforderlich/);
  });

  test('DB-verwaltet mit gespeichertem Passwort: URL/User ändern OHNE Passwort ist ok (Server behält es)', () => {
    expect(sectionError(form({ url: DB_SECTION.url, user: 'neuer-user' }), DB_SECTION)).toBe('');
  });

  test('ENV-Quelle in DB überführen ohne Passwort → Passwort erforderlich (ENV-Passwort ist nicht kopierbar)', () => {
    expect(sectionError(form({ url: ENV_SECTION.url, user: 'neuer-user' }), ENV_SECTION))
      .toMatch(/Passwort erforderlich/);
  });

  test('fehlender Benutzer → Benutzer erforderlich', () => {
    expect(sectionError(form({ url: 'https://10.0.10.99:55000', password: 'p' }), NONE_SECTION))
      .toMatch(/Benutzer erforderlich/);
  });
});

describe('sourceLabel', () => {
  test('liefert ehrliche Herkunfts-Labels', () => {
    expect(sourceLabel('db')).toMatch(/UI/);
    expect(sourceLabel('env')).toMatch(/Systemwert/);
    expect(sourceLabel('none')).toMatch(/[Nn]icht konfiguriert/);
  });
});
