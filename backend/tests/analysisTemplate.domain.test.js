'use strict';

const { AnalysisTemplate, TEMPLATE_FIELDS } = require('../src/domain/AnalysisTemplate');

describe('AnalysisTemplate (Domain)', () => {
  test('erzeugt ID + Zeitstempel automatisch', () => {
    const t = new AnalysisTemplate({ name: 'RDP Brute Force' });
    expect(t.id).toMatch(/[0-9a-f-]{36}/);
    expect(t.createdAt).toBeTruthy();
    expect(t.updatedAt).toBeTruthy();
  });

  test('übernimmt alle Analyse-Felder', () => {
    const t = new AnalysisTemplate({
      name: 'Phishing', desc: 'Beschreibung', iocs: 'evil.com',
      logs: 'proxy logs', actions: 'Block IOC', rec: 'User-Awareness', notes: 'intern',
      author: 'analyst@nexora',
    });
    expect(t.name).toBe('Phishing');
    expect(t.desc).toBe('Beschreibung');
    expect(t.iocs).toBe('evil.com');
    expect(t.logs).toBe('proxy logs');
    expect(t.actions).toBe('Block IOC');
    expect(t.rec).toBe('User-Awareness');
    expect(t.notes).toBe('intern');
    expect(t.author).toBe('analyst@nexora');
  });

  test('TEMPLATE_FIELDS listet genau die portierten Vorlagen-Felder', () => {
    expect(TEMPLATE_FIELDS).toEqual(['desc', 'iocs', 'logs', 'actions', 'rec', 'notes']);
  });

  test('trimmt den Namen und kappt überlange Namen', () => {
    const t = new AnalysisTemplate({ name: '  ' + 'x'.repeat(500) + '  ' });
    expect(t.name.length).toBeLessThanOrEqual(120);
    expect(t.name.startsWith('x')).toBe(true);
  });

  test('kappt überlange Textfelder (Schutz vor Riesen-Payloads)', () => {
    const huge = 'a'.repeat(50_000);
    const t = new AnalysisTemplate({ name: 'X', desc: huge });
    expect(t.desc.length).toBeLessThanOrEqual(20_000);
  });

  test('fehlende Felder werden zu leeren Strings (kein undefined)', () => {
    const t = new AnalysisTemplate({ name: 'X' });
    expect(t.desc).toBe('');
    expect(t.notes).toBe('');
  });

  test('isValid() true nur mit Namen', () => {
    expect(new AnalysisTemplate({ name: 'X' }).isValid()).toBe(true);
    expect(new AnalysisTemplate({ name: '   ' }).isValid()).toBe(false);
    expect(new AnalysisTemplate({}).isValid()).toBe(false);
  });

  test('toJSON enthält alle Felder', () => {
    const t = new AnalysisTemplate({ name: 'X', desc: 'd' });
    const j = t.toJSON();
    expect(j).toMatchObject({ name: 'X', desc: 'd', iocs: '', logs: '', actions: '', rec: '', notes: '' });
    expect(j.id).toBe(t.id);
    expect(j.createdAt).toBe(t.createdAt);
  });
});
