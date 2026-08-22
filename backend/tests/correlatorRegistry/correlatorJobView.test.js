'use strict';

// P_CORR_ADMIN_1 — reine Präsentationslogik für Job-/Result-/Queue-Sichten.
// Leitet `superseded` aus (failed + Prefix) ab, redigiert Rohinhalte/Stack,
// gibt nur sichere Zusammenfassungen aus. Keine DB, kein HTTP — voll testbar.

const {
  PRESENTATION_STATUS, presentationStatusOf, toJobSummary, toResultSummary, summarizeQueue,
} = require('../../src/correlatorRegistry/correlatorJobView');

describe('presentationStatusOf', () => {
  test('failed + superseded-Prefix → superseded (nicht pauschaler Fehler)', () => {
    expect(presentationStatusOf({ status: 'failed', failureReason: 'superseded: source_revision geändert (a → b)' }))
      .toBe(PRESENTATION_STATUS.SUPERSEDED);
  });
  test('failed ohne Prefix → failed', () => {
    expect(presentationStatusOf({ status: 'failed', failureReason: 'Ticket nicht gefunden' }))
      .toBe(PRESENTATION_STATUS.FAILED);
  });
  test('aktive + completed Status werden unverändert durchgereicht', () => {
    expect(presentationStatusOf({ status: 'pending' })).toBe('pending');
    expect(presentationStatusOf({ status: 'running' })).toBe('running');
    expect(presentationStatusOf({ status: 'retrying' })).toBe('retrying');
    expect(presentationStatusOf({ status: 'completed' })).toBe('completed');
  });
});

describe('toJobSummary — sichere Felder, kein Stack/Rohinhalt', () => {
  const baseJob = {
    id: 'J1', ticketId: 'INC0001', inputHash: 'abc123', sourceRevision: 'rev-1',
    engineVersion: 'ce-1', status: 'completed', retryCount: 0, failureReason: null,
    resultReference: 'R1', createdAt: '2026-06-22T00:00:00.000Z',
    startedAt: '2026-06-22T00:00:01.000Z', completedAt: '2026-06-22T00:00:02.000Z',
  };

  test('liefert Traceability-Felder (ticket, revision, engine, inputHash, resultRef)', () => {
    const s = toJobSummary(baseJob);
    expect(s).toMatchObject({
      id: 'J1', ticketId: 'INC0001', inputHash: 'abc123', sourceRevision: 'rev-1',
      engineVersion: 'ce-1', presentationStatus: 'completed', resultReference: 'R1',
    });
  });

  test('superseded-Job wird als superseded markiert (superseded:true)', () => {
    const s = toJobSummary({ ...baseJob, status: 'failed', failureReason: 'superseded: a → b', resultReference: null });
    expect(s.presentationStatus).toBe('superseded');
    expect(s.superseded).toBe(true);
  });

  test('failureSummary redigiert gefährliche/zu lange Inhalte', () => {
    const nasty = 'Error: at /srv/app/x.js:42\n\tTRACE'.repeat(20);
    const s = toJobSummary({ ...baseJob, status: 'failed', failureReason: nasty });
    expect(s.failureSummary.length).toBeLessThanOrEqual(160);
    expect(s.failureSummary).not.toContain('\n');
  });

  test('exportiert KEIN failureReason-Rohfeld und keine unerwarteten Felder', () => {
    const s = toJobSummary({ ...baseJob, secretField: 'do-not-leak' });
    expect(s).not.toHaveProperty('failureReason');
    expect(s).not.toHaveProperty('secretField');
  });
});

describe('toResultSummary — nur Meta, KEIN Roh-Result-Payload', () => {
  const result = {
    id: 'R1', ticketId: 'INC0001', jobId: 'J1', inputHash: 'h', sourceRevision: 'rev-1',
    engineVersion: 'ce-1', createdAt: '2026-06-22T00:00:00.000Z',
    evidenceRefs: [{ ticketId: 'INC0001', role: 'subject' }, { ticketId: 'INC0002', role: 'child' }],
    result: {
      id: 'INC0001', type: 'network',
      source: { ip: '10.0.0.5' }, payload: { secret: 'should-never-appear' },
      correlation: { eventCount: 2, sources: [{ source: 'Wazuh', count: 1 }, { source: 'QRadar', count: 1 }] },
    },
  };

  test('gibt korrelations-Meta (eventCount/sources) + evidenceRefCount aus', () => {
    const s = toResultSummary(result);
    expect(s.eventCount).toBe(2);
    expect(s.sources).toEqual([{ source: 'Wazuh', count: 1 }, { source: 'QRadar', count: 1 }]);
    expect(s.evidenceRefCount).toBe(2);
  });

  test('enthält NIEMALS das rohe result-Payload', () => {
    const s = toResultSummary(result);
    expect(JSON.stringify(s)).not.toContain('should-never-appear');
    expect(s).not.toHaveProperty('result');
    expect(s).not.toHaveProperty('payload');
  });

  test('robust gegen fehlende correlation-Meta', () => {
    const s = toResultSummary({ ...result, result: { id: 'x' } });
    expect(s.eventCount).toBe(0);
    expect(s.sources).toEqual([]);
  });
});

describe('summarizeQueue', () => {
  test('aggregiert aktive/terminale Zähler + leitet superseded aus failed ab', () => {
    const q = summarizeQueue({
      counts: { pending: 2, running: 1, retrying: 1, completed: 5, failed: 3 },
      supersededCount: 2,
    });
    expect(q.active).toBe(4);        // pending+running+retrying
    expect(q.completed).toBe(5);
    expect(q.superseded).toBe(2);
    expect(q.failed).toBe(1);        // 3 db-failed minus 2 superseded = 1 echter Fehler
    expect(q.total).toBe(12);
  });

  test('superseded überschreitet failed nie (clamp ≥ 0)', () => {
    const q = summarizeQueue({ counts: { failed: 1 }, supersededCount: 5 });
    expect(q.failed).toBe(0);
    expect(q.superseded).toBe(5);
  });
});
