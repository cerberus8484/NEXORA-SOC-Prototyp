'use strict';

// P_CORR_ADMIN_2 Stufe 2 — Kill-Switch CONFIG_APPLY_ENABLED steuert applyStatus.
// Default OFF → 'not_supported' (erhält alle bestehenden Invarianten). ON → 'supported'
// NUR für apply-eligible Capabilities. Nicht-eligible bleiben immer 'not_supported'.

const config = require('../../src/config');
const { getCapability, applyChannelEnabled } = require('../../src/configRegistry/configCapabilityCatalog');

const ELIGIBLE = 'correlator.worker.maxChildren';
const NON_ELIGIBLE = 'collector.firewall.maxLineBytes';

afterEach(() => { config.apply.enabled = false; }); // immer wieder fail-closed

describe('Kill-Switch — Default fail-closed', () => {
  test('Default: applyChannelEnabled false → applyStatus not_supported', () => {
    config.apply.enabled = false;
    expect(applyChannelEnabled()).toBe(false);
    expect(getCapability(ELIGIBLE).toJSON().applyStatus).toBe('not_supported');
  });
});

describe('Kill-Switch — aktiviert', () => {
  test('enabled + eligible → applyStatus supported', () => {
    config.apply.enabled = true;
    expect(getCapability(ELIGIBLE).toJSON().applyStatus).toBe('supported');
  });

  test('enabled + NICHT eligible → bleibt not_supported (enge Allowlist)', () => {
    config.apply.enabled = true;
    expect(getCapability(NON_ELIGIBLE).toJSON().applyStatus).toBe('not_supported');
  });

  test('reservierte/prohibited Capability bleibt not_supported, selbst bei aktivem Switch', () => {
    config.apply.enabled = true;
    expect(getCapability('host.network.allowlist').toJSON().applyStatus).toBe('not_supported');
  });
});
