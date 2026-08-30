'use strict';

// SSRF-Deny-List (geteilt): host- und URL-basiert. isBlockedSsrfHost deckt rohe
// Nicht-HTTP-Ziele ab (z.B. IMAP über TCP), isBlockedSsrfUrl die HTTP-URLs.

const { isBlockedSsrfHost, isBlockedSsrfUrl, plaintextCredentialWarning } = require('../../src/integrations/http/internalUrlAllowlist');

describe('isBlockedSsrfHost', () => {
  test.each([
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '169.254.169.254', '169.254.1.1',
    'localhost', 'LOCALHOST', 'metadata', 'metadata.google.internal', '::1', 'fe80::1',
  ])('blockt Sonderbereich %s', (host) => {
    expect(isBlockedSsrfHost(host)).toBe(true);
  });

  test.each(['10.0.10.85', '192.168.1.10', 'mail.example.com', '8.8.8.8', ''])(
    'erlaubt regulären Host %s', (host) => {
      expect(isBlockedSsrfHost(host)).toBe(false);
    },
  );

  test('nicht-string → false (kein Crash)', () => {
    expect(isBlockedSsrfHost(null)).toBe(false);
    expect(isBlockedSsrfHost(undefined)).toBe(false);
  });
});

describe('isBlockedSsrfUrl (weiter über isBlockedSsrfHost)', () => {
  test('blockt Loopback-/Metadaten-URLs, erlaubt internen Host', () => {
    expect(isBlockedSsrfUrl('http://127.0.0.1:9200')).toBe(true);
    expect(isBlockedSsrfUrl('https://169.254.169.254/latest/meta-data')).toBe(true);
    expect(isBlockedSsrfUrl('https://10.0.10.85:8080')).toBe(false);
  });
  test('unparsebare URL → blocken', () => {
    expect(isBlockedSsrfUrl('nicht-eine-url')).toBe(true);
  });
});

describe('plaintextCredentialWarning', () => {
  test('http:// zu externem Ziel → Warntext (Klartext-Creds)', () => {
    expect(plaintextCredentialWarning('http://otrs.example.com')).toMatch(/Klartext/);
    expect(plaintextCredentialWarning('http://8.8.8.8:8080/otrs')).toMatch(/Klartext/);
  });

  test.each([
    'http://localhost:8080', 'http://127.0.0.1', 'http://10.0.10.85:55000',
    'http://192.168.1.10', 'http://172.16.0.5',
  ])('http:// zu internem Ziel %s → null (intern akzeptabel)', (url) => {
    expect(plaintextCredentialWarning(url)).toBeNull();
  });

  test.each([
    'https://otrs.example.com', 'https://10.0.10.85:55000', 'https://8.8.8.8',
  ])('https %s → null (verschlüsselt)', (url) => {
    expect(plaintextCredentialWarning(url)).toBeNull();
  });

  test('leer / nicht-string → null (kein Crash)', () => {
    expect(plaintextCredentialWarning('')).toBeNull();
    expect(plaintextCredentialWarning(null)).toBeNull();
    expect(plaintextCredentialWarning(undefined)).toBeNull();
  });
});
