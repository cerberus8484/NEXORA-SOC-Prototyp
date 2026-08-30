'use strict';

// Reine Scharfschalt-Logik für den Wazuh-Manager-Restart.
// Sichert die Wahrheitstabelle (ENV ODER DB) + die Quelle der Scharfschaltung.
// Fail-closed: alles, was nicht explizit true ist, gilt als nicht scharf.

const { isWazuhRestartArmed, wazuhRestartArmSource } = require('../../src/services/wazuhRestartArm');

describe('isWazuhRestartArmed — ENV ODER DB genügt (ENV bleibt Fallback)', () => {
  test('ENV an, DB aus → scharf', () => {
    expect(isWazuhRestartArmed({ envEnabled: true, dbArmed: false })).toBe(true);
  });

  test('ENV aus, DB an → scharf (per UI scharfgeschaltet)', () => {
    expect(isWazuhRestartArmed({ envEnabled: false, dbArmed: true })).toBe(true);
  });

  test('beide an → scharf', () => {
    expect(isWazuhRestartArmed({ envEnabled: true, dbArmed: true })).toBe(true);
  });

  test('beide aus → nicht scharf', () => {
    expect(isWazuhRestartArmed({ envEnabled: false, dbArmed: false })).toBe(false);
  });

  test('fehlende/undefined Flags → nicht scharf (fail-closed)', () => {
    expect(isWazuhRestartArmed({})).toBe(false);
    expect(isWazuhRestartArmed()).toBe(false);
  });

  test('truthy Nicht-Booleans schalten NICHT scharf (nur echtes true zählt)', () => {
    expect(isWazuhRestartArmed({ envEnabled: 'true', dbArmed: 1 })).toBe(false);
  });
});

describe('wazuhRestartArmSource — Herkunft der Scharfschaltung', () => {
  test('ENV an → Quelle env (Vorrang, Break-Glass/Betrieb)', () => {
    expect(wazuhRestartArmSource({ envEnabled: true, dbArmed: true })).toBe('env');
  });

  test('nur DB an → Quelle ui', () => {
    expect(wazuhRestartArmSource({ envEnabled: false, dbArmed: true })).toBe('ui');
  });

  test('nichts an → null', () => {
    expect(wazuhRestartArmSource({ envEnabled: false, dbArmed: false })).toBeNull();
    expect(wazuhRestartArmSource()).toBeNull();
  });
});
