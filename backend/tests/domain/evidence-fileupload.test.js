'use strict';

const {
  validateFileUpload, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXTENSIONS, Evidence,
} = require('../../src/domain/Evidence');

describe('validateFileUpload — Datei-Import-Validierung', () => {
  test('akzeptiert erlaubte Endung unter Größenlimit', () => {
    expect(validateFileUpload({ filename: 'alert.log', content: 'line1\nline2' })).toEqual({ ok: true });
    for (const ext of ALLOWED_UPLOAD_EXTENSIONS) {
      expect(validateFileUpload({ filename: `report${ext}`, content: 'x' }).ok).toBe(true);
    }
  });

  test('lehnt nicht erlaubte Endung ab (z. B. .exe)', () => {
    const r = validateFileUpload({ filename: 'malware.exe', content: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Dateityp/);
  });

  test('lehnt fehlenden Dateinamen ab', () => {
    const r = validateFileUpload({ filename: '', content: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/filename/);
  });

  test('lehnt Inhalt über 5 MB ab', () => {
    const tooBig = 'a'.repeat(MAX_UPLOAD_BYTES + 1);
    const r = validateFileUpload({ filename: 'big.txt', content: tooBig });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/zu groß/);
  });
});

describe('Evidence — neue Typen + filename-Feld', () => {
  test('ai_output / hunt_finding / file_upload sind gültige Typen mit Integritäts-Hash', () => {
    for (const type of ['ai_output', 'hunt_finding', 'file_upload']) {
      const e = Evidence.create({ ticketId: 'T1', type, title: 't', rawText: 'x' });
      expect(e.type).toBe(type);
      expect(e.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test('filename wird übernommen und persistiert', () => {
    const e = Evidence.create({ ticketId: 'T1', type: 'file_upload', title: 't', filename: 'evidence.json' });
    expect(e.filename).toBe('evidence.json');
    expect(e.toJSON().filename).toBe('evidence.json');
  });
});
