import { describe, expect, test } from 'vitest';
import {
  buildServicenowPatch, servicenowConnError, servicenowSourceLabel,
  type ServicenowMasked, type ServicenowForm,
} from './servicenowConnectionModel';

const masked = (o: Partial<ServicenowMasked> = {}): ServicenowMasked =>
  ({ baseUrl: 'https://acme.service-now.com', username: 'soc', table: 'incident', passwordSet: true, source: 'db', ...o });
const form = (o: Partial<ServicenowForm> = {}): ServicenowForm =>
  ({ baseUrl: '', username: '', servicenowPassword: '', table: '', ...o });

describe('buildServicenowPatch', () => {
  test('getrimmt; leeres Passwort bleibt leer (Server behält)', () => {
    expect(buildServicenowPatch(form({ baseUrl: ' https://acme.service-now.com ', username: ' soc ', servicenowPassword: '', table: ' incident ' })))
      .toEqual({ baseUrl: 'https://acme.service-now.com', username: 'soc', servicenowPassword: '', table: 'incident' });
  });
  test('URL geleert bei DB-Quelle → Lösch-Patch', () => {
    expect(buildServicenowPatch(form(), masked({ source: 'db' }))).toEqual({ baseUrl: '', username: '', servicenowPassword: '', table: '' });
  });
  test('leeres Formular bei env-Quelle → null', () => {
    expect(buildServicenowPatch(form(), masked({ source: 'env' }))).toBeNull();
  });
  test('unveränderte DB-Werte → null (keine Änderung)', () => {
    expect(buildServicenowPatch(form({ baseUrl: 'https://acme.service-now.com', username: 'soc', table: 'incident' }), masked({ source: 'db' }))).toBeNull();
  });
});

describe('servicenowConnError', () => {
  test('leere URL → kein Fehler', () => {
    expect(servicenowConnError(form(), masked({ source: 'none' }))).toBe('');
  });
  test('nicht-https → Fehler', () => {
    expect(servicenowConnError(form({ baseUrl: 'http://x', username: 'u', servicenowPassword: 'p' }), masked({ source: 'none' }))).toMatch(/https/i);
  });
  test('neue Konfig ohne Benutzer → Benutzer erforderlich', () => {
    expect(servicenowConnError(form({ baseUrl: 'https://x.service-now.com', username: '', servicenowPassword: 'p' }), masked({ source: 'none', baseUrl: '', username: '', passwordSet: false })))
      .toMatch(/Benutzer/i);
  });
  test('neue Konfig ohne Passwort → Passwort erforderlich', () => {
    expect(servicenowConnError(form({ baseUrl: 'https://x.service-now.com', username: 'u', servicenowPassword: '' }), masked({ source: 'none', baseUrl: '', username: '', passwordSet: false })))
      .toMatch(/Passwort/i);
  });
  test('DB-verwaltet mit gespeichertem Passwort: URL/Benutzer ändern ohne Passwort ok', () => {
    expect(servicenowConnError(form({ baseUrl: 'https://neu.service-now.com', username: 'neu', servicenowPassword: '' }), masked({ source: 'db', passwordSet: true })))
      .toBe('');
  });
});

describe('servicenowSourceLabel', () => {
  test('ehrlich', () => {
    expect(servicenowSourceLabel('db')).toMatch(/UI/);
    expect(servicenowSourceLabel('env')).toMatch(/Systemwert/);
    expect(servicenowSourceLabel('none')).toMatch(/[Nn]icht/);
  });
});
