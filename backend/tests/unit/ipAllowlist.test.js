'use strict';

// Unit-Tests für den reinen IPv4-CIDR-Matcher (keine Deps, kein IO).

const { ipv4ToInt, normalizeIp, matchesCidr, parseCidrList, ipInAllowlist } =
  require('../../src/middleware/ipAllowlist');

describe('ipv4ToInt', () => {
  it('wandelt gültige IPv4 in 32-Bit-Zahl', () => {
    expect(ipv4ToInt('0.0.0.0')).toBe(0);
    expect(ipv4ToInt('255.255.255.255')).toBe(4294967295);
    expect(ipv4ToInt('192.168.241.1')).toBe(3232297217);
  });

  it('gibt null bei ungültiger IP', () => {
    expect(ipv4ToInt('256.0.0.1')).toBeNull();
    expect(ipv4ToInt('1.2.3')).toBeNull();
    expect(ipv4ToInt('a.b.c.d')).toBeNull();
    expect(ipv4ToInt('1.2.3.4.5')).toBeNull();
  });
});

describe('normalizeIp', () => {
  it('entfernt IPv4-mapped-IPv6-Prefix', () => {
    expect(normalizeIp('::ffff:192.168.240.5')).toBe('192.168.240.5');
  });
  it('lässt reine IPv4 unverändert', () => {
    expect(normalizeIp('10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('matchesCidr', () => {
  it('matcht exakte IP (implizit /32)', () => {
    expect(matchesCidr('10.99.99.75', '10.99.99.75')).toBe(true);
    expect(matchesCidr('10.99.99.76', '10.99.99.75')).toBe(false);
  });

  it('matcht /24-Netz', () => {
    expect(matchesCidr('192.168.241.50', '192.168.241.0/24')).toBe(true);
    expect(matchesCidr('192.168.242.50', '192.168.241.0/24')).toBe(false);
  });

  it('matcht /8 und /16', () => {
    expect(matchesCidr('10.5.6.7', '10.0.0.0/8')).toBe(true);
    expect(matchesCidr('11.0.0.1', '10.0.0.0/8')).toBe(false);
    expect(matchesCidr('172.16.99.1', '172.16.0.0/16')).toBe(true);
  });

  it('/0 matcht alles', () => {
    expect(matchesCidr('8.8.8.8', '0.0.0.0/0')).toBe(true);
  });

  it('matcht IPv4-mapped-IPv6-Quelle', () => {
    expect(matchesCidr('::ffff:192.168.241.10', '192.168.241.0/24')).toBe(true);
  });

  it('weist ungültige CIDR/Bits ab', () => {
    expect(matchesCidr('1.2.3.4', '1.2.3.0/33')).toBe(false);
    expect(matchesCidr('1.2.3.4', 'nonsense')).toBe(false);
    expect(matchesCidr('1.2.3.4', '')).toBe(false);
  });
});

describe('parseCidrList', () => {
  it('zerlegt Komma- und Zeilen-getrennte Listen', () => {
    expect(parseCidrList('10.0.0.0/8, 192.168.241.0/24')).toEqual(['10.0.0.0/8', '192.168.241.0/24']);
    expect(parseCidrList('10.0.0.0/8\n192.168.241.0/24')).toEqual(['10.0.0.0/8', '192.168.241.0/24']);
  });
  it('filtert Leereinträge', () => {
    expect(parseCidrList('10.0.0.0/8,,  ,')).toEqual(['10.0.0.0/8']);
    expect(parseCidrList('')).toEqual([]);
  });
  it('akzeptiert bereits ein Array', () => {
    expect(parseCidrList(['10.0.0.0/8'])).toEqual(['10.0.0.0/8']);
  });
});

describe('ipInAllowlist', () => {
  it('true wenn IP in mindestens einem Eintrag liegt', () => {
    expect(ipInAllowlist('192.168.241.5', '10.0.0.0/8, 192.168.241.0/24')).toBe(true);
  });
  it('false wenn IP in keinem Eintrag liegt', () => {
    expect(ipInAllowlist('8.8.8.8', '10.0.0.0/8, 192.168.241.0/24')).toBe(false);
  });
  it('false bei leerer Liste', () => {
    expect(ipInAllowlist('8.8.8.8', '')).toBe(false);
  });
});
