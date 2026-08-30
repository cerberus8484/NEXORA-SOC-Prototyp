import { describe, test, expect } from 'vitest';
import { parseTicketImport } from './ticketImport';

describe('parseTicketImport', () => {
  test('übernimmt skalare Felder als Strings', () => {
    const { form } = parseTicketImport({ title: 'RDP Brute Force', priority: 'high', port: 3389, vpn: true });
    expect(form.title).toBe('RDP Brute Force');
    expect(form.priority).toBe('high');
    expect(form.port).toBe('3389');
    expect(form.vpn).toBe('true');
  });

  test('überspringt null/verschachtelte Werte', () => {
    const { form } = parseTicketImport({ title: 'X', skip: null, nested: { a: 1 } });
    expect(form.title).toBe('X');
    expect(form).not.toHaveProperty('skip');
    expect(form).not.toHaveProperty('nested');
  });

  test('importiert eingebettete Payloads (mit Defaults)', () => {
    const { payloads } = parseTicketImport({
      title: 'X',
      payloads: [{ type: 'url', raw: 'http://evil.com', fields: { url: 'http://evil.com' } }],
    });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].type).toBe('url');
    expect(payloads[0].fields.url).toBe('http://evil.com');
    expect(payloads[0].id).toBeTruthy();
    expect(payloads[0].createdAt).toBeTruthy();
  });

  test('verwirft Payloads ohne type', () => {
    const { payloads } = parseTicketImport({ title: 'X', payloads: [{ raw: 'kein typ' }, { type: 'ip' }] });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].type).toBe('ip');
  });

  test('importiert tiEntries und verwirft leere', () => {
    const { tiEntries } = parseTicketImport({
      title: 'X',
      tiEntries: [
        { id: 'a', category: 'C2', actor: 'APT29', malware: '', confidence: 'High' },
        { id: 'b', category: '', actor: '', malware: '', confidence: '' },
      ],
    });
    expect(tiEntries).toHaveLength(1);
    expect(tiEntries[0].actor).toBe('APT29');
    expect(tiEntries[0].confidence).toBe('High');
  });

  test('wirft bei Nicht-Objekt', () => {
    expect(() => parseTicketImport('string')).toThrow();
    expect(() => parseTicketImport([1, 2])).toThrow();
    expect(() => parseTicketImport(null)).toThrow();
  });

  test('wirft wenn nichts Importierbares enthalten', () => {
    expect(() => parseTicketImport({ skip: null, nested: { a: 1 } })).toThrow();
  });
});
