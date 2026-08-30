import { describe, expect, test } from 'vitest';
import {
  isHttpsUrl, buildQradarPatch, qradarConnError, qradarSourceLabel,
  type QradarMasked, type QradarForm,
} from './qradarConnectionModel';

const masked = (o: Partial<QradarMasked> = {}): QradarMasked => ({ baseUrl: 'https://q', tokenSet: true, source: 'db', ...o });
const form = (o: Partial<QradarForm> = {}): QradarForm => ({ baseUrl: '', token: '', ...o });

describe('isHttpsUrl', () => {
  test('nur https', () => {
    expect(isHttpsUrl('https://10.0.10.60')).toBe(true);
    expect(isHttpsUrl('http://10.0.10.60')).toBe(false);
    expect(isHttpsUrl('')).toBe(false);
  });
});

describe('buildQradarPatch', () => {
  test('getrimmte Werte; leerer Token bleibt leer (Server behält)', () => {
    expect(buildQradarPatch(form({ baseUrl: ' https://q2 ', token: '' }))).toEqual({ baseUrl: 'https://q2', token: '' });
  });
  test('URL geleert bei DB-Quelle → Lösch-Patch', () => {
    expect(buildQradarPatch(form(), masked({ source: 'db' }))).toEqual({ baseUrl: '', token: '' });
  });
  test('leeres Formular bei env-Quelle → null (kein No-op-Write)', () => {
    expect(buildQradarPatch(form(), masked({ source: 'env' }))).toBeNull();
  });
});

describe('qradarConnError', () => {
  test('leere URL → kein Fehler', () => {
    expect(qradarConnError(form(), masked({ source: 'none' }))).toBe('');
  });
  test('nicht-https → Fehler', () => {
    expect(qradarConnError(form({ baseUrl: 'http://q', token: 't' }), masked({ source: 'none' }))).toMatch(/https/i);
  });
  test('neue Konfig ohne Token → Token erforderlich', () => {
    expect(qradarConnError(form({ baseUrl: 'https://q', token: '' }), masked({ source: 'none', tokenSet: false, baseUrl: '' }))).toMatch(/Token/);
  });
  test('DB-verwaltet mit gespeichertem Token: URL ändern ohne Token ok', () => {
    expect(qradarConnError(form({ baseUrl: 'https://q2', token: '' }), masked({ source: 'db', tokenSet: true }))).toBe('');
  });
});

describe('qradarSourceLabel', () => {
  test('ehrlich', () => {
    expect(qradarSourceLabel('db')).toMatch(/UI/);
    expect(qradarSourceLabel('env')).toMatch(/Systemwert/);
    expect(qradarSourceLabel('none')).toMatch(/[Nn]icht/);
  });
});
