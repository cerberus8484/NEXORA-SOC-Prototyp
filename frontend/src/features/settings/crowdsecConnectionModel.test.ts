import { describe, expect, test } from 'vitest';
import {
  buildCrowdsecPatch, crowdsecConnError, crowdsecSourceLabel,
  type CrowdsecMasked, type CrowdsecForm,
} from './crowdsecConnectionModel';

const masked = (o: Partial<CrowdsecMasked> = {}): CrowdsecMasked =>
  ({ baseUrl: 'https://10.0.10.91:8080', machineId: 'nexora', passwordSet: true, tlsInsecure: false, source: 'db', ...o });
const form = (o: Partial<CrowdsecForm> = {}): CrowdsecForm =>
  ({ baseUrl: '', machineId: '', lapiPassword: '', tlsInsecure: false, ...o });

describe('buildCrowdsecPatch', () => {
  test('getrimmt; leeres Passwort bleibt leer (Server behält)', () => {
    expect(buildCrowdsecPatch(form({ baseUrl: ' https://10.0.10.91:8080 ', machineId: ' m ', lapiPassword: '' })))
      .toEqual({ baseUrl: 'https://10.0.10.91:8080', machineId: 'm', lapiPassword: '', tlsInsecure: false });
  });
  test('URL geleert bei DB-Quelle → Lösch-Patch', () => {
    expect(buildCrowdsecPatch(form(), masked({ source: 'db' }))).toEqual({ baseUrl: '', machineId: '', lapiPassword: '', tlsInsecure: false });
  });
  test('leeres Formular bei env-Quelle → null', () => {
    expect(buildCrowdsecPatch(form(), masked({ source: 'env' }))).toBeNull();
  });
});

describe('crowdsecConnError', () => {
  test('leere URL → kein Fehler', () => {
    expect(crowdsecConnError(form(), masked({ source: 'none' }))).toBe('');
  });
  test('nicht-http(s) → Fehler', () => {
    expect(crowdsecConnError(form({ baseUrl: 'ftp://x', machineId: 'm', lapiPassword: 'p' }), masked({ source: 'none' }))).toMatch(/https?/i);
  });
  test('neue Konfig ohne MachineID → MachineID erforderlich', () => {
    expect(crowdsecConnError(form({ baseUrl: 'https://x:8080', machineId: '', lapiPassword: 'p' }), masked({ source: 'none', baseUrl: '', machineId: '', passwordSet: false })))
      .toMatch(/Machine/i);
  });
  test('neue Konfig ohne Passwort → Passwort erforderlich', () => {
    expect(crowdsecConnError(form({ baseUrl: 'https://x:8080', machineId: 'm', lapiPassword: '' }), masked({ source: 'none', baseUrl: '', machineId: '', passwordSet: false })))
      .toMatch(/Passwort/i);
  });
  test('DB-verwaltet mit gespeichertem Passwort: URL/Machine ändern ohne Passwort ok', () => {
    expect(crowdsecConnError(form({ baseUrl: 'https://x:8080', machineId: 'neu', lapiPassword: '' }), masked({ source: 'db', passwordSet: true })))
      .toBe('');
  });
});

describe('crowdsecSourceLabel', () => {
  test('ehrlich', () => {
    expect(crowdsecSourceLabel('db')).toMatch(/UI/);
    expect(crowdsecSourceLabel('env')).toMatch(/Systemwert/);
    expect(crowdsecSourceLabel('none')).toMatch(/[Nn]icht/);
  });
});
