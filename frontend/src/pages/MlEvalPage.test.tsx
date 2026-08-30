import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../features/mlEval/mlEvalApi', () => ({
  getMlEvalStatus: vi.fn(),
  previewEvalSnapshot: vi.fn(),
}));

import { getMlEvalStatus, previewEvalSnapshot } from '../features/mlEval/mlEvalApi';
import { MlEvalPage } from './MlEvalPage';

const mockedStatus = getMlEvalStatus as unknown as ReturnType<typeof vi.fn>;
const mockedPreview = previewEvalSnapshot as unknown as ReturnType<typeof vi.fn>;

const renderPage = () => render(<MemoryRouter><MlEvalPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MlEvalPage', () => {
  it('zeigt eine aktive Routing-Policy mit Threshold', async () => {
    mockedStatus.mockResolvedValue({ routingPolicy: { active: true, policyName: 'conservative_review_bias', threshold: 0.7 } });
    renderPage();
    expect(await screen.findByText('conservative_review_bias')).toBeInTheDocument();
    expect(screen.getByText('Aktiv')).toBeInTheDocument();
    expect(screen.getByText('≥0.7')).toBeInTheDocument();
  });

  it('zeigt einen ehrlichen Inaktiv-Zustand ohne Policy', async () => {
    mockedStatus.mockResolvedValue({ routingPolicy: { active: false, reason: 'unset' } });
    renderPage();
    expect(await screen.findByText('Inaktiv (unset)')).toBeInTheDocument();
    expect(screen.getByText(/ML_ROUTING_POLICY_PATH/)).toBeInTheDocument();
  });

  it('erzeugt auf Knopfdruck einen Eval-Snapshot und zeigt Counts', async () => {
    mockedStatus.mockResolvedValue({ routingPolicy: { active: false, reason: 'unset' } });
    mockedPreview.mockResolvedValue({
      schemaVersion: 'ml-eval-schema.v1',
      generatedAt: '2026-06-29T10:00:00Z',
      recordSha256: 'abcdef0123456789abcdef',
      returned: 20,
      counts: { agent_review: 12, ticket_outcome: 8 },
      labelSourceCounts: { gold_review: 20 },
      humanLabelCounts: { incident: 10, false_positive: 10 },
      exportLimit: 1000,
      include: 'all',
    });
    renderPage();
    await screen.findByText('Eval-Snapshot (Vorschau)');
    fireEvent.click(screen.getByRole('button', { name: /Snapshot erzeugen/i }));
    expect(await screen.findByText('agent_review: 12')).toBeInTheDocument();
    expect(screen.getByText('ticket_outcome: 8')).toBeInTheDocument();
    expect(screen.getByText('incident: 10')).toBeInTheDocument();
    expect(screen.getByText('ml-eval-schema.v1')).toBeInTheDocument();
    expect(screen.getByText(/Snapshot brauchbar/)).toBeInTheDocument();
  });

  it('zeigt bei generischem Fehler eine ehrliche Meldung OHNE falschen Rollen-Hinweis', async () => {
    mockedStatus.mockRejectedValue(new Error('network down'));
    renderPage();
    expect(await screen.findByText('ML-Eval-Status konnte nicht geladen werden.')).toBeInTheDocument();
    // Kein irreführender Admin-Hinweis bei Nicht-403-Fehlern.
    expect(screen.queryByText(/Admin-Rolle nötig/)).not.toBeInTheDocument();
  });

  it('zeigt einen ehrlichen Leerzustand bei 0 Records', async () => {
    mockedStatus.mockResolvedValue({ routingPolicy: { active: false, reason: 'unset' } });
    mockedPreview.mockResolvedValue({
      schemaVersion: 'ml-eval-schema.v1', generatedAt: '2026-06-29T10:00:00Z', recordSha256: 'x',
      returned: 0, counts: {}, labelSourceCounts: {}, humanLabelCounts: {}, exportLimit: 1000, include: 'all',
    });
    renderPage();
    await screen.findByText('Eval-Snapshot (Vorschau)');
    fireEvent.click(screen.getByRole('button', { name: /Snapshot erzeugen/i }));
    await waitFor(() => expect(screen.getByText('Noch keine Eval-Daten')).toBeInTheDocument());
  });

  it('erklaert eine inaktive Policy in Klartext statt nur technisch', async () => {
    mockedStatus.mockResolvedValue({ routingPolicy: { active: false, reason: 'unset' } });
    renderPage();
    expect(await screen.findByText('Routing aktuell aus')).toBeInTheDocument();
    expect(screen.getByText(/Es passiert nichts automatisch/)).toBeInTheDocument();
  });
});
