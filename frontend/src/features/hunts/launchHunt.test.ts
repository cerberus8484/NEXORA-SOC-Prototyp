import { describe, it, expect, vi } from 'vitest';
import { launchHunt, type HuntLauncher } from './launchHunt';
import type { CreateHuntBody } from './huntApi';

const body = { huntType: 'persistence', targetHost: 'host01', targetType: 'host', riskLevel: 'medium' } as CreateHuntBody;

describe('launchHunt (P_TRUST_1 A2)', () => {
  it('legt die Session an UND startet sie wirklich (start aufgerufen)', async () => {
    const api: HuntLauncher = {
      createSession: vi.fn().mockResolvedValue({ data: { id: 'h-1' } }),
      start:         vi.fn().mockResolvedValue({ data: { id: 'h-1' } }),
    };
    const id = await launchHunt(api, body);
    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(api.start).toHaveBeenCalledWith('h-1');
    expect(id).toBe('h-1');
  });

  it('ohne Session-ID → klarer Fehler, KEIN start (kein stiller Draft)', async () => {
    const api: HuntLauncher = {
      createSession: vi.fn().mockResolvedValue({ data: {} }),
      start:         vi.fn(),
    };
    await expect(launchHunt(api, body)).rejects.toThrow(/Session-ID/);
    expect(api.start).not.toHaveBeenCalled();
  });

  it('start-Fehler propagiert (die UI zeigt ihn)', async () => {
    const api: HuntLauncher = {
      createSession: vi.fn().mockResolvedValue({ data: { id: 'h-2' } }),
      start:         vi.fn().mockRejectedValue(new Error('start 500')),
    };
    await expect(launchHunt(api, body)).rejects.toThrow('start 500');
  });
});
