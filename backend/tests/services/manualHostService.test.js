/**
 * @jest-environment node
 */
'use strict';

// ManualHostService — Geschäftslogik: list / add (+Audit) / remove (+Audit).
// Hängt am Repo-Interface + AuditService (beide injiziert/gefaked).

const { ManualHostService } = require('../../src/services/ManualHostService');
const { InMemoryManualHostRepository } = require('../../src/repositories/ManualHostRepository');

function make() {
  const repo = new InMemoryManualHostRepository();
  const audits = [];
  const auditService = { write: async (e) => { audits.push(e); } };
  const service = new ManualHostService({ repo, auditService });
  return { repo, audits, service };
}

const ACTOR = { userId: 'u1', label: 'admin@x.io', ip: '10.0.0.9' };

describe('ManualHostService — add', () => {
  test('legt einen Host an, source=manual, und auditiert', async () => {
    const { service, audits } = make();
    const host = await service.add({ hostname: 'fw-edge', ipAddresses: ['10.0.10.1'], os: 'OPNsense' }, ACTOR);
    expect(host.source).toBe('manual');
    expect(host.hostname).toBe('fw-edge');
    expect(host.createdBy).toBe('admin@x.io');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'MANUAL_HOST_ADDED', targetId: host.id });
  });

  test('list liefert angelegte Hosts', async () => {
    const { service } = make();
    await service.add({ hostname: 'a' }, ACTOR);
    await service.add({ hostname: 'b' }, ACTOR);
    const all = await service.list();
    expect(all.map((h) => h.hostname).sort()).toEqual(['a', 'b']);
  });
});

describe('ManualHostService — remove', () => {
  test('entfernt einen Host und auditiert', async () => {
    const { service, audits } = make();
    const host = await service.add({ hostname: 'tmp' }, ACTOR);
    const ok = await service.remove(host.id, ACTOR);
    expect(ok).toBe(true);
    expect(await service.list()).toHaveLength(0);
    expect(audits.some((a) => a.action === 'MANUAL_HOST_REMOVED' && a.targetId === host.id)).toBe(true);
  });

  test('remove eines unbekannten Hosts → false, kein Audit', async () => {
    const { service, audits } = make();
    const ok = await service.remove('nope', ACTOR);
    expect(ok).toBe(false);
    expect(audits.some((a) => a.action === 'MANUAL_HOST_REMOVED')).toBe(false);
  });
});
