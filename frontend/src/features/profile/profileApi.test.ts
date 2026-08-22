// TDD RED: Vertrags-Tests für profileApi — prüfen Pfad, Body, Rückgabetyp-Vertrag.
// Kein Buffer, kein @types/node (Web-Build-Constraint).

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: {}, requestId: 'test' });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { profileApi, type UserProfile } from './profileApi';

const mGet = api.get as ReturnType<typeof vi.fn>;
const mPut = api.put as ReturnType<typeof vi.fn>;

const baseProfile: UserProfile = {
  id: 'u1',
  email: 'alice@soc.test',
  displayName: 'Alice',
  phone: '+49 123',
  theme: 'dark',
  language: 'de',
  dateFormat: 'dmy',
  role: 'analyst',
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mGet.mockResolvedValue({ data: baseProfile });
  mPut.mockResolvedValue({ data: baseProfile });
});

describe('profileApi.getProfile', () => {
  test('trifft GET /profile', () => {
    profileApi.getProfile();
    expect(mGet).toHaveBeenCalledWith('/profile', undefined, undefined);
  });

  test('gibt UserProfile aus data-Envelope zurück', async () => {
    mGet.mockResolvedValueOnce({ data: baseProfile });
    const p = await profileApi.getProfile();
    expect(p.email).toBe('alice@soc.test');
    expect(p.phone).toBe('+49 123');
    expect(p.theme).toBe('dark');
  });

  test('UserProfile enthält phone + theme', async () => {
    const res = await profileApi.getProfile();
    expect(res).toHaveProperty('phone');
    expect(res).toHaveProperty('theme');
  });

  test('leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    profileApi.getProfile({ signal: ctrl.signal });
    expect(mGet).toHaveBeenCalledWith('/profile', undefined, { signal: ctrl.signal });
  });
});

describe('profileApi.updateProfile', () => {
  test('trifft PUT /profile mit korrektem Body', () => {
    profileApi.updateProfile({ displayName: 'Bob', phone: '+49 999', theme: 'light' });
    expect(mPut).toHaveBeenCalledWith('/profile', { displayName: 'Bob', phone: '+49 999', theme: 'light' }, undefined);
  });

  test('gibt aktualisierten UserProfile zurück', async () => {
    mPut.mockResolvedValueOnce({ data: { ...baseProfile, displayName: 'Bob', theme: 'light' } });
    const p = await profileApi.updateProfile({ displayName: 'Bob', theme: 'light' });
    expect(p.displayName).toBe('Bob');
    expect(p.theme).toBe('light');
  });

  test('partial update — nur displayName', () => {
    profileApi.updateProfile({ displayName: 'Only Name' });
    expect(mPut).toHaveBeenCalledWith('/profile', { displayName: 'Only Name' }, undefined);
  });

  test('partial update — nur theme', () => {
    profileApi.updateProfile({ theme: 'dark' });
    expect(mPut).toHaveBeenCalledWith('/profile', { theme: 'dark' }, undefined);
  });

  test('partial update — language + dateFormat', () => {
    profileApi.updateProfile({ language: 'en', dateFormat: 'iso' });
    expect(mPut).toHaveBeenCalledWith('/profile', { language: 'en', dateFormat: 'iso' }, undefined);
  });

  test('gibt aktualisierte language + dateFormat zurück', async () => {
    mPut.mockResolvedValueOnce({ data: { ...baseProfile, language: 'en', dateFormat: 'iso' } });
    const p = await profileApi.updateProfile({ language: 'en', dateFormat: 'iso' });
    expect(p.language).toBe('en');
    expect(p.dateFormat).toBe('iso');
  });

  test('leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    profileApi.updateProfile({ displayName: 'X' }, { signal: ctrl.signal });
    expect(mPut).toHaveBeenCalledWith('/profile', { displayName: 'X' }, { signal: ctrl.signal });
  });
});
