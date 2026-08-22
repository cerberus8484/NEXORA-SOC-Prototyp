import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let currentRole = 'admin';
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { role: currentRole, displayName: 'Tester' } }),
}));

vi.mock('../features/integrations/integrationsApi', () => ({
  getIntegrationStatus: vi.fn(),
  testIntegration: vi.fn(),
}));
vi.mock('../features/dataplane/dataplaneApi', () => ({
  getPipelineStatus: vi.fn(),
}));
vi.mock('../features/collectors/collectorsStatusApi', async () => {
  const actual = await vi.importActual<typeof import('../features/collectors/collectorsStatusApi')>(
    '../features/collectors/collectorsStatusApi',
  );
  return { ...actual, getCollectorActivity: vi.fn() };
});

import { getIntegrationStatus, testIntegration } from '../features/integrations/integrationsApi';
import { getPipelineStatus } from '../features/dataplane/dataplaneApi';
import { getCollectorActivity } from '../features/collectors/collectorsStatusApi';
import { CollectorsStatusPage } from './CollectorsStatusPage';

const mInt = getIntegrationStatus as unknown as ReturnType<typeof vi.fn>;
const mTest = testIntegration as unknown as ReturnType<typeof vi.fn>;
const mPipe = getPipelineStatus as unknown as ReturnType<typeof vi.fn>;
const mAct = getCollectorActivity as unknown as ReturnType<typeof vi.fn>;

const renderPage = () => render(<MemoryRouter><CollectorsStatusPage /></MemoryRouter>);

const emptyPipeline = {
  available: false, staleAfterMs: 90000, generatedAt: '2026-07-01T12:00:00.000Z', nodes: [],
  aggregate: {
    nodes: 0, freshNodes: 0, collectors: 0, collectorsRunning: 0, collectorsFailed: 0,
    intake: { total: 0, rejected: 0, pending: 0 }, outbox: { pending: 0, retrying: 0, failed: 0 },
  },
};
const activity = {
  sources: [{ source: 'wazuh', total: 120, recent: 12, lastSeen: '2026-07-01T11:00:00.000Z' }],
  liveProcessStatus: { available: false, note: '' },
};

beforeEach(() => {
  vi.clearAllMocks();
  currentRole = 'admin';
  mInt.mockResolvedValue([
    { id: 'wazuh', name: 'Wazuh', category: 'siem', configured: true, endpoint: 'wazuh.lab:55000', status: 'configured', testable: true },
    { id: 'qradar', name: 'QRadar', category: 'siem', configured: false, endpoint: '', status: 'not_configured', testable: false },
  ]);
  mPipe.mockResolvedValue(emptyPipeline);
  mAct.mockResolvedValue(activity);
});

describe('CollectorsStatusPage - konsolidierte Integrations & Collectors Uebersicht', () => {
  it('zeigt den ehrlichen read-only/Deploy-Center-Hinweis oben', async () => {
    renderPage();
    expect(await screen.findByText(/Deploy-Center/)).toBeInTheDocument();
  });

  it('rendert den ehrlichen Hinweis fuer automatische Live-Tests in der Integrations-Sektion', async () => {
    renderPage();
    expect(await screen.findByText(/Live-Tests laufen beim Laden automatisch/)).toBeInTheDocument();
  });

  it('startet Live-Tests beim Laden fuer testbare, konfigurierte Integrationen automatisch', async () => {
    mTest.mockResolvedValue({ reachable: true, message: 'Manager erreichbar' });

    renderPage();

    expect(await screen.findByText(/Manager erreichbar/)).toBeInTheDocument();
    expect(mTest).toHaveBeenCalledWith('wazuh');
  });

  it('loest den Verbindungstest fuer eine testbare Integration aus und zeigt das Ergebnis ehrlich', async () => {
    mTest.mockResolvedValue({ reachable: true, message: 'Manager erreichbar' });
    renderPage();
    const btn = (await screen.findAllByRole('button', { name: /Verbindung testen/ }))[0];
    fireEvent.click(btn);
    expect(await screen.findByText(/Manager erreichbar/)).toBeInTheDocument();
    expect(mTest).toHaveBeenCalledWith('wazuh');
  });

  it('zeigt die Live-Collectors-Sektion ehrlich leer, wenn kein frischer Snapshot vorliegt', async () => {
    renderPage();
    expect(await screen.findByText('Noch kein Collector-Hub-Knoten gemeldet')).toBeInTheDocument();
    expect(screen.getByText(/Status-Bruecke ist aktiv/)).toBeInTheDocument();
  });

  it('zeigt die Ingest-Aktivitaet je Quelle', async () => {
    renderPage();
    expect(await screen.findByText('Ingest-Aktivitaet je Quelle')).toBeInTheDocument();
    expect(screen.getByText('Aktiv (24h)')).toBeInTheDocument();
  });

  it('zeigt Source Health verstaendlich als aktiv und still seit', async () => {
    mInt.mockResolvedValue([
      { id: 'wazuh', name: 'Wazuh', category: 'siem', configured: true, endpoint: 'wazuh.lab:55000', status: 'configured', testable: true },
      { id: 'splunk', name: 'Splunk', category: 'siem', configured: true, endpoint: 'splunk.lab:8089', status: 'configured', testable: false },
    ]);
    mAct.mockResolvedValue({
      sources: [
        { source: 'wazuh', total: 120, recent: 12, lastSeen: '2026-07-01T11:00:00.000Z' },
        { source: 'splunk', total: 9, recent: 0, lastSeen: '2026-06-30T06:00:00.000Z' },
      ],
      liveProcessStatus: { available: false, note: '' },
    });

    renderPage();
    expect(await screen.findByText('Source Health')).toBeInTheDocument();
    expect(screen.getByText('Liefert Tickets')).toBeInTheDocument();
    expect(screen.getByText(/Still seit/)).toBeInTheDocument();
  });

  it('zeigt Modell-fehlt sauber an, wenn Ollama erreichbar ist aber das Modell fehlt', async () => {
    mInt.mockResolvedValue([
      { id: 'ollama', name: 'Ollama', category: 'llm', configured: true, endpoint: 'ollama.lab:11434', status: 'configured', testable: true },
    ]);
    mAct.mockResolvedValue({ sources: [], liveProcessStatus: { available: false, note: '' } });
    mTest.mockResolvedValue({ reachable: true, modelAvailable: false, reason: 'model_missing', message: 'Gewaehltes Modell fehlt' });

    renderPage();

    expect(await screen.findByText(/Modell fehlt: Gewaehltes Modell fehlt/)).toBeInTheDocument();
    expect(mTest).toHaveBeenCalledWith('ollama');
  });

  it('verbirgt den Integrations-Status fuer Nicht-Admins mit ehrlichem Hinweis', async () => {
    currentRole = 'analyst';
    renderPage();
    expect(await screen.findByText(/Source Health braucht Konfigurationsdaten/)).toBeInTheDocument();
    expect(screen.getByText(/Der Integrations-Status/)).toBeInTheDocument();
    expect(mInt).not.toHaveBeenCalled();
  });
});
