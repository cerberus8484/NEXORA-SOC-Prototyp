// Vertrags-Tests für provisioningApi — Pfade, Verben, Body/Query.
// Kein Buffer, kein @types/node (Web-Build-Constraint).

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: 'ok' });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { provisioningApi, NODE_ROLES, CAPABILITIES } from './provisioningApi';

const mGet = api.get as ReturnType<typeof vi.fn>;
const mPost = api.post as ReturnType<typeof vi.fn>;

beforeEach(() => { vi.clearAllMocks(); });

describe('provisioningApi.listNodes', () => {
  test('GET /provisioning/nodes ohne Query', () => {
    provisioningApi.listNodes();
    expect(mGet).toHaveBeenCalledWith('/provisioning/nodes', undefined, undefined);
  });
  test('leitet limit/offset als Query weiter', () => {
    provisioningApi.listNodes({ limit: 25, offset: 50 });
    expect(mGet).toHaveBeenCalledWith('/provisioning/nodes', { limit: 25, offset: 50 }, undefined);
  });
  test('leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    provisioningApi.listNodes(undefined, { signal: ctrl.signal });
    expect(mGet).toHaveBeenCalledWith('/provisioning/nodes', undefined, { signal: ctrl.signal });
  });
});

describe('provisioningApi.getNode', () => {
  test('GET /provisioning/nodes/:id', () => {
    provisioningApi.getNode('n-1');
    expect(mGet).toHaveBeenCalledWith('/provisioning/nodes/n-1', undefined, undefined);
  });
});

describe('provisioningApi.listEnrollmentProfiles', () => {
  test('GET /provisioning/enrollment-profiles', () => {
    provisioningApi.listEnrollmentProfiles();
    expect(mGet).toHaveBeenCalledWith('/provisioning/enrollment-profiles', undefined, undefined);
  });
});

describe('provisioningApi.createEnrollmentProfile', () => {
  test('POST /provisioning/enrollment-profiles mit Body', () => {
    const body = { name: 'lab', role: 'network_sensor' as const, capabilities: ['inventory' as const] };
    provisioningApi.createEnrollmentProfile(body);
    expect(mPost).toHaveBeenCalledWith('/provisioning/enrollment-profiles', body);
  });
});

describe('provisioningApi.mintToken', () => {
  test('POST /provisioning/enrollment-profiles/:id/token mit leerem Body', () => {
    provisioningApi.mintToken('p-1');
    expect(mPost).toHaveBeenCalledWith('/provisioning/enrollment-profiles/p-1/token', {});
  });
  test('leitet ttlSeconds weiter', () => {
    provisioningApi.mintToken('p-2', { ttlSeconds: 3600 });
    expect(mPost).toHaveBeenCalledWith('/provisioning/enrollment-profiles/p-2/token', { ttlSeconds: 3600 });
  });
});

describe('provisioningApi.listAudit', () => {
  test('GET /provisioning/audit mit subjectId-Filter', () => {
    provisioningApi.listAudit({ subjectId: 'n-1' });
    expect(mGet).toHaveBeenCalledWith('/provisioning/audit', { subjectId: 'n-1' }, undefined);
  });
});

describe('provisioningApi.listNodeCredentials', () => {
  test('GET /provisioning/nodes/:id/credentials', () => {
    provisioningApi.listNodeCredentials('n-1');
    expect(mGet).toHaveBeenCalledWith('/provisioning/nodes/n-1/credentials', undefined, undefined);
  });
  test('leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    provisioningApi.listNodeCredentials('n-1', { signal: ctrl.signal });
    expect(mGet).toHaveBeenCalledWith('/provisioning/nodes/n-1/credentials', undefined, { signal: ctrl.signal });
  });
});

describe('provisioningApi.revokeCredential', () => {
  test('POST .../credentials/:credId/revoke mit Grund', () => {
    provisioningApi.revokeCredential('n-1', 'c-9', 'compromise');
    expect(mPost).toHaveBeenCalledWith('/provisioning/nodes/n-1/credentials/c-9/revoke', { reason: 'compromise' });
  });
  test('ohne Grund → reason undefined', () => {
    provisioningApi.revokeCredential('n-1', 'c-9');
    expect(mPost).toHaveBeenCalledWith('/provisioning/nodes/n-1/credentials/c-9/revoke', { reason: undefined });
  });
});

describe('provisioningApi.retireNode', () => {
  test('POST /provisioning/nodes/:id/retire mit Grund', () => {
    provisioningApi.retireNode('n-1', 'lifecycle-end');
    expect(mPost).toHaveBeenCalledWith('/provisioning/nodes/n-1/retire', { reason: 'lifecycle-end' });
  });
});

describe('Allowed-Listen', () => {
  test('NODE_ROLES + CAPABILITIES spiegeln das Backend', () => {
    expect(NODE_ROLES).toContain('network_sensor');
    expect(NODE_ROLES).toHaveLength(5);
    expect(CAPABILITIES).toContain('inventory');
    expect(CAPABILITIES).toContain('sniffing');
    expect(CAPABILITIES).toHaveLength(9);
  });
});
