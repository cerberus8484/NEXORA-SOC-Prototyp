import { describe, it, expect } from 'vitest';
import { formatBulkDeleteResult } from './bulkDeleteModel';

describe('formatBulkDeleteResult', () => {
  it('alles gelöscht → ok-Ton, nennt Anzahl', () => {
    const n = formatBulkDeleteResult({ requested: 3, deleted: 3, missing: 0, deletedIds: ['a', 'b', 'c'] });
    expect(n.tone).toBe('ok');
    expect(n.text).toContain('3 Tickets gelöscht');
  });

  it('ein Ticket → Singular', () => {
    const n = formatBulkDeleteResult({ requested: 1, deleted: 1, missing: 0, deletedIds: ['a'] });
    expect(n.text).toBe('1 Ticket gelöscht.');
  });

  it('teilweise gelöscht → warn-Ton, trennt gelöscht und nicht gefunden', () => {
    const n = formatBulkDeleteResult({ requested: 3, deleted: 2, missing: 1, deletedIds: ['a', 'b'] });
    expect(n.tone).toBe('warn');
    expect(n.text).toContain('2 von 3 gelöscht');
    expect(n.text).toContain('1 nicht gefunden');
  });

  it('nichts gelöscht → warn-Ton, KEIN Erfolgswording', () => {
    const n = formatBulkDeleteResult({ requested: 2, deleted: 0, missing: 2, deletedIds: [] });
    expect(n.tone).toBe('warn');
    expect(n.text).toContain('Kein Ticket gelöscht');
    expect(n.text).not.toMatch(/erfolg/i);
  });
});
