import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Rolle wird je Test gesetzt; API gemockt — wir prüfen Verhalten, nicht echtes fetch.
let currentRole = 'admin';
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { role: currentRole, displayName: 'Tester' } }),
}));
vi.mock('../features/correlators/correlatorsApi', () => ({
  correlatorsApi: {
    list: vi.fn(), get: vi.fn(), listJobs: vi.fn(), listResults: vi.fn(),
    getConfig: vi.fn(), listAudit: vi.fn(),
    createDraft: vi.fn(), updateDraft: vi.fn(), submitDraft: vi.fn(), decideDraft: vi.fn(),
    validateDraft: vi.fn(), getPlan: vi.fn(), getWorkerHealth: vi.fn(),
  },
}));

import { correlatorsApi } from '../features/correlators/correlatorsApi';
import { CorrelatorsPage } from './CorrelatorsPage';

const mock = correlatorsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const CORRELATOR = {
  id: 'correlation-worker', name: 'Correlation Engine',
  description: 'Asynchrone, materialisierte Korrelation.', engineVersion: 'ce-1', riskClass: 'medium',
  inputSources: ['ticket', 'evidence'], outputTypes: ['correlated-evidence'],
  configTargetId: 'correlation-worker', configCapabilityIds: ['correlator.worker.maxChildren'],
  queue: { total: 4, active: 1, pending: 1, running: 0, retrying: 0, completed: 2, failed: 0, superseded: 1 },
  lastActivityAt: '2026-06-22T00:00:00.000Z',
};

const JOB_SUPERSEDED = {
  id: 'J-sup', ticketId: 'INC0009', presentationStatus: 'superseded', superseded: true,
  engineVersion: 'ce-1', sourceRevision: 'r', inputHash: 'h', resultReference: null, retryCount: 0,
  failureSummary: null, createdAt: '2026-06-22T00:00:00.000Z', startedAt: null, completedAt: null,
};
const RESULT = {
  id: 'R-1', ticketId: 'INC0001', jobId: 'J-1', inputHash: 'h', sourceRevision: 'r', engineVersion: 'ce-1',
  eventCount: 2, sources: [{ source: 'Wazuh', count: 2 }], evidenceRefCount: 2, createdAt: '2026-06-22T00:00:00.000Z',
};
const CAP = {
  id: 'correlator.worker.maxChildren', scope: 'correlator', risk: 'low',
  description: 'Max Child-Tickets pro Job.', effect: 'Begrenzt den Input.', applyImpact: 'reload',
  applyStatus: 'not_supported', editable: true, sensitiveFields: [], allowedTargets: ['correlation-worker'],
  fields: [{ name: 'maxChildren', type: 'number', required: false, default: 200, sensitive: false }],
  drafts: [],
};
const RESERVED = {
  id: 'host.network.allowlist', scope: 'host', risk: 'prohibited', description: 'Reserviert.', effect: '',
  applyImpact: 'restart', applyStatus: 'not_supported', editable: false, sensitiveFields: [],
  allowedTargets: ['host-fw'], fields: [],
};

function setConfig(drafts: unknown[] = []) {
  mock.getConfig.mockResolvedValue({ data: { bound: [{ ...CAP, drafts }], reserved: [RESERVED] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentRole = 'admin';
  mock.list.mockResolvedValue({ data: [CORRELATOR] });
  mock.listJobs.mockResolvedValue({ data: [JOB_SUPERSEDED], total: 4 });
  mock.listResults.mockResolvedValue({ data: [RESULT] });
  mock.listAudit.mockResolvedValue({ data: [{ id: 'a1', type: 'config.draft.created', actor: 'eng', capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', draftId: 'd1', before: null, after: { maxChildren: 5 }, at: '2026-06-22T00:00:00.000Z' }] });
  mock.getWorkerHealth.mockResolvedValue({ data: { workerId: 'correlation-worker', present: true, lastHeartbeatAt: '2026-06-22T08:00:00.000Z', ageMs: 100, heartbeatFresh: true, adoptedConfigVersions: { 'correlator.worker.maxChildren': 1 }, queueProcessingState: 'idle', queueOk: true, lastJobOutcome: 'completed', killSwitchEnabled: false, applyReady: false, reasons: ['Apply serverseitig gesperrt'] } });
  setConfig();
});

async function renderAndOpenDetail() {
  render(<MemoryRouter><CorrelatorsPage /></MemoryRouter>);
  const row = await screen.findByText('Correlation Engine');
  fireEvent.click(row);
  await screen.findByText(/Jobs \(/);
}

describe('CorrelatorsPage — Registry', () => {
  it('rendert die Registry mit realen Daten', async () => {
    render(<MemoryRouter><CorrelatorsPage /></MemoryRouter>);
    expect(await screen.findByText('Correlation Engine')).toBeInTheDocument();
    expect(screen.getByText('ce-1')).toBeInTheDocument();
  });

  it('verweigert den Zugriff unterhalb der Analyst-Rolle', async () => {
    currentRole = 'viewer';
    render(<MemoryRouter><CorrelatorsPage /></MemoryRouter>);
    expect(await screen.findByText('Zugriff verweigert')).toBeInTheDocument();
    expect(mock.list).not.toHaveBeenCalled();
  });
});

describe('CorrelatorsPage — Detailansicht', () => {
  it('zeigt Jobs, Results, Audit und Config-Status', async () => {
    await renderAndOpenDetail();
    expect(screen.getByText('INC0009')).toBeInTheDocument();           // Job
    expect(screen.getByText('Ersetzt')).toBeInTheDocument();           // superseded-Label (Badge)
    expect(screen.getByText(/Results \(/)).toBeInTheDocument();
    expect(screen.getByText('INC0001')).toBeInTheDocument();           // Result-Ticket
    expect(screen.getByText(/Audit \(/)).toBeInTheDocument();
    expect(screen.getAllByText('correlator.worker.maxChildren').length).toBeGreaterThan(0); // Config-Cap + Audit
  });

  it('zeigt Worker Live-Health + Apply-Readiness (blockiert bei Kill-Switch aus)', async () => {
    await renderAndOpenDetail();
    expect(screen.getByText(/Worker Live-Health/i)).toBeInTheDocument();
    expect(screen.getByText(/Heartbeat: frisch/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Apply blockiert/i).length).toBeGreaterThan(0);
  });

  it('erklärt superseded als ersetzt (kein pauschaler Fehler)', async () => {
    await renderAndOpenDetail();
    expect(screen.getByText(/durch eine neuere Ticket-Revision ersetzt/i)).toBeInTheDocument();
  });

  it('zeigt reservierte Capability sichtbar, aber gesperrt', async () => {
    await renderAndOpenDetail();
    expect(screen.getByText('host.network.allowlist')).toBeInTheDocument();
    expect(screen.getByText(/Reserviert — sichtbar, nicht editierbar/i)).toBeInTheDocument();
  });

  it('bietet KEINE Apply-/Restart-/Shell-Aktion an', async () => {
    await renderAndOpenDetail();
    // Exakte Ausführungs-Verben — die read-only „Apply-Plan anzeigen"-Vorschau ist KEINE Ausführung.
    expect(screen.queryByRole('button', { name: /^(anwenden|apply|restart|neustart|reload|shell|ssh|ausführen|execute)$/i })).toBeNull();
  });
});

describe('CorrelatorsPage — Draft-/Approval-Fluss (admin)', () => {
  it('legt einen Draft an (createDraft mit korrekter Capability)', async () => {
    mock.createDraft.mockResolvedValue({ data: { id: 'd1', status: 'draft' } });
    await renderAndOpenDetail();
    fireEvent.click(screen.getByRole('button', { name: /Draft anlegen & validieren/i }));
    await waitFor(() => expect(mock.createDraft).toHaveBeenCalledWith('correlation-worker', { capabilityId: 'correlator.worker.maxChildren', value: { maxChildren: 200 } }));
  });

  it('zeigt „genehmigt, nicht angewendet" bei approved Draft', async () => {
    setConfig([{ id: 'd1', capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', value: { maxChildren: 42 }, status: 'approved', version: 3, revision: 1, createdBy: 'eng', createdAt: '', updatedAt: '' }]);
    await renderAndOpenDetail();
    expect(await screen.findByText(/Genehmigt, aber noch nicht angewendet/i)).toBeInTheDocument();
  });

  it('admin kann einen pending-Draft genehmigen', async () => {
    setConfig([{ id: 'd2', capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', value: { maxChildren: 9 }, status: 'pending_approval', version: 2, revision: 1, createdBy: 'eng', createdAt: '', updatedAt: '' }]);
    mock.decideDraft.mockResolvedValue({ data: { id: 'd2', status: 'approved' } });
    await renderAndOpenDetail();
    fireEvent.click(screen.getByRole('button', { name: /^Genehmigen$/i }));
    await waitFor(() => expect(mock.decideDraft).toHaveBeenCalledWith('correlation-worker', 'd2', { decision: 'approved', expectedVersion: 2, note: '' }));
  });
});

describe('CorrelatorsPage — Validierung + Apply-Plan (Stufe 1, kein Apply)', () => {
  const DRAFT = { id: 'd-v', capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', value: { maxChildren: 9 }, status: 'draft', version: 1, revision: 1, createdBy: 'eng', createdAt: '', updatedAt: '' };

  it('separater Validieren-Schritt zeigt das Ergebnis, ohne zu mutieren', async () => {
    setConfig([DRAFT]);
    mock.validateDraft.mockResolvedValue({ data: { draftId: 'd-v', capabilityId: 'correlator.worker.maxChildren', valid: true, value: { maxChildren: 9 }, errors: [] } });
    await renderAndOpenDetail();
    fireEvent.click(screen.getByRole('button', { name: /^Validieren$/i }));
    await waitFor(() => expect(mock.validateDraft).toHaveBeenCalledWith('correlation-worker', 'd-v'));
    expect(await screen.findByText(/Validierung erfolgreich/i)).toBeInTheDocument();
    expect(mock.getConfig).toHaveBeenCalledTimes(1); // kein Reload → nicht-mutierend
  });

  it('Apply-Plan-Vorschau zeigt wouldApply:false + „nichts angewendet"', async () => {
    setConfig([DRAFT]);
    mock.getPlan.mockResolvedValue({ data: {
      draftId: 'd-v', draftStatus: 'draft', capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker',
      applyImpact: 'reload', applyStatus: 'not_supported', applyEligible: true, wouldApply: false,
      before: { maxChildren: 200 }, after: { maxChildren: 9 },
      changes: [{ key: 'maxChildren', before: 200, after: 9 }], unchanged: [], note: 'Vorschau.', generatedAt: '',
    } });
    await renderAndOpenDetail();
    fireEvent.click(screen.getByRole('button', { name: /Apply-Plan anzeigen/i }));
    await waitFor(() => expect(mock.getPlan).toHaveBeenCalledWith('correlation-worker', 'd-v'));
    expect(await screen.findByText(/wouldApply: false/i)).toBeInTheDocument();
    expect(screen.getByText(/es wird nichts angewendet/i)).toBeInTheDocument();
    expect(screen.getByText(/Apply-fähig \(später\)/i)).toBeInTheDocument();
  });
});

describe('CorrelatorsPage — RBAC-Sicht', () => {
  it('Analyst sieht keine administrativen Draft-Aktionen', async () => {
    currentRole = 'analyst';
    setConfig([{ id: 'd3', capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', value: { maxChildren: 9 }, status: 'pending_approval', version: 2, revision: 1, createdBy: 'eng', createdAt: '', updatedAt: '' }]);
    await renderAndOpenDetail();
    expect(screen.queryByRole('button', { name: /Draft anlegen/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Genehmigen$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Zur Genehmigung einreichen/i })).toBeNull();
  });
});
