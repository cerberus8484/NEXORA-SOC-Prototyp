import { describe, test, expect } from 'vitest';
import {
  PAYLOAD_SCHEMA,
  PAYLOAD_TYPES,
  payloadToTemplateFields,
  type TicketPayloadItem,
} from './payloadSchema';

describe('PAYLOAD_SCHEMA', () => {
  test('enthält die erwarteten Artefakt-Typen', () => {
    expect(PAYLOAD_TYPES).toContain('URL');
    expect(PAYLOAD_TYPES).toContain('Hash');
    expect(PAYLOAD_TYPES).toContain('Registry-Key');
    expect(PAYLOAD_TYPES.length).toBe(Object.keys(PAYLOAD_SCHEMA).length);
  });

  test('jedes Feld hat key, label und gültigen input-Typ', () => {
    for (const defs of Object.values(PAYLOAD_SCHEMA)) {
      expect(defs.length).toBeGreaterThan(0);
      for (const d of defs) {
        expect(d.key).toBeTruthy();
        expect(d.label).toBeTruthy();
        expect(['text', 'textarea']).toContain(d.input);
      }
    }
  });
});

describe('payloadToTemplateFields', () => {
  test('mappt vorhandene Feldwerte auf {label,value}', () => {
    const p: TicketPayloadItem = {
      id: 'p1', type: 'URL', raw: '', createdAt: '', fields: { url: 'https://evil.example', method: 'GET' },
    };
    const out = payloadToTemplateFields(p);
    expect(out[0]).toEqual({ label: 'URL', value: 'https://evil.example' });
    expect(out.find((x) => x.label === 'Method')?.value).toBe('GET');
  });

  test('fehlende Felder werden zu leerem String', () => {
    const p: TicketPayloadItem = { id: 'p2', type: 'IP', raw: '', createdAt: '', fields: {} };
    const out = payloadToTemplateFields(p);
    expect(out.every((x) => x.value === '')).toBe(true);
  });

  test('unbekannter Typ → leeres Ergebnis', () => {
    const p: TicketPayloadItem = { id: 'p3', type: 'Unbekannt', raw: '', createdAt: '', fields: { x: 'y' } };
    expect(payloadToTemplateFields(p)).toEqual([]);
  });
});
