import { describe, it, expect } from 'vitest';
import { hostContext } from './hostContext';
import { EMPTY_EVIDENCE, type ParsedEvidence } from './analysisModel';
import type { Ticket } from '../../lib/types';

const ev = (over: Partial<ParsedEvidence>): ParsedEvidence => ({
  ...EMPTY_EVIDENCE,
  ...over,
  source: { ...EMPTY_EVIDENCE.source, ...over.source },
  metadata: { ...EMPTY_EVIDENCE.metadata, ...over.metadata },
});
const tk = (over: Partial<Ticket> = {}): Pick<Ticket, 'hostname' | 'srcIp' | 'user'> => ({ ...over });

describe('hostContext', () => {
  it('nimmt den Hostnamen aus ev.source.host', () => {
    const c = hostContext(tk(), ev({ source: { host: 'WIN-DC01' } }));
    expect(c.hostname).toBe('WIN-DC01');
    expect(c.hasAny).toBe(true);
  });

  it('fällt auf den Wazuh-Agent-Namen zurück, wenn kein source.host vorhanden ist', () => {
    const c = hostContext(tk(), ev({ metadata: { agentName: 'agent-007', agentId: '007' } }));
    expect(c.hostname).toBe('agent-007');
    expect(c.agentId).toBe('007');
    // agentName ist hier == hostname → nicht zusätzlich führen (redundant).
    expect(c.agentName).toBeUndefined();
  });

  it('führt agentName separat, wenn er vom Hostnamen abweicht', () => {
    const c = hostContext(tk(), ev({ source: { host: 'WIN-DC01' }, metadata: { agentName: 'wazuh-013', agentId: '013' } }));
    expect(c.hostname).toBe('WIN-DC01');
    expect(c.agentName).toBe('wazuh-013');
    expect(c.agentId).toBe('013');
  });

  it('fällt für Hostname/IP/User auf die Ticketfelder zurück', () => {
    const c = hostContext(tk({ hostname: 'srv-app', srcIp: '10.0.0.5', user: 'svc_app' }), ev({}));
    expect(c.hostname).toBe('srv-app');
    expect(c.ip).toBe('10.0.0.5');
    expect(c.user).toBe('svc_app');
    expect(c.hasAny).toBe(true);
  });

  it('bevorzugt Evidence-Werte vor Ticketfeldern', () => {
    const c = hostContext(tk({ hostname: 'alt-host', srcIp: '1.1.1.1' }), ev({ source: { host: 'ev-host', ip: '2.2.2.2' } }));
    expect(c.hostname).toBe('ev-host');
    expect(c.ip).toBe('2.2.2.2');
  });

  it('hasAny=false, wenn weder Host, Agent noch IP bekannt sind', () => {
    const c = hostContext(tk(), ev({}));
    expect(c.hasAny).toBe(false);
    expect(c.hostname).toBeUndefined();
  });

  it('ignoriert Whitespace-only-Werte', () => {
    const c = hostContext(tk({ hostname: '   ' }), ev({ source: { host: '  ' }, metadata: { agentName: '' } }));
    expect(c.hasAny).toBe(false);
  });
});
