import { describe, test, expect } from 'vitest';
import {
  validateEvidenceDraft, emptyEvidenceDraft,
  validateUploadFile, MAX_UPLOAD_BYTES,
} from './evidenceImportModel';

const UUID = '11111111-2222-3333-4444-555555555555';

describe('validateEvidenceDraft', () => {
  test('gültiger Draft → null', () => {
    const d = { ...emptyEvidenceDraft(UUID), title: 'Verdächtiger Prozess' };
    expect(validateEvidenceDraft(d)).toBeNull();
  });

  test('fehlende Ticket-ID → Fehler', () => {
    const d = { ...emptyEvidenceDraft(''), title: 'X' };
    expect(validateEvidenceDraft(d)).toMatch(/Ticket-ID/);
  });

  test('Ticket-ID keine UUID → Fehler', () => {
    const d = { ...emptyEvidenceDraft('INC000123'), title: 'X' };
    expect(validateEvidenceDraft(d)).toMatch(/UUID/);
  });

  test('fehlender Titel → Fehler', () => {
    const d = { ...emptyEvidenceDraft(UUID), title: '   ' };
    expect(validateEvidenceDraft(d)).toMatch(/Titel/);
  });

  test('emptyEvidenceDraft setzt sinnvolle Defaults', () => {
    const d = emptyEvidenceDraft(UUID);
    expect(d.type).toBe('log_entry');
    expect(d.source).toBe('manual');
    expect(d.ticketId).toBe(UUID);
  });
});

describe('validateUploadFile', () => {
  test('akzeptiert erlaubte Endung unter Limit, lehnt verbotene ab', () => {
    expect(validateUploadFile({ name: 'alert.log', size: 1024 })).toBeNull();
    expect(validateUploadFile({ name: 'report.json', size: 10 })).toBeNull();
    expect(validateUploadFile({ name: 'evil.exe', size: 10 })).toMatch(/Dateityp/);
    expect(validateUploadFile({ name: 'noext', size: 10 })).toMatch(/Dateityp/);
  });

  test('lehnt Dateien über dem 5-MB-Limit ab', () => {
    expect(validateUploadFile({ name: 'big.txt', size: MAX_UPLOAD_BYTES + 1 })).toMatch(/zu groß/);
    expect(validateUploadFile({ name: 'ok.txt', size: MAX_UPLOAD_BYTES })).toBeNull();
  });
});
