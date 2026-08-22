import { describe, it, expect } from 'vitest';
import { classifyIoc, iocsFromParsed, EMPTY_EVIDENCE } from './analysisModel';

describe('classifyIoc', () => {
  it('Windows-Dateipfad → file (NICHT domain)', () => {
    expect(classifyIoc('C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe('file');
    expect(classifyIoc('C:\\Windows\\evil.exe')).toBe('file');
    expect(classifyIoc('/usr/bin/curl')).toBe('file');
    expect(classifyIoc('payload.ps1')).toBe('file');
  });
  it('echte Domain → domain', () => {
    expect(classifyIoc('github.com')).toBe('domain');
    expect(classifyIoc('sub.example.co.uk')).toBe('domain');
  });
  it('IP / URL / Hash korrekt', () => {
    expect(classifyIoc('192.168.241.102')).toBe('ip');
    expect(classifyIoc('https://evil.tld/x')).toBe('url');
    expect(classifyIoc('a'.repeat(64))).toBe('hash');
  });
});

describe('iocsFromParsed', () => {
  it('dedupliziert + klassifiziert Dateipfade als file', () => {
    const ev = { ...EMPTY_EVIDENCE,
      source: { ip: '192.168.241.102' }, destination: { ip: '192.168.241.102' },
      file: { name: 'C:\\Windows\\evil.exe' },
    } as typeof EMPTY_EVIDENCE;
    const iocs = iocsFromParsed(ev);
    expect(iocs.filter((i) => i.value === '192.168.241.102')).toHaveLength(1); // dedup
    expect(iocs.find((i) => i.type === 'file')?.value).toMatch(/evil\.exe/);
    expect(iocs.some((i) => i.type === 'domain')).toBe(false); // kein Pfad-als-Domain
  });
});
