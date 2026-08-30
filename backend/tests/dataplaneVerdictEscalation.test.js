'use strict';

const { shouldEscalate, PRIORITY_RANK } = require('../src/integrations/adapters/dataplane/verdictEscalation');

describe('shouldEscalate — Cross-Domain-Verdikt-Anstieg', () => {
  test('Severity steigt (info → high) → escalate', () => {
    expect(shouldEscalate({ priority: 'info', decision: '' }, { priority: 'high', decision: 'suspicious' })).toBe(true);
  });

  test('Decision steigt bei gleicher Severity (observed → suspicious) → escalate', () => {
    expect(shouldEscalate({ priority: 'medium', decision: '' }, { priority: 'medium', decision: 'suspicious' })).toBe(true);
  });

  test('gleiches/niedrigeres Verdikt → kein Update (kein Downgrade)', () => {
    expect(shouldEscalate({ priority: 'high', decision: 'suspicious' }, { priority: 'high', decision: 'suspicious' })).toBe(false);
    expect(shouldEscalate({ priority: 'high', decision: 'suspicious' }, { priority: 'info', decision: '' })).toBe(false);
  });

  test('confirmed_malicious (incident) über suspicious → escalate', () => {
    expect(shouldEscalate({ priority: 'high', decision: 'suspicious' }, { priority: 'critical', decision: 'incident' })).toBe(true);
  });

  test('Analyst-Endurteil (benign/fp) wird NICHT automatisch überschrieben', () => {
    expect(shouldEscalate({ priority: 'info', decision: 'benign' }, { priority: 'critical', decision: 'incident' })).toBe(false);
    expect(shouldEscalate({ priority: 'info', decision: 'fp' }, { priority: 'high', decision: 'suspicious' })).toBe(false);
  });

  test('PRIORITY_RANK ist monoton', () => {
    expect(PRIORITY_RANK.info).toBeLessThan(PRIORITY_RANK.medium);
    expect(PRIORITY_RANK.high).toBeLessThan(PRIORITY_RANK.critical);
  });
});
