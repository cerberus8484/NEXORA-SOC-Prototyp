import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u-1', role: 'admin', email: 'admin@nexora.local' } }),
}));

vi.mock('../lib/apiClient', () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock('../features/system/systemApi', () => ({
  systemApi: {
    stats: vi.fn(),
  },
}));

vi.mock('../features/settings/settingsApi', () => ({
  getPlatform: vi.fn(),
  savePlatform: vi.fn(),
}));

vi.mock('../features/users/UsersPanel', () => ({ UsersPanel: () => <div>UsersPanel Stub</div> }));
vi.mock('../features/settings/OidcSettingsCard', () => ({ OidcSettingsCard: () => <div>Oidc Stub</div> }));
vi.mock('../features/settings/SecurityPosture', () => ({ SecurityPostureCards: () => <div>SecurityPosture Stub</div> }));
vi.mock('../features/settings/SecurityScoreCard', () => ({ SecurityScoreCard: () => <div>SecurityScore Stub</div> }));
vi.mock('../features/settings/SecurityEventsFeed', () => ({ SecurityEventsFeed: () => <div>SecurityEvents Stub</div> }));
vi.mock('../features/mfa/MfaSecurityCard', () => ({ MfaSecurityCard: () => <div>Mfa Stub</div> }));
vi.mock('../features/notifications/NotificationsPanel', () => ({ NotificationsPanel: () => <div>Notifications Stub</div> }));
vi.mock('../features/settings/StorageRetentionPanel', () => ({ StorageRetentionPanel: () => <div>Retention Stub</div> }));
vi.mock('../features/settings/BrandingPanel', () => ({ BrandingPanel: () => <div>Branding Stub</div> }));
vi.mock('../hooks/useAutoResetFlag', () => ({ useAutoResetFlag: () => [false, vi.fn()] }));
vi.mock('../features/auth/authApi', () => ({ authApi: { changePassword: vi.fn() } }));

import { api } from '../lib/apiClient';
import { systemApi } from '../features/system/systemApi';
import { getPlatform, savePlatform } from '../features/settings/settingsApi';

const mApiGet = api.get as ReturnType<typeof vi.fn>;
const mStats = systemApi.stats as ReturnType<typeof vi.fn>;
const mGetPlatform = getPlatform as ReturnType<typeof vi.fn>;
const mSavePlatform = savePlatform as ReturnType<typeof vi.fn>;

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mApiGet.mockResolvedValue({ status: 'ok', service: 'api', version: '1.0.0', env: 'test', uptime: 7200, db: 'ok' });
    mStats.mockResolvedValue({ data: { counts: { users: 5, tickets: 8, evidence: 12 }, storage: { dbBytes: 1024 } } });
    mGetPlatform.mockResolvedValue({
      platformName: 'Nexora SOC Platform',
      defaultView: 'dashboard',
      timezone: 'Europe/Berlin',
      language: 'de',
      maintenanceMode: false,
      betaFeatures: false,
      passwordMinLength: 8,
      passwordComplexity: 'medium',
      sessionMaxHours: 8,
      lockoutMaxAttempts: 5,
      lockoutMinutes: 15,
      passwordHistoryCount: 5,
      passwordExpiryDays: 90,
      maxConcurrentSessions: 2,
      inactivityTimeoutMinutes: 30,
      tlsEnforce: true,
      ipAllowlistEnabled: false,
      ipAllowlistCidrs: '',
      mfaRequired: false,
      accentColor: '#3b82f6',
    });
    mSavePlatform.mockResolvedValue({});
  });

  it('zeigt auf den Einstellungen direkte Feldhilfe mit Beispielwerten', async () => {
    render(<SettingsPage />);

    expect(await screen.findByText(/Plattform-Informationen/i)).toBeInTheDocument();

    const trigger = screen.getByLabelText(/Plattformname erklaeren/i);
    fireEvent.mouseEnter(trigger);

    expect(await screen.findByText(/Name der sichtbaren Nexora-Instanz/i)).toBeInTheDocument();
    expect(screen.getByText(/Nexora SOC Frankfurt/i)).toBeInTheDocument();
  });
});
