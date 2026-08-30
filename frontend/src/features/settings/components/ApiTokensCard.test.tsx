import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ApiTokensCard } from './ApiTokensCard';
import type { ApiTokenItem } from '../api/apiTokensApi';

// ── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../api/apiTokensApi', () => ({
  listTokens:  vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
  TOKEN_DISPLAY_PREFIX_LEN: 12,
}));

import { listTokens, createToken, revokeToken } from '../api/apiTokensApi';

const mockListTokens  = listTokens  as ReturnType<typeof vi.fn>;
const mockCreateToken = createToken as ReturnType<typeof vi.fn>;
const mockRevokeToken = revokeToken as ReturnType<typeof vi.fn>;

const mockToken: ApiTokenItem = {
  id:         'tok-1',
  userId:     'u-1',
  name:       'Mein Skript',
  prefix:     'soc_a3f9b2c...',
  createdAt:  '2026-06-15T10:00:00.000Z',
  expiresAt:  null,
  lastUsedAt: null,
  revoked:    false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListTokens.mockResolvedValue([]);
  mockCreateToken.mockResolvedValue({ token: 'soc_' + 'x'.repeat(64), apiToken: mockToken });
  mockRevokeToken.mockResolvedValue(undefined);
});

// ── Wenn tokensEnabled=false → PlannedCard ──────────────────────────────────

describe('ApiTokensCard — tokensEnabled=false', () => {
  it('zeigt Geplant-Hinweis wenn nicht aktiviert', () => {
    render(<ApiTokensCard tokensEnabled={false} />);
    expect(screen.getByText(/geplant/i)).toBeInTheDocument();
  });

  it('ruft listTokens nicht auf wenn disabled', () => {
    render(<ApiTokensCard tokensEnabled={false} />);
    expect(mockListTokens).not.toHaveBeenCalled();
  });

  it('zeigt keinen "Neues Token"-Button wenn disabled', () => {
    render(<ApiTokensCard tokensEnabled={false} />);
    expect(screen.queryByRole('button', { name: /neues token/i })).not.toBeInTheDocument();
  });
});

// ── Wenn tokensEnabled=true ─────────────────────────────────────────────────

describe('ApiTokensCard — tokensEnabled=true', () => {
  it('lädt Token-Liste beim Mount', async () => {
    render(<ApiTokensCard tokensEnabled={true} />);
    await waitFor(() => expect(mockListTokens).toHaveBeenCalledOnce());
  });

  it('zeigt leere Nachricht wenn keine Tokens', async () => {
    mockListTokens.mockResolvedValue([]);
    render(<ApiTokensCard tokensEnabled={true} />);
    await waitFor(() => expect(screen.getByText(/keine tokens/i)).toBeInTheDocument());
  });

  it('zeigt Token-Name und Prefix in der Liste', async () => {
    mockListTokens.mockResolvedValue([mockToken]);
    render(<ApiTokensCard tokensEnabled={true} />);
    await waitFor(() => {
      expect(screen.getByText('Mein Skript')).toBeInTheDocument();
      expect(screen.getByText('soc_a3f9b2c...')).toBeInTheDocument();
    });
  });

  it('zeigt "Neues Token erstellen"-Button', async () => {
    render(<ApiTokensCard tokensEnabled={true} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /neues token/i })).toBeInTheDocument()
    );
  });

  it('zeigt Widerrufen-Button für jeden Token', async () => {
    mockListTokens.mockResolvedValue([mockToken]);
    render(<ApiTokensCard tokensEnabled={true} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /widerruf/i })).toBeInTheDocument()
    );
  });
});

// ── Token-Erstellung ────────────────────────────────────────────────────────

describe('ApiTokensCard — Token erstellen', () => {
  it('öffnet Modal beim Klick auf "Neues Token"', async () => {
    render(<ApiTokensCard tokensEnabled={true} />);
    await waitFor(() => screen.getByRole('button', { name: /neues token/i }));
    fireEvent.click(screen.getByRole('button', { name: /neues token/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('zeigt Token EINMALIG im Modal nach Erstellung', async () => {
    const plainToken = 'soc_' + 'a'.repeat(64);
    mockCreateToken.mockResolvedValue({ token: plainToken, apiToken: mockToken });

    render(<ApiTokensCard tokensEnabled={true} />);
    await waitFor(() => screen.getByRole('button', { name: /neues token/i }));
    fireEvent.click(screen.getByRole('button', { name: /neues token/i }));

    // Name eingeben
    const nameInput = screen.getByPlaceholderText(/name/i);
    fireEvent.change(nameInput, { target: { value: 'Skript' } });

    // Erstellen
    fireEvent.click(screen.getByRole('button', { name: /token erzeugen|create token/i }));

    await waitFor(() =>
      expect(screen.getByText(plainToken)).toBeInTheDocument()
    );
  });
});

// ── Token-Widerruf ──────────────────────────────────────────────────────────

describe('ApiTokensCard — Token widerrufen', () => {
  it('ruft revokeToken mit korrekter id auf', async () => {
    mockListTokens.mockResolvedValue([mockToken]);
    render(<ApiTokensCard tokensEnabled={true} />);

    await waitFor(() => screen.getByRole('button', { name: /widerruf/i }));
    fireEvent.click(screen.getByRole('button', { name: /widerruf/i }));

    await waitFor(() =>
      expect(mockRevokeToken).toHaveBeenCalledWith('tok-1')
    );
  });

  it('aktualisiert die Liste nach Widerruf', async () => {
    mockListTokens.mockResolvedValueOnce([mockToken]).mockResolvedValueOnce([]);
    render(<ApiTokensCard tokensEnabled={true} />);

    await waitFor(() => screen.getByRole('button', { name: /widerruf/i }));
    fireEvent.click(screen.getByRole('button', { name: /widerruf/i }));

    await waitFor(() =>
      expect(screen.getByText(/keine tokens/i)).toBeInTheDocument()
    );
  });
});
