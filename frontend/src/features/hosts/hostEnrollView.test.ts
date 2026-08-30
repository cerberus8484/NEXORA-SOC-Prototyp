import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => ({ api: { get: vi.fn(), post: vi.fn().mockResolvedValue({ data: 'ok' }) } }));

import { validateAddHost, enrollmentSteps } from './hostEnrollView';
import { api } from '../../lib/apiClient';
import { hostsApi } from './hostsApi';

const mPost = api.post as ReturnType<typeof vi.fn>;
beforeEach(() => { vi.clearAllMocks(); });

describe('validateAddHost', () => {
  test('gültiger Name (+ optionale IP) → ok', () => {
    expect(validateAddHost({ name: 'web01', ip: '10.0.10.20' }).ok).toBe(true);
    expect(validateAddHost({ name: 'db-prod_1.local', ip: '' }).ok).toBe(true);
  });
  test('Name mit Leerzeichen/Sonderzeichen → Fehler', () => {
    expect(validateAddHost({ name: 'web 01', ip: '' }).errors.name).toBeTruthy();
    expect(validateAddHost({ name: 'rm;-rf', ip: '' }).ok).toBe(false);
    expect(validateAddHost({ name: '', ip: '' }).ok).toBe(false);
  });
  test('ungültige IP → Fehler; leere IP erlaubt', () => {
    expect(validateAddHost({ name: 'web01', ip: '999.1.1.1' }).errors.ip).toBeTruthy();
    expect(validateAddHost({ name: 'web01', ip: 'nope' }).ok).toBe(false);
    expect(validateAddHost({ name: 'web01', ip: '' }).ok).toBe(true);
  });
});

describe('enrollmentSteps', () => {
  test('nennt ID/Name und warnt vor Einmaligkeit des Keys', () => {
    const steps = enrollmentSteps({ id: '005', name: 'web01', key: 'K' });
    expect(steps.join(' ')).toMatch(/005/);
    expect(steps.join(' ')).toMatch(/web01/);
    expect(steps.join(' ').toLowerCase()).toMatch(/einmal/);
    expect(steps.join(' ')).not.toMatch(/\bK\b.*Key/); // der Key-Wert selbst steht NICHT in der Anleitung
  });
});

describe('hostsApi.addHost', () => {
  test('POST /hosts mit Body', () => {
    hostsApi.addHost({ name: 'web01', ip: '10.0.10.20' });
    expect(mPost).toHaveBeenCalledWith('/hosts', { name: 'web01', ip: '10.0.10.20' });
  });
});
