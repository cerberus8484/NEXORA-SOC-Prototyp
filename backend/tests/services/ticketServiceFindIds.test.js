'use strict';

// TicketService.findIds — „alle gefilterten auswählen": nur IDs, gleiche Filterung wie findAll.

const { TicketService } = require('../../src/services/TicketService');

function repoStub(result) {
  return { findAll: jest.fn(async () => result), calls: () => result };
}

describe('TicketService.findIds', () => {
  test('gibt nur { ids, total } zurück (aus findAll abgeleitet)', async () => {
    const repo = repoStub({ data: [{ id: 'a', title: 'x' }, { id: 'b', title: 'y' }], total: 2 });
    const svc = new TicketService(repo);
    const res = await svc.findIds({ state: 'OPEN', limit: 5000 });
    expect(res).toEqual({ ids: ['a', 'b'], total: 2 });
  });

  test('reicht die Filter unverändert an findAll durch (keine Divergenz zur Liste)', async () => {
    const repo = repoStub({ data: [], total: 0 });
    const svc = new TicketService(repo);
    const filters = { state: 'OPEN', priority: 'high', search: 'ssh', limit: 5000, offset: 0 };
    await svc.findIds(filters);
    expect(repo.findAll).toHaveBeenCalledWith(filters);
  });

  test('leeres Ergebnis → leere ids', async () => {
    const svc = new TicketService(repoStub({ data: [], total: 0 }));
    expect(await svc.findIds({})).toEqual({ ids: [], total: 0 });
  });
});
