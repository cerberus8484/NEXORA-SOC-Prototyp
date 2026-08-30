import { describe, test, expect } from 'vitest';
import {
  imapFormFromMasked, buildImapPatch, imapConnError, imapSourceLabel, isValidHost,
  type ImapMasked, type ImapForm,
} from './imapConnectionModel';

const maskedDb: ImapMasked = { host: '10.0.10.85', port: 993, user: 'soc@nexora', secure: true, passwordSet: true, source: 'db' };
const maskedEnv: ImapMasked = { host: 'mail.env', port: 993, user: 'env@x', secure: true, passwordSet: true, source: 'env' };
const maskedNone: ImapMasked = { host: '', port: 993, user: '', secure: true, passwordSet: false, source: 'none' };

const form = (over: Partial<ImapForm> = {}): ImapForm =>
  ({ host: '', port: '993', user: '', imapPassword: '', secure: true, ...over });

describe('isValidHost', () => {
  test('akzeptiert Hostnamen und IPv4, lehnt Müll ab', () => {
    expect(isValidHost('10.0.10.85')).toBe(true);
    expect(isValidHost('mail.example.com')).toBe(true);
    expect(isValidHost('mail')).toBe(true);
    expect(isValidHost('http://x')).toBe(false);
    expect(isValidHost('a b')).toBe(false);
  });
});

describe('imapFormFromMasked', () => {
  test('übernimmt Felder, Passwort bewusst leer, Port als String', () => {
    expect(imapFormFromMasked(maskedDb)).toEqual({ host: '10.0.10.85', port: '993', user: 'soc@nexora', imapPassword: '', secure: true });
  });
});

describe('buildImapPatch', () => {
  test('unverändert → null', () => {
    expect(buildImapPatch(imapFormFromMasked(maskedDb), maskedDb)).toBeNull();
  });

  test('geänderter User → Patch mit Number-Port', () => {
    const patch = buildImapPatch(form({ host: '10.0.10.85', user: 'neu@x', port: '143', secure: false }), maskedDb);
    expect(patch).toEqual({ host: '10.0.10.85', port: 143, user: 'neu@x', imapPassword: '', secure: false });
  });

  test('leerer Host bei DB-Quelle → Lösch-Patch; bei ENV/none → null', () => {
    expect(buildImapPatch(form({ host: '' }), maskedDb)).toEqual({ host: '', port: 993, user: '', imapPassword: '', secure: true });
    expect(buildImapPatch(form({ host: '' }), maskedEnv)).toBeNull();
    expect(buildImapPatch(form({ host: '' }), maskedNone)).toBeNull();
  });

  test('leerer Port fällt auf 993 zurück', () => {
    const patch = buildImapPatch(form({ host: 'mail.x', user: 'u', port: '', imapPassword: 'p' }), maskedNone);
    expect(patch?.port).toBe(993);
  });
});

describe('imapConnError', () => {
  test('ungültiger Host → Fehler', () => {
    expect(imapConnError(form({ host: 'http://x', user: 'u', imapPassword: 'p' }), maskedNone)).toMatch(/Host/);
  });

  test('Port außerhalb 1–65535 → Fehler', () => {
    expect(imapConnError(form({ host: 'mail.x', port: '70000', user: 'u', imapPassword: 'p' }), maskedNone)).toMatch(/Port/);
  });

  test('neue Sektion ohne Passwort → Fehler', () => {
    expect(imapConnError(form({ host: 'mail.x', user: 'u', imapPassword: '' }), maskedNone)).toMatch(/Passwort/);
  });

  test('DB-Quelle mit gespeichertem Passwort → leeres Passwort ok', () => {
    expect(imapConnError(form({ host: '10.0.10.85', user: 'neu@x', imapPassword: '' }), maskedDb)).toBe('');
  });

  test('keine Änderung → kein Fehler', () => {
    expect(imapConnError(imapFormFromMasked(maskedDb), maskedDb)).toBe('');
  });
});

describe('imapSourceLabel', () => {
  test('ehrliche Herkunfts-Labels', () => {
    expect(imapSourceLabel('db')).toMatch(/DB/);
    expect(imapSourceLabel('env')).toMatch(/Systemwert/);
    expect(imapSourceLabel('none')).toMatch(/Nicht/);
  });
});
