import { describe, test, expect } from 'vitest';
import {
  recordPollFailure,
  recordPollSuccess,
  INITIAL_POLL_HEALTH,
  POLL_DEGRADED_THRESHOLD,
} from './pollHealthModel';

describe('pollHealthModel', () => {
  test('Startzustand ist nicht degraded, 0 Fehler', () => {
    expect(INITIAL_POLL_HEALTH).toEqual({ consecutiveFailures: 0, degraded: false });
  });

  test('einzelner Fehler unter der Schwelle → noch nicht degraded', () => {
    const h = recordPollFailure(INITIAL_POLL_HEALTH);
    expect(h.consecutiveFailures).toBe(1);
    expect(h.degraded).toBe(false);
  });

  test('Fehler bis zur Schwelle → degraded', () => {
    let h = INITIAL_POLL_HEALTH;
    for (let i = 0; i < POLL_DEGRADED_THRESHOLD; i++) h = recordPollFailure(h);
    expect(h.consecutiveFailures).toBe(POLL_DEGRADED_THRESHOLD);
    expect(h.degraded).toBe(true);
  });

  test('Erfolg setzt den Zähler zurück (transienter Aussetzer eskaliert nicht)', () => {
    let h = recordPollFailure(INITIAL_POLL_HEALTH);
    h = recordPollFailure(h);
    expect(h.consecutiveFailures).toBe(2);
    h = recordPollSuccess();
    expect(h).toEqual(INITIAL_POLL_HEALTH);
    expect(h.degraded).toBe(false);
  });

  test('eigene Schwelle wird respektiert', () => {
    const h = recordPollFailure(INITIAL_POLL_HEALTH, 1);
    expect(h.degraded).toBe(true);
  });

  test('ungültige Schwelle fällt auf Default zurück', () => {
    let h = INITIAL_POLL_HEALTH;
    for (let i = 0; i < POLL_DEGRADED_THRESHOLD; i++) h = recordPollFailure(h, 0);
    expect(h.degraded).toBe(true);
  });

  test('mutiert den Vorzustand nicht (Immutabilität)', () => {
    const prev = recordPollFailure(INITIAL_POLL_HEALTH);
    const snapshot = JSON.stringify(prev);
    recordPollFailure(prev);
    expect(JSON.stringify(prev)).toBe(snapshot);
  });
});
