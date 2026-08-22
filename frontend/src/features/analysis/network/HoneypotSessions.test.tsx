import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HoneypotSessions } from './NetworkNatView';

// Sessions sind nach Angreifer-IP gruppiert + eingeklappt → für Detail-Asserts erst
// die Gruppe aufklappen (Klick auf die IP-Kopfzeile).
const expandFirstGroup = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /185\.220\.101\.45/ }));
};
import type { HoneypotSession, NetworkCorrelation, NetworkFlow } from '../analysisModel';

const session = (over: Partial<HoneypotSession> = {}): HoneypotSession => ({
  sessionId: 's1', sensor: 'nexora-honeypot', service: 'ssh',
  sourceIp: '185.220.101.45', sourcePort: 49152, destinationIp: '10.99.99.80', destinationPort: 2222,
  firstSeen: '2026-06-24T08:15:30.000Z', lastSeen: '2026-06-24T08:20:00.000Z', durationMs: 270500,
  loginAttempts: 2, loginSucceeded: 1, loginFailed: 1, authSuccess: true,
  usernames: ['root'], usernamesTruncated: false, passwordObserved: true, passwordAttempts: 2,
  commands: [{ timestamp: '2026-06-24T08:15:40.000Z', command: 'uname -a' }],
  commandCount: 3, commandsTruncated: true,
  downloads: [], fingerprint: {}, relatedFlowSessionId: 's1', ...over,
});
const cowrieFlow = { sourceType: 'cowrie', sessionId: 's1', sourceIp: '185.220.101.45' } as unknown as NetworkFlow;
const corr = (over: Partial<NetworkCorrelation> = {}): NetworkCorrelation => ({ flows: [], topConversations: [], ...over });

describe('<HoneypotSessions>', () => {
  it('Empty State, wenn keine Sessions', () => {
    render(<HoneypotSessions network={corr()} />);
    expect(screen.getByText(/Keine Honeypot-Sessions für diesen Ticket-Kontext gefunden\./)).toBeInTheDocument();
  });

  it('Angreifer-IP in der Gruppen-Kopfzeile; Details nach Aufklappen', async () => {
    render(<HoneypotSessions network={corr({ honeypotSessions: [session()], flows: [cowrieFlow] })} />);
    expect(screen.getByText(/185\.220\.101\.45/)).toBeInTheDocument();   // Kopfzeile (eingeklappt)
    await expandFirstGroup();
    expect(screen.getByText(/Remote Source \/ Angreifer-IP/)).toBeInTheDocument();
    expect(screen.getByText(/2 weitere Commands/)).toBeInTheDocument();
    expect(screen.getByText(/Zugehöriger Netzwerkflow vorhanden/)).toBeInTheDocument();
  });

  it('zeigt NIEMALS ein Passwort an', async () => {
    const dirty = { ...session(), password: 'SECRETXYZ' } as unknown as HoneypotSession;
    render(<HoneypotSessions network={corr({ honeypotSessions: [dirty], flows: [cowrieFlow] })} />);
    await expandFirstGroup();
    expect(screen.queryByText(/SECRETXYZ/)).toBeNull();
    expect(screen.getByText(/Passwort beobachtet/)).toBeInTheDocument();
  });

  it('ohne zugehörigen Flow → ehrlicher Hinweis statt künstlicher Verbindung', async () => {
    render(<HoneypotSessions network={corr({ honeypotSessions: [session({ relatedFlowSessionId: 's1' })], flows: [] })} />);
    await expandFirstGroup();
    expect(screen.getByText(/Kein zugehöriger Netzwerkflow im Zeitfenster\./)).toBeInTheDocument();
  });

  it('partielle Session (kein Ziel von Cowrie) → ehrlicher 5-Tuple-Hinweis', async () => {
    render(<HoneypotSessions network={corr({ honeypotSessions: [session({ destinationIp: null, destinationPort: null })], flows: [cowrieFlow] })} />);
    await expandFirstGroup();
    expect(screen.getByText(/Ziel-IP\/Port von Cowrie nicht geliefert/)).toBeInTheDocument();
  });
});
