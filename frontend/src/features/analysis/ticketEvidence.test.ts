import { describe, it, expect } from 'vitest';
import { buildEvidence, toHashes } from './ticketEvidence';
import type { Ticket } from '../../lib/types';

const base = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1', ticketNr: 'INC000001', title: 'Test', priority: 'high', status: 'assigned',
  analyst: 'a', createdAt: '2026-06-22T10:00:00Z', updatedAt: '2026-06-22T11:00:00Z', ...over,
});

describe('toHashes', () => {
  it('präfixt nach Hex-Länge', () => {
    expect(toHashes('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe('sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHashes('da39a3ee5e6b4b0d3255bfef95601890afd80709')).toMatch(/^sha1=/);
    expect(toHashes('d41d8cd98f00b204e9800998ecf8427e')).toMatch(/^md5=/);
  });
  it('lässt bereits formatierte Hashes durch und behandelt Leeres ehrlich', () => {
    expect(toHashes('sha256=abc')).toBe('sha256=abc');
    expect(toHashes('')).toBeUndefined();
    expect(toHashes(undefined)).toBeUndefined();
  });
});

describe('buildEvidence', () => {
  it('mappt Identität + Netzwerk aus echten Ticketfeldern', () => {
    const ev = buildEvidence(base({ hostname: 'WEC01', user: 'j.bauer', srcIp: '10.99.99.11', dstIp: '10.99.99.5', port: '5985', protocol: 'WinRM' }));
    expect(ev.source.host).toBe('WEC01');
    expect(ev.source.user).toBe('j.bauer');
    expect(ev.source.ip).toBe('10.99.99.11');
    expect(ev.source.port).toBe(5985);
    expect(ev.destination.ip).toBe('10.99.99.5');
    expect(ev.network.protocol).toBe('WinRM');
  });

  it('mappt NAT-Felder korrekt (postNatSrc → Outbound, extIp als Fallback)', () => {
    const ev = buildEvidence(base({ srcIp: '10.0.20.34', postNatSrc: '203.0.113.7', postNatDst: '185.220.101.45' }));
    expect(ev.nat.originalSourceIp).toBe('10.0.20.34');
    expect(ev.nat.postNatSourceIp).toBe('203.0.113.7');
    expect(ev.nat.postNatDestinationIp).toBe('185.220.101.45');
    const ev2 = buildEvidence(base({ postNatSrc: '', extIp: '198.51.100.1' }));
    expect(ev2.nat.postNatSourceIp).toBe('198.51.100.1');
  });

  it('legt den Hash an den Prozess (sha256-Präfix), wenn ein Prozess bekannt ist', () => {
    const ev = buildEvidence(base({ process: 'powershell.exe', hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }));
    expect(ev.process?.image).toBe('powershell.exe');
    expect(ev.process?.hashes).toMatch(/^sha256=/);
    expect(ev.file).toBeUndefined();
  });

  it('legt den Hash an die Datei, wenn kein Prozess bekannt ist', () => {
    const ev = buildEvidence(base({ hash: 'd41d8cd98f00b204e9800998ecf8427e' }));
    expect(ev.process).toBeUndefined();
    expect(ev.file?.hashes).toMatch(/^md5=/);
  });

  it('mappt commandLine in ev.process.commandLine (Sysmon / PowerShell-ScriptBlock)', () => {
    const ev = buildEvidence(base({ process: 'powershell.exe', commandLine: 'powershell -enc ZQBjAGgAbwA=' }));
    expect(ev.process?.image).toBe('powershell.exe');
    expect(ev.process?.commandLine).toBe('powershell -enc ZQBjAGgAbwA=');
  });

  it('legt Prozess-Evidence auch ohne Image an, wenn nur commandLine vorhanden ist (ScriptBlock)', () => {
    const ev = buildEvidence(base({ commandLine: '[Convert]::FromBase64String("ZQBjAGgAbwA=")' }));
    expect(ev.process?.commandLine).toContain('FromBase64String');
    expect(ev.process?.image).toBeUndefined();
    expect(ev.file).toBeUndefined();
  });

  it('mappt MITRE auf metadata.mitreTechnique', () => {
    expect(buildEvidence(base({ mitre: 'T1059.001' })).metadata.mitreTechnique).toBe('T1059.001');
  });

  it('lässt fehlende Felder ehrlich leer (keine Fake-Daten)', () => {
    const ev = buildEvidence(base());
    expect(ev.source.host).toBeUndefined();
    expect(ev.source.user).toBeUndefined();
    expect(ev.network.protocol).toBeUndefined();
    expect(ev.nat.postNatSourceIp).toBeUndefined();
    expect(ev.process).toBeUndefined();
    expect(ev.file).toBeUndefined();
  });
});
