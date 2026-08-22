'use strict';

// Sicherheits-Härtung: /connection/test-Fehler werden auf feste Kategorien gemappt,
// nie roh gespiegelt (kein Info-Disclosure von IP/Port/Zertifikat/Fremd-Text).

const { classifyConnError } = require('../../src/integrations/http/connErrorClassifier');

const withStatus = (status) => Object.assign(new Error(`HTTP ${status}: x`), { status });
const withCode   = (code, message = 'boom') => Object.assign(new Error(message), { code });

describe('classifyConnError', () => {
  test('401/403/407 → Authentifizierung (per Status ODER per Message)', () => {
    for (const s of [401, 403, 407]) expect(classifyConnError(withStatus(s))).toMatch(/Authentifizierung/);
    // gewrappte/gemockte Fehler ohne .status, nur "HTTP 401" in der Message
    expect(classifyConnError(new Error('HTTP 401'))).toMatch(/Authentifizierung/);
    expect(classifyConnError(new Error('Request failed: Unauthorized'))).toMatch(/Authentifizierung/);
  });

  test('nackte Zahl (Port) wird NICHT als HTTP-Status fehlgedeutet', () => {
    // ":443" darf nicht als HTTP 443 durchgehen; ohne Code → Fallback.
    expect(classifyConnError(new Error('connect to host:443 failed'))).toMatch(/fehlgeschlagen/);
  });

  test('TLS/Zertifikat-Codes → TLS-Fehler', () => {
    for (const c of ['DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
      expect(classifyConnError(withCode(c))).toMatch(/TLS/);
    }
  });

  test('DNS → nicht auflösbar', () => {
    expect(classifyConnError(withCode('ENOTFOUND'))).toMatch(/DNS/);
    expect(classifyConnError(withCode('EAI_AGAIN'))).toMatch(/DNS/);
  });

  test('Timeout (Code oder Message)', () => {
    expect(classifyConnError(withCode('ETIMEDOUT'))).toMatch(/Zeitüberschreitung/);
    expect(classifyConnError(new Error('network timeout at: https://x'))).toMatch(/Zeitüberschreitung/);
  });

  test('Refused/Unreachable', () => {
    for (const c of ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET']) {
      expect(classifyConnError(withCode(c))).toMatch(/abgelehnt|nicht erreichbar/);
    }
  });

  test('Redirect blockiert', () => {
    expect(classifyConnError(new Error("redirect mode is set to error: https://x"))).toMatch(/Redirect/);
  });

  test('sonstiger HTTP-Status ≥400 → generisch mit Status (keine Topologie)', () => {
    expect(classifyConnError(withStatus(500))).toMatch(/HTTP 500/);
  });

  test('spiegelt NIE rohe Topologie/Fremd-Texte (IP:Port, OTRS-ErrorMessage)', () => {
    const leaky = Object.assign(new Error('connect ECONNREFUSED 10.0.10.60:443'), { code: 'ECONNREFUSED' });
    const out = classifyConnError(leaky);
    expect(out).not.toContain('10.0.10.60');
    expect(out).not.toContain('443');

    const otrs = new Error('OTRS Fehler AuthFail: geheimer interner Grund');
    const out2 = classifyConnError(otrs);
    expect(out2).not.toContain('geheimer');
    expect(out2).toMatch(/fehlgeschlagen/);
  });

  test('robust bei undefined/leerem Fehler', () => {
    expect(classifyConnError(undefined)).toMatch(/fehlgeschlagen/);
    expect(classifyConnError({})).toMatch(/fehlgeschlagen/);
  });
});
