import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NetworkFlowsTable, NetworkGaps } from './NetworkFlowsTable';
import type { NetworkCorrelation, NetworkFlow } from '../analysisModel';

function flow(over: Partial<NetworkFlow>): NetworkFlow {
  return {
    sourceType: 'unknown', timestamp: null,
    sourceIp: null, sourcePort: null, sourceHost: null, sourceFqdn: null, sourceMac: null, sourceHostInterface: null, sourceZone: null,
    destinationIp: null, destinationPort: null, destinationHost: null, destinationFqdn: null, destinationMac: null, destinationHostInterface: null, destinationZone: null,
    protocol: null, transport: null, direction: null, action: null,
    bytesSent: null, bytesReceived: null, packetsSent: null, packetsReceived: null, durationMs: null,
    originalSourceIp: null, originalSourcePort: null, postNatSourceIp: null, postNatSourcePort: null,
    originalDestinationIp: null, originalDestinationPort: null, postNatDestinationIp: null, postNatDestinationPort: null,
    natType: null, natRule: null, firewallRule: null,
    processImage: null, processId: null, processGuid: null, user: null,
    ...over,
  };
}
const corr = (flows: NetworkFlow[], gaps: NetworkCorrelation['gaps'] = []): NetworkCorrelation =>
  ({ flows, topConversations: [], sourceSummary: { distinct: 0, top: [] }, destinationSummary: { distinct: 0, top: [] }, gaps });

describe('NetworkFlowsTable', () => {
  it('rendert einen Sysmon-Event-3-Flow (Prozess + Sysmon-Badge + Ziel)', () => {
    render(<NetworkFlowsTable network={corr([flow({
      sourceType: 'sysmon_event3', timestamp: '2026-06-15T23:34:16.686Z',
      sourceIp: '10.99.99.10', sourcePort: 52835, destinationIp: '10.99.99.72', destinationPort: 8080,
      protocol: 'tcp', processImage: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      user: 'NT AUTHORITY\\SYSTEM',
    })])} />);
    expect(screen.getByText('powershell.exe')).toBeTruthy();
    expect(screen.getByText('Sysmon E3')).toBeTruthy();
    expect(screen.getByText('10.99.99.72:8080')).toBeTruthy();
    expect(screen.getByText('TCP')).toBeTruthy();
  });

  it('rendert einen Firewall-Flow (Firewall-Badge, kein Prozess)', () => {
    render(<NetworkFlowsTable network={corr([flow({
      sourceType: 'firewall', timestamp: '2026-06-16T10:00:00.000Z',
      sourceIp: '192.168.240.109', destinationIp: '8.8.8.8', destinationPort: 53, protocol: 'udp',
      action: 'block', missingReason: { processImage: 'source_provides_none' },
    })])} />);
    expect(screen.getByText('Firewall', { selector: 'span' })).toBeTruthy(); // Source-Type-Badge (≠ Spalten-Header)
    expect(screen.getByText('8.8.8.8:53')).toBeTruthy();
    expect(screen.queryByText('powershell.exe')).toBeNull(); // kein Prozess bei Firewall
  });

  it('rendert Host-Anreicherung (MAC, Host, Host-Interface) aus CE-4', () => {
    render(<NetworkFlowsTable network={corr([flow({
      sourceType: 'sysmon_event3', sourceIp: '10.99.99.10', sourcePort: 52835,
      sourceHost: 'DC01', sourceMac: 'bc:24:11:7b:45:69', sourceHostInterface: 'Ethernet',
      destinationIp: '10.99.99.72', destinationPort: 8080, destinationHost: 'opensourcebackup',
      destinationMac: 'aa:bb:cc:dd:ee:11', destinationHostInterface: 'eth0', protocol: 'tcp',
    })])} />);
    expect(screen.getByText('DC01')).toBeTruthy();
    expect(screen.getByText('bc:24:11:7b:45:69')).toBeTruthy();
    expect(screen.getByText('Ethernet')).toBeTruthy();
    expect(screen.getByText('opensourcebackup')).toBeTruthy();
    expect(screen.getByText('aa:bb:cc:dd:ee:11')).toBeTruthy();
  });

  it('zeigt Host-Interface und Firewall-Interface getrennt an', () => {
    render(<NetworkFlowsTable network={corr([flow({
      sourceType: 'firewall', sourceIp: '192.168.241.102', sourceHost: 'CERBERUS',
      sourceMac: '9c:6b:00:76:e6:fe', sourceHostInterface: 'Ethernet 2',
      firewallInterface: 'LAN', firewallRule: '7', action: 'block',
      destinationIp: '192.168.240.1', destinationPort: 53, protocol: 'udp',
      missingReason: { destinationMac: 'not_in_inventory', destinationHost: 'not_in_inventory' },
    })])} />);
    expect(screen.getByText('Ethernet 2')).toBeTruthy(); // Host-NIC
    expect(screen.getByText('LAN')).toBeTruthy();         // Firewall-Interface — separat
    expect(screen.getByText('CERBERUS')).toBeTruthy();
    expect(screen.getByText('block')).toBeTruthy();
  });

  it('rendert FQDN getrennt unter Source und Destination', () => {
    render(<NetworkFlowsTable network={corr([flow({
      sourceType: 'sysmon_event3', sourceIp: '10.99.99.10', sourceHost: 'DC01', sourceFqdn: 'DC01.nexora.example',
      destinationIp: '10.99.99.72', destinationHost: 'osb', destinationFqdn: 'osb.nexora.example', protocol: 'tcp',
    })])} />);
    expect(screen.getByText('DC01')).toBeTruthy();              // Host
    expect(screen.getByText('DC01.nexora.example')).toBeTruthy(); // FQDN — getrennt vom Host
    expect(screen.getByText('osb.nexora.example')).toBeTruthy();
  });

  it('zeigt für fehlenden FQDN kein Fake, sondern Dash mit Missing-Reason', () => {
    render(<NetworkFlowsTable network={corr([flow({
      sourceType: 'sysmon_event3', sourceIp: '10.99.99.10', sourceHost: 'DC01', sourceFqdn: null,
      missingReason: { sourceFqdn: 'field_missing' },
    })])} />);
    expect(screen.getByText('DC01')).toBeTruthy();
    expect(screen.queryByText('DC01.nexora.example')).toBeNull();        // kein Fake-FQDN
    expect(screen.getAllByTitle('im Event nicht enthalten').length).toBeGreaterThan(0); // field_missing
  });

  it('zeigt für fehlende MAC kein Fake-Wert, sondern Dash mit Missing-Reason', () => {
    render(<NetworkFlowsTable network={corr([flow({
      sourceType: 'firewall', sourceIp: '8.8.8.8',
      missingReason: { sourceMac: 'not_in_inventory' },
    })])} />);
    const dashes = screen.getAllByTitle('IP keinem Wazuh-Agent zugeordnet');
    expect(dashes.length).toBeGreaterThan(0); // not_in_inventory → kein Fake-Wert, Dash mit Reason
  });

  it('zeigt Empty-State, wenn keine Flows vorhanden sind', () => {
    render(<NetworkFlowsTable network={corr([])} />);
    expect(screen.getByText(/Keine korrelierten Netzwerk-Flows/)).toBeTruthy();
  });

  it('NetworkGaps zeigt Feld + Missing-Reason als dezenten Hinweis', () => {
    render(<NetworkGaps gaps={[{ field: 'processImage', missingReason: 'source_provides_none', count: 1 }]} />);
    expect(screen.getByText(/processImage: Quelle liefert dieses Feld nicht/)).toBeTruthy();
  });
});
