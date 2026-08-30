// Vertrags-Tests für deployApi — Pfade, Verben, Body, Reauth-Header.

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: 'ok' });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { deployApi } from './deployApi';

const mGet = api.get as ReturnType<typeof vi.fn>;
const mPost = api.post as ReturnType<typeof vi.fn>;

beforeEach(() => { vi.clearAllMocks(); });

describe('deployApi — read', () => {
  test('GET /deploy/modules', () => {
    deployApi.listModules();
    expect(mGet).toHaveBeenCalledWith('/deploy/modules', undefined, undefined);
  });
  test('GET /deploy/connectors', () => {
    deployApi.listConnectors();
    expect(mGet).toHaveBeenCalledWith('/deploy/connectors', undefined, undefined);
  });
  test('GET /deploy/runs/:id leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    deployApi.getRun('r-1', { signal: ctrl.signal });
    expect(mGet).toHaveBeenCalledWith('/deploy/runs/r-1', undefined, { signal: ctrl.signal });
  });
});

describe('deployApi — write', () => {
  test('POST /deploy/connectors mit Body + X-Reauth-Token-Header', () => {
    const body = { type: 'proxmox' as const, name: 'L', host: '10.0.99.100', apiToken: 't', targetNode: 'pve1' };
    deployApi.createConnector(body, 'reauth-abc');
    expect(mPost).toHaveBeenCalledWith('/deploy/connectors', body, { headers: { 'X-Reauth-Token': 'reauth-abc' } });
  });
  test('POST /deploy/specs mit Body', () => {
    const body = { moduleId: 'opnsense', connectorId: 'c1', targetNode: 'pve1', storage: 's', bridge: 'vmbr1', params: {} };
    deployApi.createSpec(body);
    expect(mPost).toHaveBeenCalledWith('/deploy/specs', body);
  });
  test('POST /deploy/specs/:id/plan mit leerem Body', () => {
    deployApi.plan('s-1');
    expect(mPost).toHaveBeenCalledWith('/deploy/specs/s-1/plan', {});
  });
  test('POST /deploy/runs/:id/approve mit note', () => {
    deployApi.approve('r-1', 'ok');
    expect(mPost).toHaveBeenCalledWith('/deploy/runs/r-1/approve', { note: 'ok' });
  });
  test('POST /deploy/runs/:id/apply sendet den X-Reauth-Token-Header', () => {
    deployApi.apply('r-1', 'reauth-abc');
    expect(mPost).toHaveBeenCalledWith('/deploy/runs/r-1/apply', {}, { headers: { 'X-Reauth-Token': 'reauth-abc' } });
  });
  test('POST /auth/deploy-reauth mit Passwort', () => {
    deployApi.reauth('geheim');
    expect(mPost).toHaveBeenCalledWith('/auth/deploy-reauth', { password: 'geheim' });
  });
});

describe('deployApi — Node-Update / Host-Key / Keypair (Slice 7)', () => {
  test('GET /deploy/keypair (maskiert) leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    deployApi.getKeypair({ signal: ctrl.signal });
    expect(mGet).toHaveBeenCalledWith('/deploy/keypair', undefined, { signal: ctrl.signal });
  });
  test('POST /deploy/keypair/generate sendet den X-Reauth-Token-Header', () => {
    deployApi.generateKeypair('reauth-abc');
    expect(mPost).toHaveBeenCalledWith('/deploy/keypair/generate', {}, { headers: { 'X-Reauth-Token': 'reauth-abc' } });
  });
  test('POST /deploy/nodes/:id/update mit agentVersion + Reauth-Header', () => {
    deployApi.updateNode('n-1', 'reauth-abc', '4.9.0');
    expect(mPost).toHaveBeenCalledWith('/deploy/nodes/n-1/update', { agentVersion: '4.9.0' }, { headers: { 'X-Reauth-Token': 'reauth-abc' } });
  });
  test('POST /deploy/nodes/:id/update ohne agentVersion → leerer Body', () => {
    deployApi.updateNode('n-1', 'reauth-abc');
    expect(mPost).toHaveBeenCalledWith('/deploy/nodes/n-1/update', {}, { headers: { 'X-Reauth-Token': 'reauth-abc' } });
  });
  test('POST /deploy/nodes/:id/hostkey/capture sendet den X-Reauth-Token-Header', () => {
    deployApi.captureHostKey('n-1', 'reauth-abc');
    expect(mPost).toHaveBeenCalledWith('/deploy/nodes/n-1/hostkey/capture', {}, { headers: { 'X-Reauth-Token': 'reauth-abc' } });
  });
});
