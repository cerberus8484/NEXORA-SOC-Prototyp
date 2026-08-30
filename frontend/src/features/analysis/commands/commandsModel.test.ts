import { describe, it, expect } from 'vitest';
import {
  deriveCommands, detectLolbins, isInterpreter, isLolbin, extractInterpreters,
  commandSeverity, commandConfidence, powershellInsights, commandHighlights, buildProcessTree,
  type CommandRow,
} from './commandsModel';
import { EMPTY_EVIDENCE, type ParsedEvidence } from '../analysisModel';
import type { Ticket } from '../../../lib/types';

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1', ticketNr: 'INC1', title: 'T', priority: 'high', status: 'assigned', analyst: 'a',
  createdAt: '2026-06-22T10:00:00Z', updatedAt: '2026-06-22T11:00:00Z', ...over,
});

const withProcess = (over: Partial<NonNullable<ParsedEvidence['process']>> = {}): ParsedEvidence => ({
  ...EMPTY_EVIDENCE,
  detection: { ...EMPTY_EVIDENCE.detection, timestamp: '2026-06-22T10:00:00Z', ruleId: 'wazuh:rule:92213', sourceSystem: 'wazuh' },
  source: { ...EMPTY_EVIDENCE.source, host: 'WEC01', user: 'j.bauer' },
  metadata: { ...EMPTY_EVIDENCE.metadata, mitreTechnique: 'T1059.001' },
  process: { image: 'powershell.exe', commandLine: 'powershell -nop -w hidden', parentImage: 'winword.exe', processId: '4321', hashes: 'sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', ...over },
});

describe('deriveCommands', () => {
  it('leitet die volle Prozess-Evidence als Command-Row ab', () => {
    const rows = deriveCommands(ticket(), withProcess());
    expect(rows).toHaveLength(1);
    expect(rows[0].image).toBe('powershell.exe');
    expect(rows[0].commandLine).toBe('powershell -nop -w hidden');
    expect(rows[0].parentImage).toBe('winword.exe');
    expect(rows[0].user).toBe('j.bauer');
    expect(rows[0].host).toBe('WEC01');
    expect(rows[0].ruleId).toBe('wazuh:rule:92213');
    expect(rows[0].hashes.length).toBeGreaterThan(0);
    expect(rows[0].mitre).toContain('T1059.001');
  });

  it('markiert encodierte Commands als suspicious (echtes Signal)', () => {
    const enc = deriveCommands(ticket(), withProcess({ commandLine: 'powershell -EncodedCommand SQBFAFgA' }));
    expect(enc[0].suspicious).toBe(true);
    expect(enc[0].decoded).toBeTruthy();
    const plain = deriveCommands(ticket(), withProcess({ commandLine: 'whoami' }));
    expect(plain[0].suspicious).toBe(false);
  });

  it('liefert KEINE Rows ohne echte Prozess-/Flow-Evidence (kein Fake)', () => {
    expect(deriveCommands(ticket(), EMPTY_EVIDENCE)).toHaveLength(0);
  });

  it('ergänzt deduplizierte Prozess-Images aus Flows (ohne Command Line)', () => {
    const network = { flows: [{ processImage: 'rundll32.exe', user: 'svc', timestamp: '2026-06-22T09:00:00Z', sourceType: 'sysmon_event3' }] } as never;
    const rows = deriveCommands(ticket(), withProcess(), network);
    expect(rows).toHaveLength(2);
    const flowRow = rows.find((r) => r.image === 'rundll32.exe')!;
    expect(flowRow.commandLine).toBeUndefined();
    expect(flowRow.suspicious).toBe(false);
  });
});

const row = (over: Partial<CommandRow> = {}): CommandRow => ({ id: 'x', hashes: [], mitre: [], suspicious: false, ...over });

describe('LOLBin- & Interpreter-Erkennung', () => {
  it('erkennt LOLBins anhand des Namens inkl. Technik', () => {
    expect(isLolbin('C:\\Windows\\System32\\rundll32.exe')).toBe(true);
    expect(isLolbin('powershell.exe')).toBe(false);
    const hits = detectLolbins([row({ image: 'C:\\Windows\\System32\\rundll32.exe' }), row({ image: 'mshta.exe' }), row({ image: 'rundll32.exe' })]);
    expect(hits.map((h) => h.name)).toEqual(['rundll32.exe', 'mshta.exe']); // dedupliziert
    expect(hits[0].technique).toBe('T1218.011');
  });
  it('erkennt Interpreter und extrahiert ein Schlüssel-Argument', () => {
    expect(isInterpreter('powershell.exe')).toBe(true);
    const ints = extractInterpreters([row({ image: 'powershell.exe', commandLine: 'powershell -EncodedCommand AAAA' }), row({ image: 'cmd.exe', commandLine: 'cmd.exe /c whoami' })]);
    expect(ints.find((i) => i.name === 'powershell.exe')?.arg).toBe('-EncodedCommand');
    expect(ints.find((i) => i.name === 'cmd.exe')?.arg).toContain('/c whoami');
  });
});

describe('commandSeverity & commandConfidence', () => {
  it('stuft suspicious/LOLBin/Encoded hoch ein', () => {
    expect(commandSeverity(row({ image: 'rundll32.exe' }))).toBe('high');
    expect(commandSeverity(row({ image: 'powershell.exe', commandLine: 'powershell -w hidden -nop' }))).toBe('high');
    expect(commandSeverity(row({ image: 'cmd.exe', commandLine: 'cmd.exe /c dir' }))).toBe('medium');
    expect(commandSeverity(row({ image: 'foo.exe' }))).toBe('low');
  });
  it('confidence steigt mit der Korroboration', () => {
    expect(commandConfidence(row({ image: 'powershell.exe', commandLine: 'powershell -enc AAAA', decoded: 'echo', mitre: ['T1059.001'], parentImage: 'winword.exe' }))).toBe('high');
    expect(commandConfidence(row({ image: 'x.exe' }))).toBe('low');
  });
});

describe('powershellInsights', () => {
  it('liest Flags/EncodedCommand/ExecutionPolicy aus der realen Command-Line', () => {
    const ins = powershellInsights([row({ image: 'powershell.exe', commandLine: 'powershell -NoP -W Hidden -ExecutionPolicy Bypass -EncodedCommand AAAA', decoded: 'echo' })]);
    expect(ins.present).toBe(true);
    expect(ins.encodedCommand).toBe(true);
    expect(ins.executionPolicy).toBe('Bypass');
    expect(ins.suspiciousFlags).toEqual(expect.arrayContaining(['-NoProfile', '-WindowStyle Hidden', '-EncodedCommand']));
  });
  it('ist abwesend ohne PowerShell-Command', () => {
    expect(powershellInsights([row({ image: 'cmd.exe', commandLine: 'cmd /c dir' })]).present).toBe(false);
  });
});

describe('commandHighlights', () => {
  it('hebt Encoded PowerShell + LOLBins hervor', () => {
    const hl = commandHighlights([
      row({ image: 'powershell.exe', commandLine: 'powershell -enc AAAA', decoded: 'echo' }),
      row({ image: 'bitsadmin.exe', commandLine: 'bitsadmin /transfer j http://x/y' }),
    ]);
    expect(hl.some((h) => h.text.includes('Encoded PowerShell'))).toBe(true);
    expect(hl.some((h) => h.text.includes('bitsadmin'))).toBe(true);
  });
});

describe('buildProcessTree', () => {
  it('verkettet Parent → Child über PID', () => {
    const roots = buildProcessTree([
      row({ id: 'a', image: 'powershell.exe', pid: 'S324', parentImage: 'explorer.exe', parentPid: '4120', suspicious: true }),
      row({ id: 'b', image: 'cmd.exe', pid: '6140', parentImage: 'powershell.exe', parentPid: 'S324' }),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe('explorer.exe');
    const ps = roots[0].children[0];
    expect(ps.name).toBe('powershell.exe');
    expect(ps.suspicious).toBe(true);
    expect(ps.children[0].name).toBe('cmd.exe');
  });
});
