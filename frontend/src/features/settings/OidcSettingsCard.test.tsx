import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./oidcAdminApi', () => ({
  getOidcConfig: vi.fn(),
  saveOidcConfig: vi.fn(),
  testOidcConnection: vi.fn(),
}));

import { OidcSettingsCard } from './OidcSettingsCard';
import * as api from './oidcAdminApi';

const cfg = {
  enabled: false, issuer: 'https://idp.example/realms/soc', clientId: 'soc-app',
  clientSecretSet: true, redirectUri: 'https://nexora/api/v1/auth/oidc/callback',
  scope: 'openid profile email', defaultRole: 'viewer' as const, allowSignup: false, configured: true,
};

beforeEach(() => {
  vi.mocked(api.getOidcConfig).mockResolvedValue({ ...cfg });
  vi.mocked(api.saveOidcConfig).mockResolvedValue({ ...cfg });
});

describe('OidcSettingsCard — Step-up-Reauth beim Speichern', () => {
  it('„OIDC speichern" öffnet den Passwort-Dialog statt direkt zu speichern', async () => {
    const user = userEvent.setup();
    render(<OidcSettingsCard isAdmin />);
    await user.click(await screen.findByRole('button', { name: 'OIDC speichern' }));
    expect(await screen.findByText('OIDC-Konfiguration ändern')).toBeInTheDocument();
    expect(api.saveOidcConfig).not.toHaveBeenCalled(); // erst nach Passwortbestätigung
  });

  it('Passwortbestätigung ruft saveOidcConfig mit (patch, password)', async () => {
    const user = userEvent.setup();
    render(<OidcSettingsCard isAdmin />);
    await user.click(await screen.findByRole('button', { name: 'OIDC speichern' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(/passwort/i), 'Test1234!');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(api.saveOidcConfig).toHaveBeenCalledWith(
      expect.objectContaining({ issuer: 'https://idp.example/realms/soc', clientId: 'soc-app' }),
      'Test1234!',
    );
  });

  it('ohne Admin-Rechte kein Speichern-Button', async () => {
    render(<OidcSettingsCard isAdmin={false} />);
    await screen.findByDisplayValue('https://idp.example/realms/soc'); // Karte geladen
    expect(screen.queryByRole('button', { name: 'OIDC speichern' })).not.toBeInTheDocument();
  });
});
