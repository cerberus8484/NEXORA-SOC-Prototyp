'use strict';

// ADR-042 Arming-Blocker #1 — Containment-Real-Exec-Readiness. Reine Funktion, damit die
// Fehlkonfiguration beim Boot FRÜH sichtbar wird, statt erst beim Auslösen einer Isolation
// (verwirrender Runtime-E_NO_MGMT_PRESERVE). Kein Boot-Abbruch — die Runtime ist fail-closed.

const { checkContainmentReadiness, isValidIpv4Cidr, isValidPort } = require('../../src/threatHunting/containmentReadiness');

describe('checkContainmentReadiness (ADR-042 Arming-Blocker #1)', () => {
  it('nicht scharf → armed false, keine Issues (Config egal)', () => {
    expect(checkContainmentReadiness({ huntResponse: { realExecutionEnabled: false, mgmtCidr: null } }))
      .toEqual({ armed: false, issues: [] });
  });

  it('leere/fehlende Config → armed false, keine Issues', () => {
    expect(checkContainmentReadiness({})).toEqual({ armed: false, issues: [] });
    expect(checkContainmentReadiness()).toEqual({ armed: false, issues: [] });
  });

  it('scharf + gültige Mgmt-CIDR + Port → keine Issues', () => {
    const r = checkContainmentReadiness({ huntResponse: { realExecutionEnabled: true, mgmtCidr: '10.0.10.0/24', mgmtSshPort: '22' } });
    expect(r.armed).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('scharf OHNE Mgmt-CIDR → Issue (früher Hinweis auf Laufzeit-E_NO_MGMT_PRESERVE)', () => {
    const r = checkContainmentReadiness({ huntResponse: { realExecutionEnabled: true, mgmtCidr: null, mgmtSshPort: '22' } });
    expect(r.armed).toBe(true);
    expect(r.issues.some((i) => /MGMT_CIDR fehlt/.test(i))).toBe(true);
  });

  it('scharf + ungültige Mgmt-CIDR → Issue', () => {
    const r = checkContainmentReadiness({ huntResponse: { realExecutionEnabled: true, mgmtCidr: '999.1.1.0/99', mgmtSshPort: '22' } });
    expect(r.issues.some((i) => /kein gültiges IPv4/.test(i))).toBe(true);
  });

  it('scharf + gültige CIDR + ungültiger Port → Issue', () => {
    const r = checkContainmentReadiness({ huntResponse: { realExecutionEnabled: true, mgmtCidr: '10.0.10.0/24', mgmtSshPort: '99999' } });
    expect(r.issues.some((i) => /SSH_PORT/.test(i))).toBe(true);
  });

  it('isValidIpv4Cidr: Oktett-/Prefix-Grenzen', () => {
    expect(isValidIpv4Cidr('10.0.0.0/24')).toBe(true);
    expect(isValidIpv4Cidr('10.0.0.5')).toBe(true);       // ohne Prefix ok
    expect(isValidIpv4Cidr('256.0.0.0/24')).toBe(false);  // Oktett > 255
    expect(isValidIpv4Cidr('10.0.0.0/33')).toBe(false);   // Prefix > 32
    expect(isValidIpv4Cidr('nope')).toBe(false);
  });

  it('isValidPort: 1..65535', () => {
    expect(isValidPort('22')).toBe(true);
    expect(isValidPort(65535)).toBe(true);
    expect(isValidPort('0')).toBe(false);
    expect(isValidPort('70000')).toBe(false);
  });
});
