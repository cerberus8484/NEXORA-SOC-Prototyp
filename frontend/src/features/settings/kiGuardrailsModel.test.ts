import { describe, test, expect } from 'vitest';
import { formatLatency, formatCostUsd, formatTokens, errorRatePct } from './kiGuardrailsModel';

describe('formatLatency', () => {
  test('ms unter 1s', () => expect(formatLatency(850)).toBe('850 ms'));
  test('sekunden ab 1s', () => expect(formatLatency(14230)).toBe('14.2 s'));
  test('0 oder ungültig → Platzhalter', () => {
    expect(formatLatency(0)).toBe('—');
    expect(formatLatency(NaN)).toBe('—');
  });
});

describe('formatCostUsd', () => {
  test('0 → $0.00', () => expect(formatCostUsd(0)).toBe('$0.00'));
  test('winzig → < $0.01', () => expect(formatCostUsd(0.003)).toBe('< $0.01'));
  test('normal → 2 Nachkommastellen', () => expect(formatCostUsd(1.234)).toBe('$1.23'));
});

describe('formatTokens', () => {
  test('unter 1000 roh', () => expect(formatTokens(999)).toBe('999'));
  test('ab 1000 in k', () => expect(formatTokens(1234)).toBe('1.2k'));
  test('0', () => expect(formatTokens(0)).toBe('0'));
});

describe('errorRatePct', () => {
  test('rechnet Prozent', () => expect(errorRatePct(40, 2)).toBe(5));
  test('0 Calls → 0', () => expect(errorRatePct(0, 0)).toBe(0));
});
