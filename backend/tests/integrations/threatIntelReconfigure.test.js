'use strict';

// Layer 2: TI-Provider-Keys zur Laufzeit ändern (aus der UI), ohne Prozess-Neustart.

const { AbuseIpDbProvider } = require('../../src/integrations/threatIntel/AbuseIpDbProvider');
const { VirusTotalProvider } = require('../../src/integrations/threatIntel/VirusTotalProvider');

describe('AbuseIpDbProvider.reconfigure', () => {
  test('setzt Key → isConfigured() true; leerer Key → false', () => {
    const p = new AbuseIpDbProvider({ key: '' });
    expect(p.isConfigured()).toBe(false);
    p.reconfigure({ key: 'neuer-key' });
    expect(p.isConfigured()).toBe(true);
    p.reconfigure({ key: '' });
    expect(p.isConfigured()).toBe(false);
  });

  test('übernimmt maxAgeInDays, wenn übergeben; behält sonst den alten Wert', () => {
    const p = new AbuseIpDbProvider({ key: 'k', maxAgeInDays: 90 });
    p.reconfigure({ key: 'k2' });
    expect(p._maxAge).toBe(90);
    p.reconfigure({ key: 'k2', maxAgeInDays: 30 });
    expect(p._maxAge).toBe(30);
  });
});

describe('VirusTotalProvider.reconfigure', () => {
  test('setzt Key → isConfigured() spiegelt den neuen Zustand', () => {
    const p = new VirusTotalProvider({ key: 'alt' });
    expect(p.isConfigured()).toBe(true);
    p.reconfigure({ key: '' });
    expect(p.isConfigured()).toBe(false);
  });
});
