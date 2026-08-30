'use strict';

const { createInventoryLookupCache, toLookupInput } = require('../../src/correlation/inventoryLookupCache');

// Fake-Client mit zählbaren Aufrufen.
function makeClient({ enabled = true, agents = [], inventoryById = {}, failList = false, failInv = null } = {}) {
  const calls = { listAgents: 0, getAgentInventory: 0 };
  return {
    calls,
    isEnabled: () => enabled,
    listAgents: async () => { calls.listAgents += 1; if (failList) throw new Error('list down'); return agents; },
    getAgentInventory: async (id) => {
      calls.getAgentInventory += 1;
      if (failInv === id) throw new Error('inv down');
      return inventoryById[id] || null;
    },
  };
}

const AGENTS = [{ id: '009', name: 'DC01-agent' }, { id: '001', name: 'CERBERUS' }];
const INV = {
  '009': { os: { hostname: 'DC01' }, interfaces: [{ name: 'Ethernet', mac: 'bc:24:11:7b:45:69' }],
    addresses: [{ iface: 'Ethernet', address: '10.99.99.10', proto: 'ipv4' }] },
  '001': { os: { hostname: 'CERBERUS' }, interfaces: [{ name: 'Ethernet 2', mac: '9c:6b:00:76:e6:fe' }],
    addresses: [{ iface: 'Ethernet 2', address: '192.168.241.102', proto: 'ipv4' }] },
};

describe('toLookupInput', () => {
  test('os.hostname bevorzugt, FQDN null, Interfaces/Addresses gemappt', () => {
    const out = toLookupInput({ id: 9, name: 'DC01-agent' }, INV['009']);
    expect(out).toMatchObject({ agentId: '9', host: 'DC01', fqdn: null });
    expect(out.interfaces[0]).toEqual({ name: 'Ethernet', mac: 'bc:24:11:7b:45:69' });
    expect(out.addresses[0]).toEqual({ iface: 'Ethernet', address: '10.99.99.10', proto: 'ipv4' });
  });
  test('ohne os → Fallback auf Agent-Name', () => {
    expect(toLookupInput({ id: '7', name: 'WindowsClient' }, null).host).toBe('WindowsClient');
  });
});

describe('createInventoryLookupCache', () => {
  test('baut byIp-Lookup aus Agentenliste + Inventar', async () => {
    const client = makeClient({ agents: AGENTS, inventoryById: INV });
    const cache = createInventoryLookupCache({ client });
    const lookup = await cache.getLookup();
    expect(lookup.byIp['10.99.99.10']).toMatchObject({ host: 'DC01', mac: 'bc:24:11:7b:45:69', interfaceName: 'Ethernet' });
    expect(lookup.byIp['192.168.241.102']).toMatchObject({ host: 'CERBERUS', mac: '9c:6b:00:76:e6:fe' });
  });

  test('cacht innerhalb der TTL (keine erneuten API-Calls)', async () => {
    let t = 1000;
    const client = makeClient({ agents: AGENTS, inventoryById: INV });
    const cache = createInventoryLookupCache({ client, ttlMs: 5000, now: () => t });
    await cache.getLookup();
    await cache.getLookup();
    expect(client.calls.listAgents).toBe(1); // zweiter Aufruf aus Cache
    t += 6000; // TTL abgelaufen
    await cache.getLookup();
    expect(client.calls.listAgents).toBe(2);
  });

  test('Client nicht enabled → null, keine API-Calls', async () => {
    const client = makeClient({ enabled: false, agents: AGENTS });
    const cache = createInventoryLookupCache({ client });
    expect(await cache.getLookup()).toBeNull();
    expect(client.calls.listAgents).toBe(0);
  });

  test('listAgents wirft → soft-fail null (UI nicht kaputt)', async () => {
    const client = makeClient({ failList: true });
    const cache = createInventoryLookupCache({ client });
    expect(await cache.getLookup()).toBeNull();
  });

  test('einzelnes Agent-Inventar wirft → anderer Agent bleibt im Lookup', async () => {
    const client = makeClient({ agents: AGENTS, inventoryById: INV, failInv: '001' });
    const cache = createInventoryLookupCache({ client });
    const lookup = await cache.getLookup();
    expect(lookup.byIp['10.99.99.10']).toBeDefined();      // DC01 ok
    expect(lookup.byIp['192.168.241.102']).toBeUndefined(); // CERBERUS-Inventar fiel aus
  });
});
