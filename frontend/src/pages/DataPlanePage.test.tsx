import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../features/dataplane/dataplaneApi', () => ({
  getPipelineStatus: vi.fn(),
}));

import { getPipelineStatus } from '../features/dataplane/dataplaneApi';
import { DataPlanePage } from './DataPlanePage';

const mockedStatus = getPipelineStatus as unknown as ReturnType<typeof vi.fn>;
const renderPage = () => render(<MemoryRouter><DataPlanePage /></MemoryRouter>);

function healthyNode() {
  return {
    nodeId: 'dp-prod-1', reportedAt: '2026-06-30T11:59:50.000Z', receivedAt: '2026-06-30T11:59:50.000Z',
    collectors: [
      { name: 'cowrie', kind: 'siem', status: 'running', emitted: 7, error: null },
      { name: 'suricata', kind: 'ids', status: 'running', emitted: 3, error: null },
    ],
    intake: { total: 50, rejected: 1, pending: 2 },
    outbox: { pending: 1, retrying: 0, failed: 0 },
    ageMs: 10000, fresh: true, collectorsSummary: { total: 2, running: 2, failed: 0 }, health: 'healthy',
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('DataPlanePage', () => {
  it('rendert einen gesunden Knoten mit KPIs, Health-Badge und Collector-Tabelle', async () => {
    mockedStatus.mockResolvedValue({
      available: true, staleAfterMs: 90000, generatedAt: '2026-06-30T12:00:00.000Z',
      nodes: [healthyNode()],
      aggregate: {
        nodes: 1, freshNodes: 1, collectors: 2, collectorsRunning: 2, collectorsFailed: 0,
        intake: { total: 50, rejected: 1, pending: 2 }, outbox: { pending: 1, retrying: 0, failed: 0 },
      },
    });
    renderPage();

    expect(await screen.findByText('dp-prod-1')).toBeInTheDocument();
    expect(screen.getByText('Gesund')).toBeInTheDocument();
    expect(screen.getByText('cowrie')).toBeInTheDocument();
    expect(screen.getByText('suricata')).toBeInTheDocument();
    expect(screen.getByText('Kollektoren laufend')).toBeInTheDocument();
    // zwei laufende Kollektoren → zwei „Läuft"-Badges
    expect(screen.getAllByText('Läuft')).toHaveLength(2);
  });

  it('zeigt einen ehrlichen Zustand, wenn kein frischer Snapshot vorliegt', async () => {
    mockedStatus.mockResolvedValue({
      available: false, staleAfterMs: 90000, generatedAt: '2026-06-30T12:00:00.000Z',
      nodes: [],
      aggregate: {
        nodes: 0, freshNodes: 0, collectors: 0, collectorsRunning: 0, collectorsFailed: 0,
        intake: { total: 0, rejected: 0, pending: 0 }, outbox: { pending: 0, retrying: 0, failed: 0 },
      },
    });
    renderPage();

    expect(await screen.findByText(/Kein frischer Status-Snapshot/)).toBeInTheDocument();
    expect(screen.getByText('Noch kein Data-Plane-Knoten gemeldet')).toBeInTheDocument();
  });

  it('zeigt eine ehrliche Fehlermeldung bei Ladefehler', async () => {
    mockedStatus.mockRejectedValue(new Error('network down'));
    renderPage();
    expect(await screen.findByText('Pipeline-Status konnte nicht geladen werden.')).toBeInTheDocument();
  });
});
