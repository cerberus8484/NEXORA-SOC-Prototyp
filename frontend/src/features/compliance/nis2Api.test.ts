// Vertrags-Tests für nis2Api — Pfade, Verben, Body.
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: 'ok' });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { nis2Api, ASSESSMENT_STATUSES, EVIDENCE_TYPES } from './nis2Api';

const mGet = api.get as ReturnType<typeof vi.fn>;
const mPut = api.put as ReturnType<typeof vi.fn>;
const mPost = api.post as ReturnType<typeof vi.fn>;
const mDel = api.del as ReturnType<typeof vi.fn>;

beforeEach(() => { vi.clearAllMocks(); });

describe('nis2Api', () => {
  test('getControls → GET /nis2/controls', () => {
    nis2Api.getControls();
    expect(mGet).toHaveBeenCalledWith('/nis2/controls', undefined, undefined);
  });
  test('getControlDetail → GET /nis2/assessments/:key', () => {
    nis2Api.getControlDetail('incident_handling');
    expect(mGet).toHaveBeenCalledWith('/nis2/assessments/incident_handling', undefined, undefined);
  });
  test('updateAssessment → PUT /nis2/assessments/:key mit Body', () => {
    nis2Api.updateAssessment('incident_handling', { status: 'in_progress', owner: 'X' });
    expect(mPut).toHaveBeenCalledWith('/nis2/assessments/incident_handling', { status: 'in_progress', owner: 'X' });
  });
  test('addEvidence → POST /nis2/assessments/:key/evidence', () => {
    nis2Api.addEvidence('incident_handling', { evidenceType: 'ticket', evidenceRef: 'INC1', title: 'T' });
    expect(mPost).toHaveBeenCalledWith('/nis2/assessments/incident_handling/evidence', { evidenceType: 'ticket', evidenceRef: 'INC1', title: 'T' });
  });
  test('removeEvidence → DELETE /nis2/evidence/:id', () => {
    nis2Api.removeEvidence('ev-1');
    expect(mDel).toHaveBeenCalledWith('/nis2/evidence/ev-1');
  });
  test('Allowed-Listen spiegeln das Backend', () => {
    expect(ASSESSMENT_STATUSES).toContain('addressed');
    expect(ASSESSMENT_STATUSES).toHaveLength(6);
    expect(EVIDENCE_TYPES).toContain('gitops_profile');
    expect(EVIDENCE_TYPES).toHaveLength(8);
  });
});

// P_NIS2_2 — Management-Report + Incident-Evidence-Verlinkung.
describe('nis2Api — P_NIS2_2', () => {
  test('getManagementReport → GET /nis2/report ohne opts', () => {
    nis2Api.getManagementReport();
    expect(mGet).toHaveBeenCalledWith('/nis2/report', undefined, undefined);
  });

  test('getManagementReport → leitet AbortSignal weiter', () => {
    const signal = new AbortController().signal;
    nis2Api.getManagementReport({ signal });
    expect(mGet).toHaveBeenCalledWith('/nis2/report', undefined, { signal });
  });

  test('linkIncident → POST /nis2/controls/:key/incident-evidence mit ticketId', () => {
    nis2Api.linkIncident('incident_handling', 'INC000042');
    expect(mPost).toHaveBeenCalledWith(
      '/nis2/controls/incident_handling/incident-evidence',
      { ticketId: 'INC000042' },
    );
  });

  test('linkIncident kodiert den controlKey korrekt in den Pfad', () => {
    nis2Api.linkIncident('supply_chain_security', 'INC999');
    expect(mPost).toHaveBeenCalledWith(
      '/nis2/controls/supply_chain_security/incident-evidence',
      { ticketId: 'INC999' },
    );
  });
});
