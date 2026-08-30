import { describe, expect, it } from 'vitest';
import { hasWiki, wikiUrl } from './wiki';

describe('wiki-Helper', () => {
  it('liefert immer interne Nexora-Wiki-Routen', () => {
    expect(wikiUrl()).toBe('/wiki');
    expect(wikiUrl('admin/integrationen')).toBe('/wiki/admin/integrationen');
    expect(hasWiki()).toBe(true);
  });
});
