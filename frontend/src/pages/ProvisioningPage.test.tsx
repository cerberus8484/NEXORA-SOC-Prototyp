import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProvisioningPage } from './ProvisioningPage';

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { role: 'admin', displayName: 'Tester' } }),
}));

vi.mock('../hooks/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn(), confirmDialog: null }),
}));

vi.mock('../features/provisioning/provisioningApi', () => ({
  NODE_ROLES: ['control_plane', 'normal_agent', 'integration_connector', 'network_sensor', 'gateway_sensor'],
  CAPABILITIES: ['heartbeat', 'inventory', 'netflow'],
  provisioningApi: {
    listNodes: vi.fn(),
    listEnrollmentProfiles: vi.fn(),
  },
}));

import { provisioningApi } from '../features/provisioning/provisioningApi';

const mListNodes = provisioningApi.listNodes as ReturnType<typeof vi.fn>;
const mListEnrollmentProfiles = provisioningApi.listEnrollmentProfiles as ReturnType<typeof vi.fn>;

describe('ProvisioningPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mListNodes.mockResolvedValue({ data: [] });
    mListEnrollmentProfiles.mockResolvedValue({ data: [] });
  });

  it('zeigt im Profil-Dialog konkrete Hilfebeispiele direkt an den Feldern', async () => {
    render(<ProvisioningPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Profil anlegen/i }));

    const trigger = screen.getByLabelText(/Name .*erklaeren/i);
    fireEvent.mouseEnter(trigger);

    expect(await screen.findByText(/Interner Name des Enrollment-Profils/i)).toBeInTheDocument();
    expect(screen.getByText(/branch-sensor-lab/i)).toBeInTheDocument();
  });
});
