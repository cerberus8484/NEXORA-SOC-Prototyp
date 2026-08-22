import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('../features/system/systemApi', () => ({
  systemApi: {
    health: vi.fn(),
    stats: vi.fn(),
    control: vi.fn(),
    runControlAction: vi.fn(),
  },
}));

vi.mock('../features/settings/integrationsApi', () => ({
  getStatus: vi.fn(),
  testIntegration: vi.fn(),
  buildStatusCounts: (items: Array<{ status: string }>) => ({
    connected: items.filter((item) => item.status === 'connected').length,
    configured: items.filter((item) => item.status === 'configured').length,
    not_configured: items.filter((item) => item.status === 'not_configured').length,
    total: items.length,
  }),
}));

vi.mock('../features/deploy/deployApi', () => ({
  deployApi: {
    reauth: vi.fn(),
  },
}));

import { systemApi } from '../features/system/systemApi';
import { getStatus, testIntegration } from '../features/settings/integrationsApi';
import { SystemStatusPage } from './SystemStatusPage';

const mHealth = systemApi.health as ReturnType<typeof vi.fn>;
const mStats = systemApi.stats as ReturnType<typeof vi.fn>;
const mControl = systemApi.control as ReturnType<typeof vi.fn>;
const mGetStatus = getStatus as ReturnType<typeof vi.fn>;
const mTestIntegration = testIntegration as ReturnType<typeof vi.fn>;

describe('SystemStatusPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mGetStatus.mockResolvedValue([]);
    mControl.mockResolvedValue({ data: { actions: [] } });
    mTestIntegration.mockResolvedValue({ reachable: true, testedAt: '2026-07-06T00:00:00.000Z' });
  });

  it('zeigt die Pool-Kachel mit Warnhinweis bei wartenden DB-Anfragen', async () => {
    mHealth.mockResolvedValue({
      status: 'ok',
      db: 'ok',
      version: '1.0.0',
      uptime: 3600,
    });
    mStats.mockResolvedValue({
      data: {
        dbEnabled: true,
        counts: { tickets: 10, ticketsOpen: 8, evidence: 3, hunts: 2, findings: 1, audit24h: 5, fpExceptions: 0, users: 2 },
        byPriority: {},
        byState: {},
        storage: { dbBytes: 1024, tables: [] },
        activity: [],
        pool: { total: 10, idle: 0, waiting: 2, max: 10, saturated: true },
      },
    });

    render(<SystemStatusPage />);

    expect(await screen.findByText(/Postgres-Pool/i)).toBeInTheDocument();
    expect(screen.getByText(/Pool unter Druck/i)).toBeInTheDocument();
    expect(screen.getByText(/wartet bereits auf eine DB-Verbindung/i)).toBeInTheDocument();
    const waitingTile = screen.getByText('Waiting').parentElement;
    expect(waitingTile).toBeTruthy();
    expect(within(waitingTile as HTMLElement).getByText(/^2$/)).toBeInTheDocument();
  });

  it('zeigt die Integrations-Gesundheit mit fehlenden Kernintegrationen', async () => {
    mHealth.mockResolvedValue({
      status: 'ok',
      db: 'ok',
      version: '1.0.0',
      uptime: 3600,
    });
    mStats.mockResolvedValue({
      data: {
        dbEnabled: true,
        counts: { tickets: 10, ticketsOpen: 8, evidence: 3, hunts: 2, findings: 1, audit24h: 5, fpExceptions: 0, users: 2 },
        byPriority: {},
        byState: {},
        storage: { dbBytes: 1024, tables: [] },
        activity: [],
        pool: { total: 10, idle: 4, waiting: 0, max: 10, saturated: false },
      },
    });
    mGetStatus.mockResolvedValue([
      { id: 'wazuh', name: 'Wazuh', category: 'siem', configured: true, endpoint: 'wazuh.local:55000', status: 'configured', testable: true },
      { id: 'ollama', name: 'Ollama', category: 'llm', configured: false, endpoint: '', status: 'not_configured', testable: true },
      { id: 'email', name: 'E-Mail', category: 'email', configured: false, endpoint: '', status: 'not_configured', testable: true },
    ]);

    render(<SystemStatusPage />);

    expect(await screen.findByText(/Integrations-Gesundheit/i)).toBeInTheDocument();
    expect(screen.getByText(/1 konfiguriert/i)).toBeInTheDocument();
    expect(screen.getByText(/2 offen/i)).toBeInTheDocument();
    expect(screen.getByText(/Ollama fehlt/i)).toBeInTheDocument();
    expect(screen.getByText(/E-Mail fehlt/i)).toBeInTheDocument();
  });

  it('zeigt einen warnenden Ollama-Hinweis, wenn das Modell fehlt', async () => {
    mHealth.mockResolvedValue({
      status: 'ok',
      db: 'ok',
      version: '1.0.0',
      uptime: 3600,
    });
    mStats.mockResolvedValue({
      data: {
        dbEnabled: true,
        counts: { tickets: 10, ticketsOpen: 8, evidence: 3, hunts: 2, findings: 1, audit24h: 5, fpExceptions: 0, users: 2 },
        byPriority: {},
        byState: {},
        storage: { dbBytes: 1024, tables: [] },
        activity: [],
        pool: { total: 10, idle: 4, waiting: 0, max: 10, saturated: false },
      },
    });
    mGetStatus.mockResolvedValue([
      { id: 'ollama', name: 'Ollama', category: 'llm', configured: true, endpoint: 'ollama.local:11434', status: 'configured', testable: true },
    ]);
    mTestIntegration.mockResolvedValue({
      reachable: true,
      testedAt: '2026-07-06T00:00:00.000Z',
      modelAvailable: false,
      reason: 'model_missing',
      message: 'Modell fehlt',
    });

    render(<SystemStatusPage />);

    expect(await screen.findByText(/Ollama: Modell fehlt/i)).toBeInTheDocument();
  });

  it('zeigt bei deaktivierter DB den ehrlichen EmptyState statt Pool-Kachel', async () => {
    mHealth.mockResolvedValue({
      status: 'ok',
      db: 'not_configured',
      version: '1.0.0',
      uptime: 3600,
    });
    mStats.mockResolvedValue({
      data: { dbEnabled: false },
    });

    render(<SystemStatusPage />);

    expect(await screen.findByText(/DB-Modus deaktiviert/i)).toBeInTheDocument();
    expect(screen.queryByText(/Postgres-Pool/i)).not.toBeInTheDocument();
  });

  it('zeigt fail-closed System-Operationen mit Disabled-Grund', async () => {
    mHealth.mockResolvedValue({
      status: 'ok',
      db: 'ok',
      version: '1.0.0',
      uptime: 3600,
    });
    mStats.mockResolvedValue({
      data: {
        dbEnabled: true,
        counts: { tickets: 1, ticketsOpen: 1, evidence: 0, hunts: 0, findings: 0, audit24h: 0, fpExceptions: 0, users: 1 },
        byPriority: {},
        byState: {},
        storage: { dbBytes: 0, tables: [] },
        activity: [],
        pool: { total: 2, idle: 1, waiting: 0, max: 10, saturated: false },
      },
    });
    mControl.mockResolvedValue({
      data: {
        actions: [
          {
            id: 'app-update',
            name: 'System aktualisieren',
            description: 'Update',
            kind: 'update',
            requiresReauth: true,
            executionMode: 'detached',
            enabled: false,
            disabledReason: 'Serverseitig nicht freigeschaltet',
            errorCode: 'E_DISABLED',
            running: false,
            repoRoot: '/repo',
            lastResult: null,
          },
        ],
      },
    });

    render(<SystemStatusPage />);

    expect(await screen.findByText(/System-Operationen/i)).toBeInTheDocument();
    expect(screen.getByText(/Serverseitig nicht freigeschaltet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aktualisierung anstossen/i })).toBeDisabled();
  });
});
