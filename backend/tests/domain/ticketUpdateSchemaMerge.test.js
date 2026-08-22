'use strict';

// Regression: PUT /tickets/:id darf ein Ticket NICHT ausleeren.
//
// Bug: updateTicketSchema forkte nur `title` auf optional, behielt aber auf ALLEN
// Feldern `.default('')`. Die validate-Middleware ersetzt den Body durch das
// validierte Objekt → ein Partial-PUT { decision } wurde zu einem 65-Feld-Body mit
// srcIp='', logs='', mitre='' … → Ticket.update() überschrieb jedes nicht mitgesendete
// Feld mit '' (Merge sieht '' !== undefined). Öffnen/Speichern im Analyse-Deck löschte
// so srcIp/dstIp/logs/mitre/Payloads-Kontext → „im Deck ist nichts".
//
// Fix: updateTicketSchema injiziert keine Defaults mehr (noDefaults) → absente Felder
// bleiben undefined → der Merge lässt sie unangetastet.

const { updateTicketSchema } = require('../../src/domain/validation/ticketSchema');

describe('updateTicketSchema — Partial-PUT darf keine Felder ausleeren', () => {
  test('absente Felder werden NICHT als "" injiziert', () => {
    const { value, error } = updateTicketSchema.validate({ decision: 'incident', confidence: 90 });
    expect(error).toBeUndefined();
    expect(value.srcIp).toBeUndefined();
    expect(value.dstIp).toBeUndefined();
    expect(value.logs).toBeUndefined();
    expect(value.mitre).toBeUndefined();
    expect(value.hostname).toBeUndefined();
    // Nur die tatsächlich gesendeten Felder überleben.
    expect(Object.keys(value).sort()).toEqual(['confidence', 'decision']);
  });

  test('gesendete Felder bleiben erhalten (inkl. bewusst geleerter Wert)', () => {
    const { value } = updateTicketSchema.validate({ notes: '', srcIp: '10.0.0.5' });
    expect(value.notes).toBe('');       // bewusstes Leeren bleibt möglich
    expect(value.srcIp).toBe('10.0.0.5');
    expect(value.logs).toBeUndefined(); // aber NICHT mitgesendetes bleibt weg
  });

  test('title bleibt optional (kein required-Fehler beim Teil-Update)', () => {
    const { error } = updateTicketSchema.validate({ status: 'on_hold' });
    expect(error).toBeUndefined();
  });

  test('Enum-Validierung greift weiterhin', () => {
    const { error } = updateTicketSchema.validate({ priority: 'ultra' });
    expect(error).toBeDefined();
  });
});
