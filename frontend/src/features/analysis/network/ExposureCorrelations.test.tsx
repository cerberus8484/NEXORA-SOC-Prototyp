import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExposureCorrelations } from './NetworkNatView';
import type { ExposureCorrelation, NetworkCorrelation } from '../analysisModel';

const ec = (over: Partial<ExposureCorrelation> = {}): ExposureCorrelation => ({
  sessionId: 's1', relatedFlowSessionId: 's1', remoteSourceIp: '91.92.40.10',
  firewallEventId: 'fw-1', firewallTimestamp: '2026-06-24T08:15:35.000Z', firewallDestinationIp: '203.0.113.7',
  firewallDestinationPort: 2222, firewallProtocol: 'tcp', firewallAction: 'pass',
  confidence: 'high', correlationType: 'firewall_to_honeypot', natVerified: false, provenance: 'correlated', missingReason: null, ...over,
});
const corr = (over: Partial<NetworkCorrelation> = {}): NetworkCorrelation => ({ flows: [], topConversations: [], ...over });

describe('<ExposureCorrelations>', () => {
  it('keine Einträge → Sektion wird NICHT gerendert (keine künstliche Kette)', () => {
    const { container } = render(<ExposureCorrelations network={corr()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('high-Eintrag: Remote Source + FW-Ziel/Port + NAT-Disclaimer', () => {
    const { container } = render(<ExposureCorrelations network={corr({ exposureCorrelations: [ec()] })} />);
    expect(screen.getByText('Correlated Exposure Path')).toBeInTheDocument();
    expect(screen.getByText(/Keine bestätigte NAT-Translation/)).toBeInTheDocument();
    expect(container.textContent).toContain('91.92.40.10');
    expect(container.textContent).toContain('203.0.113.7:2222');
  });

  it('none-Eintrag: ehrlicher Mehrdeutigkeits-Hinweis statt erfundenem FW-Ziel', () => {
    render(<ExposureCorrelations network={corr({ exposureCorrelations: [ec({ confidence: 'none', firewallDestinationIp: null, firewallDestinationPort: null, missingReason: 'no_unique_firewall_match' })] })} />);
    expect(screen.getByText(/nicht eindeutig/)).toBeInTheDocument();
  });
});
