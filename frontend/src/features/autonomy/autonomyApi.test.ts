// Vertrags-Tests für autonomyApi — prüfen Pfade, Verben und Body-Vertrag.
// Kein Buffer, kein @types/node (Web-Build-Constraint).

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: 'ok' });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import {
  autonomyApi,
  isCeilingViolation,
  ACTION_CLASS_CEILINGS,
} from './autonomyApi';

const mGet  = api.get  as ReturnType<typeof vi.fn>;
const mPost = api.post as ReturnType<typeof vi.fn>;
const mPut  = api.put  as ReturnType<typeof vi.fn>;
const mDel  = api.del  as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getStatus ──────────────────────────────────────────────────────────────

describe('autonomyApi.getStatus', () => {
  test('trifft GET /autonomy-policies/status ohne Body', () => {
    autonomyApi.getStatus();
    expect(mGet).toHaveBeenCalledWith('/autonomy-policies/status', undefined, undefined);
  });

  test('leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    autonomyApi.getStatus({ signal: ctrl.signal });
    expect(mGet).toHaveBeenCalledWith('/autonomy-policies/status', undefined, { signal: ctrl.signal });
  });
});

// ── listPolicies ───────────────────────────────────────────────────────────

describe('autonomyApi.listPolicies', () => {
  test('trifft GET /autonomy-policies ohne Query', () => {
    autonomyApi.listPolicies();
    expect(mGet).toHaveBeenCalledWith('/autonomy-policies', undefined, undefined);
  });

  test('leitet customer-Filter als Query weiter', () => {
    autonomyApi.listPolicies({ customer: 'acme' });
    expect(mGet).toHaveBeenCalledWith('/autonomy-policies', { customer: 'acme' }, undefined);
  });

  test('leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    autonomyApi.listPolicies(undefined, { signal: ctrl.signal });
    expect(mGet).toHaveBeenCalledWith('/autonomy-policies', undefined, { signal: ctrl.signal });
  });
});

// ── getPolicy ─────────────────────────────────────────────────────────────

describe('autonomyApi.getPolicy', () => {
  test('trifft GET /autonomy-policies/:id', () => {
    autonomyApi.getPolicy('pol-1');
    expect(mGet).toHaveBeenCalledWith('/autonomy-policies/pol-1', undefined, undefined);
  });
});

// ── createPolicy ──────────────────────────────────────────────────────────

describe('autonomyApi.createPolicy', () => {
  test('trifft POST /autonomy-policies mit vollständigem Body', () => {
    const body = {
      customer: '*',
      actionClass: 'enrichment' as const,
      mode: 'advisory' as const,
      minVerdict: 'suspicious' as const,
      minConfidence: 0.8,
      requireEvidenceFloor: true,
      maxPerHour: 0,
      enabled: false,
    };
    autonomyApi.createPolicy(body);
    expect(mPost).toHaveBeenCalledWith('/autonomy-policies', body);
  });

  test('trifft POST auch mit minimalem Body (fehlende Felder landen beim Backend)', () => {
    autonomyApi.createPolicy({ customer: 'contoso', actionClass: 'draft_generation', mode: 'autonomous', minVerdict: 'confirmed_incident', minConfidence: 0.9, requireEvidenceFloor: true, maxPerHour: 10, enabled: true });
    expect(mPost).toHaveBeenCalledTimes(1);
    const [path] = mPost.mock.calls[0] as [string, ...unknown[]];
    expect(path).toBe('/autonomy-policies');
  });
});

// ── updatePolicy ──────────────────────────────────────────────────────────

describe('autonomyApi.updatePolicy', () => {
  test('trifft PUT /autonomy-policies/:id mit Patch-Body', () => {
    autonomyApi.updatePolicy('pol-42', { enabled: true, maxPerHour: 5 });
    expect(mPut).toHaveBeenCalledWith('/autonomy-policies/pol-42', { enabled: true, maxPerHour: 5 });
  });

  test('leitet mode-Änderung weiter', () => {
    autonomyApi.updatePolicy('pol-7', { mode: 'assisted' });
    expect(mPut).toHaveBeenCalledWith('/autonomy-policies/pol-7', { mode: 'assisted' });
  });
});

// ── deletePolicy ──────────────────────────────────────────────────────────

describe('autonomyApi.deletePolicy', () => {
  test('trifft DELETE /autonomy-policies/:id', () => {
    autonomyApi.deletePolicy('pol-99');
    expect(mDel).toHaveBeenCalledWith('/autonomy-policies/pol-99');
  });
});

// ── isCeilingViolation (reine Logik — keine API) ──────────────────────────

describe('isCeilingViolation', () => {
  test('detection_write + autonomous ist Ceiling-Verletzung', () => {
    expect(isCeilingViolation('detection_write', 'autonomous')).toBe(true);
  });

  test('detection_write + assisted ist KEINE Verletzung (max assisted)', () => {
    expect(isCeilingViolation('detection_write', 'assisted')).toBe(false);
  });

  test('host_response + assisted ist Ceiling-Verletzung (human-only)', () => {
    expect(isCeilingViolation('host_response', 'assisted')).toBe(true);
  });

  test('host_response + advisory ist KEINE Verletzung', () => {
    expect(isCeilingViolation('host_response', 'advisory')).toBe(false);
  });

  test('external_comms + autonomous ist Ceiling-Verletzung', () => {
    expect(isCeilingViolation('external_comms', 'autonomous')).toBe(true);
  });

  test('enrichment + autonomous ist KEINE Verletzung', () => {
    expect(isCeilingViolation('enrichment', 'autonomous')).toBe(false);
  });

  test('internal_state + autonomous ist KEINE Verletzung', () => {
    expect(isCeilingViolation('internal_state', 'autonomous')).toBe(false);
  });

  test('draft_generation + autonomous ist KEINE Verletzung', () => {
    expect(isCeilingViolation('draft_generation', 'autonomous')).toBe(false);
  });

  // Alle human-only Klassen: Decke = advisory (mode > advisory immer Verletzung)
  test('external_comms + assisted ist auch Ceiling-Verletzung', () => {
    expect(isCeilingViolation('external_comms', 'assisted')).toBe(true);
  });
});

// ── ACTION_CLASS_CEILINGS — Export verifizieren ───────────────────────────

describe('ACTION_CLASS_CEILINGS', () => {
  test('Decken entsprechen ADR-016-Taxonomie', () => {
    expect(ACTION_CLASS_CEILINGS['enrichment']).toBe('autonomous');
    expect(ACTION_CLASS_CEILINGS['internal_state']).toBe('autonomous');
    expect(ACTION_CLASS_CEILINGS['draft_generation']).toBe('autonomous');
    expect(ACTION_CLASS_CEILINGS['detection_write']).toBe('assisted');
    expect(ACTION_CLASS_CEILINGS['host_response']).toBe('advisory');
    expect(ACTION_CLASS_CEILINGS['external_comms']).toBe('advisory');
  });
});
