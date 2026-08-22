import { describe, expect, test } from 'vitest';
import {
  buildOtrsPatch, otrsConnError, otrsSourceLabel,
  type OtrsMasked, type OtrsForm,
} from './otrsConnectionModel';

const masked = (o: Partial<OtrsMasked> = {}): OtrsMasked =>
  ({ baseUrl: 'https://otrs.acme.local', username: 'soc', queue: 'Security', webService: 'GenericTicketConnectorREST', operation: 'TicketCreate', passwordSet: true, source: 'db', ...o });
const form = (o: Partial<OtrsForm> = {}): OtrsForm =>
  ({ baseUrl: '', username: '', otrsPassword: '', queue: '', webService: '', operation: '', ...o });

describe('buildOtrsPatch', () => {
  test('getrimmt; leeres Passwort bleibt leer (Server behält)', () => {
    expect(buildOtrsPatch(form({ baseUrl: ' https://otrs.acme.local ', username: ' soc ', otrsPassword: '', queue: ' Security ', webService: ' WS ', operation: ' TicketCreate ' })))
      .toEqual({ baseUrl: 'https://otrs.acme.local', username: 'soc', otrsPassword: '', queue: 'Security', webService: 'WS', operation: 'TicketCreate' });
  });
  test('URL geleert bei DB-Quelle → Lösch-Patch', () => {
    expect(buildOtrsPatch(form(), masked({ source: 'db' }))).toEqual({ baseUrl: '', username: '', otrsPassword: '', queue: '', webService: '', operation: '' });
  });
  test('leeres Formular bei env-Quelle → null', () => {
    expect(buildOtrsPatch(form(), masked({ source: 'env' }))).toBeNull();
  });
  test('unveränderte DB-Werte → null (keine Änderung)', () => {
    expect(buildOtrsPatch(form({ baseUrl: 'https://otrs.acme.local', username: 'soc', queue: 'Security', webService: 'GenericTicketConnectorREST', operation: 'TicketCreate' }), masked({ source: 'db' }))).toBeNull();
  });
  test('geänderte Queue allein → Patch', () => {
    const p = buildOtrsPatch(form({ baseUrl: 'https://otrs.acme.local', username: 'soc', queue: 'SOC', webService: 'GenericTicketConnectorREST', operation: 'TicketCreate' }), masked({ source: 'db' }));
    expect(p).toMatchObject({ queue: 'SOC' });
  });
});

describe('otrsConnError', () => {
  test('leere URL → kein Fehler', () => {
    expect(otrsConnError(form(), masked({ source: 'none' }))).toBe('');
  });
  test('nicht-http(s) → Fehler', () => {
    expect(otrsConnError(form({ baseUrl: 'ftp://x', username: 'u', otrsPassword: 'p' }), masked({ source: 'none' }))).toMatch(/https?/i);
  });
  test('neue Konfig ohne Benutzer → Benutzer erforderlich', () => {
    expect(otrsConnError(form({ baseUrl: 'https://otrs.x', username: '', otrsPassword: 'p' }), masked({ source: 'none', baseUrl: '', username: '', passwordSet: false })))
      .toMatch(/Benutzer/i);
  });
  test('neue Konfig ohne Passwort → Passwort erforderlich', () => {
    expect(otrsConnError(form({ baseUrl: 'https://otrs.x', username: 'u', otrsPassword: '' }), masked({ source: 'none', baseUrl: '', username: '', passwordSet: false })))
      .toMatch(/Passwort/i);
  });
  test('DB-verwaltet mit gespeichertem Passwort: URL/Benutzer ändern ohne Passwort ok', () => {
    expect(otrsConnError(form({ baseUrl: 'https://neu.otrs', username: 'neu', otrsPassword: '' }), masked({ source: 'db', passwordSet: true })))
      .toBe('');
  });
});

describe('otrsSourceLabel', () => {
  test('ehrlich', () => {
    expect(otrsSourceLabel('db')).toMatch(/UI/);
    expect(otrsSourceLabel('env')).toMatch(/Systemwert/);
    expect(otrsSourceLabel('none')).toMatch(/[Nn]icht/);
  });
});
