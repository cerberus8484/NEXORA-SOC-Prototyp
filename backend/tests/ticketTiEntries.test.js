'use strict';

const { Ticket } = require('../src/domain/Ticket');
const { createTicketSchema } = require('../src/domain/validation/ticketSchema');

describe('Ticket — tiEntries (mehrere Threat-Intel-Einträge)', () => {
  test('Domain übernimmt tiEntries und gibt sie in toJSON aus', () => {
    const entries = [{ id: 'a', category: 'C2', actor: 'APT29', malware: 'Cobalt Strike', confidence: 'High' }];
    const t = new Ticket({ title: 'X', tiEntries: entries });
    expect(t.tiEntries).toEqual(entries);
    expect(t.toJSON().tiEntries).toEqual(entries);
  });

  test('tiEntries default = leeres Array', () => {
    const t = new Ticket({ title: 'X' });
    expect(t.tiEntries).toEqual([]);
  });

  test('update() übernimmt tiEntries', () => {
    const t = new Ticket({ title: 'X' });
    t.update({ tiEntries: [{ id: 'b', category: 'Exfiltration', actor: '', malware: '', confidence: 'Medium' }] });
    expect(t.tiEntries).toHaveLength(1);
    expect(t.tiEntries[0].confidence).toBe('Medium');
  });

  test('Schema akzeptiert tiEntries und strippt unbekannte Felder', () => {
    const { value, error } = createTicketSchema.validate({
      title: 'X',
      tiEntries: [{ id: 'c', category: 'Initial Access', actor: 'FIN7', malware: 'Carbanak', confidence: 'Low', hack: 'drop me' }],
    });
    expect(error).toBeUndefined();
    expect(value.tiEntries[0].actor).toBe('FIN7');
    expect(value.tiEntries[0]).not.toHaveProperty('hack');
  });

  test('Schema-Default: ohne tiEntries → leeres Array', () => {
    const { value } = createTicketSchema.validate({ title: 'X' });
    expect(value.tiEntries).toEqual([]);
  });
});
