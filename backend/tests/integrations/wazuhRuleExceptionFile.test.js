'use strict';

const B = require('../../src/integrations/adapters/wazuh/wazuhRuleExceptionBuilder');

const scopeA = { ruleId: '87702', srcips: ['192.168.240.109'], dstips: ['224.0.0.0/24'], reason: 'multicast fp' };
const scopeB = { ruleId: '5555', srcips: ['10.0.0.5'], dstips: ['10.0.0.6'], reason: 'b' };

describe('wazuhRuleExceptionBuilder — Datei-/ID-/Scope-Helfer', () => {
  test('allocateRuleId aus leerer Datei = 900000', () => {
    expect(B.allocateRuleId('')).toBe(900000);
  });

  test('allocateRuleId liefert nächste freie ID aus bestehender Datei', () => {
    const xml = B.wrapFile([B.buildRuleElement(scopeA, 900000), B.buildRuleElement(scopeB, 900001)]);
    expect(B.parseRuleIds(xml).sort()).toEqual([900000, 900001]);
    expect(B.allocateRuleId(xml)).toBe(900002);
  });

  test('scopeHash ist deterministisch + unterscheidet verschiedene Scopes', () => {
    expect(B.scopeHash(scopeA)).toBe(B.scopeHash({ ...scopeA }));
    expect(B.scopeHash(scopeA)).not.toBe(B.scopeHash(scopeB));
    // Reihenfolge der Listen egal:
    expect(B.scopeHash({ ...scopeA, srcips: ['1.1.1.1', '2.2.2.2'] }))
      .toBe(B.scopeHash({ ...scopeA, srcips: ['2.2.2.2', '1.1.1.1'] }));
  });

  test('buildFpException bettet den scopeHash als Marker ein', () => {
    const r = B.buildFpException({ ...scopeA, newRuleId: 900100 });
    expect(r.ok).toBe(true);
    expect(r.xml).toContain(`scope=${r.scopeHash}`);
  });

  test('findRuleByScope findet die ID per Marker — null bei anderem Scope', () => {
    const file = B.buildFpException({ ...scopeA, newRuleId: 900100 }).xml;
    expect(B.findRuleByScope(file, scopeA)).toBe(900100);
    expect(B.findRuleByScope(file, scopeB)).toBeNull();
  });

  test('findRuleById liefert den Block / null', () => {
    const file = B.buildFpException({ ...scopeA, newRuleId: 900100 }).xml;
    expect(B.findRuleById(file, 900100)).toMatch(/<if_sid>87702<\/if_sid>/);
    expect(B.findRuleById(file, 999999)).toBeNull();
  });

  test('insertRule fügt eine zweite Regel in EINE Gruppe ein', () => {
    const file = B.buildFpException({ ...scopeA, newRuleId: 900100 }).xml;
    const merged = B.insertRule(file, B.buildRuleElement(scopeB, 900200));
    expect(B.parseRuleIds(merged).sort()).toEqual([900100, 900200]);
    expect((merged.match(/<group name="soc_fp_exceptions,">/g) || []).length).toBe(1);
    expect(merged.trim().endsWith('</group>')).toBe(true);
  });

  test('removeRuleById entfernt nur die passende Regel', () => {
    let file = B.buildFpException({ ...scopeA, newRuleId: 900100 }).xml;
    file = B.insertRule(file, B.buildRuleElement(scopeB, 900200));
    const after = B.removeRuleById(file, 900100);
    expect(B.parseRuleIds(after)).toEqual([900200]);
    expect(after).not.toContain('<if_sid>87702</if_sid>');
  });

  test('insertRule in leere Datei wrappt eine neue Gruppe', () => {
    const merged = B.insertRule('', B.buildRuleElement(scopeA, 900100));
    expect(merged).toContain('<group name="soc_fp_exceptions,">');
    expect(B.parseRuleIds(merged)).toEqual([900100]);
  });
});
