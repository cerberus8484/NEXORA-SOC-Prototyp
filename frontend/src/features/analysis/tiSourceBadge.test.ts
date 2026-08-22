import { describe, it, expect } from 'vitest';
import { tiSourceBadge } from './tiSourceBadge';

describe('tiSourceBadge', () => {
  it('warnt ehrlich, wenn die Quelle „mock" ist (kein TI-Provider konfiguriert)', () => {
    const b = tiSourceBadge('mock');
    expect(b.isMock).toBe(true);
    expect(b.tone).toBe('warning');
    expect(b.label).toMatch(/Kein TI-Provider/i);
    // Der Mock darf nicht als „echte" Quelle durchgehen.
    expect(b.label).not.toBe('mock');
  });

  it('zeigt echte Provider-Quellen ohne Warnung', () => {
    for (const src of ['provider', 'cache'] as const) {
      const b = tiSourceBadge(src);
      expect(b.isMock).toBe(false);
      expect(b.tone).toBe('muted');
      expect(b.label).toBe(src);
    }
  });

  it('behandelt unbekannte/fehlende Quellen als nicht-Mock (keine falsche Beruhigung)', () => {
    expect(tiSourceBadge(undefined).isMock).toBe(false);
    expect(tiSourceBadge('').isMock).toBe(false);
  });
});
