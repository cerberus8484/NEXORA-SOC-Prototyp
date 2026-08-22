'use strict';

const { Evidence } = require('../../src/domain/Evidence');

describe('Evidence — Integrität (SHA-256)', () => {
  test('berechnet sha256 über den Inhalt (64 hex)', () => {
    const e = Evidence.create({ ticketId: 'T1', type: 'process', source: 'sysmon', title: 'powershell', rawText: 'cmd /c whoami' });
    expect(e.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('gleicher Inhalt → gleicher Hash; geänderter Inhalt → anderer Hash', () => {
    const a = new Evidence({ type: 'process', source: 'sysmon', title: 't', rawText: 'X' });
    const b = new Evidence({ type: 'process', source: 'sysmon', title: 't', rawText: 'X' });
    const c = new Evidence({ type: 'process', source: 'sysmon', title: 't', rawText: 'Y' });
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).not.toBe(c.sha256);
  });

  test('verifyIntegrity erkennt Manipulation', () => {
    const e = new Evidence({ type: 'process', source: 'sysmon', title: 't', rawText: 'original' });
    expect(e.verifyIntegrity()).toBe(true);
    e.rawText = 'manipuliert'; // nachträglich verändert, Hash bleibt alt
    expect(e.verifyIntegrity()).toBe(false);
  });
});
