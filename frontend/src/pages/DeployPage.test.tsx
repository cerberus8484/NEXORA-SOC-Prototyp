import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DeployPage } from './DeployPage';

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { role: 'admin', displayName: 'Tester' } }),
}));

vi.mock('../features/deploy/deployApi', () => ({
  deployApi: {
    listModules: vi.fn(),
    listConnectors: vi.fn(),
    createConnector: vi.fn(),
    reauth: vi.fn(),
    createSpec: vi.fn(),
    plan: vi.fn(),
    approve: vi.fn(),
    apply: vi.fn(),
    getRun: vi.fn(),
  },
}));

vi.mock('../features/deploy/ManagedNodesPanel', () => ({
  ManagedNodesPanel: () => <div>Managed Nodes Stub</div>,
}));

import { deployApi } from '../features/deploy/deployApi';

const mListModules = deployApi.listModules as ReturnType<typeof vi.fn>;
const mListConnectors = deployApi.listConnectors as ReturnType<typeof vi.fn>;

describe('DeployPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mListModules.mockResolvedValue({
      data: [
        { id: 'opnsense', kind: 'vm-clone', name: 'OPNsense Firewall', available: true, resourceDefaults: {} },
        { id: 'linux-client', kind: 'agent-install', name: 'Linux Client', available: true, resourceDefaults: {} },
        { id: 'windows-server', kind: 'vm-clone', name: 'Windows Server', available: true, resourceDefaults: {} },
      ],
    });
    mListConnectors.mockResolvedValue({ data: [] });
  });

  it('rendert Hilfe-Trigger direkt an den wichtigsten Deployment-Feldern', async () => {
    render(
      <MemoryRouter>
        <DeployPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Connector-Typ/i)).toBeInTheDocument();
    expect(screen.getByText(/Passwort-Bestätigung \(Reauth zum Anlegen\)/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByLabelText(/erklären/i).length).toBeGreaterThanOrEqual(6);
    });
  });

  it('zeigt im Tooltip ein konkretes Beispielbild in Kartenform', async () => {
    render(
      <MemoryRouter>
        <DeployPage />
      </MemoryRouter>,
    );

    const trigger = await screen.findByLabelText(/Host \(IP\/DNS\) erklären/i);
    fireEvent.mouseEnter(trigger);

    expect((await screen.findAllByText(/Adresse des Zielsystems/i)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/10\.0\.10\.20/i)).toBeInTheDocument();
    expect(screen.getByText(/srv-wazuh-01\.nexora\.local/i)).toBeInTheDocument();
  });
});
