import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DeployPage } from './DeployPage';

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { role: 'admin', displayName: 'Tester' } }),
}));

vi.mock('../features/deploy/deployApi', () => ({
  deployApi: {
    listModules: vi.fn(), listConnectors: vi.fn(), createConnector: vi.fn(), reauth: vi.fn(),
    createSpec: vi.fn(), plan: vi.fn(), approve: vi.fn(), apply: vi.fn(), getRun: vi.fn(),
    getConnectorCapacity: vi.fn(), listRuns: vi.fn(),
  },
}));

vi.mock('../features/deploy/ManagedNodesPanel', () => ({ ManagedNodesPanel: () => <div>Managed Nodes Stub</div> }));
vi.mock('../features/deploy/DeploySystemStatusPanel', () => ({ DeploySystemStatusPanel: () => <div>Systemstatus Stub</div> }));

import { deployApi } from '../features/deploy/deployApi';

const mListModules = deployApi.listModules as ReturnType<typeof vi.fn>;
const mListConnectors = deployApi.listConnectors as ReturnType<typeof vi.fn>;
const mGetConnectorCapacity = deployApi.getConnectorCapacity as ReturnType<typeof vi.fn>;
const mListRuns = deployApi.listRuns as ReturnType<typeof vi.fn>;

describe('DeployPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mListModules.mockResolvedValue({ data: [
      { id: 'opnsense', kind: 'vm-clone', name: 'OPNsense Firewall', available: true, resourceDefaults: {}, paramSchema: { ipMode: { values: ['static'] } } },
      { id: 'linux-client', kind: 'agent-install', name: 'Linux Client', available: true, resourceDefaults: {} },
      { id: 'windows-server', kind: 'vm-clone', name: 'Windows Server', available: true, resourceDefaults: {} },
    ] });
    mListConnectors.mockResolvedValue({ data: [] });
    mListRuns.mockResolvedValue({ data: [] });
    mGetConnectorCapacity.mockResolvedValue({ data: undefined });
  });

  it('zeigt zuerst das Deployment-Center und öffnet von dort den Assistenten', async () => {
    render(<MemoryRouter><DeployPage /></MemoryRouter>);

    expect(await screen.findByText(/Deploy-Ziele \(Connectoren\)/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Neuen Deploy starten/i }));
    expect((await screen.findAllByText(/Was möchtest du bereitstellen/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Wähle den Typ der Ressource/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Deploy-Assistent/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Weiter zu Schritt 2/i })).toBeDisabled();
  });

  it('zeigt aktuelle Deployments in der Übersicht', async () => {
    mListRuns.mockResolvedValue({ data: [{ id: 'run-12345678', status: 'planned', startedBy: 'admin@nexora.example', startedAt: '2026-08-02T12:00:00.000Z' }] });
    render(<MemoryRouter><DeployPage /></MemoryRouter>);

    expect(await screen.findByText(/Aktuelle Deployments/i)).toBeInTheDocument();
    expect(screen.getByText(/Run run-1234/i)).toBeInTheDocument();
    expect(screen.getByText(/Geplant/i)).toBeInTheDocument();
  });

  it('öffnet die Ziel-Konfiguration als eigene Seite', async () => {
    render(<MemoryRouter><DeployPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /Deploy-Ziel hinzufügen/i }));

    expect((await screen.findAllByText(/Deploy-Ziel hinzufügen/i)).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Ziel-Node/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Proxmox API-Token/i)).toBeInTheDocument();
    expect(screen.getByText(/Zum Speichern fehlt:.*Nexora-Passwort-Bestätigung/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Speichern$/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Docker Engine/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Portainer/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /VMware ESXi/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /SSH \/ Bare Metal/i }));
    expect(screen.getByRole('radio', { name: /SSH \/ Bare Metal/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByPlaceholderText(/BEGIN OPENSSH PRIVATE KEY/i)).toBeInTheDocument();
  });

  it('führt nach der Modulauswahl direkt zur Zielwahl', async () => {
    render(<MemoryRouter><DeployPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /Neuen Deploy starten/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Firewall.*OPNsense/i }));
    expect(screen.getByRole('button', { name: /Weiter zu Schritt 2/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Weiter zu Schritt 2/i }));

    expect((await screen.findAllByText(/Wohin deployen/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Noch kein Proxmox-Ziel/i)).toBeInTheDocument();
  });

  it('wählt den konkreten Proxmox-Connector vor der Konfiguration', async () => {
    mListConnectors.mockResolvedValue({ data: [
      { id: 'pve-lab', type: 'proxmox', name: 'PVE Lab', host: '10.0.10.20', targetNode: 'pve-lab' },
      { id: 'pve-prod', type: 'proxmox', name: 'PVE Produktion', host: '10.0.10.21', targetNode: 'pve-prod' },
    ] });

    render(<MemoryRouter><DeployPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Neuen Deploy starten/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Firewall.*OPNsense/i }));
    fireEvent.click(screen.getByRole('button', { name: /Weiter zu Schritt 2/i }));

    expect((await screen.findAllByText(/Wohin deployen/i)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /PVE Produktion/i }));
    expect(screen.getByRole('button', { name: /Weiter zu Schritt 3/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Weiter zu Schritt 3/i }));
    expect((await screen.findAllByText(/Maschine konfigurieren/i)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'DHCP' })).not.toBeInTheDocument();

    const inputFor = (label: RegExp) => screen.getAllByLabelText(label).find((element) => element.tagName === 'INPUT') as HTMLInputElement;
    fireEvent.change(inputFor(/^Hostname$/i), { target: { value: 'fw-lab-01' } });
    fireEvent.change(inputFor(/^Template-VMID/i), { target: { value: '9000' } });
    fireEvent.change(inputFor(/^Statische IP/i), { target: { value: '10.0.10.20' } });
    fireEvent.change(inputFor(/^Gateway$/i), { target: { value: '10.0.10.1' } });
    fireEvent.change(inputFor(/^DNS-Server/i), { target: { value: '10.0.10.10' } });
    fireEvent.click(screen.getByRole('button', { name: /Weiter zu Schritt 4/i }));

    expect((await screen.findAllByText(/Prüfen und planen/i)).length).toBeGreaterThan(0);
    expect(deployApi.createSpec).not.toHaveBeenCalled();
    expect(screen.getByText(/fw-lab-01/i)).toBeInTheDocument();
  });
});
