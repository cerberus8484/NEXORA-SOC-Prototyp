'use strict';

const { YaraRule, isDangerousRegex } = require('../../src/domain/YaraRule');
const { YaraService } = require('../../src/services/YaraService');
const { InMemoryYaraRepository } = require('../../src/repositories/InMemoryYaraRepository');

describe('isDangerousRegex() — ReDoS-Erkennung', () => {
  it('erkennt verschachtelte Quantoren (a+)+', () => {
    expect(isDangerousRegex('(a+)+$')).toBe(true);
    expect(isDangerousRegex('(a*)*')).toBe(true);
    expect(isDangerousRegex('(a+)*')).toBe(true);
    expect(isDangerousRegex('(.*)+')).toBe(true);
  });

  it('lässt harmlose Regex durch', () => {
    expect(isDangerousRegex('\\d{1,3}\\.\\d{1,3}')).toBe(false);
    expect(isDangerousRegex('mimikatz|lsass')).toBe(false);
    expect(isDangerousRegex('[a-f0-9]{32}')).toBe(false);
  });
});

describe('YaraRule.match() — ReDoS-Schutz', () => {
  it('gefährliche Regex matched nicht (wird übersprungen statt zu hängen)', () => {
    const r = new YaraRule({ name: 'evil', patterns: [{ id: '1', type: 'regex', value: '(a+)+$', modifiers: [] }] });
    const start = Date.now();
    const res = r.match('a'.repeat(40) + 'X');
    expect(Date.now() - start).toBeLessThan(200); // darf nicht hängen
    expect(res.matched).toBe(false);
  });

  it('überlangen Input kappt (kein unbegrenztes Scannen)', () => {
    const r = new YaraRule({ name: 'x', patterns: [{ id: '1', type: 'text', value: 'needle', modifiers: [] }] });
    const huge = 'a'.repeat(500000) + 'needle';
    const start = Date.now();
    r.match(huge);
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('YaraService.createRule() — lehnt gefährliche Regex ab', () => {
  function svc() { return new YaraService({ repo: new InMemoryYaraRepository() }); }

  it('wirft 400 bei ReDoS-Regex', async () => {
    await expect(svc().createRule({
      name: 'evil', patterns: [{ id: '1', type: 'regex', value: '(a+)+$', modifiers: [] }],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('akzeptiert harmlose Regex', async () => {
    const r = await svc().createRule({
      name: 'ok', patterns: [{ id: '1', type: 'regex', value: '[a-f0-9]{32}', modifiers: [] }],
    });
    expect(r.id).toBeDefined();
  });
});
