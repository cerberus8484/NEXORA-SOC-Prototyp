import { describe, it, expect } from 'vitest';
import { parseTopologyConfig, DEFAULT_TOPOLOGY } from './topologyConfig';

const validZone = {
  key: 'vlanX', label: 'VLAN X', color: 'var(--accent)', subnet: '10.0.0.0/24',
  agents: ['agent-a'],
  hosts: [{ label: 'Host A', ip: '10.0.0.10', agent: 'agent-a', note: 'prod' }],
};
const validLink = { label: 'Panel', url: 'https://panel.example.local', desc: 'admin' };

describe('parseTopologyConfig', () => {
  it('akzeptiert eine wohlgeformte Konfiguration', () => {
    const cfg = parseTopologyConfig({ zones: [validZone], quickLinks: [validLink] });
    expect(cfg).not.toBeNull();
    expect(cfg!.zones[0].key).toBe('vlanX');
    expect(cfg!.quickLinks[0].url).toBe('https://panel.example.local');
  });

  it('nutzt Default-Listen, wenn ein Feld fehlt', () => {
    const cfg = parseTopologyConfig({ zones: [validZone] });
    expect(cfg!.quickLinks).toBe(DEFAULT_TOPOLOGY.quickLinks);
  });

  it('gibt null für Nicht-Objekte zurück', () => {
    expect(parseTopologyConfig(null)).toBeNull();
    expect(parseTopologyConfig('nope')).toBeNull();
    expect(parseTopologyConfig(42)).toBeNull();
  });

  it('lehnt eine Zone mit fehlendem Pflichtfeld ab', () => {
    const bad = { ...validZone, subnet: undefined };
    expect(parseTopologyConfig({ zones: [bad] })).toBeNull();
  });

  it('lehnt einen Host ohne label/ip ab', () => {
    const bad = { ...validZone, hosts: [{ agent: 'x' }] };
    expect(parseTopologyConfig({ zones: [bad] })).toBeNull();
  });

  it('lehnt einen Quick-Link mit unsicherem Schema ab (kein javascript:)', () => {
    const bad = { label: 'x', url: 'javascript' + ':alert(1)', desc: 'd' };
    expect(parseTopologyConfig({ quickLinks: [bad] })).toBeNull();
  });

  it('lehnt einen Quick-Link mit ungültiger URL ab', () => {
    const bad = { label: 'x', url: 'not-a-url', desc: 'd' };
    expect(parseTopologyConfig({ quickLinks: [bad] })).toBeNull();
  });

  it('übernimmt optionale Felder (isolated, note) korrekt', () => {
    const iso = { ...validZone, isolated: true };
    const cfg = parseTopologyConfig({ zones: [iso] });
    expect(cfg!.zones[0].isolated).toBe(true);
    expect(cfg!.zones[0].hosts[0].note).toBe('prod');
  });
});
