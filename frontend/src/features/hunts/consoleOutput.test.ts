import { describe, test, expect } from 'vitest';
import { toConsoleLines, toPlainText } from './consoleOutput';
import type { HuntLog } from '../../lib/types';

const log = (over: Partial<HuntLog>): HuntLog => ({
  id: 'l1', sessionId: 's1', seq: 1, level: 'info',
  message: 'msg', timestamp: '2026-06-13T10:00:00.000Z', ...over,
});

describe('toConsoleLines', () => {
  test('liefert alle Zeilen (keine Begrenzung) mit Level + Message', () => {
    const lines = toConsoleLines([
      log({ id: 'a', level: 'info', message: 'started' }),
      log({ id: 'b', level: 'warning', message: 'odd port' }),
      log({ id: 'c', level: 'error', message: 'failed' }),
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[1].level).toBe('warning');
    expect(lines[1].text).toContain('[WARNING]');
    expect(lines[1].text).toContain('odd port');
  });
});

describe('toPlainText', () => {
  test('eine Zeile pro Log, durch Newline getrennt', () => {
    const text = toPlainText([log({ message: 'one' }), log({ id: 'l2', message: 'two' })]);
    expect(text.split('\n')).toHaveLength(2);
    expect(text).toContain('one');
    expect(text).toContain('two');
  });
});
