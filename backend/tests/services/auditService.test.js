'use strict';

const { AuditService } = require('../../src/services/AuditService');

describe('AuditService — IP-Pseudonymisierung (Art. 25)', () => {
  test('speichert die IP gehasht, niemals roh', async () => {
    const svc = new AuditService();
    const entry = await svc.write({ action: 'LOGIN', actorLabel: 'a@x.io', ip: '203.0.113.7' });
    expect(entry.ip).not.toBe('203.0.113.7');
    expect(entry.ip).toMatch(/^h:[0-9a-f]{32}$/);
  });

  test('gleiche IP → gleicher Hash (deterministisch, für Korrelation)', async () => {
    const svc = new AuditService();
    const a = await svc.write({ action: 'LOGIN', ip: '10.0.0.5' });
    const b = await svc.write({ action: 'LOGIN', ip: '10.0.0.5' });
    expect(a.ip).toBe(b.ip);
  });

  test('verschiedene IPs → verschiedene Hashes', async () => {
    const svc = new AuditService();
    const a = await svc.write({ action: 'LOGIN', ip: '10.0.0.5' });
    const b = await svc.write({ action: 'LOGIN', ip: '10.0.0.6' });
    expect(a.ip).not.toBe(b.ip);
  });

  test('leere IP bleibt leer (kein Hash von Nichts)', async () => {
    const svc = new AuditService();
    const entry = await svc.write({ action: 'LOGIN' });
    expect(entry.ip).toBe('');
  });
});
