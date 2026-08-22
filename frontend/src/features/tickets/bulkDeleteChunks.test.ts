import { describe, it, expect } from 'vitest';
import { chunkIds, mergeBulkResults, BULK_DELETE_CHUNK_SIZE } from './bulkDeleteChunks';
import type { BulkDeleteResult } from './bulkDeleteModel';

describe('chunkIds', () => {
  it('returns empty array for empty input', () => {
    expect(chunkIds([], 100)).toEqual([]);
  });

  it('returns a single chunk when below the cap', () => {
    const ids = ['a', 'b', 'c'];
    expect(chunkIds(ids, 100)).toEqual([['a', 'b', 'c']]);
  });

  it('returns a single chunk when exactly at the cap', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(100);
  });

  it('splits into chunks of at most the cap, preserving order', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids, 100);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[1]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(50);
    expect(chunks[0][0]).toBe('id-0');
    expect(chunks[2][49]).toBe('id-249');
  });

  it('defaults to the backend cap of 100', () => {
    expect(BULK_DELETE_CHUNK_SIZE).toBe(100);
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    expect(chunkIds(ids)).toHaveLength(2);
  });

  it('treats a non-positive size as a single chunk (no infinite loop)', () => {
    const ids = ['a', 'b'];
    expect(chunkIds(ids, 0)).toEqual([['a', 'b']]);
    expect(chunkIds(ids, -5)).toEqual([['a', 'b']]);
  });
});

describe('mergeBulkResults', () => {
  it('returns a zeroed result for no chunks', () => {
    expect(mergeBulkResults([])).toEqual({ requested: 0, deleted: 0, missing: 0, deletedIds: [] });
  });

  it('sums counts and concatenates deletedIds across chunks', () => {
    const r1: BulkDeleteResult = { requested: 100, deleted: 98, missing: 2, deletedIds: ['a', 'b'] };
    const r2: BulkDeleteResult = { requested: 50, deleted: 50, missing: 0, deletedIds: ['c'] };
    expect(mergeBulkResults([r1, r2])).toEqual({
      requested: 150,
      deleted: 148,
      missing: 2,
      deletedIds: ['a', 'b', 'c'],
    });
  });

  it('passes a single chunk result through unchanged in shape', () => {
    const r: BulkDeleteResult = { requested: 3, deleted: 3, missing: 0, deletedIds: ['x', 'y', 'z'] };
    expect(mergeBulkResults([r])).toEqual(r);
  });
});
