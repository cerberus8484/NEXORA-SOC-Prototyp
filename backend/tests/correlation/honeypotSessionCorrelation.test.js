'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Slice 2b.2 (+ 2b.4) — Orchestrierung: aus echten Cowrie-QUELLereignissen die
// Honeypot-Sessions bauen (NICHT mehr aus session.connect/closed-Flows).
//
// Feste Regeln:
//  - Gate: data.eventid startsWith "cowrie." AND data.src_ip vorhanden AND eindeutiger agent.id.
//  - agentId/IP/Fenster/Session aus den Cowrie-Events — NIE agent.ip als Quelle.
//  - Soft-Fail: Fehler → [] (kein Throw).
// ─────────────────────────────────────────────────────────────────────────

const { buildHoneypotSessions } = require('../../src/correlation/honeypotSessionCorrelation');

// Live-artiges Event: login/command (KEIN connect/closed), agent.ip = Tunnel-IP.
const cowrieSrc = (over = {}) => ({
  agent: { id: '014', ip: '10.99.97.1', name: 'honeypot' },
  data: { eventid: 'cowrie.login.success', src_ip: '91.92.40.10', session: 's1', username: 'administrator', protocol: 'ssh', sensor: 'ubuntu', timestamp: '2026-06-24T08:15:33.000Z', ...over },
});

describe('buildHoneypotSessions (Slice 2b.4) — Gate auf echte Cowrie-Events', () => {
  test('Cowrie-Events → Fetch mit belegtem agentId/IP/Fenster/Session → Sessions', async () => {
    const fetchSessions = jest.fn(async () => ({ events: [cowrieSrc(), cowrieSrc({ eventid: 'cowrie.command.input', input: 'id', timestamp: '2026-06-24T08:15:40.000Z' })] }));
    const res = await buildHoneypotSessions({ sources: [cowrieSrc()], fetchSessions });

    expect(fetchSessions).toHaveBeenCalledTimes(1);
    expect(fetchSessions).toHaveBeenCalledWith(expect.objectContaining({
      agentId: '014', srcIp: '91.92.40.10', sessionId: 's1', firstSeen: '2026-06-24T08:15:33.000Z',
    }));
    expect(res.honeypotSessions).toHaveLength(1);
    expect(res.honeypotSessions[0].sessionId).toBe('s1');
  });

  test('agent.ip wird NIE als srcIp benutzt', async () => {
    const fetchSessions = jest.fn(async () => ({ events: [cowrieSrc()] }));
    await buildHoneypotSessions({ sources: [cowrieSrc()], fetchSessions });
    const call = fetchSessions.mock.calls[0][0];
    expect(call.srcIp).toBe('91.92.40.10');
    expect(call.srcIp).not.toBe('10.99.97.1');
  });

  test('keine Cowrie-Events → kein Fetch', async () => {
    const fetchSessions = jest.fn();
    const res = await buildHoneypotSessions({ sources: [{ data: { srcip: '1.1.1.1', dstip: '8.8.8.8' } }], fetchSessions });
    expect(fetchSessions).not.toHaveBeenCalled();
    expect(res).toMatchObject({ honeypotSessions: [], reason: 'no_cowrie_events' });
  });

  test('Cowrie-Event ohne src_ip → kein Fetch (kein belastbarer Anker)', async () => {
    const fetchSessions = jest.fn();
    const res = await buildHoneypotSessions({ sources: [{ agent: { id: '014' }, data: { eventid: 'cowrie.command.input', input: 'id', session: 's1' } }], fetchSessions });
    expect(fetchSessions).not.toHaveBeenCalled();
    expect(res.reason).toBe('no_cowrie_events');
  });

  test('kein belegter Agent → kein Fetch', async () => {
    const fetchSessions = jest.fn();
    const res = await buildHoneypotSessions({ sources: [cowrieSrc({}) , cowrieSrc({})].map((e) => ({ ...e, agent: {} })), fetchSessions });
    expect(fetchSessions).not.toHaveBeenCalled();
    expect(res.reason).toBe('no_agent');
  });

  test('mehrdeutiger Agent → kein Fetch', async () => {
    const fetchSessions = jest.fn();
    const res = await buildHoneypotSessions({ sources: [cowrieSrc(), { ...cowrieSrc(), agent: { id: '999' } }], fetchSessions });
    expect(fetchSessions).not.toHaveBeenCalled();
    expect(res.reason).toBe('no_agent');
  });

  test('Fetch-Fehler → Soft-Fail: leeres Array, kein Throw', async () => {
    const fetchSessions = jest.fn(async () => { throw new Error('indexer down'); });
    const res = await buildHoneypotSessions({ sources: [cowrieSrc()], fetchSessions });
    expect(res.honeypotSessions).toEqual([]);
  });

  test('mehrere Angreifer-IPs → Fetch je distinct IP (keine sessionId-Verengung)', async () => {
    const fetchSessions = jest.fn(async ({ srcIp }) => ({ events: [cowrieSrc({ src_ip: srcIp, session: srcIp })] }));
    const res = await buildHoneypotSessions({
      sources: [cowrieSrc({ src_ip: '1.1.1.1', session: 'a' }), cowrieSrc({ src_ip: '2.2.2.2', session: 'b' })],
      fetchSessions,
    });
    expect(fetchSessions).toHaveBeenCalledTimes(2);
    expect(fetchSessions.mock.calls.every(([q]) => q.sessionId === undefined)).toBe(true);
    expect(res.honeypotSessions).toHaveLength(2);
  });
});
