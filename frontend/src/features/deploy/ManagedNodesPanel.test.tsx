import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Beide API-Objekte mocken — der Panel ist ein Container (Datenladen + Reauth + Aktionen).
vi.mock('./deployApi', () => ({
  deployApi: {
    getKeypair: vi.fn(),
    generateKeypair: vi.fn(),
    updateNode: vi.fn(),
    captureHostKey: vi.fn(),
    reauth: vi.fn(),
  },
}));
vi.mock('../provisioning/provisioningApi', () => ({
  provisioningApi: { listNodes: vi.fn() },
}));

import { deployApi } from './deployApi';
import { provisioningApi } from '../provisioning/provisioningApi';
import { ManagedNodesPanel } from './ManagedNodesPanel';

const mGetKeypair = deployApi.getKeypair as ReturnType<typeof vi.fn>;
const mGenerate = deployApi.generateKeypair as ReturnType<typeof vi.fn>;
const mUpdate = deployApi.updateNode as ReturnType<typeof vi.fn>;
const mReauth = deployApi.reauth as ReturnType<typeof vi.fn>;
const mListNodes = provisioningApi.listNodes as ReturnType<typeof vi.fn>;

const node = (o: Record<string, unknown> = {}) => ({
  id: 'n', name: 'win', role: 'normal_agent', profileId: null, fqdn: null,
  ip: '10.0.10.50', os: 'windows', version: null, status: 'active',
  lastSeenAt: null, createdAt: '', updatedAt: '', hostKeyPin: null, ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Reihenfolge = Anzeige-Reihenfolge: [pinned, nopin]. Linux wird herausgefiltert.
  mListNodes.mockResolvedValue({ data: [
    node({ id: 'win-pinned', name: 'win-pinned', hostKeyPin: 'a'.repeat(64), version: '4.9.0' }),
    node({ id: 'win-nopin', name: 'win-nopin', hostKeyPin: null }),
    node({ id: 'lin-1', name: 'lin-1', os: 'linux', hostKeyPin: 'b'.repeat(64) }),
  ] });
  mGetKeypair.mockResolvedValue({ data: { isSet: true, publicKey: 'ssh-ed25519 AAA nexora', fingerprint: 'SHA256:deadbeef' } });
  mReauth.mockResolvedValue({ data: { reauthToken: 'tok', expiresIn: 300 } });
  mUpdate.mockResolvedValue({ data: { ok: true, nodeId: 'win-pinned', host: '10.0.10.50' } });
  mGenerate.mockResolvedValue({ data: { isSet: true, publicKey: 'ssh-ed25519 BBB nexora', fingerprint: 'SHA256:newkey' } });
});

describe('ManagedNodesPanel', () => {
  test('zeigt aktives Keypair + Fingerprint und Windows- UND Linux-Nodes', async () => {
    render(<ManagedNodesPanel />);
    expect(await screen.findByText('aktiv')).toBeInTheDocument();
    expect(screen.getByText(/SHA256:deadbeef/)).toBeInTheDocument();
    expect(screen.getByText('win-pinned')).toBeInTheDocument();
    expect(screen.getByText('win-nopin')).toBeInTheDocument();
    // Linux ist jetzt ebenfalls Update-Ziel (Slice 8) → gelistet.
    expect(screen.getByText('lin-1')).toBeInTheDocument();
  });

  test('Update ist ohne gepinnten Host-Key gesperrt (fail-closed in der UI gespiegelt)', async () => {
    render(<ManagedNodesPanel />);
    await screen.findByText('win-pinned');
    // Reihenfolge: [0]=pinned, [1]=nopin.
    const updateButtons = screen.getAllByRole('button', { name: 'Update' });
    expect(updateButtons[1]).toBeDisabled(); // kein Host-Key
  });

  test('Update ist auch mit Pin gesperrt, solange keine Passwort-Reauth eingegeben ist', async () => {
    render(<ManagedNodesPanel />);
    await screen.findByText('win-pinned');
    expect(screen.getAllByRole('button', { name: 'Update' })[0]).toBeDisabled();
  });

  test('mit Pin + Passwort → Update löst frische Reauth + updateNode(id, token) aus', async () => {
    const user = userEvent.setup();
    render(<ManagedNodesPanel />);
    await screen.findByText('win-pinned');

    await user.type(screen.getByPlaceholderText('Aktuelles Passwort'), 'geheim');
    const updateBtn = screen.getAllByRole('button', { name: 'Update' })[0];
    expect(updateBtn).toBeEnabled();
    await user.click(updateBtn);

    await waitFor(() => expect(mReauth).toHaveBeenCalledWith('geheim'));
    expect(mUpdate).toHaveBeenCalledWith('win-pinned', 'tok');
  });

  test('zeigt die gemeldete Agent-Version je Node (bzw. „unbekannt")', async () => {
    render(<ManagedNodesPanel />);
    await screen.findByText('win-pinned');
    expect(screen.getByText('Agent v4.9.0')).toBeInTheDocument();
    // win-nopin + lin-1 melden keine Version → zwei „Agent unbekannt".
    expect(screen.getAllByText('Agent unbekannt').length).toBeGreaterThanOrEqual(1);
  });

  test('„Kopieren" legt den Deploy-Public-Key in die Zwischenablage', async () => {
    // userEvent.setup() installiert einen funktionsfähigen Clipboard-Stub → über readText prüfbar.
    const user = userEvent.setup();
    render(<ManagedNodesPanel />);
    await screen.findByText('aktiv');

    await user.click(screen.getByRole('button', { name: /Kopieren/ }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('ssh-ed25519 AAA nexora'));
  });

  test('Keypair rotieren löst generateKeypair mit Reauth-Token aus', async () => {
    const user = userEvent.setup();
    render(<ManagedNodesPanel />);
    await screen.findByText('aktiv');

    await user.type(screen.getByPlaceholderText('Aktuelles Passwort'), 'geheim');
    await user.click(screen.getByRole('button', { name: /Keypair rotieren/ }));

    await waitFor(() => expect(mGenerate).toHaveBeenCalledWith('tok'));
  });
});
