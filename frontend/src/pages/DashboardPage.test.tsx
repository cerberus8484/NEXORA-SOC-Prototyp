import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Rolle pro Test steuerbar — entscheidet ueber den RBAC-Gate der SOC-Metriken.
let currentRole = 'admin';
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { role: currentRole, displayName: 'Tester' } }),
}));

// TelemetryPanel macht eigene Netz-Calls — als Stub isolieren, Dashboard-Orchestrierung testen.
vi.mock('../features/siem/TelemetryPanel', () => ({
  TelemetryPanel: () => null,
}));

vi.mock('../features/tickets/ticketApi', () => ({
  ticketApi: { list: vi.fn() },
}));
vi.mock('../features/hunts/huntApi', () => ({
  huntApi: { listSessions: vi.fn() },
}));
vi.mock('../features/system/systemApi', () => ({
  systemApi: { health: vi.fn() },
}));
vi.mock('../features/settings/integrationsApi', () => ({
  getStatus: vi.fn(),
  testIntegration: vi.fn(),
}));
vi.mock('../features/evidence/evidenceApi', () => ({
  evidenceApi: { recent: vi.fn() },
}));
vi.mock('../features/siem/siemApi', () => ({
  siemApi: { telemetry: vi.fn() },
}));
vi.mock('../features/audit/auditApi', () => ({
  auditApi: { recent: vi.fn() },
}));
vi.mock('../features/metrics/socMetricsApi', () => ({
  socMetricsApi: { get: vi.fn() },
}));
// getCollectorActivity mocken, restliche Exports (sourceLiveness etc.) echt lassen.
vi.mock('../features/collectors/collectorsStatusApi', async () => {
  const actual = await vi.importActual<typeof import('../features/collectors/collectorsStatusApi')>(
    '../features/collectors/collectorsStatusApi',
  );
  return { ...actual, getCollectorActivity: vi.fn() };
});

import { ticketApi } from '../features/tickets/ticketApi';
import { huntApi } from '../features/hunts/huntApi';
import { systemApi } from '../features/system/systemApi';
import { getStatus, testIntegration } from '../features/settings/integrationsApi';
import { evidenceApi } from '../features/evidence/evidenceApi';
import { siemApi } from '../features/siem/siemApi';
import { auditApi } from '../features/audit/auditApi';
import { socMetricsApi } from '../features/metrics/socMetricsApi';
import { getCollectorActivity } from '../features/collectors/collectorsStatusApi';
import { buildPrioritySegments, DashboardPage } from './DashboardPage';
import i18n from '../i18n';

const mList = ticketApi.list as unknown as ReturnType<typeof vi.fn>;
const mHunts = huntApi.listSessions as unknown as ReturnType<typeof vi.fn>;
const mHealth = systemApi.health as unknown as ReturnType<typeof vi.fn>;
const mIntegrationStatus = getStatus as unknown as ReturnType<typeof vi.fn>;
const mIntegrationTest = testIntegration as unknown as ReturnType<typeof vi.fn>;
const mEvidence = evidenceApi.recent as unknown as ReturnType<typeof vi.fn>;
const mTelemetry = siemApi.telemetry as unknown as ReturnType<typeof vi.fn>;
const mAudit = auditApi.recent as unknown as ReturnType<typeof vi.fn>;
const mMetrics = socMetricsApi.get as unknown as ReturnType<typeof vi.fn>;
const mActivity = getCollectorActivity as unknown as ReturnType<typeof vi.fn>;

const renderPage = () => render(<MemoryRouter><DashboardPage /></MemoryRouter>);

const activityWithSources = {
  sources: [
    { source: 'wazuh', total: 120, recent: 12, lastSeen: '2026-07-05T09:00:00.000Z' },
    { source: 'email', total: 30, recent: 4, lastSeen: '2026-07-05T08:00:00.000Z' },
  ],
  liveProcessStatus: { available: false, note: '' },
};

beforeEach(() => {
  vi.clearAllMocks();
  currentRole = 'admin';
  mList.mockResolvedValue({ total: 0, data: [] });
  mHunts.mockResolvedValue({ data: [] });
  mHealth.mockResolvedValue({ status: 'ok' });
  mIntegrationStatus.mockResolvedValue([
    { id: 'wazuh', name: 'Wazuh', category: 'siem', configured: true, endpoint: 'wazuh.lab:55000', status: 'configured', testable: true },
    { id: 'ollama', name: 'Ollama', category: 'llm', configured: true, endpoint: 'ollama.lab:11434', status: 'configured', testable: true },
    { id: 'email', name: 'E-Mail', category: 'email', configured: true, endpoint: 'imap.lab:993', status: 'configured', testable: true },
  ]);
  mIntegrationTest.mockImplementation(async (id: string) => {
    if (id === 'ollama') return { reachable: true, testedAt: '2026-07-06T18:00:00.000Z', modelAvailable: true, message: 'Ollama erreichbar' };
    return { reachable: true, testedAt: '2026-07-06T18:00:00.000Z', message: 'Wazuh erreichbar' };
  });
  mEvidence.mockResolvedValue({ data: [] });
  mTelemetry.mockResolvedValue({ enabled: false });
  mAudit.mockResolvedValue({ data: [] });
  mMetrics.mockResolvedValue({ data: { topRules: [{ key: 'rule:100205', count: 7 }] } });
  mActivity.mockResolvedValue(activityWithSources);
});

describe('DashboardPage - Detection-Panel-Orchestrierung nach Rolle', () => {
  it('baut Prioritaetslabels mit der aktuell gewaehlten Sprache', async () => {
    await i18n.changeLanguage('en');
    expect(buildPrioritySegments({ high: 2 }, i18n.t.bind(i18n))[1]).toMatchObject({ label: 'High', value: 2 });

    await i18n.changeLanguage('de');
    expect(buildPrioritySegments({ high: 2 }, i18n.t.bind(i18n))[1]).toMatchObject({ label: 'Hoch', value: 2 });
  });

  it('zeigt Engineer/Admin echte SOC-Metriken-Regelquellen und ruft socMetricsApi', async () => {
    currentRole = 'engineer';
    renderPage();

    expect(await screen.findByText('SOC-Metriken')).toBeInTheDocument();
    expect(screen.getByText('Regel 100205')).toBeInTheDocument();
    expect(mMetrics).toHaveBeenCalledTimes(1);
  });

  it('faellt fuer Analysten ehrlich auf Ticket-Quellen zurueck OHNE SOC-Metriken zu laden', async () => {
    currentRole = 'analyst';
    renderPage();

    // Fallback-Card zeigt reale Ticket-Quellen statt Regel-Statistik (Sources-Mode: Beschreibung).
    expect(await screen.findByText(/Rule-Statistiken sind hier nicht sichtbar/)).toBeInTheDocument();
    // RBAC-Gate: Analyst darf SOC-Metriken nicht abfragen.
    expect(mMetrics).not.toHaveBeenCalled();
  });

  it('nutzt Ticket-Quellen als Fallback, wenn SOC-Metriken fuer Engineer fehlschlagen', async () => {
    currentRole = 'engineer';
    mMetrics.mockRejectedValue(new Error('metrics down'));
    renderPage();

    expect(await screen.findByText('Ingestion-Fallback')).toBeInTheDocument();
    expect(mMetrics).toHaveBeenCalledTimes(1);
  });

  it('laedt die Collector-Aktivitaet genau einmal (kein doppeltes Laden)', async () => {
    renderPage();

    await screen.findByText('Schnellzugriff');
    await waitFor(() => expect(mActivity).toHaveBeenCalledTimes(1));
  });

  it('zeigt einen ehrlichen Fehlerzustand, wenn das Lagebild nicht ladbar ist', async () => {
    mList.mockRejectedValue(new Error('backend weg'));
    renderPage();

    expect(await screen.findByText('backend weg')).toBeInTheDocument();
  });

  it('stuft System Health auf PRUEFEN herunter, wenn Wazuh live nicht erreichbar ist', async () => {
    mIntegrationTest.mockImplementation(async (id: string) => {
      if (id === 'wazuh') return { reachable: false, testedAt: '2026-07-06T18:00:00.000Z', message: 'Wazuh live nicht erreichbar' };
      return { reachable: true, testedAt: '2026-07-06T18:00:00.000Z', modelAvailable: true, message: 'Ollama erreichbar' };
    });

    renderPage();

    expect(await screen.findByText('PRUEFEN')).toBeInTheDocument();
    expect(screen.getByText(/Wazuh live nicht erreichbar/)).toBeInTheDocument();
  });

  it('stuft System Health auf PRUEFEN herunter, wenn das Ollama-Modell fehlt', async () => {
    mIntegrationTest.mockImplementation(async (id: string) => {
      if (id === 'ollama') {
        return {
          reachable: true,
          testedAt: '2026-07-06T18:00:00.000Z',
          modelAvailable: false,
          reason: 'model_missing',
          message: 'Gewaehltes Modell fehlt',
        };
      }
      return { reachable: true, testedAt: '2026-07-06T18:00:00.000Z', message: 'Wazuh erreichbar' };
    });

    renderPage();

    expect(await screen.findByText('PRUEFEN')).toBeInTheDocument();
    expect(screen.getByText(/Gewaehltes Modell fehlt/)).toBeInTheDocument();
  });
});
