import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { KiAnalysisView } from './KiAnalysisView';
import { EMPTY_EVIDENCE } from '../analysisModel';
import { agentApi, type AgentSuggestion, type AgentAnalysis } from '../../aiAgent/agentApi';

vi.mock('../../aiAgent/agentApi', () => ({
  agentApi: { forTicket: vi.fn(), propose: vi.fn(), approve: vi.fn(), reject: vi.fn() },
}));

const mockList = (data: AgentSuggestion[]) => (agentApi.forTicket as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data });

const analysis: AgentAnalysis = {
  entities: {},
  iocs: [{ type: 'ipv4', value: '185.199.108.153', reason: 'C2', evidenceSource: 'Threat Intel', verdict: 'high' }],
  assessment: 'Verschleierter PowerShell-Downloader auf WEC01.',
  verdict: 'suspicious',
  confidence: 78,
  riskLevel: 'High',
  confirmedFacts: ['powershell.exe mit -EncodedCommand'],
  suspiciousIndicators: [{ value: 'winword.exe als Parent', reason: 'untypisch' }],
  missingEvidence: ['Sysmon Event 1 fehlt'],
  recommendedActions: [{ priority: 1, action: 'Host isolieren', details: 'WEC01 vom Netz nehmen' }],
  mitreAttack: [{ techniqueId: 'T1059.001', technique: 'PowerShell' }],
};

const sugg = (over: Partial<AgentSuggestion> = {}): AgentSuggestion => ({
  id: 's1',
  ticketId: 't1',
  kind: 'triage',
  proposal: 'Triage',
  rationale: 'r',
  verdict: 'suspicious',
  confidence: 78,
  status: 'pending',
  model: 'llama3.2:3b',
  reviewedBy: null,
  reviewReason: '',
  reviewedAt: null,
  createdAt: '2026-06-22T10:00:00Z',
  analysis,
  ...over,
});

describe('KiAnalysisView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('zeigt das KI-Abfragen-Raster plus ehrlichen Empty State, wenn keine Analyse vorliegt', async () => {
    mockList([]);
    render(<KiAnalysisView ev={EMPTY_EVIDENCE} tl={null} ticketId="t1" canAct />);

    expect(await screen.findByText('KI-Abfragen')).toBeInTheDocument();
    expect(screen.getByText('Triage Summary')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Starten/i }).length).toBeGreaterThan(1);
    expect(screen.getByText(/Noch keine KI-Analyse/i)).toBeInTheDocument();
  });

  it('rendert die Ergebnis-Karten aus echter Analyse und markiert KI-Ausgabe als unbestaetigt', async () => {
    mockList([sugg()]);
    render(<KiAnalysisView ev={EMPTY_EVIDENCE} tl={null} ticketId="t1" canAct />);

    await waitFor(() => expect(screen.getByText('AI Verdict / Triage Summary')).toBeInTheDocument());
    expect(screen.getAllByText(/Verschleierter PowerShell-Downloader/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Evidence-backed Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Confidence & Recommendation')).toBeInTheDocument();
    expect(screen.getByText('Extracted IOCs & Entities')).toBeInTheDocument();
    expect(screen.getByText('KI-Verlauf')).toBeInTheDocument();
    expect(screen.getAllByText('Host isolieren').length).toBeGreaterThan(0);
    expect(screen.getByText(/Sysmon Event 1 fehlt/i)).toBeInTheDocument();
    expect(screen.getByText('185.199.108.153')).toBeInTheDocument();
    expect(screen.getByText(/keine best[aä]tigte Evidence/i)).toBeInTheDocument();
    expect(screen.getAllByText(/nichts automatisch ausgef[uü]hrt/i).length).toBeGreaterThan(0);
  });

  it('zeigt den KI-Verlauf fuer mehrere echte Analyse-Laeufe eines Tickets', async () => {
    mockList([
      sugg({ id: 'older', createdAt: '2026-06-22T09:00:00Z', confidence: 61, analysis: { ...analysis, confidence: 61 }, status: 'pending' }),
      sugg({
        id: 'newer',
        createdAt: '2026-06-22T11:30:00Z',
        confidence: 88,
        analysis: { ...analysis, confidence: 88, verdict: 'malicious', assessment: 'Mehr bestaetigte Treffer.' },
        status: 'approved',
        kind: 'incident_recommendation',
      }),
    ]);

    render(<KiAnalysisView ev={EMPTY_EVIDENCE} tl={null} ticketId="t1" canAct />);

    await waitFor(() => expect(screen.getByText('KI-Verlauf')).toBeInTheDocument());
    expect(screen.getByText('Confidence steigt')).toBeInTheDocument();
    expect(screen.getByText('Run 1')).toBeInTheDocument();
    expect(screen.getByText('Run 2')).toBeInTheDocument();
    expect(screen.getAllByText('Incident Recommendation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('88%').length).toBeGreaterThan(0);
  });

  it('zeigt keine Ergebnis-Karten ohne echte Analyse', async () => {
    mockList([]);
    render(<KiAnalysisView ev={EMPTY_EVIDENCE} tl={null} ticketId="t1" canAct />);

    await screen.findByText(/Noch keine KI-Analyse/i);
    expect(screen.queryByText('Extracted IOCs & Entities')).not.toBeInTheDocument();
    expect(screen.queryByText('Analyst Approval')).not.toBeInTheDocument();
  });
});
