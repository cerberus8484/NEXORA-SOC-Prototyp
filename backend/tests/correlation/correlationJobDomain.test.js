'use strict';

const {
  CorrelationJob, CorrelationResult, CORRELATION_STATUS, CORRELATION_ENGINE_VERSION,
  MAX_RESULT_EVIDENCE, computeInputHash, normalizeEvidenceRef,
} = require('../../src/correlation/correlationJobDomain');

describe('computeInputHash (Idempotenz-Schlüssel)', () => {
  test('gleiche Eingabe → gleicher Hash (deterministisch)', () => {
    const a = computeInputHash({ ticketId: 'T-1', sourceRevision: '2026-06-21T00:00:00Z' });
    const b = computeInputHash({ ticketId: 'T-1', sourceRevision: '2026-06-21T00:00:00Z' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  test('andere Revision → anderer Hash', () => {
    const a = computeInputHash({ ticketId: 'T-1', sourceRevision: 'rev-1' });
    const b = computeInputHash({ ticketId: 'T-1', sourceRevision: 'rev-2' });
    expect(a).not.toBe(b);
  });

  test('andere Engine-Version → anderer Hash (alte Ergebnisse werden neu berechnet)', () => {
    const a = computeInputHash({ ticketId: 'T-1', sourceRevision: 'rev', engineVersion: 'ce-1' });
    const b = computeInputHash({ ticketId: 'T-1', sourceRevision: 'rev', engineVersion: 'ce-2' });
    expect(a).not.toBe(b);
  });

  test('fehlende Pflichtteile werfen', () => {
    expect(() => computeInputHash({ sourceRevision: 'r' })).toThrow(/ticketId/);
    expect(() => computeInputHash({ ticketId: 'T' })).toThrow(/sourceRevision/);
  });
});

describe('CorrelationJob.create', () => {
  test('legt einen pending-Job mit berechnetem inputHash an', () => {
    const job = CorrelationJob.create({ ticketId: 'T-1', sourceRevision: 'rev-1' });
    expect(job.status).toBe(CORRELATION_STATUS.PENDING);
    expect(job.retryCount).toBe(0);
    expect(job.engineVersion).toBe(CORRELATION_ENGINE_VERSION);
    expect(job.inputHash).toBe(computeInputHash({ ticketId: 'T-1', sourceRevision: 'rev-1' }));
    expect(job.createdAt).toEqual(expect.any(String));
  });

  test('zwei Jobs mit gleichem Input haben denselben inputHash (Idempotenz-Grundlage)', () => {
    const a = CorrelationJob.create({ ticketId: 'T-9', sourceRevision: 'rev-x' });
    const b = CorrelationJob.create({ ticketId: 'T-9', sourceRevision: 'rev-x' });
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.id).not.toBe(b.id); // eigene Identität, gleicher Idempotenz-Schlüssel
  });

  test('ohne ticketId/sourceRevision → Fehler', () => {
    expect(() => CorrelationJob.create({ sourceRevision: 'r' })).toThrow(/ticketId/);
    expect(() => CorrelationJob.create({ ticketId: 'T' })).toThrow(/sourceRevision/);
  });
});

describe('CorrelationJob — Status-Lebenszyklus', () => {
  const fresh = () => CorrelationJob.create({ ticketId: 'T-1', sourceRevision: 'rev' });

  test('pending → running → completed (mit resultReference)', () => {
    const job = fresh();
    job.start();
    expect(job.status).toBe(CORRELATION_STATUS.RUNNING);
    expect(job.startedAt).toEqual(expect.any(String));
    job.complete('result-123');
    expect(job.status).toBe(CORRELATION_STATUS.COMPLETED);
    expect(job.resultReference).toBe('result-123');
    expect(job.completedAt).toEqual(expect.any(String));
    expect(job.isTerminal()).toBe(true);
  });

  test('running → retrying → running (retryCount steigt, Grund sichtbar)', () => {
    const job = fresh();
    job.start();
    job.retry('Timeout beim Inventory-Lookup');
    expect(job.status).toBe(CORRELATION_STATUS.RETRYING);
    expect(job.retryCount).toBe(1);
    expect(job.failureReason).toMatch(/Timeout/);
    job.start();
    expect(job.status).toBe(CORRELATION_STATUS.RUNNING);
  });

  test('running → failed ist terminal + Grund sichtbar', () => {
    const job = fresh();
    job.start();
    job.fail('Engine-Fehler');
    expect(job.status).toBe(CORRELATION_STATUS.FAILED);
    expect(job.failureReason).toBe('Engine-Fehler');
    expect(job.isTerminal()).toBe(true);
  });

  test('retrying → failed erlaubt (Retries erschöpft)', () => {
    const job = fresh();
    job.start();
    job.retry('x');
    job.fail('erschöpft');
    expect(job.status).toBe(CORRELATION_STATUS.FAILED);
  });

  test('ungültige Übergänge werfen (kein stiller Fehlzustand)', () => {
    const job = fresh();
    expect(() => job.complete('r')).toThrow(/Statuswechsel/); // pending → completed
    job.start();
    job.complete('r');
    expect(() => job.start()).toThrow(/Statuswechsel/);        // completed → running
    expect(() => job.retry()).toThrow(/Statuswechsel/);        // completed → retrying
  });

  test('complete ohne resultReference wirft', () => {
    const job = fresh();
    job.start();
    expect(() => job.complete()).toThrow(/resultReference/);
  });
});

describe('CorrelationResult', () => {
  test('verlangt ticketId + inputHash und normalisiert Evidence-Rückverweise', () => {
    const res = new CorrelationResult({
      ticketId: 'T-1', jobId: 'J-1', inputHash: 'h', sourceRevision: 'rev',
      result: { merged: true },
      evidenceRefs: [
        { ticketId: 'T-1', role: 'subject' },
        { ticketId: 'T-2', role: 'child', evidenceId: 'E-9' },
        { ticketId: 'T-3', role: 'bogus' }, // ungültige Rolle → 'child'
      ],
    });
    expect(res.evidenceRefs).toHaveLength(3);
    expect(res.evidenceRefs[0]).toEqual({ ticketId: 'T-1', role: 'subject', evidenceId: null });
    expect(res.evidenceRefs[1].evidenceId).toBe('E-9');
    expect(res.evidenceRefs[2].role).toBe('child');
    expect(res.toJSON().result).toEqual({ merged: true });
  });

  test('ohne ticketId/inputHash → Fehler', () => {
    expect(() => new CorrelationResult({ inputHash: 'h' })).toThrow(/ticketId/);
    expect(() => new CorrelationResult({ ticketId: 'T' })).toThrow(/inputHash/);
  });

  test('zu viele Evidence-Referenzen → Fehler (kein unbounded Persist)', () => {
    const refs = Array.from({ length: MAX_RESULT_EVIDENCE + 1 }, (_, i) => ({ ticketId: `T-${i}`, role: 'child' }));
    expect(() => new CorrelationResult({ ticketId: 'T', inputHash: 'h', evidenceRefs: refs })).toThrow(/zu viele/);
  });
});

describe('normalizeEvidenceRef', () => {
  test('ohne ticketId wirft', () => {
    expect(() => normalizeEvidenceRef({ role: 'child' })).toThrow(/ticketId/);
  });
});
