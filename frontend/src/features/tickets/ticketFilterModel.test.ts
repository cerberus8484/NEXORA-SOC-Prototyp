import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTERS, PAGE_SIZE,
  buildTicketListParams, hasActiveFilters,
  currentPage, totalPages,
  type TicketFilters,
} from './ticketFilterModel';

describe('buildTicketListParams', () => {
  it('lässt leere Filter weg und setzt Listen-Defaults', () => {
    const p = buildTicketListParams(DEFAULT_FILTERS, 'Max');
    expect(p).toEqual({
      state: 'OPEN', status: undefined, priority: undefined, source: undefined,
      analyst: undefined, search: undefined,
      limit: PAGE_SIZE, offset: 0, sort: 'updatedAt', order: 'desc',
    });
  });

  it('übernimmt gesetzte Filter 1:1', () => {
    const f: TicketFilters = { state: '', status: 'in_progress', priority: 'high', source: '', mineOnly: false, search: '', offset: 0 };
    const p = buildTicketListParams(f, 'Max');
    expect(p.state).toBeUndefined();
    expect(p.status).toBe('in_progress');
    expect(p.priority).toBe('high');
  });

  it('source-Filter (dataplane) wird durchgereicht; leer = weggelassen', () => {
    expect(buildTicketListParams({ ...DEFAULT_FILTERS, source: 'dataplane' }, '').source).toBe('dataplane');
    expect(buildTicketListParams(DEFAULT_FILTERS, '').source).toBeUndefined();
  });

  it('mineOnly mappt auf analyst = eigener Name', () => {
    const f: TicketFilters = { ...DEFAULT_FILTERS, mineOnly: true };
    expect(buildTicketListParams(f, 'Max Mustermann').analyst).toBe('Max Mustermann');
  });

  it('mineOnly ohne Namen bleibt ohne analyst-Filter (ehrlich statt leerer Match)', () => {
    const f: TicketFilters = { ...DEFAULT_FILTERS, mineOnly: true };
    expect(buildTicketListParams(f, '').analyst).toBeUndefined();
  });

  it('search wird getrimmt; nur Whitespace zählt nicht', () => {
    expect(buildTicketListParams({ ...DEFAULT_FILTERS, search: '  INC0001  ' }, '').search).toBe('INC0001');
    expect(buildTicketListParams({ ...DEFAULT_FILTERS, search: '   ' }, '').search).toBeUndefined();
  });

  it('übergibt offset an Backend-Params', () => {
    const f: TicketFilters = { ...DEFAULT_FILTERS, offset: PAGE_SIZE };
    expect(buildTicketListParams(f, '').offset).toBe(PAGE_SIZE);
  });
});

describe('hasActiveFilters', () => {
  it('Default (Open, sonst nichts) gilt nicht als aktiv', () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
  });

  it.each<[Partial<TicketFilters>]>([
    [{ state: 'CLOSED' }],
    [{ state: '' }],
    [{ status: 'on_hold' }],
    [{ priority: 'critical' }],
    [{ source: 'dataplane' }],
    [{ mineOnly: true }],
    [{ search: 'dns' }],
  ])('erkennt Abweichung vom Default: %o', (patch) => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, ...patch })).toBe(true);
  });

  it('offset beeinflusst hasActiveFilters nicht (kein Reset-Button für Paging)', () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, offset: PAGE_SIZE })).toBe(false);
  });
});

describe('currentPage', () => {
  it('gibt 1 zurück bei offset 0', () => {
    expect(currentPage(0)).toBe(1);
  });

  it('gibt 2 zurück bei offset = PAGE_SIZE', () => {
    expect(currentPage(PAGE_SIZE)).toBe(2);
  });

  it('gibt korrekte Seite für beliebige Offsets zurück', () => {
    expect(currentPage(PAGE_SIZE * 4)).toBe(5);
  });
});

describe('totalPages', () => {
  it('gibt 1 zurück wenn total 0', () => {
    expect(totalPages(0)).toBe(1);
  });

  it('gibt 1 zurück wenn total <= PAGE_SIZE', () => {
    expect(totalPages(PAGE_SIZE)).toBe(1);
  });

  it('gibt 2 zurück wenn total = PAGE_SIZE + 1', () => {
    expect(totalPages(PAGE_SIZE + 1)).toBe(2);
  });

  it('rundet korrekt auf', () => {
    expect(totalPages(PAGE_SIZE * 3)).toBe(3);
    expect(totalPages(PAGE_SIZE * 3 + 1)).toBe(4);
  });
});
