'use strict';

/**
 * Safe-Command-Allowlist für die Hunt-Console (Response-Console Stufe 1).
 *
 * SICHERHEIT: KEINE freie Shell, KEINE destruktiven Befehle, KEIN echter
 * Remote-Exec. Nur read-only Diagnose-Befehle aus dieser Allowlist sind erlaubt;
 * alles andere wird serverseitig abgelehnt. Die Ausgabe ist deterministisch/
 * mock-backed (kein Agent verbunden) und klar als Simulation gekennzeichnet.
 */

const SIM = '  [simulated — kein echter Remote-Exec, kein Agent verbunden]';

const COMMANDS = [
  { match: /^whoami$/i, type: 'manual',
    render: () => `nexora\\analyst\n${SIM}` },

  { match: /^hostname$/i, type: 'manual',
    render: (host) => `${host || 'HOST'}\n${SIM}` },

  { match: /^tasklist(\s+\/v)?$/i, type: 'manual',
    render: () => [
      'Image Name                     PID   Session   Mem Usage',
      'System                           4    Services    140 K',
      'explorer.exe                  3896    Console  42.110 K',
      'powershell.exe                4528    Console  88.204 K',
      'WINWORD.EXE                   3896    Console  61.880 K',
      SIM,
    ].join('\n') },

  { match: /^netstat\s+-ano$/i, type: 'network_scan',
    render: () => [
      'Proto  Local Address          Foreign Address        State        PID',
      'TCP    192.168.240.44:49712     203.0.113.10:443       ESTABLISHED  4528',
      'TCP    192.168.240.44:3389      0.0.0.0:0              LISTENING    1044',
      'UDP    0.0.0.0:5353           *:*                                 2210',
      SIM,
    ].join('\n') },

  { match: /^ipconfig(\s+\/all)?$/i, type: 'manual',
    render: (host) => [
      'Windows IP Configuration',
      `   Host Name . . . . . . . . . . . . : ${host || 'HOST'}`,
      '   IPv4 Address. . . . . . . . . . . : 192.168.240.44',
      '   Subnet Mask . . . . . . . . . . . : 255.255.255.0',
      '   Default Gateway . . . . . . . . . : 192.168.240.1',
      SIM,
    ].join('\n') },

  { match: /^get-process$/i, type: 'powershell',
    render: () => [
      'Handles  NPM(K)    PM(K)      WS(K)   CPU(s)     Id  ProcessName',
      '    512      28    61880      71204     3,20   3896  WINWORD',
      '    640      35    88204      92340    12,80   4528  powershell',
      '    210      14    12044      18220     0,90   1044  svchost',
      SIM,
    ].join('\n') },

  { match: /^get-service$/i, type: 'powershell',
    render: () => [
      'Status   Name               DisplayName',
      'Running  Dnscache           DNS Client',
      'Running  TermService        Remote Desktop Services',
      'Stopped  WSearch            Windows Search',
      SIM,
    ].join('\n') },
];

/** Erlaubte Befehle (für UI-Chips + Fehlermeldung). */
const ALLOWED_HINTS = ['whoami', 'hostname', 'tasklist', 'netstat -ano', 'ipconfig /all', 'Get-Process', 'Get-Service'];

/**
 * Prüft einen Eingabe-String gegen die Allowlist.
 * @returns {{ allowed: boolean, type?: string, stdout?: string }}
 */
function evaluateSafeCommand(input, host) {
  const cmd = String(input || '').trim().replace(/\s+/g, ' ');
  if (!cmd) return { allowed: false };
  const entry = COMMANDS.find((c) => c.match.test(cmd));
  if (!entry) return { allowed: false };
  return { allowed: true, type: entry.type, stdout: entry.render(host) };
}

module.exports = { evaluateSafeCommand, ALLOWED_HINTS };
