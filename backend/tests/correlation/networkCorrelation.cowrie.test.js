'use strict';

// Slice 2b.4 — Cowrie-Dedup: pro sessionId genau EINE (deduplizierte) Beziehung.
const { buildNetworkCorrelation } = require('../../src/correlation/networkCorrelation');

const NOW = '2026-06-24T09:00:00.000Z';
const ev = (eventid, over = {}) => ({ data: { eventid, src_ip: '91.92.40.10', session: 's1', protocol: 'ssh', timestamp: '2026-06-24T08:15:33.000Z', ...over } });

describe('buildNetworkCorrelation — Cowrie-Dedup (2b.4)', () => {
  test('mehrere Cowrie-Events derselben Session → genau EIN Flow (partial)', () => {
    const { flows } = buildNetworkCorrelation([
      ev('cowrie.login.success', { username: 'root' }),
      ev('cowrie.command.input', { input: 'id' }),
      ev('cowrie.command.input', { input: 'uname -a' }),
    ], { now: NOW });
    const cowrie = flows.filter((f) => f.sourceType === 'cowrie');
    expect(cowrie).toHaveLength(1);
    expect(cowrie[0].sessionId).toBe('s1');
    expect(cowrie[0].sourceIp).toBe('91.92.40.10');
    expect(cowrie[0].flowCompleteness).toBe('partial');
  });

  test('vollständigerer Flow (mit Ziel-IP) wird bevorzugt', () => {
    const { flows } = buildNetworkCorrelation([
      ev('cowrie.command.input', { input: 'id' }),                                           // partial
      ev('cowrie.session.connect', { src_port: '49152', dst_ip: '10.99.99.80', dst_port: '2222' }), // full
    ], { now: NOW });
    const cowrie = flows.filter((f) => f.sourceType === 'cowrie');
    expect(cowrie).toHaveLength(1);
    expect(cowrie[0].destinationIp).toBe('10.99.99.80');
    expect(cowrie[0].flowCompleteness).toBe('full');
  });

  test('zwei verschiedene Sessions → zwei Flows', () => {
    const { flows } = buildNetworkCorrelation([
      ev('cowrie.login.success', { session: 's1' }),
      ev('cowrie.login.success', { session: 's2', src_ip: '1.2.3.4' }),
    ], { now: NOW });
    expect(flows.filter((f) => f.sourceType === 'cowrie')).toHaveLength(2);
  });
});
