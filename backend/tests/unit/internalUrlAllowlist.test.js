'use strict';

// SSRF-Deny-List (geteilt): host- und URL-basiert. isBlockedSsrfHost deckt rohe
// Nicht-HTTP-Ziele ab (z.B. IMAP über TCP), isBlockedSsrfUrl die HTTP-URLs.

const dns = require('dns').promises;

const {
  isBlockedSsrfHost,
  isBlockedSsrfHostResolved,
  isBlockedSsrfUrl,
  isBlockedSsrfUrlResolved,
  createSsrfSafeLookup,
  plaintextCredentialWarning,
} = require('../../src/integrations/http/internalUrlAllowlist');

describe('isBlockedSsrfHost', () => {
  test.each([
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '169.254.169.254', '169.254.1.1',
    'localhost', 'LOCALHOST', 'metadata', 'metadata.google.internal', '::1', 'fe80::1', '::',
    '::ffff:127.0.0.1', '::ffff:169.254.169.254', '[::ffff:127.0.0.1]',
    '::ffff:7f00:1', '::ffff:a9fe:a9fe',
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

describe('DNS-SSRF-Auflösung', () => {
  afterEach(() => jest.restoreAllMocks());

  test('blockt DNS-Namen, die auf Loopback zeigen', async () => {
    jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(isBlockedSsrfHostResolved('evil.example.test')).resolves.toBe(true);
    await expect(isBlockedSsrfUrlResolved('https://evil.example.test/api')).resolves.toBe(true);
  });

  test('erlaubt DNS-Namen, die auf reguläre Ziele zeigen', async () => {
    jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);

    await expect(isBlockedSsrfHostResolved('qradar.example.test')).resolves.toBe(false);
    await expect(isBlockedSsrfUrlResolved('https://qradar.example.test/api')).resolves.toBe(false);
  });

  test('lässt RFC1918-Ziele bewusst zu, weil On-Prem-Integrationen intern laufen können', async () => {
    jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '10.0.10.190', family: 4 }]);

    await expect(isBlockedSsrfUrlResolved('https://curator.internal/api')).resolves.toBe(false);
  });
  test('blockt bei DNS-Fehler fail-closed', async () => {
    jest.spyOn(dns, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    await expect(isBlockedSsrfHostResolved('unknown.example.test')).resolves.toBe(true);
  });
});

describe('createSsrfSafeLookup', () => {
  test('bindet eine gepruefte Adresse an den Socket-Lookup', (done) => {
    const lookup = jest.fn((_host, _options, callback) => callback(null, [
      { address: '203.0.113.10', family: 4 },
    ]));

    createSsrfSafeLookup(lookup)('qradar.example.test', { family: 4 }, (error, address, family) => {
      expect(error).toBeNull();
      expect(address).toBe('203.0.113.10');
      expect(family).toBe(4);
      done();
    });
  });

  test('verweigert eine beim Connect aufgeloeste Loopback-Adresse', (done) => {
    const lookup = (_host, _options, callback) => callback(null, [
      { address: '127.0.0.1', family: 4 },
    ]);

    createSsrfSafeLookup(lookup)('rebind.example.test', {}, (error) => {
      expect(error).toMatchObject({ code: 'E_SSRF_BLOCKED' });
      done();
    });
  });

  test('DNS-Fehler bleibt fail-closed und wird weitergereicht', (done) => {
    const dnsError = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    const lookup = (_host, _options, callback) => callback(dnsError);

    createSsrfSafeLookup(lookup)('missing.example.test', {}, (error) => {
      expect(error).toBe(dnsError);
      done();
    });
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
