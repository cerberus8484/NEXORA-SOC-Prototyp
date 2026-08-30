'use strict';

const { Ticket, PRIORITIES, STATES, STATUSES, CLOSE_REASONS } = require('../../src/domain/Ticket');
const { createTicketSchema, updateTicketSchema, listTicketsSchema } = require('../../src/domain/validation/ticketSchema');

describe('Ticket Domain Model', () => {
  test('Ticket.create() setzt id und timestamps', () => {
    const t = Ticket.create({ title: 'Test Incident' });
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.title).toBe('Test Incident');
    expect(t.priority).toBe('medium');
    expect(t.state).toBe('OPEN');
    expect(t.status).toBe('assigned');
    expect(t.closeReason).toBe('');
    expect(t.createdAt).toBeDefined();
    expect(t.updatedAt).toBeDefined();
  });

  test('Ticket.update() ändert erlaubte Felder + setzt updatedAt', async () => {
    const t = Ticket.create({ title: 'Original' });
    const before = t.updatedAt;
    await new Promise(r => setTimeout(r, 5)); // sicherstellen dass Zeit vergeht
    t.update({ title: 'Updated', status: 'in_progress', state: 'CLOSED', closeReason: 'resolved' });
    expect(t.title).toBe('Updated');
    expect(t.status).toBe('in_progress');
    expect(t.state).toBe('CLOSED');
    expect(t.closeReason).toBe('resolved');
    expect(t.updatedAt).not.toBe(before);
  });

  test('Ticket.update() erlaubt keine id-Änderung', () => {
    const t = Ticket.create({ title: 'Test' });
    const originalId = t.id;
    t.update({ id: 'hacked-id' });
    expect(t.id).toBe(originalId);
  });

  test('PRIORITIES enthält alle erwarteten Werte', () => {
    expect(PRIORITIES).toContain('critical');
    expect(PRIORITIES).toContain('high');
    expect(PRIORITIES).toContain('medium');
    expect(PRIORITIES).toContain('low');
    expect(PRIORITIES).toContain('info');
  });

  test('STATES enthält OPEN und CLOSED', () => {
    expect(STATES).toContain('OPEN');
    expect(STATES).toContain('CLOSED');
  });

  test('STATUSES enthält alle erwarteten Workflow-Werte', () => {
    expect(STATUSES).toContain('assigned');
    expect(STATUSES).toContain('in_progress');
    expect(STATUSES).toContain('on_hold');
    expect(STATUSES).toContain('awaiting_customer');
  });

  test('CLOSE_REASONS enthält false_positive als Schliessgrund', () => {
    expect(CLOSE_REASONS).toContain('false_positive');
    expect(CLOSE_REASONS).toContain('');
  });
});

// ── closedAt — echter Close-Zeitpunkt (Audit #1) ────────────────────────────

describe('Ticket.closedAt — Lifecycle-Transition', () => {
  test('neu erstelltes OPEN-Ticket hat closedAt = null', () => {
    const t = Ticket.create({ title: 'Neu' });
    expect(t.closedAt).toBeNull();
  });

  test('create() mit state=CLOSED setzt closedAt automatisch', () => {
    const t = Ticket.create({ title: 'Direkt geschlossen', state: 'CLOSED' });
    expect(t.closedAt).not.toBeNull();
    expect(Date.parse(t.closedAt)).not.toBeNaN();
  });

  test('update() OPEN→CLOSED setzt closedAt auf now()', () => {
    const t = Ticket.create({ title: 'Test' });
    expect(t.closedAt).toBeNull();
    t.update({ state: 'CLOSED', closeReason: 'resolved' });
    expect(t.closedAt).not.toBeNull();
    expect(Date.parse(t.closedAt)).not.toBeNaN();
  });

  test('update() CLOSED→OPEN (Re-Open) setzt closedAt auf null', () => {
    const t = Ticket.create({ title: 'Test', state: 'CLOSED' });
    expect(t.closedAt).not.toBeNull();
    t.update({ state: 'OPEN' });
    expect(t.closedAt).toBeNull();
  });

  test('update() eines bereits geschlossenen Tickets ohne state-Wechsel behält closedAt', () => {
    const t = Ticket.create({ title: 'Test', state: 'CLOSED' });
    const firstClosed = t.closedAt;
    // späteres Edit (z.B. Notiz) darf closedAt NICHT verschieben → sonst falsche MTTR
    t.update({ notes: 'Nachträgliche Analyse-Notiz' });
    expect(t.closedAt).toBe(firstClosed);
    expect(t.state).toBe('CLOSED');
  });

  test('update() eines offenen Tickets ohne state-Wechsel lässt closedAt null', () => {
    const t = Ticket.create({ title: 'Test' });
    t.update({ notes: 'Bearbeitung läuft' });
    expect(t.closedAt).toBeNull();
  });

  test('erneutes Schließen nach Re-Open setzt closedAt neu', () => {
    const t = Ticket.create({ title: 'Test', state: 'CLOSED' });
    t.update({ state: 'OPEN' });
    expect(t.closedAt).toBeNull();
    t.update({ state: 'CLOSED', closeReason: 'resolved' });
    expect(t.closedAt).not.toBeNull();
  });

  test('expliziter closedAt-Wert im Konstruktor bleibt erhalten (DB-Roundtrip)', () => {
    const iso = '2026-06-01T10:00:00.000Z';
    const t = new Ticket({ title: 'Test', state: 'CLOSED', closedAt: iso });
    expect(t.closedAt).toBe(iso);
  });
});

describe('createTicketSchema Validierung', () => {
  test('gültiges Ticket wird akzeptiert', () => {
    const { error, value } = createTicketSchema.validate({ title: 'C2 Beacon erkannt' });
    expect(error).toBeUndefined();
    expect(value.title).toBe('C2 Beacon erkannt');
    expect(value.priority).toBe('medium');   // Default
    expect(value.state).toBe('OPEN');         // Default
    expect(value.status).toBe('assigned');    // Default
  });

  test('fehlendes title wird abgelehnt', () => {
    const { error } = createTicketSchema.validate({ priority: 'high' });
    expect(error).toBeDefined();
    expect(error.details[0].path).toContain('title');
  });

  test('ungültige priority wird abgelehnt', () => {
    const { error } = createTicketSchema.validate({ title: 'Test', priority: 'ultra-critical' });
    expect(error).toBeDefined();
    expect(error.details[0].path).toContain('priority');
  });

  test('ungültiger status wird abgelehnt', () => {
    const { error } = createTicketSchema.validate({ title: 'Test', status: 'deleted' });
    expect(error).toBeDefined();
  });

  test('unbekannte Felder werden entfernt (stripUnknown)', () => {
    const { value } = createTicketSchema.validate({
      title: 'Test',
      unknownField: 'should be removed',
    });
    expect(value.unknownField).toBeUndefined();
  });

  test('title über 200 Zeichen wird abgelehnt', () => {
    const { error } = createTicketSchema.validate({ title: 'A'.repeat(201) });
    expect(error).toBeDefined();
  });

  test('alle Fehler werden gesammelt (abortEarly: false)', () => {
    const { error } = createTicketSchema.validate({
      title: 'Test',
      priority: 'invalid',
      status: 'invalid',
    });
    expect(error.details.length).toBeGreaterThan(1);
  });

  test('leere Strings für optionale Felder erlaubt', () => {
    const { error } = createTicketSchema.validate({
      title: 'Test',
      srcIp: '',
      analyst: '',
    });
    expect(error).toBeUndefined();
  });

  test('reale Inbound-Quellen sind beim Anlegen gültig (crowdsec/email/dataplane)', () => {
    for (const source of ['crowdsec', 'email', 'dataplane']) {
      const { error, value } = createTicketSchema.validate({ title: 'T', source });
      expect(error).toBeUndefined();
      expect(value.source).toBe(source);
    }
  });
});

// ── analystState — Checkliste + Playbook ────────────────────────────────────

describe('Ticket.analystState — Domain Roundtrip', () => {
  test('Default analystState ist leeres Objekt', () => {
    const t = Ticket.create({ title: 'Test' });
    expect(t.analystState).toEqual({});
  });

  test('Ticket.create() übernimmt analystState mit Checkliste', () => {
    const state = {
      checklist: [
        { id: 'c1', label: 'IoCs prüfen', done: false },
        { id: 'c2', label: 'VT prüfen', done: true },
      ],
      playbook: {},
    };
    const t = Ticket.create({ title: 'Test', analystState: state });
    expect(t.analystState).toEqual(state);
  });

  test('Ticket.create() übernimmt analystState mit Playbook-Status', () => {
    const state = {
      checklist: [],
      playbook: { id: 'susp-ip', step: 2, status: 'in_progress' },
    };
    const t = Ticket.create({ title: 'Test', analystState: state });
    expect(t.analystState.playbook).toEqual({ id: 'susp-ip', step: 2, status: 'in_progress' });
  });

  test('update() übernimmt analystState (in allowed-Liste)', () => {
    const t = Ticket.create({ title: 'Test' });
    const newState = {
      checklist: [{ id: 'c1', label: 'IoCs prüfen', done: true }],
      playbook: { id: 'malware', step: 1, status: 'done' },
    };
    t.update({ analystState: newState });
    expect(t.analystState).toEqual(newState);
  });

  test('update() kann analystState partiell ersetzen', () => {
    const initial = { checklist: [{ id: 'c1', label: 'A', done: false }], playbook: {} };
    const t = Ticket.create({ title: 'Test', analystState: initial });
    const updated = { checklist: [{ id: 'c1', label: 'A', done: true }], playbook: {} };
    t.update({ analystState: updated });
    expect(t.analystState.checklist[0].done).toBe(true);
  });

  test('update() lässt analystState unberührt wenn nicht im Update-Body', () => {
    const state = { checklist: [{ id: 'c1', label: 'Test', done: false }], playbook: {} };
    const t = Ticket.create({ title: 'Test', analystState: state });
    t.update({ title: 'Anderer Titel' });
    expect(t.analystState).toEqual(state);
  });

  test('update() verhindert id-Änderung auch wenn analystState gesetzt wird', () => {
    const t = Ticket.create({ title: 'Test' });
    const originalId = t.id;
    t.update({ id: 'gehackt', analystState: { checklist: [], playbook: {} } });
    expect(t.id).toBe(originalId);
  });
});

describe('createTicketSchema — analystState Validierung', () => {
  test('analystState fehlt → Default {} wird gesetzt', () => {
    const { error, value } = createTicketSchema.validate({ title: 'Test' });
    expect(error).toBeUndefined();
    expect(value.analystState).toEqual({});
  });

  test('gültiger analystState mit Checkliste wird akzeptiert', () => {
    const { error, value } = createTicketSchema.validate({
      title: 'Test',
      analystState: {
        checklist: [{ id: 'c1', label: 'IoCs prüfen', done: false }],
        playbook: {},
      },
    });
    expect(error).toBeUndefined();
    expect(value.analystState.checklist).toHaveLength(1);
  });

  test('gültiger analystState mit Playbook-Status wird akzeptiert', () => {
    const { error, value } = createTicketSchema.validate({
      title: 'Test',
      analystState: {
        checklist: [],
        playbook: { id: 'susp-ip', step: 3, status: 'in_progress' },
      },
    });
    expect(error).toBeUndefined();
    expect(value.analystState.playbook.status).toBe('in_progress');
  });

  test('ungültiger Playbook-Status wird abgelehnt', () => {
    const { error } = createTicketSchema.validate({
      title: 'Test',
      analystState: {
        checklist: [],
        playbook: { id: 'x', step: 0, status: 'illegal_value' },
      },
    });
    expect(error).toBeDefined();
  });

  test('Checkliste über 100 Items wird abgelehnt', () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ id: `c${i}`, label: `Item ${i}`, done: false }));
    const { error } = createTicketSchema.validate({ title: 'Test', analystState: { checklist: items, playbook: {} } });
    expect(error).toBeDefined();
  });

  test('leerer analystState {} wird akzeptiert (Joi befüllt Defaults: checklist+playbook)', () => {
    // Joi füllt bei leerem {} die definierten Schlüssel mit ihren Defaults auf.
    const { error, value } = createTicketSchema.validate({ title: 'Test', analystState: {} });
    expect(error).toBeUndefined();
    // Joi-Defaults: checklist → [], playbook → {}
    expect(value.analystState.checklist).toEqual([]);
    expect(value.analystState.playbook).toEqual({});
  });

  test('unbekannte Felder in analystState werden entfernt (stripUnknown)', () => {
    const { value } = createTicketSchema.validate({
      title: 'Test',
      analystState: { checklist: [], playbook: {}, hackField: 'bad' },
    });
    expect(value.analystState.hackField).toBeUndefined();
  });
});

describe('listTicketsSchema Validierung', () => {
  test('leere Query ist gültig', () => {
    const { error, value } = listTicketsSchema.validate({});
    expect(error).toBeUndefined();
    expect(value.limit).toBe(50);
    expect(value.offset).toBe(0);
  });

  test('gültige Filter werden akzeptiert', () => {
    const { error, value } = listTicketsSchema.validate({
      state: 'OPEN',
      status: 'in_progress',
      priority: 'high',
      limit: '100',
    });
    expect(error).toBeUndefined();
    expect(value.limit).toBe(100);
  });

  test('limit über 500 wird abgelehnt', () => {
    const { error } = listTicketsSchema.validate({ limit: 1000 });
    expect(error).toBeDefined();
  });

  test('reale Inbound-Quellen sind als Filter gültig (crowdsec/email/dataplane u.a.)', () => {
    // Diese Quellen werden von Live-Adaptern an Tickets vergeben (CrowdsecProcessor,
    // EmailProcessor, DataplaneIncidentAdapter) → müssen filterbar sein, nicht 400.
    for (const source of ['crowdsec', 'email', 'dataplane', 'wazuh', 'qradar', 'splunk', 'manual', 'threat_hunt']) {
      const { error } = listTicketsSchema.validate({ source });
      expect(error).toBeUndefined();
    }
  });

  test('unbekannte Quelle wird als Filter abgelehnt (Enum bleibt geschlossen)', () => {
    const { error } = listTicketsSchema.validate({ source: 'bogus_source' });
    expect(error).toBeDefined();
  });
});
