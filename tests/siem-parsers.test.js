'use strict';

const { parseVTRaw, parseAbuseIPDBRaw } = require('./lib/parser');

describe('parseVTRaw — VirusTotal Paste Parser', () => {
  test('erkennt Detection Ratio "58 / 72"', () => {
    const r = parseVTRaw('58 / 72');
    expect(r.result).toBe('58 / 72');
    expect(r.malicious).toBe('58');
  });

  test('erkennt Detection Ratio "58/72" ohne Spaces', () => {
    const r = parseVTRaw('58/72');
    expect(r.result).toBe('58 / 72');
  });

  test('erkennt "Malicious: 45" explizit', () => {
    const r = parseVTRaw('Malicious: 45\nSuspicious: 3');
    expect(r.malicious).toBe('45');
    expect(r.suspicious).toBe('3');
  });

  test('erkennt SHA256 Hash im Text', () => {
    const hash = 'a3f1c2d8e4b9074512fcd3a1e8b07245c9f3d1a8e7b204c5f9a3d2e1b8c07415';
    const r = parseVTRaw(`SHA256 ${hash}\n58 / 72`);
    expect(r.query).toBe(hash);
  });

  test('erkennt MD5 Hash', () => {
    const r = parseVTRaw('d41d8cd98f00b204e9800998ecf8427e');
    expect(r.query).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  test('erkennt First Seen Datum', () => {
    const r = parseVTRaw('First Seen: 2026-02-14\n58/72');
    expect(r.firstseen).toBe('2026-02-14');
  });

  test('erkennt Last Analysis Datum', () => {
    const r = parseVTRaw('Last Analysis: 2026-06-03');
    expect(r.lastseen).toBe('2026-06-03');
  });

  test('erkennt Tags', () => {
    const r = parseVTRaw('Tags: trojan, cobalt-strike, c2');
    expect(r.tags).toBe('trojan, cobalt-strike, c2');
  });

  test('erkennt bekannte Malware-Labels im Text', () => {
    const r = parseVTRaw('Detected as trojan and ransomware behavior');
    expect(r.tags).toContain('trojan');
    expect(r.tags).toContain('ransomware');
  });

  test('vollständiger VT-Block', () => {
    const block = `
SHA256 a3f1c2d8e4b9074512fcd3a1e8b07245c9f3d1a8e7b204c5f9a3d2e1b8c07415
58 / 72 malicious
Suspicious: 4
First Seen: 2026-02-14
Last Analysis: 2026-06-03
Tags: trojan, cobalt-strike, powershell-dropper`;
    const r = parseVTRaw(block);
    expect(r.result).toBe('58 / 72');
    expect(r.suspicious).toBe('4');
    expect(r.firstseen).toBe('2026-02-14');
    expect(r.tags).toContain('cobalt-strike');
  });

  test('leerer Input gibt leeres Objekt', () => {
    expect(parseVTRaw('')).toEqual({});
    expect(parseVTRaw(null)).toEqual({});
  });
});

describe('parseAbuseIPDBRaw — AbuseIPDB Paste Parser', () => {
  test('erkennt IP-Adresse', () => {
    const r = parseAbuseIPDBRaw('185.220.101.47');
    expect(r.ip).toBe('185.220.101.47');
  });

  test('erkennt Confidence Score "97 %"', () => {
    const r = parseAbuseIPDBRaw('Confidence of Abuse: 97 %');
    expect(r.score).toBe('97 %');
  });

  test('erkennt Confidence Score "98%"', () => {
    const r = parseAbuseIPDBRaw('98%');
    expect(r.score).toBe('98 %');
  });

  test('erkennt Total Reports', () => {
    const r = parseAbuseIPDBRaw('Total Reports: 312');
    expect(r.reports).toBe('312');
  });

  test('erkennt Last Reported', () => {
    const r = parseAbuseIPDBRaw('Last Reported: 2026-06-03 12:41 UTC');
    expect(r.last).toContain('2026-06-03');
  });

  test('erkennt Country Code', () => {
    const r = parseAbuseIPDBRaw('Country: RU');
    expect(r.country).toContain('RU');
  });

  test('erkennt ISP', () => {
    const r = parseAbuseIPDBRaw('ISP: Privax Ltd / Hosting');
    expect(r.isp).toContain('Privax');
  });

  test('erkennt Kategorien', () => {
    const r = parseAbuseIPDBRaw('Categories: Port Scan, Hacking, C2');
    expect(r.cats).toContain('Port Scan');
    expect(r.cats).toContain('Hacking');
  });

  test('vollständiger AbuseIPDB-Block', () => {
    const block = `
185.220.101.47
Confidence of Abuse: 97 %
Total Reports: 312
Last Reported: 2026-06-03 12:41 UTC
Country: RU
ISP: Privax Ltd / Hosting
Usage Type: Data Center / VPN
Categories: Port Scan, Hacking, C2, Malware Distribution`;
    const r = parseAbuseIPDBRaw(block);
    expect(r.ip).toBe('185.220.101.47');
    expect(r.score).toBe('97 %');
    expect(r.reports).toBe('312');
    expect(r.country).toContain('RU');
    expect(r.isp).toContain('Privax');
    expect(r.cats).toContain('Hacking');
  });

  test('leerer Input gibt leeres Objekt', () => {
    expect(parseAbuseIPDBRaw('')).toEqual({});
    expect(parseAbuseIPDBRaw(null)).toEqual({});
  });
});
