'use strict';

const { AgentSuggestion } = require('../../src/domain/AgentSuggestion');

function make(over = {}) {
  return new AgentSuggestion({
    ticketId: 't1', kind: 'triage', proposal: 'Eskalieren', rationale: 'hohe Severity',
    confidence: 0.8, ...over,
  });
}

describe('AgentSuggestion — Konstruktion & Validierung', () => {
  it('startet im Status pending mit createdBy=agent', () => {
    const s = make();
    expect(s.status).toBe('pending');
    expect(s.createdBy).toBe('agent');
    expect(s.id).toBeDefined();
  });

  it('klemmt confidence auf [0,1]', () => {
    expect(make({ confidence: 2 }).confidence).toBe(1);
    expect(make({ confidence: -1 }).confidence).toBe(0);
  });

  it('isValid false bei unbekanntem kind', () => {
    expect(make({ kind: 'bogus' }).isValid()).toBe(false);
    expect(make().isValid()).toBe(true);
  });
});

describe('AgentSuggestion — Approval-Workflow', () => {
  it('approve() setzt status approved + reviewer + zeitstempel', () => {
    const s = make();
    s.approve('user-1');
    expect(s.status).toBe('approved');
    expect(s.reviewedBy).toBe('user-1');
    expect(s.reviewedAt).toBeTruthy();
  });

  it('reject() setzt status rejected + grund', () => {
    const s = make();
    s.reject('user-1', 'False Positive');
    expect(s.status).toBe('rejected');
    expect(s.reviewReason).toBe('False Positive');
  });

  it('approve() auf bereits beurteilter Suggestion wirft (409)', () => {
    const s = make();
    s.approve('user-1');
    expect(() => s.approve('user-2')).toThrow(/bereits/i);
  });

  it('reject() auf bereits beurteilter Suggestion wirft', () => {
    const s = make();
    s.reject('user-1', 'x');
    expect(() => s.reject('user-2', 'y')).toThrow(/bereits/i);
  });
});

describe('AgentSuggestion — isActionable', () => {
  it('nur approved UND über Schwelle ist actionable', () => {
    const s = make({ confidence: 0.9 });
    expect(s.isActionable(0.7)).toBe(false); // noch pending
    s.approve('u');
    expect(s.isActionable(0.7)).toBe(true);
    expect(s.isActionable(0.95)).toBe(false); // unter Schwelle
  });
});

describe('AgentSuggestion — neue Kinds (evidence_explanation / mitre_mapping / next_steps)', () => {
  it('isValid gibt true für evidence_explanation', () => {
    expect(make({ kind: 'evidence_explanation' }).isValid()).toBe(true);
  });

  it('isValid gibt true für mitre_mapping', () => {
    expect(make({ kind: 'mitre_mapping' }).isValid()).toBe(true);
  });

  it('isValid gibt true für next_steps', () => {
    expect(make({ kind: 'next_steps' }).isValid()).toBe(true);
  });

  it('KINDS enthält alle 3 neuen Kinds', () => {
    const { KINDS } = require('../../src/domain/AgentSuggestion');
    expect(KINDS).toContain('evidence_explanation');
    expect(KINDS).toContain('mitre_mapping');
    expect(KINDS).toContain('next_steps');
  });
});
