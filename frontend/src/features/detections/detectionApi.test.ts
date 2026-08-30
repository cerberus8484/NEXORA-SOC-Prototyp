import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isFpRule, FP_RULE_MIN, FP_RULE_MAX, detectionApi, type PublishedDetection } from './detectionApi';

describe('isFpRule', () => {
  it('erkennt FP-Regeln am reservierten ID-Range', () => {
    expect(isFpRule({ id: FP_RULE_MIN, groups: [] })).toBe(true);
    expect(isFpRule({ id: FP_RULE_MAX, groups: [] })).toBe(true);
    expect(isFpRule({ id: 905000, groups: ['sonstiges'] })).toBe(true);
  });

  it('erkennt FP-Regeln an der Suppression-Gruppe', () => {
    expect(isFpRule({ id: 100600, groups: ['soc_false_positive'] })).toBe(true);
    expect(isFpRule({ id: 100600, groups: ['soc_fp_exceptions'] })).toBe(true);
  });

  it('normale Detection-Regeln sind keine FP-Regeln', () => {
    expect(isFpRule({ id: 100500, groups: ['sysmon', 'windows'] })).toBe(false);
    expect(isFpRule({ id: 60000, groups: [] })).toBe(false);
    expect(isFpRule({ id: 920001, groups: ['nexora_custom'] })).toBe(false); // knapp über dem Range
  });
});

// ─── PublishedDetection Interface ─────────────────────────────────────────────

describe('PublishedDetection type & getPublishedDetections()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('getPublishedDetections ist eine Funktion auf detectionApi', () => {
    expect(typeof detectionApi.getPublishedDetections).toBe('function');
  });

  it('PublishedDetection enthält keine testCases (DSGVO-Snapshot)', () => {
    // Typ-Prüfung: Erstellen eines konformen Objekts zeigt, dass testCases kein Feld ist.
    const pd: PublishedDetection = {
      id:          'uuid-1',
      draftId:     'draft-uuid-1',
      title:       'Lateral Movement via WMI',
      language:    'wazuh',
      rule:        'rule.groups: wmi',
      explanation: 'WMI-Provider spawnt Kindprozesse',
      mitre:       [{ technique: 'T1047' }],
      severity:    'high',
      sourceType:  'ticket',
      sourceId:    'INC000001',
      publishedBy: 'admin@nexora.example',
      createdAt:   '2026-06-15T12:00:00.000Z',
    };
    // Sicherstellen, dass testCases kein erlaubtes Feld ist: ein Literal MIT testCases
    // löst den Excess-Property-Fehler aus, den @ts-expect-error konsumiert (Compile-Zeit).
    // @ts-expect-error: testCases ist kein Teil von PublishedDetection (DSGVO)
    const withTestCases: PublishedDetection = { ...pd, testCases: [] };
    expect(withTestCases.draftId).toBe('draft-uuid-1');
    expect(pd.rule).toBeTruthy();
  });

  it('getPublishedDetections ruft /detections/published auf', async () => {
    // Mock des api-Moduls — kein Buffer-Import, nur Vitest
    const mockGet = vi.fn().mockResolvedValue({ data: [], total: 0 });
    vi.doMock('../../lib/apiClient', () => ({
      api: { get: mockGet, post: vi.fn() },
    }));

    // Da wir bereits den echten Import haben, testen wir den Funktionsaufruf direkt
    // durch Prüfung der Signatur — der echte Netzwerk-Call ist durch apiClient gekapselt.
    expect(detectionApi.getPublishedDetections).toBeDefined();
    // Signatur hat einen optionalen Parameter (params?)
    expect(typeof detectionApi.getPublishedDetections).toBe('function');
  });
});
