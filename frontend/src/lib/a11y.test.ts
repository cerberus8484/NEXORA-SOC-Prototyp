import { describe, it, expect, vi } from 'vitest';
import { onActivateKey } from './a11y';

// onActivateKey macht nicht-native interaktive Elemente per Tastatur bedienbar:
// Enter/Space lösen den Handler aus, alle anderen Tasten nicht.

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
}

describe('onActivateKey', () => {
  it('ruft den Handler bei Enter und verhindert das Default-Verhalten', () => {
    const handler = vi.fn();
    const e = keyEvent('Enter');
    onActivateKey(handler)(e);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('ruft den Handler bei Leertaste (Space) auf', () => {
    const handler = vi.fn();
    onActivateKey(handler)(keyEvent(' '));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignoriert andere Tasten', () => {
    const handler = vi.fn();
    const fn = onActivateKey(handler);
    fn(keyEvent('a'));
    fn(keyEvent('Tab'));
    fn(keyEvent('Escape'));
    expect(handler).not.toHaveBeenCalled();
  });
});
