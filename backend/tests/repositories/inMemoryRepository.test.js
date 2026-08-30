'use strict';

const { InMemoryTicketRepository } = require('../../src/repositories/InMemoryTicketRepository');
const { Ticket }                   = require('../../src/domain/Ticket');

describe('InMemoryTicketRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new InMemoryTicketRepository();
  });

  test('save() speichert Ticket und gibt Kopie zurück', async () => {
    const ticket = Ticket.create({ title: 'C2 Beacon' });
    const saved  = await repo.save(ticket);
    expect(saved.id).toBe(ticket.id);
    expect(saved.title).toBe('C2 Beacon');
    expect(repo.size()).toBe(1);
  });

  test('save() überschreibt bei gleichem id (upsert)', async () => {
    const ticket = Ticket.create({ title: 'Original' });
    await repo.save(ticket);
    ticket.title = 'Updated';
    await repo.save(ticket);
    expect(repo.size()).toBe(1);
    const found = await repo.findById(ticket.id);
    expect(found.title).toBe('Updated');
  });

  test('findById() gibt Ticket zurück', async () => {
    const ticket = Ticket.create({ title: 'Test' });
    await repo.save(ticket);
    const found = await repo.findById(ticket.id);
    expect(found.id).toBe(ticket.id);
  });

  test('findById() gibt null für unbekannte ID', async () => {
    const found = await repo.findById('nonexistent');
    expect(found).toBeNull();
  });

  test('findAll() gibt alle Tickets mit total zurück', async () => {
    await repo.save(Ticket.create({ title: 'T1' }));
    await repo.save(Ticket.create({ title: 'T2' }));
    const result = await repo.findAll();
    expect(result.total).toBe(2);
    expect(result.data.length).toBe(2);
  });

  test('findAll() filtert nach state', async () => {
    await repo.save(Ticket.create({ title: 'Open',   state: 'OPEN'   }));
    await repo.save(Ticket.create({ title: 'Closed', state: 'CLOSED' }));
    const result = await repo.findAll({ state: 'OPEN' });
    expect(result.total).toBe(1);
    expect(result.data[0].title).toBe('Open');
  });

  test('findAll() filtert nach status', async () => {
    await repo.save(Ticket.create({ title: 'Hold',     status: 'on_hold'     }));
    await repo.save(Ticket.create({ title: 'Progress', status: 'in_progress' }));
    const result = await repo.findAll({ status: 'on_hold' });
    expect(result.total).toBe(1);
    expect(result.data[0].title).toBe('Hold');
  });

  test('findByOffense() liefert offenes Ticket zu (source, offenseId)', async () => {
    await repo.save(Ticket.create({ title: 'Wazuh', source: 'wazuh', offenseId: 'wazuh:rule:5503:agent:001' }));
    const hit = await repo.findByOffense('wazuh', 'wazuh:rule:5503:agent:001');
    expect(hit).not.toBeNull();
    expect(hit.title).toBe('Wazuh');
    expect(await repo.findByOffense('wazuh', 'wazuh:rule:9999:agent:001')).toBeNull();
  });

  test('findByOffense() ignoriert geschlossene Tickets', async () => {
    await repo.save(Ticket.create({ title: 'Closed', source: 'wazuh', state: 'CLOSED', offenseId: 'wazuh:rule:5503:agent:001' }));
    expect(await repo.findByOffense('wazuh', 'wazuh:rule:5503:agent:001')).toBeNull();
  });

  test('findAll() filtert nach priority', async () => {
    await repo.save(Ticket.create({ title: 'High', priority: 'high' }));
    await repo.save(Ticket.create({ title: 'Low',  priority: 'low'  }));
    const result = await repo.findAll({ priority: 'high' });
    expect(result.total).toBe(1);
  });

  test('findAll() filtert nach source (dataplane = korrelierte Vorfälle)', async () => {
    await repo.save(Ticket.create({ title: 'Korreliert', source: 'dataplane' }));
    await repo.save(Ticket.create({ title: 'Wazuh',      source: 'wazuh' }));
    const result = await repo.findAll({ source: 'dataplane' });
    expect(result.total).toBe(1);
    expect(result.data[0].title).toBe('Korreliert');
  });

  test('findAll() respektiert limit/offset', async () => {
    for (let i = 0; i < 10; i++) {
      await repo.save(Ticket.create({ title: `T${i}` }));
    }
    const page = await repo.findAll({ limit: 3, offset: 3 });
    expect(page.data.length).toBe(3);
    expect(page.total).toBe(10);
  });

  test('delete() entfernt Ticket', async () => {
    const ticket = Ticket.create({ title: 'To Delete' });
    await repo.save(ticket);
    await repo.delete(ticket.id);
    expect(repo.size()).toBe(0);
    const found = await repo.findById(ticket.id);
    expect(found).toBeNull();
  });

  test('delete() von unbekannter ID wirft keinen Fehler', async () => {
    await expect(repo.delete('nonexistent')).resolves.toBeUndefined();
  });

  test('save() gibt Kopie zurück — Mutation des Original ändert Store nicht', async () => {
    const ticket = Ticket.create({ title: 'Original' });
    const saved  = await repo.save(ticket);
    saved.title  = 'Mutated';
    const found  = await repo.findById(ticket.id);
    expect(found.title).toBe('Original'); // Store unverändert
  });
});

describe('TicketRepository Interface', () => {
  const { TicketRepository } = require('../../src/repositories/TicketRepository');

  test('nicht implementierte Methoden werfen Fehler', async () => {
    const repo = new TicketRepository();
    await expect(repo.save({})).rejects.toThrow('nicht implementiert');
    await expect(repo.findById('x')).rejects.toThrow('nicht implementiert');
    await expect(repo.findAll()).rejects.toThrow('nicht implementiert');
    await expect(repo.delete('x')).rejects.toThrow('nicht implementiert');
  });
});
