import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Rolle je Test setzbar — die Konfig ist admin-gated (UX-Spiegel des Servers).
let currentRole = 'admin';
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { role: currentRole, displayName: 'Tester' } }),
}));

// Kind-Panels stubben — hier wird NUR die Seiten-Struktur (Akkordeon + RBAC) getestet,
// nicht die (einzeln getesteten) Verbindungs-/Key-Karten. Inline-Factories wegen
// vi.mock-Hoisting.
vi.mock('../features/services/WazuhConnectionCard', () => ({ WazuhConnectionCard: () => <div>stub-WazuhConnectionCard</div> }));
vi.mock('../features/settings/ThreatIntelKeysCard', () => ({ ThreatIntelKeysCard: () => <div>stub-ThreatIntelKeysCard</div> }));
vi.mock('../features/settings/QradarConnectionCard', () => ({ QradarConnectionCard: () => <div>stub-QradarConnectionCard</div> }));
vi.mock('../features/settings/QdrantConnectionCard', () => ({ QdrantConnectionCard: () => <div>stub-QdrantConnectionCard</div> }));
vi.mock('../features/settings/CrowdsecConnectionCard', () => ({ CrowdsecConnectionCard: () => <div>stub-CrowdsecConnectionCard</div> }));
vi.mock('../features/settings/ServicenowConnectionCard', () => ({ ServicenowConnectionCard: () => <div>stub-ServicenowConnectionCard</div> }));
vi.mock('../features/settings/OtrsConnectionCard', () => ({ OtrsConnectionCard: () => <div>stub-OtrsConnectionCard</div> }));
vi.mock('../features/settings/ImapConnectionCard', () => ({ ImapConnectionCard: () => <div>stub-ImapConnectionCard</div> }));
vi.mock('../features/settings/WebhookSecretsCard', () => ({ WebhookSecretsCard: () => <div>stub-WebhookSecretsCard</div> }));
vi.mock('../features/settings/ApiWebhooksPanel', () => ({ ApiWebhooksPanel: () => <div>stub-ApiWebhooksPanel</div> }));
vi.mock('../features/settings/IntegrationsPanel', () => ({ IntegrationsPanel: () => <div>stub-IntegrationsPanel</div> }));

import { IntegrationsConfigPage } from './IntegrationsConfigPage';

beforeEach(() => { currentRole = 'admin'; });

describe('IntegrationsConfigPage — Akkordeon-Liste aller Integrationen (admin-gated)', () => {
  it('zeigt Admins eine kompakte Akkordeon-Liste inkl. Wazuh (aus Services hierher)', () => {
    render(<IntegrationsConfigPage />);
    expect(screen.getByText(/Schnellstart mit Beispielen/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/wazuh\.nexora\.local:55000/i)).toBeInTheDocument();
    expect(screen.getByText(/VirusTotal/)).toBeInTheDocument();
    // Akkordeon-Header sind sichtbar (auch eingeklappt) …
    expect(screen.getByRole('button', { name: /Wazuh-Verbindung/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /QRadar-Verbindung/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /API-Zugriff & Webhooks/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Integrations-Status/ })).toBeInTheDocument();
    // … aber die Karten-Inhalte sind eingeklappt (nicht gemountet).
    expect(screen.queryByText('stub-WazuhConnectionCard')).not.toBeInTheDocument();
    expect(screen.queryByText('stub-IntegrationsPanel')).not.toBeInTheDocument();
  });

  it('klappt eine Integration zum Konfigurieren auf', () => {
    render(<IntegrationsConfigPage />);
    fireEvent.click(screen.getByRole('button', { name: /Wazuh-Verbindung/ }));
    expect(screen.getByText('stub-WazuhConnectionCard')).toBeInTheDocument();
    // andere bleiben eingeklappt
    expect(screen.queryByText('stub-QradarConnectionCard')).not.toBeInTheDocument();
  });

  it('verbirgt die Konfig für Nicht-Admins mit ehrlichem Hinweis', () => {
    currentRole = 'analyst';
    render(<IntegrationsConfigPage />);
    expect(screen.getByText(/der Admin-Rolle vorbehalten/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Wazuh-Verbindung/ })).not.toBeInTheDocument();
  });
});
