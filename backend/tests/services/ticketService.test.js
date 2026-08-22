'use strict';

const { TicketService } = require('../../src/services/TicketService');
const { NotFoundError } = require('../../src/errors/AppError');

describe('TicketService (In-Memory)', () => {
  let service;

  beforeEach(() => {
    service = new TicketService(); // frische Instanz pro Test
  });

  test('create() gibt Ticket mit id zurück', async () => {
    const t = await service.create({ title: 'C2 Beacon' });
    expect(t.id).toBeDefined();
    expect(t.title).toBe('C2 Beacon');
    expect(t.priority).toBe('medium');
    expect(t.state).toBe('OPEN');
    expect(t.status).toBe('assigned');
  });

  test('findById() gibt Ticket zurück', async () => {
    const created = await service.create({ title: 'LSASS Dump' });
    const found   = await service.findById(created.id);
    expect(found.id).toBe(created.id);
  });

  test('findById() wirft NotFoundError für unbekannte ID', async () => {
    await expect(service.findById('nonexistent-id'))
      .rejects.toThrow(NotFoundError);
  });

  test('findAll() gibt alle Tickets zurück', async () => {
    await service.create({ title: 'Ticket 1' });
    await service.create({ title: 'Ticket 2' });
    const result = await service.findAll();
    expect(result.total).toBe(2);
    expect(result.data.length).toBe(2);
  });

  test('findAll() filtert nach state', async () => {
    await service.create({ title: 'Open Ticket', state: 'OPEN' });
    await service.create({ title: 'Closed Ticket', state: 'CLOSED' });
    const result = await service.findAll({ state: 'OPEN' });
    expect(result.total).toBe(1);
    expect(result.data[0].title).toBe('Open Ticket');
  });

  test('findAll() filtert nach status', async () => {
    await service.create({ title: 'On Hold', status: 'on_hold' });
    await service.create({ title: 'In Progress', status: 'in_progress' });
    const result = await service.findAll({ status: 'on_hold' });
    expect(result.total).toBe(1);
    expect(result.data[0].title).toBe('On Hold');
  });

  test('findAll() filtert nach priority', async () => {
    await service.create({ title: 'Critical', priority: 'critical' });
    await service.create({ title: 'Low', priority: 'low' });
    const result = await service.findAll({ priority: 'critical' });
    expect(result.total).toBe(1);
  });

  test('findAll() sucht in title, ticketNr, srcIp', async () => {
    await service.create({ title: 'PowerShell C2 Beacon', srcIp: '185.220.101.47' });
    await service.create({ title: 'Unrelated Ticket' });
    const r1 = await service.findAll({ search: 'powershell' });
    expect(r1.total).toBe(1);
    const r2 = await service.findAll({ search: '185.220' });
    expect(r2.total).toBe(1);
  });

  test('findAll() respektiert limit und offset', async () => {
    for (let i = 0; i < 5; i++) await service.create({ title: `Ticket ${i}` });
    const page1 = await service.findAll({ limit: 2, offset: 0 });
    const page2 = await service.findAll({ limit: 2, offset: 2 });
    expect(page1.data.length).toBe(2);
    expect(page2.data.length).toBe(2);
    expect(page1.total).toBe(5);
  });

  test('update() ändert Felder', async () => {
    const t = await service.create({ title: 'Original' });
    const updated = await service.update(t.id, { status: 'in_progress', title: 'Updated' });
    expect(updated.status).toBe('in_progress');
    expect(updated.title).toBe('Updated');
  });

  test('update() wirft NotFoundError für unbekannte ID', async () => {
    await expect(service.update('nonexistent', { title: 'X' }))
      .rejects.toThrow(NotFoundError);
  });

  test('delete() entfernt Ticket', async () => {
    const t = await service.create({ title: 'To Delete' });
    await service.delete(t.id);
    await expect(service.findById(t.id)).rejects.toThrow(NotFoundError);
  });

  test('delete() wirft NotFoundError für unbekannte ID', async () => {
    await expect(service.delete('nonexistent')).rejects.toThrow(NotFoundError);
  });
});
