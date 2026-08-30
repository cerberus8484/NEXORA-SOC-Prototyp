import { describe, test, expect } from 'vitest';
import { filterFromParams, filterToParams } from './huntFilterParams';

describe('filterFromParams', () => {
  test('liest status/type/q und verwirft unbekannten Status', () => {
    expect(filterFromParams(new URLSearchParams('status=completed&type=rdp&q=dc01')))
      .toEqual({ status: 'completed', type: 'rdp', q: 'dc01' });
    expect(filterFromParams(new URLSearchParams('status=bogus')).status).toBe('');
    expect(filterFromParams(new URLSearchParams('')))
      .toEqual({ status: '', type: '', q: '' });
  });
});

describe('filterToParams', () => {
  test('lässt leere Werte weg und trimmt die Suche', () => {
    expect(filterToParams({ status: 'active', type: '', q: '  beacon ' }))
      .toEqual({ status: 'active', q: 'beacon' });
    expect(filterToParams({ status: '', type: '', q: '' })).toEqual({});
  });
});
