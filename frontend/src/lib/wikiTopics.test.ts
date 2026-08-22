import { describe, it, expect } from 'vitest';
import { WIKI_TOPICS, getWikiTopic } from './wikiTopics';

describe('wikiTopics-Registry', () => {
  const entries = Object.entries(WIKI_TOPICS);

  it('enthält Topics', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('jeder Topic hat einen nicht-leeren, analyst-tauglichen Hinweis', () => {
    for (const [key, topic] of entries) {
      expect(topic.hint.length, `hint für ${key}`).toBeGreaterThan(20);
    }
  });

  it('jeder Slug ist wohlgeformt (relativer Pfad, kein führender/abschließender Slash, keine Schemata)', () => {
    for (const [key, topic] of entries) {
      expect(topic.slug, `slug für ${key}`).toMatch(/^[a-z0-9][a-z0-9/_-]*[a-z0-9]$/i);
      expect(topic.slug.startsWith('/')).toBe(false);
      expect(topic.slug.includes('://')).toBe(false);
    }
  });

  it('getWikiTopic liefert denselben Eintrag wie die Registry', () => {
    expect(getWikiTopic('integrationen')).toBe(WIKI_TOPICS.integrationen);
    expect(getWikiTopic('mfa').slug).toBe('admin/sicherheit');
  });
});
