'use strict';

// Strukturierte Feld-Extraktion aus win.eventdata in den Ticket-Draft (Coverage-Fix).
// Bisher landeten Prozess/Command-Line/Skript/User/Protokoll/Hash nur als Freitext in
// logs/iocs und erreichten den Analysis-Deck nie. buildEventFields zieht sie strukturiert.
const { buildEventFields } = require('../../src/integrations/adapters/wazuh/WazuhProcessor');

const nd = (eventdata, extra = {}) => ({ raw: { data: { win: { eventdata } }, ...extra } });

describe('buildEventFields', () => {
  test('Sysmon Event 1 (Process Creation): image/commandLine/user/hash', () => {
    const out = buildEventFields(nd({
      image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      commandLine: 'powershell.exe -nop -w hidden -enc ZQBjAGgAbwA=',
      parentImage: 'C:\\Windows\\explorer.exe',
      targetUserName: 'CORP\\jdoe',
      hashes: 'SHA256=ABC123,MD5=DEF456',
    }));
    expect(out.process).toContain('powershell.exe');
    expect(out.commandLine).toContain('-enc ZQBjAGgAbwA=');
    expect(out.user).toBe('CORP\\jdoe');
    expect(out.hash).toContain('SHA256=ABC123');
  });

  test('PowerShell ScriptBlock (Event 4104, Rule 91809): scriptBlockText → commandLine', () => {
    const out = buildEventFields(nd({
      scriptBlockText: '$d = [System.Convert]::FromBase64String("ZQBjAGgAbwA="); iex ([Text.Encoding]::UTF8.GetString($d))',
    }));
    expect(out.commandLine).toContain('FromBase64String');
    // Ohne Prozess-Image bleibt process undefined (keine erfundenen Werte).
    expect(out.process).toBeUndefined();
  });

  test('Sysmon Event 3 (Network Connection): image/protocol/destinationPort', () => {
    const out = buildEventFields(nd({
      image: 'C:\\Temp\\evil.exe',
      protocol: 'tcp',
      destinationPort: '443',
    }));
    expect(out.process).toContain('evil.exe');
    expect(out.protocol).toBe('tcp');
    expect(out.port).toBe('443');
  });

  test('leere/fehlende eventdata → keine erfundenen Felder', () => {
    expect(buildEventFields(nd({}))).toEqual({});
    expect(buildEventFields({ raw: {} })).toEqual({});
    expect(buildEventFields({})).toEqual({});
  });

  test('übergroßer ScriptBlock wird bounded (≤ 20000 Zeichen)', () => {
    const out = buildEventFields(nd({ scriptBlockText: 'A'.repeat(50000) }));
    expect(out.commandLine.length).toBeLessThanOrEqual(20000);
  });

  test('Felder werden auf die Schema-Limits gekappt (process ≤200, user ≤100, hash ≤256)', () => {
    const out = buildEventFields(nd({
      image: 'C:\\' + 'x'.repeat(500) + '.exe',
      targetUserName: 'U'.repeat(500),
      hashes: 'H'.repeat(500),
    }));
    expect(out.process.length).toBeLessThanOrEqual(200);
    expect(out.user.length).toBeLessThanOrEqual(100);
    expect(out.hash.length).toBeLessThanOrEqual(256);
  });
});
