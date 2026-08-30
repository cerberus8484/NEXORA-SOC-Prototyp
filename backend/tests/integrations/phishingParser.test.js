'use strict';

/**
 * phishingParser.test.js
 *
 * Test-Szenarien:
 *  (a) Saubere Mail — SPF/DKIM/DMARC pass → keine Auth-Indikatoren
 *  (b) Gespoofte Mail — From ≠ Return-Path, DMARC fail → Mismatch + Auth-Indikatoren
 *  (c) IDN/Punycode-Domain → punycode_domain-Indikator
 *  (d) Anhang mit ausführbarer/Doppel-Extension → executable_attachment / double_extension_attachment
 *  (e) Müll/kaputter Input → parseError = true, kein Throw
 *
 * Edge-Cases: leerer Input, fehlende Felder, URL-Shortener, defangte URLs,
 *             Display-Name-Spoofing, Hashes aus Body+Anhang, ReDoS-Schutz.
 */

const { parsePhishingEmail } = require('../../src/integrations/adapters/email/phishingParser');

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function findIndicator(indicators, type) {
  return indicators.find((i) => i.type === type);
}

function findIoc(iocs, type, valueSubstring) {
  return iocs.find(
    (i) => i.type === type && (valueSubstring ? i.value.includes(valueSubstring) : true),
  );
}

// ─── (a) Saubere Mail — SPF/DKIM/DMARC pass ─────────────────────────────────
describe('(a) Saubere Mail — SPF/DKIM/DMARC pass', () => {
  const CLEAN_MAIL = {
    from:       'alerts@nexora.example',
    replyTo:    'alerts@nexora.example',
    returnPath: '<alerts@nexora.example>',
    subject:    'System-Benachrichtigung: CPU-Auslastung 92% auf host01.nexora.example',
    body:       'Der Host 10.99.99.50 hat eine CPU-Auslastung von 92%. Bitte prüfen.',
    headers:    {
      'Authentication-Results': 'mx.nexora.example; spf=pass smtp.mailfrom=nexora.example; dkim=pass header.d=nexora.example; dmarc=pass header.from=nexora.example',
    },
    attachments: [],
  };

  let result;
  beforeAll(() => { result = parsePhishingEmail(CLEAN_MAIL); });

  test('kein parseError', () => {
    expect(result.parseError).toBe(false);
  });

  test('Sender korrekt geparst', () => {
    expect(result.sender).not.toBeNull();
    expect(result.sender.address).toBe('alerts@nexora.example');
    expect(result.sender.domain).toBe('nexora.example');
  });

  test('Return-Path korrekt', () => {
    expect(result.returnPath).not.toBeNull();
    expect(result.returnPath.domain).toBe('nexora.example');
  });

  test('Auth-Ergebnisse alle pass', () => {
    expect(result.authResults.spf).toBe('pass');
    expect(result.authResults.dkim).toBe('pass');
    expect(result.authResults.dmarc).toBe('pass');
  });

  test('Keine Auth-Fail-Indikatoren', () => {
    const authInds = result.indicators.filter((i) => i.type.startsWith('auth_'));
    expect(authInds).toHaveLength(0);
  });

  test('Keine From-ReturnPath-Mismatch', () => {
    expect(findIndicator(result.indicators, 'from_returnpath_mismatch')).toBeUndefined();
  });

  test('IP aus Body als IOC extrahiert', () => {
    const ip = findIoc(result.iocs, 'ip', '10.99.99.50');
    expect(ip).toBeDefined();
    expect(ip.value).toBe('10.99.99.50');
  });

  test('Domain aus Subject als IOC extrahiert', () => {
    const domain = findIoc(result.iocs, 'domain', 'host01.nexora.example');
    expect(domain).toBeDefined();
  });

  test('Sender als E-Mail-IOC vorhanden', () => {
    const emailIoc = result.iocs.find(
      (i) => i.type === 'email' && i.value === 'alerts@nexora.example' && i.role === 'sender',
    );
    expect(emailIoc).toBeDefined();
  });
});

// ─── (b) Gespoofte Mail — From ≠ Return-Path, DMARC fail ────────────────────
describe('(b) Gespoofte Mail — From ≠ Return-Path, DMARC fail', () => {
  const SPOOFED_MAIL = {
    from:       '"IT-Support Microsoft <support@microsoft.com>" <noreply@evil-phish.ru>',
    replyTo:    'collect@evil-phish.ru',
    returnPath: '<bounce@spam-relay.net>',
    subject:    'URGENT: Your account will be suspended! Click here immediately',
    body:       [
      'Dear user, please click: https://secure-microsof.com/login?token=abc123',
      'Or visit: https://bit.ly/3xYz456 for more info.',
      'Your case ID: 7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
    ].join('\n'),
    headers:    {
      'Authentication-Results': [
        'mx.gateway.com;',
        'spf=fail (sender SPF mismatch) smtp.mailfrom=evil-phish.ru;',
        'dkim=none;',
        'dmarc=fail header.from=microsoft.com',
      ].join(' '),
    },
    attachments: [],
  };

  let result;
  beforeAll(() => { result = parsePhishingEmail(SPOOFED_MAIL); });

  test('kein parseError', () => {
    expect(result.parseError).toBe(false);
  });

  test('Absender-Domain ist evil-phish.ru', () => {
    expect(result.sender.domain).toBe('evil-phish.ru');
  });

  test('Display-Name-Spoofing erkannt', () => {
    const ind = findIndicator(result.indicators, 'display_name_spoofing');
    expect(ind).toBeDefined();
    expect(ind.severity).toBe('high');
  });

  test('From-ReturnPath-Mismatch erkannt', () => {
    const ind = findIndicator(result.indicators, 'from_returnpath_mismatch');
    expect(ind).toBeDefined();
    expect(ind.severity).toBe('high');
    expect(ind.description).toContain('evil-phish.ru');
    expect(ind.description).toContain('spam-relay.net');
  });

  test('SPF-Fail-Indikator', () => {
    const ind = findIndicator(result.indicators, 'auth_spf_fail');
    expect(ind).toBeDefined();
    expect(ind.severity).toBe('high');
  });

  test('DMARC-Fail-Indikator', () => {
    const ind = findIndicator(result.indicators, 'auth_dmarc_fail');
    expect(ind).toBeDefined();
    expect(ind.severity).toBe('high');
  });

  test('Auth-Ergebnisse korrekt geparst', () => {
    expect(result.authResults.spf).toBe('fail');
    expect(result.authResults.dkim).toBe('none');
    expect(result.authResults.dmarc).toBe('fail');
  });

  test('URL-Shortener-Indikator für bit.ly', () => {
    const ind = findIndicator(result.indicators, 'url_shortener');
    expect(ind).toBeDefined();
    expect(ind.description).toContain('bit.ly');
  });

  test('URL als IOC extrahiert', () => {
    const url = findIoc(result.iocs, 'url', 'secure-microsof.com');
    expect(url).toBeDefined();
  });

  test('Hash aus Body als IOC extrahiert (MD5/SHA1)', () => {
    const hash = result.iocs.find((i) => i.type === 'hash');
    expect(hash).toBeDefined();
  });

  test('Reply-To als IOC vorhanden', () => {
    const emailIoc = result.iocs.find(
      (i) => i.type === 'email' && i.value === 'collect@evil-phish.ru' && i.role === 'reply_to',
    );
    expect(emailIoc).toBeDefined();
  });

  test('URLs nicht leer', () => {
    expect(result.urls.length).toBeGreaterThan(0);
  });
});

// ─── (c) IDN/Punycode-Domain ─────────────────────────────────────────────────
describe('(c) IDN/Punycode-Domain', () => {
  const IDN_MAIL = {
    from:    'support@xn--pple-43d.com',
    subject: 'Ihre Bestellung bei xn--pple-43d.com',
    body:    'Klicken Sie hier: https://xn--pple-43d.com/angebot oder besuchen Sie xn--googl-g0a.com',
    headers: {
      'Authentication-Results': 'mx.test.local; spf=pass; dkim=pass; dmarc=pass',
    },
    attachments: [],
  };

  let result;
  beforeAll(() => { result = parsePhishingEmail(IDN_MAIL); });

  test('kein parseError', () => {
    expect(result.parseError).toBe(false);
  });

  test('Punycode-Indikator für Absender-Domain', () => {
    const ind = result.indicators.filter((i) => i.type === 'punycode_domain');
    expect(ind.length).toBeGreaterThanOrEqual(1);
    // Mindestens xn--pple-43d.com muss erkannt werden
    const found = ind.some((i) => i.value && i.value.includes('xn--'));
    expect(found).toBe(true);
  });

  test('Severity ist high', () => {
    const ind = findIndicator(result.indicators, 'punycode_domain');
    expect(ind.severity).toBe('high');
  });

  test('Sender-Domain enthält xn--', () => {
    expect(result.sender.domain).toContain('xn--');
  });
});

// ─── (d) Anhang: ausführbare Extension + Doppel-Extension ───────────────────
describe('(d) Anhänge — ausführbare und Doppel-Extension', () => {
  const ATT_MAIL = {
    from:    'hr@trusted-company.com',
    subject: 'Job Application Documents',
    body:    'Please find the attached documents for review.',
    headers: {
      'Authentication-Results': 'mx.test.local; spf=pass; dkim=pass; dmarc=pass',
    },
    attachments: [
      // (i) Doppel-Extension
      { name: 'Resume_2024.pdf.exe', hash: 'a'.repeat(64), size: 512000, mimeType: 'application/octet-stream' },
      // (ii) Ausführbar (.lnk)
      { name: 'Portfolio.lnk', hash: 'b'.repeat(40), size: 2048, mimeType: 'application/x-ms-shortcut' },
      // (iii) Sicher (.pdf)
      { name: 'CoverLetter.pdf', hash: 'c'.repeat(32), size: 102400, mimeType: 'application/pdf' },
      // (iv) Ausführbar (.hta)
      { name: 'Viewer.hta', hash: null, size: 8192, mimeType: 'text/html' },
    ],
  };

  let result;
  beforeAll(() => { result = parsePhishingEmail(ATT_MAIL); });

  test('kein parseError', () => {
    expect(result.parseError).toBe(false);
  });

  test('Alle 4 Anhänge verarbeitet', () => {
    expect(result.attachments).toHaveLength(4);
  });

  test('Doppel-Extension erkannt (Resume_2024.pdf.exe)', () => {
    const att = result.attachments.find((a) => a.name === 'Resume_2024.pdf.exe');
    expect(att).toBeDefined();
    expect(att.doubleExt).toBe(true);
    expect(att.dangerous).toBe(true);

    const ind = findIndicator(result.indicators, 'double_extension_attachment');
    expect(ind).toBeDefined();
    expect(ind.severity).toBe('high');
    expect(ind.value).toBe('Resume_2024.pdf.exe');
  });

  test('LNK-Anhang als executable erkannt', () => {
    const att = result.attachments.find((a) => a.name === 'Portfolio.lnk');
    expect(att).toBeDefined();
    expect(att.dangerous).toBe(true);
    expect(att.ext).toBe('lnk');

    const inds = result.indicators.filter((i) => i.type === 'executable_attachment');
    expect(inds.length).toBeGreaterThanOrEqual(1);
  });

  test('HTA-Anhang als executable erkannt', () => {
    const att = result.attachments.find((a) => a.name === 'Viewer.hta');
    expect(att).toBeDefined();
    expect(att.dangerous).toBe(true);
  });

  test('PDF-Anhang NICHT als executable markiert', () => {
    const att = result.attachments.find((a) => a.name === 'CoverLetter.pdf');
    expect(att).toBeDefined();
    expect(att.dangerous).toBe(false);
    expect(att.doubleExt).toBe(false);
  });

  test('SHA256-Hash des exe-Anhangs als IOC vorhanden', () => {
    const hashIoc = result.iocs.find(
      (i) => i.type === 'hash' && i.source === 'attachment' && i.attachmentName === 'Resume_2024.pdf.exe',
    );
    expect(hashIoc).toBeDefined();
    expect(hashIoc.hashType).toBe('sha256');
  });

  test('SHA1-Hash des lnk-Anhangs als IOC vorhanden', () => {
    const hashIoc = result.iocs.find(
      (i) => i.type === 'hash' && i.source === 'attachment' && i.attachmentName === 'Portfolio.lnk',
    );
    expect(hashIoc).toBeDefined();
    expect(hashIoc.hashType).toBe('sha1');
  });

  test('Anhang ohne Hash (Viewer.hta) hat keinen Hash-IOC', () => {
    const hashIoc = result.iocs.find(
      (i) => i.type === 'hash' && i.attachmentName === 'Viewer.hta',
    );
    expect(hashIoc).toBeUndefined();
  });
});

// ─── (e) Müll/kaputter Input ─────────────────────────────────────────────────
describe('(e) Müll- und kaputter Input — kein Throw, parseError=true', () => {
  test('null → parseError=true', () => {
    const r = parsePhishingEmail(null);
    expect(r.parseError).toBe(true);
    expect(r.iocs).toEqual([]);
    expect(r.indicators).toEqual([]);
  });

  test('undefined → parseError=true', () => {
    const r = parsePhishingEmail(undefined);
    expect(r.parseError).toBe(true);
  });

  test('String statt Objekt → parseError=true', () => {
    const r = parsePhishingEmail('From: attacker@evil.com\r\nSubject: Test');
    expect(r.parseError).toBe(true);
  });

  test('Array statt Objekt → parseError=true', () => {
    const r = parsePhishingEmail(['from', 'body']);
    expect(r.parseError).toBe(true);
  });

  test('Zahl statt Objekt → parseError=true', () => {
    const r = parsePhishingEmail(42);
    expect(r.parseError).toBe(true);
  });

  test('Leeres Objekt {} → parseError=false, leere Strukturen', () => {
    const r = parsePhishingEmail({});
    expect(r.parseError).toBe(false);
    expect(r.sender).toBeNull();
    expect(r.iocs).toEqual([]);
    expect(r.indicators).toEqual([]);
    expect(r.urls).toEqual([]);
    expect(r.attachments).toEqual([]);
  });

  test('Objekt mit nur from → kein Crash', () => {
    const r = parsePhishingEmail({ from: 'x@y.com' });
    expect(r.parseError).toBe(false);
    expect(r.sender).not.toBeNull();
    expect(r.sender.address).toBe('x@y.com');
  });

  test('Body mit 60.000 Zeichen — kein Timeout, kein Crash (ReDoS-Schutz)', () => {
    const bigBody = 'A'.repeat(60_000);
    const start   = Date.now();
    const r = parsePhishingEmail({ from: 'a@b.com', body: bigBody, subject: 'Test' });
    const elapsed = Date.now() - start;
    expect(r.parseError).toBe(false);
    expect(elapsed).toBeLessThan(2000); // max 2 Sekunden
  }, 5000);

  test('Kaputte Auth-Results → spf/dkim/dmarc null (kein Crash)', () => {
    const r = parsePhishingEmail({
      from:    'a@b.com',
      subject: 'Test',
      headers: { 'Authentication-Results': 'nonsense garbage !!!' },
    });
    expect(r.parseError).toBe(false);
    expect(r.authResults.spf).toBeNull();
    expect(r.authResults.dkim).toBeNull();
    expect(r.authResults.dmarc).toBeNull();
  });

  test('Attachments mit null-Einträgen → kein Crash', () => {
    const r = parsePhishingEmail({
      from:        'a@b.com',
      subject:     'Test',
      attachments: [null, undefined, { name: 'legit.pdf' }, null],
    });
    expect(r.parseError).toBe(false);
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0].name).toBe('legit.pdf');
  });
});

// ─── Edge-Cases: URL-Extraktion ───────────────────────────────────────────────
describe('Edge-Cases — URL-Extraktion und Normalisierung', () => {
  test('Defangte URL hxxp:// wird refangt', () => {
    const r = parsePhishingEmail({
      from:    'a@b.com',
      subject: 'Test',
      body:    'Besuchen Sie hxxps://evil-site.xyz/payload für mehr Info.',
    });
    expect(r.parseError).toBe(false);
    const url = r.urls.find((u) => u.includes('evil-site.xyz'));
    expect(url).toBeDefined();
    expect(url.startsWith('http')).toBe(true);
    expect(url).not.toContain('hxxp');
  });

  test('Defangte URL http[://] wird vollständig refangt', () => {
    const r = parsePhishingEmail({
      from:    'a@b.com',
      subject: 'Test',
      body:    'Link: http[://]evil-site.xyz/payload jetzt klicken.',
    });
    expect(r.parseError).toBe(false);
    const url = r.urls.find((u) => u.includes('evil-site.xyz'));
    expect(url).toBeDefined();
    expect(url).toBe('http://evil-site.xyz/payload');
    expect(url).not.toContain('[');
  });

  test('Mehrere URLs dedupliziert', () => {
    const r = parsePhishingEmail({
      from:    'a@b.com',
      subject: 'Visit https://example.com/page',
      body:    'Also: https://example.com/page and https://example.com/page again.',
    });
    const exampleUrls = r.urls.filter((u) => u.includes('example.com/page'));
    expect(exampleUrls).toHaveLength(1);
  });

  test('URL-Shortener ow.ly erkannt', () => {
    const r = parsePhishingEmail({
      from:    'a@b.com',
      subject: 'Test',
      body:    'Hier klicken: https://ow.ly/abc123xyz',
    });
    const ind = findIndicator(r.indicators, 'url_shortener');
    expect(ind).toBeDefined();
    expect(ind.description).toContain('ow.ly');
  });

  test('IP-Adressen als IOC erfasst', () => {
    const r = parsePhishingEmail({
      from:    'a@b.com',
      subject: 'Malicious payload from 192.168.241.100',
      body:    'C2 server: 185.220.101.47',
    });
    const ips = r.iocs.filter((i) => i.type === 'ip');
    expect(ips.length).toBeGreaterThanOrEqual(2);
  });

  test('Hashes verschiedener Länge korrekt klassifiziert', () => {
    const md5    = 'a'.repeat(32);
    const sha1   = 'b'.repeat(40);
    const sha256 = 'c'.repeat(64);
    const sha512 = 'd'.repeat(128);

    const r = parsePhishingEmail({
      from:    'a@b.com',
      subject: 'Test',
      body:    `${md5} ${sha1} ${sha256} ${sha512}`,
    });

    const hashes = r.iocs.filter((i) => i.type === 'hash');
    const types  = hashes.map((h) => h.hashType);
    expect(types).toContain('md5');
    expect(types).toContain('sha1');
    expect(types).toContain('sha256');
    expect(types).toContain('sha512');
  });

  test('IOC-Deduplizierung — doppelte IP nicht zweifach', () => {
    const r = parsePhishingEmail({
      from:    'a@b.com',
      subject: 'From IP 10.0.0.1',
      body:    'Also from 10.0.0.1 again.',
    });
    const ips = r.iocs.filter((i) => i.type === 'ip' && i.value === '10.0.0.1');
    expect(ips).toHaveLength(1);
  });
});

// ─── Edge-Cases: Authentifizierung ───────────────────────────────────────────
describe('Edge-Cases — Authentication-Results-Parsing', () => {
  test('SPF softfail → Indikator mit severity medium', () => {
    const r = parsePhishingEmail({
      from:    'a@b.com',
      subject: 'Test',
      headers: { 'Authentication-Results': 'mx.test; spf=softfail smtp.mailfrom=b.com; dkim=pass; dmarc=pass' },
    });
    const ind = findIndicator(r.indicators, 'auth_spf_fail');
    expect(ind).toBeDefined();
    expect(ind.severity).toBe('medium');
  });

  test('DKIM fail → Indikator mit severity high', () => {
    const r = parsePhishingEmail({
      from:    'a@b.com',
      subject: 'Test',
      headers: { 'Authentication-Results': 'mx.test; spf=pass; dkim=fail; dmarc=fail' },
    });
    const dkimInd = findIndicator(r.indicators, 'auth_dkim_fail');
    expect(dkimInd).toBeDefined();
    expect(dkimInd.severity).toBe('high');
  });

  test('Lowercase-Header-Name auch erkannt', () => {
    const r = parsePhishingEmail({
      from:    'a@b.com',
      subject: 'Test',
      headers: { 'authentication-results': 'mx.test; spf=fail; dkim=fail; dmarc=fail' },
    });
    expect(r.authResults.spf).toBe('fail');
    expect(r.authResults.dkim).toBe('fail');
    expect(r.authResults.dmarc).toBe('fail');
  });
});

// ─── Output-Struktur-Validierung ──────────────────────────────────────────────
describe('Output-Struktur vollständig', () => {
  test('Alle Felder vorhanden bei normaler Mail', () => {
    const r = parsePhishingEmail({
      from:    'test@example.com',
      subject: 'Test',
      body:    'body text',
    });

    expect(r).toHaveProperty('sender');
    expect(r).toHaveProperty('replyTo');
    expect(r).toHaveProperty('returnPath');
    expect(r).toHaveProperty('authResults');
    expect(r).toHaveProperty('urls');
    expect(r).toHaveProperty('attachments');
    expect(r).toHaveProperty('indicators');
    expect(r).toHaveProperty('iocs');
    expect(r).toHaveProperty('parseError');

    expect(Array.isArray(r.urls)).toBe(true);
    expect(Array.isArray(r.attachments)).toBe(true);
    expect(Array.isArray(r.indicators)).toBe(true);
    expect(Array.isArray(r.iocs)).toBe(true);
  });

  test('authResults hat immer spf/dkim/dmarc — KEIN raw (PII-Minimierung)', () => {
    const r = parsePhishingEmail({ from: 'a@b.com', subject: 'x' });
    expect(r.authResults).toHaveProperty('spf');
    expect(r.authResults).toHaveProperty('dkim');
    expect(r.authResults).toHaveProperty('dmarc');
    // Der rohe Authentication-Results-Header wird NICHT mehr mitgeschleppt
    // (nirgends gelesen, unnötige PII-Mitnahme).
    expect(r.authResults).not.toHaveProperty('raw');
  });

  test('IOC-Objekte haben immer type und value', () => {
    const r = parsePhishingEmail({
      from:    'a@b.com',
      subject: 'IP 10.0.0.1 found',
      body:    'check https://evil.com and 185.1.2.3',
    });
    for (const ioc of r.iocs) {
      expect(ioc).toHaveProperty('type');
      expect(ioc).toHaveProperty('value');
      expect(typeof ioc.type).toBe('string');
      expect(typeof ioc.value).toBe('string');
    }
  });

  test('Indikator-Objekte haben immer type, description, severity', () => {
    const r = parsePhishingEmail({
      from:       'fake@legit.com',
      returnPath: '<bounce@evil.ru>',
      subject:    'Test',
      body:       'text',
      headers:    { 'Authentication-Results': 'mx.test; spf=fail; dkim=fail; dmarc=fail' },
    });
    for (const ind of r.indicators) {
      expect(ind).toHaveProperty('type');
      expect(ind).toHaveProperty('description');
      expect(ind).toHaveProperty('severity');
    }
  });
});
