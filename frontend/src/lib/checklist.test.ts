import { describe, it, expect } from 'vitest';
import { parseChecklist, serializeChecklist } from './checklist';

describe('parseChecklist', () => {
  it('leerer String → leere Liste', () => {
    expect(parseChecklist('')).toEqual([]);
  });

  it('parst ☑/☐ zu checked + text', () => {
    expect(parseChecklist('☑ Account gesperrt\n☐ Passwort-Reset')).toEqual([
      { checked: true, text: 'Account gesperrt' },
      { checked: false, text: 'Passwort-Reset' },
    ]);
  });

  it('ignoriert leere Zeilen', () => {
    expect(parseChecklist('☑ a\n\n  \n☐ b')).toHaveLength(2);
  });

  it('Zeile ohne Marker → unchecked, voller Text', () => {
    expect(parseChecklist('Forensik')).toEqual([{ checked: false, text: 'Forensik' }]);
  });
});

describe('serializeChecklist', () => {
  it('serialisiert mit ☑/☐-Präfix', () => {
    expect(serializeChecklist([
      { checked: true, text: 'a' },
      { checked: false, text: 'b' },
    ])).toBe('☑ a\n☐ b');
  });

  it('leere Liste → leerer String', () => {
    expect(serializeChecklist([])).toBe('');
  });

  it('Roundtrip parse→serialize ist stabil', () => {
    const s = '☑ Endpoint isoliert\n☐ Threat Hunting';
    expect(serializeChecklist(parseChecklist(s))).toBe(s);
  });
});
