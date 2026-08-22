import { describe, it, expect } from 'vitest';
import { deriveHoneypotSessions, deriveExposureCorrelations, groupHoneypotSessionsByAttacker } from './honeypotSessionsModel';
import type { HoneypotSession, NetworkCorrelation, NetworkFlow, ExposureCorrelation } from '../analysisModel';

const session = (over: Partial<HoneypotSession> = {}): HoneypotSession => ({
  sessionId: 's1', sensor: 'nexora-honeypot', service: 'ssh',
  sourceIp: '185.220.101.45', sourcePort: 49152, destinationIp: '10.99.99.80', destinationPort: 2222,
  firstSeen: '2026-06-24T08:15:30.000Z', lastSeen: '2026-06-24T08:20:00.000Z', durationMs: 270500,
  loginAttempts: 2, loginSucceeded: 1, loginFailed: 1, authSuccess: true,
  usernames: ['root'], usernamesTruncated: false, passwordObserved: true, passwordAttempts: 2,
  commands: [{ timestamp: '2026-06-24T08:15:40.000Z', command: 'uname -a' }],
  commandCount: 3, commandsTruncated: true,
  downloads: [{ url: 'http://evil.example/x.sh', filename: 'var/dl/abc', hash: 'deadbeef' }],
  fingerprint: { hassh: '0e7c3f', version: 'SSH-2.0-libssh' },
  relatedFlowSessionId: 's1', ...over,
});
const flow = (over: Partial<NetworkFlow> = {}): NetworkFlow => ({ sourceType: 'cowrie', sessionId: 's1', sourceIp: '185.220.101.45', ...over } as unknown as NetworkFlow);
const corr = (over: Partial<NetworkCorrelation> = {}): NetworkCorrelation => ({ flows: [], topConversations: [], ...over });

describe('deriveHoneypotSessions', () => {
  it('mappt eine Session: Angreifer-IP, Honeypot-Ziel, Login-Status', () => {
    const [v] = deriveHoneypotSessions(corr({ honeypotSessions: [session()], flows: [flow()] }));
    expect(v.attackerIp).toBe('185.220.101.45');     // Cowrie src_ip → klar Angreifer
    expect(v.honeypotIp).toBe('10.99.99.80');
    expect(v.service).toBe('ssh');
    expect(v.port).toBe(2222);
    expect(v.authSuccess).toBe(true);
    expect(v.loginAttempts).toBe(2);
    expect(v.usernames).toEqual(['root']);
  });

  it('berechnet „weitere Commands" aus commandCount minus angezeigten', () => {
    const [v] = deriveHoneypotSessions(corr({ honeypotSessions: [session()], flows: [flow()] }));
    expect(v.commands).toHaveLength(1);
    expect(v.moreCommands).toBe(2); // commandCount 3 - 1 angezeigt
  });

  it('hasRelatedFlow true, wenn ein Cowrie-Flow dieselbe sessionId trägt', () => {
    const [withFlow] = deriveHoneypotSessions(corr({ honeypotSessions: [session()], flows: [flow({ sessionId: 's1' })] }));
    expect(withFlow.hasRelatedFlow).toBe(true);
    const [noFlow] = deriveHoneypotSessions(corr({ honeypotSessions: [session({ relatedFlowSessionId: 's1' })], flows: [flow({ sessionId: 'other' })] }));
    expect(noFlow.hasRelatedFlow).toBe(false);
  });

  it('liefert NIEMALS ein Passwort ans Frontend (Whitelist-View)', () => {
    // Selbst wenn ein Roh-Feld auftaucht: die View darf es nicht durchreichen.
    const dirty = { ...session(), password: 'SECRET', passwords: ['SECRET'] } as unknown as HoneypotSession;
    const [v] = deriveHoneypotSessions(corr({ honeypotSessions: [dirty], flows: [flow()] }));
    const blob = JSON.stringify(v);
    expect(blob).not.toContain('SECRET');
    expect(v.passwordObserved).toBe(true);
    expect(v.passwordAttempts).toBe(2);
  });

  it('fingerprint null, wenn leer; Downloads nur bei Daten', () => {
    const [v] = deriveHoneypotSessions(corr({ honeypotSessions: [session({ fingerprint: {}, downloads: [] })], flows: [] }));
    expect(v.fingerprint).toBeNull();
    expect(v.downloads).toEqual([]);
  });

  it('leerer/fehlender Block → leeres Array', () => {
    expect(deriveHoneypotSessions(corr({}))).toEqual([]);
    expect(deriveHoneypotSessions(null)).toEqual([]);
    expect(deriveHoneypotSessions(undefined)).toEqual([]);
  });
});

describe('deriveExposureCorrelations', () => {
  const ec = (over: Partial<ExposureCorrelation> = {}): ExposureCorrelation => ({
    sessionId: 's1', relatedFlowSessionId: 's1', remoteSourceIp: '91.92.40.10',
    firewallEventId: 'fw-1', firewallTimestamp: '2026-06-24T08:15:35.000Z', firewallDestinationIp: '203.0.113.7',
    firewallDestinationPort: 2222, firewallProtocol: 'tcp', firewallAction: 'pass',
    confidence: 'medium', correlationType: 'firewall_to_honeypot', natVerified: false, provenance: 'correlated', missingReason: null, ...over,
  });

  it('sortiert high → medium → none', () => {
    const out = deriveExposureCorrelations(corr({ exposureCorrelations: [ec({ confidence: 'none' }), ec({ confidence: 'high' }), ec({ confidence: 'medium' })] }));
    expect(out.map((e) => e.confidence)).toEqual(['high', 'medium', 'none']);
  });

  it('leer/fehlend → []', () => {
    expect(deriveExposureCorrelations(corr({}))).toEqual([]);
    expect(deriveExposureCorrelations(null)).toEqual([]);
  });
});

describe('groupHoneypotSessionsByAttacker', () => {
  it('gruppiert nach Angreifer-IP, aggregiert + hängt Geo/Verdict an, sortiert nach Anzahl', () => {
    const views = deriveHoneypotSessions(corr({ honeypotSessions: [
      session({ sessionId: 'a1', sourceIp: '176.65.132.22', usernames: ['vagrant'], loginSucceeded: 1, loginFailed: 0 }),
      session({ sessionId: 'a2', sourceIp: '176.65.132.22', usernames: ['gabriel'], loginSucceeded: 1, loginFailed: 0 }),
      session({ sessionId: 'b1', sourceIp: '91.92.40.10', usernames: ['root'], loginSucceeded: 0, loginFailed: 1 }),
    ] }));
    const threatIntel = [{ indicatorValue: '176.65.132.22', verdict: 'malicious', score: 100, confidence: 67, source: 'provider', country: 'NL', asnOwner: 'Offshore LC' }];
    const groups = groupHoneypotSessionsByAttacker(views, threatIntel);

    expect(groups).toHaveLength(2);
    expect(groups[0].attackerIp).toBe('176.65.132.22');      // 2 Sessions → zuerst
    expect(groups[0].sessionCount).toBe(2);
    expect(groups[0].loginSucceeded).toBe(2);
    expect(groups[0].usernames).toEqual(['vagrant', 'gabriel']);
    expect(groups[0].geo).toMatchObject({ country: 'NL', verdict: 'malicious', score: 100, asnOwner: 'Offshore LC' });
    expect(groups[1].attackerIp).toBe('91.92.40.10');
    expect(groups[1].geo).toBeNull();                         // kein Threat-Intel → null
  });

  it('leere Views → []', () => {
    expect(groupHoneypotSessionsByAttacker([])).toEqual([]);
  });
});
