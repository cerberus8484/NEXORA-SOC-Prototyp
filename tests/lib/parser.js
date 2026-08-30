'use strict';

// ─── S1: Input Limits ─────────────────────────────────────
const MAX_FIELD_LENGTH   =  5_000;
const MAX_TITLE_LENGTH   =    200;
const MAX_PAYLOAD_LENGTH = 50_000;

function sanitize(val, maxLen = MAX_FIELD_LENGTH) {
  if (val === null || val === undefined) return '';
  return String(val).slice(0, maxLen);
}

function escHtml(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ─── Smart Parser ──────────────────────────────────────────
function detectAndParse(raw) {
  const t = raw.trim();
  if (!t) return { type: '', fields: {} };

  // URL
  if (/^https?:\/\//i.test(t) || /^ftp:\/\//i.test(t)) {
    const f = { url: t, method: '', status: '', referrer: '', notes: '' };
    try {
      const u  = new URL(t);
      const qs = [...u.searchParams.entries()];
      const notes = [];
      notes.push(`Host: ${u.hostname}`);
      if (u.pathname && u.pathname !== '/') notes.push(`Path: ${u.pathname}`);
      if (qs.length) notes.push(`Query-Params: ${qs.map(([k,v])=>`${k}=${v}`).join(', ')}`);
      const ext = u.pathname.split('.').pop().toLowerCase();
      if (['exe','dll','ps1','bat','vbs','hta','msi','jar','zip','rar'].includes(ext))
        notes.push(`⚠️ Verdächtige Dateiendung: .${ext}`);
      if (notes.length) f.notes = notes.join('\n');
      f.method = u.protocol === 'ftp:' ? 'FTP' : 'GET';
    } catch {}
    return { type: 'URL', fields: f };
  }

  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(t)) {
    const [ip, port] = t.split(':');
    const notes = [];
    if (/^10\./.test(ip))                           notes.push('Privates Netz: 10.0.0.0/8');
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) notes.push('Privates Netz: 172.16.0.0/12');
    else if (/^192\.168\./.test(ip))                notes.push('Privates Netz: 192.168.240.0/16');
    else if (/^127\./.test(ip))                     notes.push('Loopback / Localhost');
    else                                             notes.push('Öffentliche IP — Threat Intel prüfen');
    if (port) notes.push(`Port: ${port}`);
    return { type: 'IP', fields: { ip, geo: '', asn: '', rep: '', notes: notes.join('\n') } };
  }

  // Email
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) {
    const [, domain] = t.split('@');
    const notes = [];
    const lookalikes = ['paypa1','micros0ft','arnazon','g00gle','suppport','securrity'];
    if (lookalikes.some(l => domain.toLowerCase().includes(l)))
      notes.push('⚠️ Mögliches Typosquatting der Domain');
    return { type: 'Email', fields: { sender: t, subject: '', attach: '', origip: '', header: '', notes: notes.join('\n') } };
  }

  // Registry Key
  if (/^HK(EY_(LOCAL_MACHINE|CURRENT_USER|USERS|CLASSES_ROOT|CURRENT_CONFIG)|LM|CU|U|CR)/i.test(t)) {
    const parts = t.replace(/\//g, '\\').split('\\');
    const valname = parts.length > 1 ? parts.pop() : '';
    const key = parts.join('\\');
    const notes = [];
    const persistPaths = ['\\Run\\','\\RunOnce\\','\\RunOnceEx\\','\\Winlogon\\','\\Services\\'];
    if (persistPaths.some(p => t.includes(p))) notes.push('⚠️ Bekannter Persistence-Pfad');
    if (/HKCU/i.test(t)) notes.push('User-Context (HKCU) — kein Admin erforderlich');
    if (/HKLM/i.test(t)) notes.push('System-Context (HKLM) — Admin-Rechte vorhanden');
    return { type: 'Registry-Key', fields: { key, valname, valdata: '', action: '', notes: notes.join('\n') } };
  }

  // Hash MD5/SHA1/SHA256/SHA512
  if (/^[a-f0-9]{32}$/i.test(t))  return { type: 'Hash', fields: { algo: 'MD5',    hashval: t.toLowerCase(), filename: '', vt: `https://www.virustotal.com/gui/file/${t.toLowerCase()}` } };
  if (/^[a-f0-9]{40}$/i.test(t))  return { type: 'Hash', fields: { algo: 'SHA1',   hashval: t.toLowerCase(), filename: '', vt: `https://www.virustotal.com/gui/file/${t.toLowerCase()}` } };
  if (/^[a-f0-9]{64}$/i.test(t))  return { type: 'Hash', fields: { algo: 'SHA256', hashval: t.toLowerCase(), filename: '', vt: `https://www.virustotal.com/gui/file/${t.toLowerCase()}` } };
  if (/^[a-f0-9]{128}$/i.test(t)) return { type: 'Hash', fields: { algo: 'SHA512', hashval: t.toLowerCase(), filename: '', vt: '' } };

  // Domain — erst nach File/Hash prüfen, bekannte File-Extensions ausschließen
  const KNOWN_EXTENSIONS = /\.(exe|dll|ps1|bat|vbs|py|sh|js|hta|jar|msi|cmd|lnk|docm|xlsm|zip|rar|7z|scr|pif|cpl|pdf|doc|xls|ppt|txt|log|csv|xml|json|html|htm)$/i;
  if (/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(t) && !t.includes('/') && !KNOWN_EXTENSIONS.test(t)) {
    const parts  = t.split('.');
    const tld    = parts.slice(-1)[0];
    const notes  = [];
    const suspTLD = ['ru','cn','top','xyz','tk','ml','ga','cf','pw','cc'];
    if (suspTLD.includes(tld.toLowerCase())) notes.push(`⚠️ Verdächtige TLD: .${tld}`);
    if (parts.length > 3) notes.push(`Subdomain-Tiefe: ${parts.length - 2}`);
    return { type: 'Domain', fields: { domain: t, resolved: '', asn: '', seen: '', notes: notes.join('\n') } };
  }

  // File path
  if (/^[a-zA-Z]:\\/.test(t) || /^\/[a-z/]/.test(t) ||
      /\.(exe|dll|ps1|bat|vbs|py|sh|js|hta|jar|msi|cmd|lnk|docm|xlsm|zip|rar|7z|scr|pif|cpl)$/i.test(t)) {
    const norm  = t.replace(/\\/g, '/');
    const parts = norm.split('/');
    const filename = parts.pop() || t;
    const path  = parts.join('\\') || '';
    const ext   = filename.split('.').pop().toLowerCase();
    const notes = [];
    const suspExts = ['exe','dll','ps1','bat','vbs','hta','scr','pif','cpl','lnk','msi'];
    if (suspExts.includes(ext)) notes.push(`⚠️ Ausführbare Datei: .${ext}`);
    if (/temp|tmp|appdata|roaming|local\\microsoft/i.test(t)) notes.push('⚠️ Pfad in temporärem/Benutzerverzeichnis');
    return { type: 'File', fields: { filename, path, size: '', hash: '', notes: notes.join('\n') } };
  }

  // User-Agent — VOR Command prüfen (UA-Strings enthalten "; " was Command triggert)
  if (/^Mozilla\/|^curl\/|^python-requests|^Wget\/|^Go-http|^Apache-|^libwww/i.test(t)) {
    const toolGuess =
      /curl/i.test(t)            ? 'curl' :
      /python-requests/i.test(t) ? 'Python requests' :
      /wget/i.test(t)            ? 'wget' :
      /go-http/i.test(t)         ? 'Go http.Client' : '';
    return { type: 'User-Agent', fields: { ua: t, tool: toolGuess, notes: '' } };
  }

  // Command
  if (/^(cmd(\.exe)?|powershell(\.exe)?|pwsh|bash|sh|python[23]?|wscript|cscript|mshta|rundll32|regsvr32|certutil|bitsadmin|msiexec)\b/i.test(t)
    || /\s(\/c|\/k|-enc|-encodedcommand|-command|-exec|-nop|-w hidden|-windowstyle hidden)\b/i.test(t)
    || t.includes(' && ') || t.includes(' | ')) {
    const shellM = t.match(/^(\S+\.exe|\S+)\s/i);
    const shell  = shellM ? shellM[1] : '';
    const notes  = [];
    const encM = t.match(/(?:-enc|-encodedcommand)\s+([A-Za-z0-9+/=]{10,})/i);
    if (encM) {
      try {
        const bytes  = atob(encM[1]);
        let decoded  = '';
        for (let i = 0; i < bytes.length - 1; i += 2)
          decoded += String.fromCharCode(bytes.charCodeAt(i));
        notes.push(`Decoded (-enc): ${decoded}`);
      } catch {
        notes.push(`Encoded payload: ${encM[1]}`);
      }
    }
    if (/DownloadString|DownloadFile|WebClient|Net\.WebClient/i.test(t)) notes.push('⚠️ Download-Technik erkannt');
    if (/bypass|unrestricted|remotesigned/i.test(t)) notes.push('⚠️ ExecutionPolicy-Bypass');
    if (/iex\s*\(|invoke-expression/i.test(t)) notes.push('⚠️ IEX / Invoke-Expression');
    if (/hidden|windowstyle/i.test(t)) notes.push('Verstecktes Fenster');
    return { type: 'Command', fields: { shell, runas: '', cmd: t, notes: notes.join('\n') } };
  }

  // Base64
  if (t.length > 20 && /^[A-Za-z0-9+/]+=*$/.test(t) && t.length % 4 === 0) {
    let decoded = '';
    const notes = [];
    try {
      const raw64 = atob(t);
      let isPSenc = true;
      for (let i = 1; i < Math.min(raw64.length, 40); i += 2)
        if (raw64.charCodeAt(i) !== 0) { isPSenc = false; break; }
      if (isPSenc && raw64.length > 4) {
        let ps = '';
        for (let i = 0; i < raw64.length - 1; i += 2)
          ps += String.fromCharCode(raw64.charCodeAt(i));
        decoded = ps;
        notes.push('UTF-16LE dekodiert (PowerShell -enc)');
      } else {
        decoded = raw64;
      }
      if (/http|wget|curl|iex|invoke|download/i.test(decoded))
        notes.push('⚠️ Verdächtige Keywords im dekodiertem Inhalt');
    } catch { notes.push('Dekodierung fehlgeschlagen'); }
    return { type: 'Encoded String', fields: { encoding: 'Base64', encoded: t, decoded, notes: notes.join('\n') } };
  }

  // Script
  if (/Invoke-|Import-Module|New-Object|IEX\b|wget\s|curl\s|chmod\s|sudo\s/i.test(t) || t.startsWith('#!')) {
    const lang = /powershell|Invoke-|IEX/i.test(t) ? 'PowerShell'
               : /python/i.test(t) ? 'Python'
               : /bash|sh\s|#!/.test(t) ? 'Bash/Shell'
               : 'Script';
    const notes = [];
    if (/DownloadString|DownloadFile|WebClient/i.test(t)) notes.push('⚠️ Download-Funktion erkannt');
    if (/base64|frombase64/i.test(t)) notes.push('⚠️ Base64-Verarbeitung');
    return { type: 'Script', fields: { filename: '', lang, snippet: t, notes: notes.join('\n') } };
  }

  // Fallback
  return { type: 'Andere', fields: { label: '', value: t, notes: '' } };
}

// ─── VT Parser ─────────────────────────────────────────────
function parseVTRaw(raw) {
  if (!raw || !raw.trim()) return {};
  const result = {};

  const ratioM = raw.match(/(\d+)\s*(?:malicious)?\s*\/\s*(\d+)/i);
  if (ratioM) { result.result = `${ratioM[1]} / ${ratioM[2]}`; result.malicious = ratioM[1]; }

  const malM = raw.match(/malicious[:\s]+(\d+)/i);
  if (malM) result.malicious = malM[1];

  const susM = raw.match(/suspicious[:\s]+(\d+)/i);
  if (susM) result.suspicious = susM[1];

  const hashM = raw.match(/\b([a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{32})\b/i);
  if (hashM) result.query = hashM[1].toLowerCase();

  const fsM = raw.match(/(?:first\s+(?:seen|submission)[:\s]+)(\d{4}[-\/]\d{2}[-\/]\d{2})/i);
  if (fsM) result.firstseen = fsM[1];

  const laM = raw.match(/(?:last\s+(?:analysis|analyzed|scan)[:\s]+)(\d{4}[-\/]\d{2}[-\/]\d{2})/i);
  if (laM) result.lastseen = laM[1];

  const tagsM = raw.match(/(?:tags?|categories)[:\s]+([^\n]+)/i);
  if (tagsM) {
    result.tags = tagsM[1].trim();
  } else {
    const knownTags = ['trojan','ransomware','backdoor','c2','coinminer','dropper',
      'infostealer','spyware','worm','rootkit','adware','cryptominer','rat',
      'cobalt-strike','mimikatz','metasploit','powershell','downloader'];
    const found = knownTags.filter(t => raw.toLowerCase().includes(t));
    if (found.length) result.tags = found.join(', ');
  }

  return result;
}

// ─── AbuseIPDB Parser ──────────────────────────────────────
function parseAbuseIPDBRaw(raw) {
  if (!raw || !raw.trim()) return {};
  const result = {};

  const ipM = raw.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
  if (ipM) result.ip = ipM[1];

  const scoreM = raw.match(/(?:confidence[^%\d]*)?(\d{1,3})\s*%/i);
  if (scoreM) result.score = scoreM[1] + ' %';

  const repM = raw.match(/(?:total\s+reports?|reports?)[:\s]+(\d+)/i) || raw.match(/(\d+)\s+(?:total\s+)?reports?/i);
  if (repM) result.reports = repM[1];

  const lastM = raw.match(/(?:last\s+reported?)[:\s]+([^\n,]+)/i);
  if (lastM) result.last = lastM[1].trim();

  const countryM = raw.match(/(?:country|country\s+code)[:\s]+([A-Z]{2}\b[^\n]*)/i);
  if (countryM) result.country = countryM[1].trim().substring(0, 30);

  const ispM = raw.match(/(?:isp|organization)[:\s]+([^\n]+)/i);
  if (ispM) result.isp = ispM[1].trim().substring(0, 50);

  const catM = raw.match(/(?:categor(?:y|ies)|attack\s+types?)[:\s]+([^\n]+)/i);
  if (catM) result.cats = catM[1].trim();

  return result;
}

module.exports = {
  detectAndParse,
  parseVTRaw,
  parseAbuseIPDBRaw,
  sanitize,
  escHtml,
  MAX_FIELD_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_PAYLOAD_LENGTH,
};
