'use strict';

const { collectEndpointEvidence } = require('../../src/integrations/adapters/wazuh/wazuhEvidenceCollector');

// Fake-EvidenceService — protokolliert add()-Aufrufe.
function makeEvidenceService() {
  const calls = [];
  return {
    calls,
    async add(data) { calls.push(data); return { ok: true, evidence: { id: 'ev-' + calls.length } }; },
  };
}

// Fake-Wazuh-Client mit aktivierter API und einfachen Syscollector-Daten.
function makeWazuh(overrides = {}) {
  return {
    isEnabled: () => true,
    getProcesses:      async () => [{ pid: 1, name: 'init', state: 'sleeping', resident: 1000 }],
    getListeningPorts: async () => [{ local_port: 22, protocol: 'tcp', process: 'sshd' }],
    getNetInterfaces:  async () => [{ name: 'eth0', mac: 'aa:bb', ipv4: ['10.0.0.5'] }],
    ...overrides,
  };
}

describe('collectEndpointEvidence', () => {
  test('erzeugt Evidence-Einträge für Prozesse, Ports und Interfaces', async () => {
    const evidenceService = makeEvidenceService();
    const wazuh = makeWazuh();

    const count = await collectEndpointEvidence('042', 'ticket-1', evidenceService, { wazuh });

    expect(count).toBe(3);
    expect(evidenceService.calls).toHaveLength(3);
    expect(evidenceService.calls.map((c) => c.type)).toEqual(['process', 'network', 'network']);
    evidenceService.calls.forEach((c) => {
      expect(c.ticketId).toBe('ticket-1');
      expect(c.source).toBe('evidenceCollector');
      expect(c.collectedBy).toBe('system:evidence-collector');
      expect(typeof c.rawText).toBe('string');
    });
  });

  test('ein einzelner Syscollector-Fehler bricht nicht alles ab (fail-safe)', async () => {
    const evidenceService = makeEvidenceService();
    const wazuh = makeWazuh({
      getListeningPorts: async () => { throw new Error('Wazuh 500'); },
    });

    const count = await collectEndpointEvidence('042', 'ticket-1', evidenceService, { wazuh });

    // Prozesse + Interfaces gesammelt, Ports übersprungen.
    expect(count).toBe(2);
    expect(evidenceService.calls.map((c) => c.title)).toEqual([
      expect.stringContaining('Prozesse'),
      expect.stringContaining('Interfaces'),
    ]);
  });

  test('keine Einträge wenn agentId fehlt', async () => {
    const evidenceService = makeEvidenceService();
    const wazuh = makeWazuh();

    const count = await collectEndpointEvidence('', 'ticket-1', evidenceService, { wazuh });

    expect(count).toBe(0);
    expect(evidenceService.calls).toHaveLength(0);
  });

  test('keine Einträge wenn Wazuh-API nicht konfiguriert ist', async () => {
    const evidenceService = makeEvidenceService();
    const wazuh = makeWazuh({ isEnabled: () => false });

    const count = await collectEndpointEvidence('042', 'ticket-1', evidenceService, { wazuh });

    expect(count).toBe(0);
    expect(evidenceService.calls).toHaveLength(0);
  });

  test('leere Syscollector-Antwort erzeugt keinen Evidence-Eintrag', async () => {
    const evidenceService = makeEvidenceService();
    const wazuh = makeWazuh({
      getProcesses:      async () => [],
      getListeningPorts: async () => [],
      getNetInterfaces:  async () => [],
    });

    const count = await collectEndpointEvidence('042', 'ticket-1', evidenceService, { wazuh });

    expect(count).toBe(0);
    expect(evidenceService.calls).toHaveLength(0);
  });
});
