import { describe, test, expect } from 'vitest';
import { collectEvidenceFeedback, collectEvidenceErrorFeedback } from './collectEvidenceFeedback';

describe('collectEvidenceFeedback', () => {
  test('Erfolg mit mehreren Artefakten', () => {
    const fb = collectEvidenceFeedback({ ok: true, collected: 3 });
    expect(fb.tone).toBe('success');
    expect(fb.message).toContain('3 Endpoint-Artefakte');
  });

  test('Erfolg mit genau einem Artefakt (Singular)', () => {
    const fb = collectEvidenceFeedback({ ok: true, collected: 1 });
    expect(fb.tone).toBe('success');
    expect(fb.message).toContain('1 Endpoint-Artefakt ');
  });

  test('Erfolg ohne neue Artefakte', () => {
    const fb = collectEvidenceFeedback({ ok: true, collected: 0 });
    expect(fb.tone).toBe('success');
    expect(fb.message).toContain('keine neuen Artefakte');
  });

  test('ok:false ohne collected → 0 behandelt als Erfolg-Fall nur bei ok:true', () => {
    const fb = collectEvidenceFeedback({ ok: false, reason: 'wazuh_disabled' });
    expect(fb.tone).toBe('warning');
    expect(fb.message).toContain('Wazuh-API ist nicht konfiguriert');
  });

  test('no_agent_id → Warnung', () => {
    expect(collectEvidenceFeedback({ ok: false, reason: 'no_agent_id' }).tone).toBe('warning');
  });

  test('wazuh_unavailable → Fehler', () => {
    expect(collectEvidenceFeedback({ ok: false, reason: 'wazuh_unavailable' }).tone).toBe('error');
  });

  test('unbekannter Grund → generischer Fallback', () => {
    const fb = collectEvidenceFeedback({ ok: false, reason: 'something_else' });
    expect(fb.tone).toBe('warning');
    expect(fb.message).toBe('Endpoint-Sammlung nicht möglich.');
  });

  test('ok:false ganz ohne Grund → Fallback', () => {
    const fb = collectEvidenceFeedback({ ok: false });
    expect(fb.tone).toBe('warning');
    expect(fb.message).toBe('Endpoint-Sammlung nicht möglich.');
  });
});

describe('collectEvidenceErrorFeedback', () => {
  test('Error-Objekt wird übernommen', () => {
    const fb = collectEvidenceErrorFeedback(new Error('HTTP 503'));
    expect(fb.tone).toBe('error');
    expect(fb.message).toContain('HTTP 503');
  });

  test('Nicht-Error-Wert → generisch', () => {
    const fb = collectEvidenceErrorFeedback('boom');
    expect(fb.tone).toBe('error');
    expect(fb.message).toContain('Unbekannter Fehler');
  });
});
