'use strict';

const { YaraRule } = require('../../src/domain/YaraRule');

describe('YaraRule.match()', () => {
  function rule(patterns, condition = 'any') {
    return new YaraRule({ name: 'test', patterns, condition });
  }

  it('text-Pattern — trifft exakten String', () => {
    const r = rule([{ id: '1', type: 'text', value: 'mimikatz', modifiers: [] }]);
    expect(r.match('cmd.exe mimikatz.exe').matched).toBe(true);
  });

  it('text-Pattern nocase — trifft unabhängig von Groß-/Kleinschreibung', () => {
    const r = rule([{ id: '1', type: 'text', value: 'MiMiKaTz', modifiers: ['nocase'] }]);
    expect(r.match('MIMIKATZ').matched).toBe(true);
  });

  it('regex-Pattern — trifft IP-Adresse', () => {
    const r = rule([{ id: '1', type: 'regex', value: '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}', modifiers: [] }]);
    expect(r.match('connect to 192.168.241.1').matched).toBe(true);
    expect(r.match('no ip here').matched).toBe(false);
  });

  it('condition all — beide Patterns müssen treffen', () => {
    const r = rule([
      { id: '1', type: 'text', value: 'powershell', modifiers: [] },
      { id: '2', type: 'text', value: '-enc', modifiers: [] },
    ], 'all');
    expect(r.match('powershell -enc ABC').matched).toBe(true);
    expect(r.match('powershell only').matched).toBe(false);
  });

  it('condition threshold — mindestens N Treffer', () => {
    const r = rule([
      { id: '1', type: 'text', value: 'a', modifiers: [] },
      { id: '2', type: 'text', value: 'b', modifiers: [] },
      { id: '3', type: 'text', value: 'c', modifiers: [] },
    ], { threshold: 2 });
    expect(r.match('a b').matched).toBe(true);   // 2 hits
    expect(r.match('a').matched).toBe(false);     // 1 hit
  });

  it('disabled rule — kein Match', () => {
    const r = new YaraRule({ name: 'x', patterns: [{ id: '1', type: 'text', value: 'test', modifiers: [] }], enabled: false });
    expect(r.match('test').matched).toBe(false);
  });

  it('leerer Input — kein Match', () => {
    const r = rule([{ id: '1', type: 'text', value: 'x', modifiers: [] }]);
    expect(r.match('').matched).toBe(false);
    expect(r.match(null).matched).toBe(false);
  });

  it('hits enthalten patternId', () => {
    const r = rule([{ id: 'pid1', type: 'text', value: 'lsass', modifiers: [] }]);
    const { hits } = r.match('dump lsass.exe');
    expect(hits[0].patternId).toBe('pid1');
  });
});

describe('YaraRule.isValid()', () => {
  it('gültig wenn name + patterns gesetzt', () => {
    const r = new YaraRule({ name: 'x', patterns: [{ id: '1', type: 'text', value: 'y', modifiers: [] }] });
    expect(r.isValid()).toBe(true);
  });

  it('ungültig ohne name', () => {
    const r = new YaraRule({ patterns: [{ id: '1', type: 'text', value: 'y', modifiers: [] }] });
    expect(r.isValid()).toBe(false);
  });

  it('ungültig ohne patterns', () => {
    const r = new YaraRule({ name: 'x', patterns: [] });
    expect(r.isValid()).toBe(false);
  });
});
