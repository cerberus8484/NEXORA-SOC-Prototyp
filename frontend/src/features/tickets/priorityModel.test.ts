import { describe, it, expect } from 'vitest';
import { markImportantPriority } from './priorityModel';

describe('markImportantPriority', () => {
  it('hebt niedrigere Prioritäten auf "high"', () => {
    expect(markImportantPriority('info')).toBe('high');
    expect(markImportantPriority('low')).toBe('high');
    expect(markImportantPriority('medium')).toBe('high');
  });

  it('lässt "high" auf "high"', () => {
    expect(markImportantPriority('high')).toBe('high');
  });

  it('stuft "critical" NICHT herab', () => {
    expect(markImportantPriority('critical')).toBe('critical');
  });

  it('behandelt unbekannte Werte als "high"', () => {
    expect(markImportantPriority('')).toBe('high');
    expect(markImportantPriority('bogus')).toBe('high');
  });
});
