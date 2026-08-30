import { describe, it, expect } from 'vitest';
import { deriveKiFp, latestSuggestion, type AgentSuggestion } from './agentApi';

const base: AgentSuggestion = {
  id: 's1', ticketId: 't1', kind: 'triage', proposal: 'p', rationale: 'rat',
  verdict: 'suspicious', confidence: 50, status: 'pending', model: 'llama3.2:3b',
  reviewedBy: null, reviewReason: '', reviewedAt: null, createdAt: '2026-06-14T10:00:00Z', analysis: null,
};

describe('deriveKiFp', () => {
  it('null ohne Vorschlag oder ohne Verdict', () => {
    expect(deriveKiFp(null)).toBeNull();
    expect(deriveKiFp({ ...base, verdict: '', analysis: null })).toBeNull();
  });

  it('isFp=true bei verdict false_positive, Reason aus falsePositivePossibility', () => {
    const s: AgentSuggestion = {
      ...base, verdict: 'false_positive',
      analysis: { entities: {}, iocs: [], verdict: 'false_positive', confidence: 88,
        confirmedFacts: [], suspiciousIndicators: [], missingEvidence: [], recommendedActions: [], mitreAttack: [],
        falsePositivePossibility: { possible: true, reason: 'ClamAV-Selbstfehler, kein Fund' } },
    };
    const r = deriveKiFp(s)!;
    expect(r.isFp).toBe(true);
    expect(r.reason).toBe('ClamAV-Selbstfehler, kein Fund');
    expect(r.confidence).toBe(88); // analysis hat Vorrang
  });

  it('analysis-Verdict hat Vorrang vor Top-Level; isFp=false bei suspicious', () => {
    const s: AgentSuggestion = { ...base, verdict: 'false_positive',
      analysis: { entities: {}, iocs: [], verdict: 'suspicious', confidence: 60,
        confirmedFacts: [], suspiciousIndicators: [], missingEvidence: [], recommendedActions: [], mitreAttack: [], assessment: 'verdächtig' } };
    const r = deriveKiFp(s)!;
    expect(r.verdict).toBe('suspicious');
    expect(r.isFp).toBe(false);
    expect(r.reason).toBe('verdächtig'); // Fallback auf assessment
  });

  it('Fallback auf rationale ohne analysis', () => {
    const r = deriveKiFp({ ...base, verdict: 'false_positive' })!;
    expect(r.isFp).toBe(true);
    expect(r.reason).toBe('rat');
    expect(r.confidence).toBe(50);
  });
});

describe('latestSuggestion', () => {
  it('null bei leerer Liste', () => {
    expect(latestSuggestion([])).toBeNull();
  });
  it('jüngster nach createdAt', () => {
    const older = { ...base, id: 'old', createdAt: '2026-06-14T09:00:00Z' };
    const newer = { ...base, id: 'new', createdAt: '2026-06-14T11:00:00Z' };
    expect(latestSuggestion([older, newer])!.id).toBe('new');
    expect(latestSuggestion([newer, older])!.id).toBe('new');
  });
});
