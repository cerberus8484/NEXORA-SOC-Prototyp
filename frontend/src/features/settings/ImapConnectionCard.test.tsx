import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Deckt zugleich die geteilte connectionCardKit-Shell + useConnectionCard ab
// (Laden, Feld-Render, Verbindungstest, Ladefehler-Pfad) — via die IMAP-Karte.
vi.mock('./settingsApi', () => ({
  fetchImapConnection: vi.fn(),
  saveImapConnection: vi.fn(),
  testImapConnection: vi.fn(),
}));

import { ImapConnectionCard } from './ImapConnectionCard';
import * as api from './settingsApi';

const masked = { host: 'mail.env', port: 993, user: 'env@x', secure: true, passwordSet: true, source: 'env' as const };

beforeEach(() => {
  vi.mocked(api.fetchImapConnection).mockResolvedValue(masked);
  vi.mocked(api.testImapConnection).mockResolvedValue({ ok: true, latencyMs: 7 });
});

describe('ImapConnectionCard (via connectionCardKit)', () => {
  it('lädt und rendert Felder + ehrliches Quell-Label', async () => {
    render(<ImapConnectionCard />);
    expect(await screen.findByText('Systemwert')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('10.0.10.85')).toHaveValue('mail.env');
    expect(screen.getByDisplayValue('env@x')).toBeInTheDocument();
  });

  it('Verbindungstest ruft die API und zeigt das Ergebnis', async () => {
    const user = userEvent.setup();
    render(<ImapConnectionCard />);
    await screen.findByText('Systemwert');
    await user.click(screen.getByRole('button', { name: /Verbindung testen/i }));
    expect(await screen.findByText(/Verbindung ok/)).toBeInTheDocument();
    expect(api.testImapConnection).toHaveBeenCalledWith(expect.objectContaining({ host: 'mail.env', user: 'env@x' }));
  });

  it('Ladefehler zeigt Retry statt Karteninhalt', async () => {
    vi.mocked(api.fetchImapConnection).mockRejectedValueOnce(new Error('boom'));
    render(<ImapConnectionCard />);
    expect(await screen.findByText(/konnte nicht geladen werden/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Erneut versuchen/i })).toBeInTheDocument();
  });

  it('zeigt direkte Feldhilfe mit echten Beispielwerten', async () => {
    render(<ImapConnectionCard />);
    await screen.findByText('Systemwert');

    fireEvent.mouseEnter(screen.getByLabelText(/Host erklaeren/i));

    expect(await screen.findByText(/IMAP-Server des abzurufenden Postfachs/i)).toBeInTheDocument();
    expect(screen.getByText(/mail\.nexora\.local/i)).toBeInTheDocument();
  });
});
