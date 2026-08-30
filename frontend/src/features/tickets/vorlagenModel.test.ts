import { describe, test, expect } from 'vitest';
import { formToTemplateFields, templateToFormPatch, type AnalysisTemplate } from './vorlagenModel';

const tpl: AnalysisTemplate = {
  id: 'abc', name: 'RDP Brute Force',
  desc: 'Beschreibung', iocs: '1.2.3.4', logs: 'EventID 4625',
  actions: 'Block IP', rec: 'MFA erzwingen', notes: 'intern',
  author: 'a@nexora', createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

describe('formToTemplateFields', () => {
  test('liest description→desc und recommendation→rec', () => {
    const f = formToTemplateFields({
      description: 'd', iocs: 'i', logs: 'l', actions: 'a', recommendation: 'r', notes: 'n',
    });
    expect(f).toEqual({ desc: 'd', iocs: 'i', logs: 'l', actions: 'a', rec: 'r', notes: 'n' });
  });

  test('fehlende Felder → leere Strings', () => {
    const f = formToTemplateFields({});
    expect(f).toEqual({ desc: '', iocs: '', logs: '', actions: '', rec: '', notes: '' });
  });
});

describe('templateToFormPatch', () => {
  test('mappt desc→description und rec→recommendation zurück', () => {
    const patch = templateToFormPatch(tpl);
    expect(patch.description).toBe('Beschreibung');
    expect(patch.recommendation).toBe('MFA erzwingen');
    expect(patch.iocs).toBe('1.2.3.4');
    expect(patch.notes).toBe('intern');
  });

  test('leere Vorlagen-Felder werden NICHT ins Patch geschrieben (kein Überschreiben)', () => {
    const patch = templateToFormPatch({ ...tpl, iocs: '', notes: '   ' });
    expect(patch).not.toHaveProperty('iocs');
    expect(patch).not.toHaveProperty('notes');
    expect(patch.description).toBe('Beschreibung');
  });

  test('Round-Trip: Form → Fields → (Vorlage) → Patch erhält Inhalte', () => {
    const form = { description: 'X', iocs: 'Y', logs: '', actions: '', recommendation: 'Z', notes: '' };
    const fields = formToTemplateFields(form);
    const roundTrip = templateToFormPatch({ ...tpl, ...fields });
    expect(roundTrip.description).toBe('X');
    expect(roundTrip.iocs).toBe('Y');
    expect(roundTrip.recommendation).toBe('Z');
  });
});
