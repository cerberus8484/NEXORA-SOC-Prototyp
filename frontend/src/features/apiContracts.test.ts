// Vertrags-Tests für die dünnen API-Wrapper (features/**/<x>Api.ts).
// Sie kodieren Endpoint-Pfade und Request-Form — eine Regression hier (falscher Pfad,
// fehlender Body) ist ein echter Bug. Der zentrale apiClient wird gemockt; wir prüfen
// nur, dass jede Methode Verb + Pfad + Body korrekt verdrahtet.

import { describe, test, expect, vi, beforeEach } from 'vitest';

// Alle <x>Api.ts importieren '../../lib/apiClient' → derselbe aufgelöste Modulpfad.
vi.mock('../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: 'ok' });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../lib/apiClient';
import { siemApi } from './siem/siemApi';
import { huntApi } from './hunts/huntApi';
import { ticketApi } from './tickets/ticketApi';
import { qradarApi } from './qradar/qradarApi';
import { evidenceApi } from './evidence/evidenceApi';
import { detectionApi } from './detections/detectionApi';
import { hostsApi } from './hosts/hostsApi';
import { auditApi } from './audit/auditApi';
import { systemApi } from './system/systemApi';
import { wazuhApi } from './wazuh/wazuhApi';
import { yaraApi } from './yara/yaraApi';
import { ragApi } from './rag/ragApi';
import { threatIntelApi } from './threatIntel/threatIntelApi';
import { useCaseApi } from './tickets/useCaseApi';
import { templateApi } from './tickets/templateApi';
import { authApi } from './auth/authApi';
import { userApi } from './users/userApi';
import { agentApi } from './aiAgent/agentApi';
import { fetchKiConfig, saveKiConfig, fetchKiModels } from './settings/settingsApi';

const mGet = api.get as ReturnType<typeof vi.fn>;
const mPost = api.post as ReturnType<typeof vi.fn>;
const mPut = api.put as ReturnType<typeof vi.fn>;
const mPatch = api.patch as ReturnType<typeof vi.fn>;
const mDel = api.del as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('siemApi', () => {
  test('dashboard/telemetry/list treffen die richtigen Pfade', () => {
    siemApi.dashboard('wazuh');
    siemApi.telemetry('wazuh');
    siemApi.list();
    expect(mGet).toHaveBeenNthCalledWith(1, '/siem/wazuh/dashboard');
    expect(mGet).toHaveBeenNthCalledWith(2, '/siem/wazuh/telemetry');
    expect(mGet).toHaveBeenNthCalledWith(3, '/siem');
  });
});

describe('huntApi', () => {
  test('Lese-Endpunkte', () => {
    huntApi.catalog();
    huntApi.listSessions();
    huntApi.getSession('h1');
    huntApi.logs('h1');
    expect(mGet).toHaveBeenCalledWith('/hunts/catalog');
    expect(mGet).toHaveBeenCalledWith('/hunts');
    expect(mGet).toHaveBeenCalledWith('/hunts/h1');
    expect(mGet).toHaveBeenCalledWith('/hunts/h1/logs');
  });

  test('Schreib-Endpunkte mit Body', () => {
    huntApi.createSession({ targetHost: 'dc01' });
    huntApi.runCommand('h1', 'whoami');
    huntApi.requestAction('h1', { kind: 'isolate', reason: 'c2' });
    huntApi.rejectAction('h1', 'a1', 'nope');
    huntApi.saveNotes('h1', 'note');
    expect(mPost).toHaveBeenCalledWith('/hunts', { targetHost: 'dc01' });
    expect(mPost).toHaveBeenCalledWith('/hunts/h1/run-command', { command: 'whoami' });
    expect(mPost).toHaveBeenCalledWith('/hunts/h1/response-actions', { kind: 'isolate', reason: 'c2' });
    expect(mPost).toHaveBeenCalledWith('/hunts/h1/response-actions/a1/reject', { reason: 'nope' });
    expect(mPost).toHaveBeenCalledWith('/hunts/h1/notes', { content: 'note' });
  });

  test('Lifecycle-Aktionen ohne Body', () => {
    huntApi.start('h1');
    huntApi.pause('h1');
    huntApi.cancel('h1');
    huntApi.complete('h1');
    huntApi.approveAction('h1', 'a1', 'Betriebsrat BR-1');
    huntApi.createTicket('h1', 'f1');
    huntApi.addEvidence('h1', 'f1');
    expect(mPost).toHaveBeenCalledWith('/hunts/h1/start');
    expect(mPost).toHaveBeenCalledWith('/hunts/h1/complete');
    expect(mPost).toHaveBeenCalledWith('/hunts/h1/findings/f1/create-ticket');
    expect(mPost).toHaveBeenCalledWith('/hunts/h1/findings/f1/add-evidence');
  });
});

describe('ticketApi', () => {
  test('list mit Params, get/create/update/delete', () => {
    ticketApi.list({ state: 'open' });
    ticketApi.get('t1');
    ticketApi.create({ title: 'x' });
    ticketApi.update('t1', { title: 'y' });
    ticketApi.delete('t1');
    expect(mGet).toHaveBeenCalledWith('/tickets', { state: 'open' });
    expect(mGet).toHaveBeenCalledWith('/tickets/t1');
    expect(mPost).toHaveBeenCalledWith('/tickets', { title: 'x' });
    expect(mPut).toHaveBeenCalledWith('/tickets/t1', { title: 'y' });
    expect(mDel).toHaveBeenCalledWith('/tickets/t1');
  });

  test('FP-Workflow + Evidence', () => {
    ticketApi.fpPreview('t1', { ruleId: '100' });
    ticketApi.fpForward('t1', { ruleId: '100' });
    ticketApi.fpApply('t1', { ruleId: '100' });
    ticketApi.fpQuick('t1', { reason: 'multicast fp' });
    ticketApi.fpRevert('t1', 'e1');
    ticketApi.collectEvidence('t1');
    ticketApi.crossRef(['1.2.3.4'], 't1');
    expect(mPost).toHaveBeenCalledWith('/tickets/t1/fp-exception/preview', { ruleId: '100' });
    expect(mPost).toHaveBeenCalledWith('/tickets/t1/fp-exception/forward', { ruleId: '100' });
    expect(mPost).toHaveBeenCalledWith('/tickets/t1/fp-exception/quick', { reason: 'multicast fp' });
    expect(mPost).toHaveBeenCalledWith('/tickets/t1/fp-exception/revert', { exceptionId: 'e1' });
    expect(mPost).toHaveBeenCalledWith('/tickets/t1/collect-evidence', {});
    expect(mPost).toHaveBeenCalledWith('/tickets/cross-ref', { values: ['1.2.3.4'], excludeId: 't1' });
  });
});

describe('qradarApi', () => {
  test('Pfade inkl. Filter-Query', () => {
    qradarApi.stats();
    qradarApi.offenses();
    qradarApi.offenses('ALL');
    qradarApi.offense(42);
    qradarApi.events(42);
    expect(mGet).toHaveBeenCalledWith('/qradar/stats');
    expect(mGet).toHaveBeenCalledWith('/qradar/offenses?filter=OPEN');
    expect(mGet).toHaveBeenCalledWith('/qradar/offenses?filter=ALL');
    expect(mGet).toHaveBeenCalledWith('/qradar/offenses/42');
    expect(mGet).toHaveBeenCalledWith('/qradar/offenses/42/events');
  });
});

describe('evidenceApi', () => {
  test('list/recent/get/custody/export/add', () => {
    evidenceApi.list('t1');
    evidenceApi.recent();
    evidenceApi.recent(50);
    evidenceApi.get('e1');
    evidenceApi.custody('e1', 'verified', 'ok');
    evidenceApi.exportTicket('t1');
    evidenceApi.add({ ticketId: 't1', title: 'x' });
    expect(mGet).toHaveBeenCalledWith('/evidence', { ticketId: 't1' });
    expect(mGet).toHaveBeenCalledWith('/evidence', { limit: 200 });
    expect(mGet).toHaveBeenCalledWith('/evidence', { limit: 50 });
    expect(mPost).toHaveBeenCalledWith('/evidence/e1/custody', { action: 'verified', note: 'ok' });
    expect(mPost).toHaveBeenCalledWith('/evidence/export', { ticketId: 't1' });
    expect(mPost).toHaveBeenCalledWith('/evidence', { ticketId: 't1', title: 'x' });
  });
});

describe('detectionApi', () => {
  test('list + createCustom', () => {
    detectionApi.list({ search: 'mimikatz' });
    detectionApi.createCustom({ description: 'd', level: 10, fieldName: 'data', fieldType: 'match', fieldValue: 'x' });
    expect(mGet).toHaveBeenCalledWith('/detections', { search: 'mimikatz' });
    expect(mPost).toHaveBeenCalledWith('/detections/custom', expect.objectContaining({ level: 10 }));
  });
});

describe('hostsApi', () => {
  test('detail + alerts (mit/ohne hostname)', () => {
    hostsApi.detail('001');
    hostsApi.alerts('001');
    hostsApi.alerts('001', 'dc01');
    expect(mGet).toHaveBeenCalledWith('/hosts/001');
    expect(mGet).toHaveBeenCalledWith('/hosts/001/alerts', undefined);
    expect(mGet).toHaveBeenCalledWith('/hosts/001/alerts', { hostname: 'dc01' });
  });
});

describe('auditApi', () => {
  test('list + recent', () => {
    auditApi.list({ action: 'login' });
    auditApi.recent();
    expect(mGet).toHaveBeenCalledWith('/audit', { action: 'login' }, undefined);
    expect(mGet).toHaveBeenCalledWith('/audit', { limit: 25 }, undefined);
  });
  test('exportAudit POSTet an /audit/export (A6c)', () => {
    auditApi.exportAudit({ action: 'TICKET_CREATE', search: 'x', format: 'csv' });
    expect(mPost).toHaveBeenCalledWith('/audit/export', { action: 'TICKET_CREATE', search: 'x', format: 'csv' });
  });
});

describe('systemApi', () => {
  test('health + stats + control', () => {
    systemApi.health();
    systemApi.stats();
    systemApi.control();
    systemApi.runControlAction('app-restart', 'reauth-123');
    expect(mGet).toHaveBeenCalledWith('/health');
    expect(mGet).toHaveBeenCalledWith('/system/stats');
    expect(mGet).toHaveBeenCalledWith('/system/control');
    expect(mPost).toHaveBeenCalledWith('/system/control/app-restart', {}, { headers: { 'X-Reauth-Token': 'reauth-123' } });
  });
});

describe('wazuhApi', () => {
  test('agents/inventory/posture', () => {
    wazuhApi.agents();
    wazuhApi.inventory('001');
    wazuhApi.posture('001');
    expect(mGet).toHaveBeenCalledWith('/wazuh/agents');
    expect(mGet).toHaveBeenCalledWith('/wazuh/agents/001/inventory');
    expect(mGet).toHaveBeenCalledWith('/wazuh/agents/001/posture');
  });
});

describe('yaraApi', () => {
  test('list normalisiert enabledOnly/tag in Query', () => {
    yaraApi.list();
    yaraApi.list({ enabledOnly: true, tag: 'apt' });
    yaraApi.list({ enabledOnly: false });
    expect(mGet).toHaveBeenCalledWith('/yara', {});
    expect(mGet).toHaveBeenCalledWith('/yara', { enabledOnly: '1', tag: 'apt' });
    expect(mGet).toHaveBeenCalledWith('/yara', { enabledOnly: '0' });
  });

  test('get/create/update/delete/scan', () => {
    yaraApi.get('y1');
    yaraApi.create({ name: 'r' });
    yaraApi.update('y1', { enabled: false });
    yaraApi.delete('y1');
    yaraApi.scan('payload', 'apt');
    expect(mGet).toHaveBeenCalledWith('/yara/y1');
    expect(mPost).toHaveBeenCalledWith('/yara', { name: 'r' });
    expect(mPut).toHaveBeenCalledWith('/yara/y1', { enabled: false });
    expect(mDel).toHaveBeenCalledWith('/yara/y1');
    expect(mPost).toHaveBeenCalledWith('/yara/scan', { input: 'payload', tag: 'apt' });
  });
});

describe('ragApi', () => {
  test('status + reindex', () => {
    ragApi.status();
    ragApi.reindex();
    expect(mGet).toHaveBeenCalledWith('/rag/status', undefined, undefined);
    expect(mPost).toHaveBeenCalledWith('/rag/reindex', undefined, undefined);
  });
});

describe('threatIntelApi', () => {
  test('enrich', () => {
    threatIntelApi.enrich('ip', '1.2.3.4');
    expect(mPost).toHaveBeenCalledWith('/threat-intel/enrich', { indicatorType: 'ip', indicatorValue: '1.2.3.4' });
  });
});

describe('useCaseApi', () => {
  test('list/create/remove', () => {
    useCaseApi.list();
    useCaseApi.create('val');
    useCaseApi.remove('u1');
    expect(mGet).toHaveBeenCalledWith('/use-cases');
    expect(mPost).toHaveBeenCalledWith('/use-cases', { value: 'val' });
    expect(mDel).toHaveBeenCalledWith('/use-cases/u1');
  });
});

describe('templateApi', () => {
  test('list/create/update/remove', () => {
    templateApi.list();
    templateApi.create({ name: 'n' });
    templateApi.update('tp1', { name: 'n2' });
    templateApi.remove('tp1');
    expect(mGet).toHaveBeenCalledWith('/analysis-templates');
    expect(mPost).toHaveBeenCalledWith('/analysis-templates', { name: 'n' });
    expect(mPut).toHaveBeenCalledWith('/analysis-templates/tp1', { name: 'n2' });
    expect(mDel).toHaveBeenCalledWith('/analysis-templates/tp1');
  });
});

describe('authApi', () => {
  test('changePassword sendet beide Felder und löst zu void auf', async () => {
    await authApi.changePassword('old', 'new');
    expect(mPost).toHaveBeenCalledWith('/auth/change-password', { currentPassword: 'old', newPassword: 'new' });
  });
});

describe('userApi', () => {
  test('list/create/setRole/setActive/resetPassword', () => {
    userApi.list();
    userApi.create({ email: 'a@b.de', password: 'pw', role: 'analyst' });
    userApi.setRole('u1', 'engineer');
    userApi.setActive('u1', false);
    userApi.resetPassword('u1');
    expect(mGet).toHaveBeenCalledWith('/users');
    expect(mPost).toHaveBeenCalledWith('/users', { email: 'a@b.de', password: 'pw', role: 'analyst' });
    expect(mPatch).toHaveBeenCalledWith('/users/u1/role', { role: 'engineer' });
    expect(mPatch).toHaveBeenCalledWith('/users/u1/active', { isActive: false });
    expect(mPost).toHaveBeenCalledWith('/users/u1/reset-password');
  });
});

describe('agentApi', () => {
  test('list/propose/approve/reject', () => {
    agentApi.list();
    agentApi.list('pending');
    agentApi.propose('t1', 'triage');
    agentApi.approve('s1');
    agentApi.reject('s1', 'fp');
    expect(mGet).toHaveBeenCalledWith('/agent/suggestions', undefined);
    expect(mGet).toHaveBeenCalledWith('/agent/suggestions', { status: 'pending' });
    expect(mPost).toHaveBeenCalledWith('/agent/propose', { ticketId: 't1', kind: 'triage' });
    expect(mPost).toHaveBeenCalledWith('/agent/suggestions/s1/approve');
    expect(mPost).toHaveBeenCalledWith('/agent/suggestions/s1/reject', { reason: 'fp' });
  });
});

describe('settingsApi', () => {
  test('fetchKiConfig/saveKiConfig packen das data-Feld aus', async () => {
    mGet.mockResolvedValueOnce({ data: { ollamaBaseUrl: 'u', ollamaModel: 'm', agentLlmProvider: 'ollama', ragEnabled: true } });
    const cfg = await fetchKiConfig();
    expect(mGet).toHaveBeenCalledWith('/settings/ki');
    expect(cfg.ollamaModel).toBe('m');

    mPut.mockResolvedValueOnce({ data: { ollamaBaseUrl: 'u', ollamaModel: 'm2', agentLlmProvider: 'stub', ragEnabled: false } });
    const saved = await saveKiConfig(cfg);
    expect(mPut).toHaveBeenCalledWith('/settings/ki', cfg);
    expect(saved.ollamaModel).toBe('m2');
  });

  test('fetchKiModels reicht die Hülle durch', async () => {
    mGet.mockResolvedValueOnce({
      data: ['llama3.2:3b'],
      reachable: true,
      modelAvailable: false,
      reason: 'model_missing',
      message: "Ollama erreichbar; Modell 'llama3.2:3b' ist nicht geladen",
    });
    const env = await fetchKiModels();
    expect(mGet).toHaveBeenCalledWith('/settings/ki/models');
    expect(env.reachable).toBe(true);
    expect(env.modelAvailable).toBe(false);
    expect(env.reason).toBe('model_missing');
  });
});
