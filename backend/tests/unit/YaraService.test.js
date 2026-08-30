'use strict';

const { YaraService }           = require('../../src/services/YaraService');
const { InMemoryYaraRepository } = require('../../src/repositories/InMemoryYaraRepository');

function makeService() {
  return new YaraService({ repo: new InMemoryYaraRepository() });
}

const PATTERN = [{ id: 'p1', type: 'text', value: 'mimikatz', modifiers: [] }];

describe('YaraService.createRule()', () => {
  it('legt neue Regel an', async () => {
    const svc = makeService();
    const r = await svc.createRule({ name: 'detect_mimikatz', patterns: PATTERN, severity: 'high' });
    expect(r.id).toBeDefined();
    expect(r.name).toBe('detect_mimikatz');
  });

  it('wirft 400 ohne name', async () => {
    const svc = makeService();
    await expect(svc.createRule({ patterns: PATTERN })).rejects.toMatchObject({ status: 400 });
  });

  it('wirft 400 ohne patterns', async () => {
    const svc = makeService();
    await expect(svc.createRule({ name: 'x', patterns: [] })).rejects.toMatchObject({ status: 400 });
  });

  it('wirft 409 bei Duplikat-Name', async () => {
    const svc = makeService();
    await svc.createRule({ name: 'dup', patterns: PATTERN });
    await expect(svc.createRule({ name: 'dup', patterns: PATTERN })).rejects.toMatchObject({ status: 409 });
  });
});

describe('YaraService.scan()', () => {
  it('findet Match gegen aktive Regel', async () => {
    const svc = makeService();
    await svc.createRule({ name: 'mimikatz', patterns: PATTERN });
    const { matches, scannedRules } = await svc.scan('cmd.exe mimikatz.exe');
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('mimikatz');
    expect(scannedRules).toBe(1);
  });

  it('kein Match bei abweichendem Input', async () => {
    const svc = makeService();
    await svc.createRule({ name: 'mimikatz', patterns: PATTERN });
    const { matches } = await svc.scan('harmless.exe');
    expect(matches).toHaveLength(0);
  });

  it('ignoriert deaktivierte Regeln', async () => {
    const svc = makeService();
    const r = await svc.createRule({ name: 'mimikatz', patterns: PATTERN });
    await svc.updateRule(r.id, { enabled: false });
    const { matches } = await svc.scan('mimikatz');
    expect(matches).toHaveLength(0);
  });

  it('leerer Input → keine Matches', async () => {
    const svc = makeService();
    const { matches, scannedRules } = await svc.scan('');
    expect(matches).toHaveLength(0);
    expect(scannedRules).toBe(0);
  });
});

describe('YaraService.deleteRule()', () => {
  it('löscht existierende Regel', async () => {
    const svc = makeService();
    const r = await svc.createRule({ name: 'x', patterns: PATTERN });
    await svc.deleteRule(r.id);
    const list = await svc.listRules();
    expect(list).toHaveLength(0);
  });

  it('wirft 404 bei unbekannter ID', async () => {
    const svc = makeService();
    await expect(svc.deleteRule('nonexistent')).rejects.toMatchObject({ status: 404 });
  });
});
