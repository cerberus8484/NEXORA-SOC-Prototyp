'use strict';

/**
 * Smart-Import-Parser — Backend-Port des Original-detectAndParse() aus index.html.
 *
 * Prioritätskette (erster Treffer gewinnt):
 *   URL → IPv4 → Email → Registry-Key → Hash → Domain → File → Command
 *   → Base64 → Hex → Script → User-Agent → Andere
 *
 * Security:
 *   - raw-Cap: 20 000 Zeichen (ReDoS skaliert mit Eingabelänge)
 *   - Alle Regex sind linear (kein verschachtelter Quantor wie (a+)+)
 *   - Kein atob — Node-native Buffer.from(str, 'base64')
 *   - Keine Seiteneffekte: reine Funktion
 */

const { randomUUID } = require('crypto');

// ── Konstanten ───────────────────────────────────────────────────────────────
const RAW_CAP = 20_000;

// Bekannte verdächtige TLDs
const SUSP_TLD = new Set(['ru', 'cn', 'top', 'xyz', 'tk', 'ml', 'ga', 'cf', 'pw', 'cc']);

// Persistenz-Pfade in der Windows-Registry
const PERSIST_PATHS = [
  '\\Run\\', '\\RunOnce\\', '\\RunOnceEx\\',
  '\\Winlogon\\', '\\Services\\', '\\ScheduledTasks\\',
];

// Ausführbare Dateiendungen
const EXEC_EXTS = new Set([
  'exe', 'dll', 'ps1', 'bat', 'vbs', 'hta', 'scr', 'pif', 'cpl', 'lnk', 'msi',
  'py', 'sh', 'js', 'jar', 'cmd',
]);

// Alle bekannten Payload-Typen (für IoC-Klassifizierung)
const IOC_TYPES = { IP: 'ip', DOMAIN: 'domain', URL: 'url', HASH: 'hash', FILE: 'file', OTHER: 'other' };

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

/** IoC-Typ bestimmen — Dateipfade korrekt als 'file' erkennen, nicht als 'domain'. */
function classifyIoc(v) {
  const s = String(v || '').trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return IOC_TYPES.IP;
  if (/^https?:\/\//i.test(s)) return IOC_TYPES.URL;
  if (/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$|^[a-f0-9]{128}$/i.test(s)) return IOC_TYPES.HASH;
  // Dateipfade vor Domain prüfen
  if (/[/\\]/.test(s) || /^[a-z]:/i.test(s) ||
      /\.(exe|dll|ps1|bat|cmd|scr|vbs|js|jar|sys|tmp|dat|docm?|xlsm?)$/i.test(s)) return IOC_TYPES.FILE;
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(s)) return IOC_TYPES.DOMAIN;
  return IOC_TYPES.OTHER;
}

/** Einfachen IoC-Eintrag bauen. */
function makeIoc(value, type) {
  return { type: type || classifyIoc(value), value: String(value || '').trim() };
}

/**
 * PowerShell UTF-16LE Base64 dekodieren (Node-native, kein atob).
 * Gibt { decoded, isUtf16Le } zurück. Wirft nie.
 */
function decodeBase64(encoded) {
  try {
    const buf = Buffer.from(encoded, 'base64');
    // Heuristik: Jedes zweite Byte = 0 → UTF-16LE (PowerShell -enc)
    let isPsEnc = buf.length > 4;
    for (let i = 1; i < Math.min(buf.length, 40) && isPsEnc; i += 2) {
      if (buf[i] !== 0) isPsEnc = false;
    }
    if (isPsEnc) {
      const chars = [];
      for (let i = 0; i < buf.length - 1; i += 2) chars.push(String.fromCharCode(buf[i]));
      return { decoded: chars.join(''), isUtf16Le: true };
    }
    return { decoded: buf.toString('utf8'), isUtf16Le: false };
  } catch {
    return { decoded: '', isUtf16Le: false };
  }
}

// ── Haupt-Parser ─────────────────────────────────────────────────────────────

/**
 * Analysiert einen rohen String und erkennt den Payload-Typ automatisch.
 *
 * @param {string|null|undefined} rawInput - Roh-Text (wird auf RAW_CAP gekappt).
 * @param {string} sourceType             - Import-Quelle (für Kontext, nicht für Parse-Logik).
 * @returns {{ type: string, fields: Record<string,string>, iocs: {type:string,value:string}[] }}
 */
function smartParse(rawInput, sourceType) {
  // Safety: null/undefined behandeln
  const raw = typeof rawInput === 'string' ? rawInput : String(rawInput ?? '');
  // Raw-Cap (Security: katastrophales Backtracking skaliert mit Länge)
  const t = raw.slice(0, RAW_CAP).trim();

  if (!t) {
    return { type: 'Andere', fields: { label: '', value: '', notes: '' }, iocs: [] };
  }

  // ── URL ────────────────────────────────────────────────────────────────────
  if (/^https?:\/\//i.test(t) || /^ftp:\/\//i.test(t)) {
    const fields = { url: t, method: '', status: '', referrer: '', notes: '' };
    const notes = [];
    try {
      const u = new URL(t);
      notes.push(`Host: ${u.hostname}`);
      if (u.pathname && u.pathname !== '/') notes.push(`Path: ${u.pathname}`);
      const qs = [...u.searchParams.entries()];
      if (qs.length) notes.push(`Query-Params: ${qs.map(([k, v]) => `${k}=${v}`).join(', ')}`);
      if (u.protocol === 'ftp:') notes.push('Protokoll: FTP');
      const ext = u.pathname.split('.').pop().toLowerCase();
      if (EXEC_EXTS.has(ext)) notes.push(`Verdaechtige Dateiendung: .${ext}`);
      fields.method = u.protocol === 'ftp:' ? 'FTP' : 'GET';
    } catch { /* ungültige URL — trotzdem als URL speichern */ }
    if (notes.length) fields.notes = notes.join('\n');
    return { type: 'URL', fields, iocs: [makeIoc(t, IOC_TYPES.URL)] };
  }

  // ── IPv4 (mit optionalem Port) ────────────────────────────────────────────
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(t)) {
    const [ip, port] = t.split(':');
    const notes = [];
    if (/^10\./.test(ip))                           notes.push('Privates Netz: 10.0.0.0/8');
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) notes.push('Privates Netz: 172.16.0.0/12');
    else if (/^192\.168\./.test(ip))                notes.push('Privates Netz: 192.168.240.0/16');
    else if (/^127\./.test(ip))                     notes.push('Loopback / Localhost');
    else                                             notes.push('Oeffentliche IP — Threat Intel pruefen');
    if (port) notes.push(`Port: ${port}`);
    return {
      type: 'IP',
      fields: { ip, geo: '', asn: '', rep: '', notes: notes.join('\n') },
      iocs: [makeIoc(ip, IOC_TYPES.IP)],
    };
  }

  // ── Email ──────────────────────────────────────────────────────────────────
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) {
    const [, domain] = t.split('@');
    const notes = [];
    const lookalikes = ['paypa1', 'micros0ft', 'arnazon', 'g00gle', 'suppport', 'securrity'];
    if (lookalikes.some((l) => domain.toLowerCase().includes(l)))
      notes.push('Mögliches Typosquatting der Domain');
    if (/^\d+$/.test(t.split('@')[0])) notes.push('Absender-Localpart ist nur Zahlen — ungewöhnlich');
    return {
      type: 'Email',
      fields: { sender: t, subject: '', attach: '', origip: '', header: '', notes: notes.join('\n') },
      iocs: [makeIoc(t, IOC_TYPES.OTHER)],
    };
  }

  // ── Registry-Key ──────────────────────────────────────────────────────────
  if (/^HK(EY_(LOCAL_MACHINE|CURRENT_USER|USERS|CLASSES_ROOT|CURRENT_CONFIG)|LM|CU|U|CR)/i.test(t)) {
    const normalized = t.replace(/\//g, '\\');
    const parts = normalized.split('\\');
    const valname = parts.length > 1 ? parts.pop() : '';
    const key = parts.join('\\');
    const notes = [];
    if (PERSIST_PATHS.some((p) => normalized.includes(p))) notes.push('Bekannter Persistence-Pfad');
    if (/HKCU/i.test(t)) notes.push('User-Context (HKCU) — kein Admin erforderlich');
    if (/HKLM/i.test(t)) notes.push('System-Context (HKLM) — Admin-Rechte vorhanden');
    return {
      type: 'Registry-Key',
      fields: { key, valname, valdata: '', action: '', notes: notes.join('\n') },
      iocs: [makeIoc(t, IOC_TYPES.OTHER)],
    };
  }

  // ── Hash ───────────────────────────────────────────────────────────────────
  if (/^[a-f0-9]{32}$/i.test(t)) {
    const h = t.toLowerCase();
    return { type: 'Hash', fields: { algo: 'MD5', hashval: h, filename: '', vt: `https://www.virustotal.com/gui/file/${h}`, notes: '' }, iocs: [makeIoc(h, IOC_TYPES.HASH)] };
  }
  if (/^[a-f0-9]{40}$/i.test(t)) {
    const h = t.toLowerCase();
    return { type: 'Hash', fields: { algo: 'SHA1', hashval: h, filename: '', vt: `https://www.virustotal.com/gui/file/${h}`, notes: '' }, iocs: [makeIoc(h, IOC_TYPES.HASH)] };
  }
  if (/^[a-f0-9]{64}$/i.test(t)) {
    const h = t.toLowerCase();
    return { type: 'Hash', fields: { algo: 'SHA256', hashval: h, filename: '', vt: `https://www.virustotal.com/gui/file/${h}`, notes: '' }, iocs: [makeIoc(h, IOC_TYPES.HASH)] };
  }
  if (/^[a-f0-9]{128}$/i.test(t)) {
    const h = t.toLowerCase();
    return { type: 'Hash', fields: { algo: 'SHA512', hashval: h, filename: '', vt: '', notes: '' }, iocs: [makeIoc(h, IOC_TYPES.HASH)] };
  }

  // ── Domain ─────────────────────────────────────────────────────────────────
  // Keine Schrägstriche (wären URL), nur Buchstaben/Zahlen/Bindestrich + Punkte.
  if (/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(t) && !t.includes('/')) {
    const parts = t.split('.');
    const tld = parts[parts.length - 1].toLowerCase();
    const notes = [];
    if (SUSP_TLD.has(tld)) notes.push(`Verdaechtige TLD: .${tld}`);
    if (parts.length > 3) notes.push(`Subdomain-Tiefe: ${parts.length - 2}`);
    return {
      type: 'Domain',
      fields: { domain: t, resolved: '', asn: '', seen: '', notes: notes.join('\n') },
      iocs: [makeIoc(t, IOC_TYPES.DOMAIN)],
    };
  }

  // ── File-Pfad ─────────────────────────────────────────────────────────────
  if (/^[a-zA-Z]:[/\\]/.test(t) || /^\/[a-z/]/.test(t) ||
      /\.(exe|dll|ps1|bat|vbs|py|sh|js|hta|jar|msi|cmd|lnk|docm|xlsm|zip|rar|7z|scr|pif|cpl)$/i.test(t)) {
    const norm = t.replace(/\\/g, '/');
    const parts = norm.split('/');
    const filename = parts.pop() || t;
    const path = parts.join('\\') || '';
    const ext = filename.split('.').pop().toLowerCase();
    const notes = [];
    if (EXEC_EXTS.has(ext)) notes.push(`Ausführbare Datei: .${ext}`);
    if (/temp|tmp|appdata|roaming|local.microsoft/i.test(t)) notes.push('Pfad in temporärem/Benutzerverzeichnis');
    if (/system32|syswow64/i.test(t)) notes.push('System32-Pfad — auf DLL-Hijacking prüfen');
    return {
      type: 'File',
      fields: { filename, path, size: '', hash: '', notes: notes.join('\n') },
      iocs: [makeIoc(t, IOC_TYPES.FILE)],
    };
  }

  // ── Script mit Shebang (vor Command — Shebang-Scripts enthalten ' | ' das Command matcht) ──
  if (t.startsWith('#!')) {
    const lang = /bash|sh\s|#!/.test(t) ? 'Bash/Shell'
               : /python/i.test(t) ? 'Python'
               : /node/i.test(t) ? 'JavaScript/Node'
               : 'Script';
    const notes = [];
    if (/DownloadString|DownloadFile|WebClient/i.test(t)) notes.push('Download-Funktion erkannt');
    if (/base64|frombase64/i.test(t)) notes.push('Base64-Verarbeitung im Script');
    if (/-nop|-noprofile|-windowstyle hidden/i.test(t)) notes.push('Stealth-Parameter');
    return {
      type: 'Script',
      fields: { filename: '', lang, snippet: t, notes: notes.join('\n') },
      iocs: [makeIoc(t, IOC_TYPES.OTHER)],
    };
  }

  // ── User-Agent (vor Command — UA enthält '; ' das Command-Muster matcht) ───
  if (/^Mozilla\/|^curl\/|^python-requests|^Wget\/|^Go-http|^Apache-|^libwww/i.test(t)) {
    const notes = [];
    const toolGuess =
      /curl/i.test(t)            ? 'curl' :
      /python-requests/i.test(t) ? 'Python requests' :
      /wget/i.test(t)            ? 'wget' :
      /go-http/i.test(t)         ? 'Go http.Client' :
      /python/i.test(t)          ? 'Python' :
      /powershell/i.test(t)      ? 'PowerShell WebClient' : '';
    if (/compatible;\s*(bot|crawler|spider|scan)/i.test(t)) notes.push('Bot/Scanner User-Agent');
    if (t.length < 30) notes.push('Sehr kurzer UA — moeglicherweise Tool/Script');
    return {
      type: 'User-Agent',
      fields: { ua: t, tool: toolGuess, notes: notes.join('\n') },
      iocs: [makeIoc(t, IOC_TYPES.OTHER)],
    };
  }

  // ── Command ────────────────────────────────────────────────────────────────
  if (/^(cmd(\.exe)?|powershell(\.exe)?|pwsh|bash|sh|python[23]?|wscript|cscript|mshta|rundll32|regsvr32|certutil|bitsadmin|msiexec)\b/i.test(t)
    || /\s(\/c|\/k|-enc|-encodedcommand|-command|-exec|-nop|-w hidden|-windowstyle hidden)\b/i.test(t)
    || t.includes(' && ') || t.includes(' | ') || t.includes('; ')) {

    const shellMatch = t.match(/^(\S+\.exe|\S+)\s/i);
    const shell = shellMatch ? shellMatch[1] : '';
    const notes = [];

    const runasMatch = t.match(/runas\s+\/user[:\s]+(\S+)/i);
    const runas = runasMatch ? runasMatch[1] : '';

    // -enc / -encodedcommand → Base64 dekodieren (PowerShell UTF-16LE)
    const encMatch = t.match(/(?:-enc|-encodedcommand)\s+([A-Za-z0-9+/=]{10,})/i);
    if (encMatch) {
      const { decoded } = decodeBase64(encMatch[1]);
      if (decoded) notes.push(`Decoded (-enc): ${decoded}`);
      else notes.push(`Encoded payload: ${encMatch[1]}`);
    }

    if (/DownloadString|DownloadFile|WebClient|Net\.WebClient/i.test(t))
      notes.push('Download-Technik erkannt (WebClient)');
    if (/bypass|unrestricted|remotesigned/i.test(t))
      notes.push('ExecutionPolicy-Bypass');
    if (/iex\s*\(|invoke-expression/i.test(t))
      notes.push('IEX / Invoke-Expression — dynamische Ausfuehrung');
    if (/hidden|windowstyle/i.test(t))
      notes.push('Verstecktes Fenster — Stealth-Technik');

    return {
      type: 'Command',
      fields: { shell, runas, cmd: t, notes: notes.join('\n') },
      iocs: [makeIoc(t, IOC_TYPES.OTHER)],
    };
  }

  // ── Base64 ─────────────────────────────────────────────────────────────────
  // Mindestlänge 8, nur Base64-Alphabet, Länge mod 4 = 0
  if (t.length >= 8 && /^[A-Za-z0-9+/]+=*$/.test(t) && t.length % 4 === 0) {
    const notes = [];
    const { decoded, isUtf16Le } = decodeBase64(t);
    if (isUtf16Le) notes.push('UTF-16LE dekodiert (PowerShell -enc)');
    if (decoded && /http|wget|curl|iex|invoke|download/i.test(decoded))
      notes.push('Verdaechtige Keywords im dekodierten Inhalt');
    if (!decoded) notes.push('Dekodierung fehlgeschlagen');
    return {
      type: 'Encoded String',
      fields: { encoding: 'Base64', encoded: t, decoded: decoded || '', notes: notes.join('\n') },
      iocs: [makeIoc(t, IOC_TYPES.OTHER)],
    };
  }

  // ── Hex ────────────────────────────────────────────────────────────────────
  // Mindestlänge 16 (8 Bytes), nur Hex-Bytes (mit optionalen Leerzeichen)
  if (t.length >= 16 && /^([a-f0-9]{2}\s?)+$/i.test(t)) {
    const hex = t.replace(/\s/g, '');
    let decoded = '';
    try {
      const bytes = hex.match(/.{2}/g) || [];
      const chars = bytes.map((b) => String.fromCharCode(parseInt(b, 16)));
      const candidate = chars.join('');
      // Nur anzeigen wenn druckbar
      decoded = /[\x00-\x08\x0e-\x1f]/.test(candidate) ? '(Binaerdaten — nicht darstellbar)' : candidate;
    } catch { /* ignore */ }
    return {
      type: 'Encoded String',
      fields: { encoding: 'Hex', encoded: t, decoded, notes: '' },
      iocs: [makeIoc(t, IOC_TYPES.OTHER)],
    };
  }

  // ── Script ─────────────────────────────────────────────────────────────────
  if (/Invoke-|Import-Module|New-Object|IEX\b|wget\s|curl\s|chmod\s|sudo\s/i.test(t) || t.startsWith('#!')) {
    const lang = /powershell|Invoke-|IEX/i.test(t) ? 'PowerShell'
               : /python/i.test(t) ? 'Python'
               : /bash|sh\s|#!/.test(t) ? 'Bash/Shell'
               : /\bnode\b|require\(|process\.env/i.test(t) ? 'JavaScript/Node'
               : 'Script';
    const notes = [];
    if (/DownloadString|DownloadFile|WebClient/i.test(t)) notes.push('Download-Funktion erkannt');
    if (/base64|frombase64/i.test(t)) notes.push('Base64-Verarbeitung im Script');
    if (/-nop|-noprofile|-windowstyle hidden/i.test(t)) notes.push('Stealth-Parameter');
    return {
      type: 'Script',
      fields: { filename: '', lang, snippet: t, notes: notes.join('\n') },
      iocs: [makeIoc(t, IOC_TYPES.OTHER)],
    };
  }

  // ── Fallback ───────────────────────────────────────────────────────────────
  return { type: 'Andere', fields: { label: '', value: t, notes: '' }, iocs: [] };
}

// ── Mapper: ParseResult → ParsedEvidence-Form ─────────────────────────────────
/**
 * Konvertiert das smartParse-Ergebnis in die ParsedEvidence-Form, die das
 * Frontend erwartet (analysisModel.ts: ParsedEvidence).
 *
 * Mapping-Regeln:
 *   - IP   → destination.ip
 *   - URL  → payload.url
 *   - Email→ source.user
 *   - Hash → payload.preview (hashval)
 *   - Domain → destination.fqdn
 *   - File  → source.host (Pfad) + file-Felder
 *   - Alle  → payload.type = smartParse-Typ, payload.preview
 *   - iocs  → direkt weitergereicht
 *
 * @param {{ type: string, fields: Record<string,string>, iocs: {type:string,value:string}[] }} parseResult
 * @param {string} sourceType
 * @returns {Object} ParsedEvidence-äquivalentes Objekt mit iocs[]-Erweiterung
 */
function parsedToEvidence(parseResult, sourceType) {
  const { type, fields, iocs } = parseResult;

  const base = {
    id: randomUUID(),
    type: 'alert',
    detection: {
      sourceSystem: sourceType || 'manual',
      timestamp: new Date().toISOString(),
      description: `Smart-Import: ${type}`,
    },
    source: {},
    destination: {},
    nat: {},
    network: {},
    payload: { type },
    metadata: {},
    iocs: iocs || [],
  };

  switch (type) {
    case 'IP':
      base.destination = { ip: fields.ip || '' };
      base.type = 'network';
      break;

    case 'URL':
      base.payload = {
        ...base.payload,
        url: fields.url || '',
        method: fields.method || '',
        preview: fields.notes || '',
      };
      base.type = 'network';
      break;

    case 'Email':
      base.source = { user: fields.sender || '' };
      base.payload = { ...base.payload, preview: fields.notes || '' };
      break;

    case 'Hash':
      base.payload = {
        ...base.payload,
        preview: `${fields.algo}: ${fields.hashval}`,
      };
      break;

    case 'Domain':
      base.destination = { fqdn: fields.domain || '' };
      base.dns = { query: fields.domain || '' };
      base.type = 'dns';
      break;

    case 'File':
      base.file = {
        name: fields.filename || '',
        hashes: fields.hash || '',
      };
      base.payload = { ...base.payload, preview: fields.notes || '' };
      base.type = 'alert';
      break;

    case 'Command':
      base.process = {
        commandLine: fields.cmd || '',
        image: fields.shell || '',
        user: fields.runas || '',
      };
      base.payload = { ...base.payload, preview: fields.notes || '' };
      break;

    case 'Script':
      base.payload = {
        ...base.payload,
        preview: fields.snippet ? fields.snippet.slice(0, 500) : '',
        containsScript: true,
      };
      break;

    case 'Registry-Key':
      base.payload = {
        ...base.payload,
        preview: `${fields.key}\\${fields.valname}`,
      };
      break;

    case 'Encoded String':
      base.payload = {
        ...base.payload,
        containsBase64: fields.encoding === 'Base64',
        preview: fields.decoded ? fields.decoded.slice(0, 300) : fields.encoded.slice(0, 300),
      };
      break;

    case 'User-Agent':
      base.payload = {
        ...base.payload,
        userAgent: fields.ua || '',
        preview: fields.notes || '',
      };
      break;

    default:
      base.payload = { ...base.payload, preview: fields.value || '' };
  }

  return base;
}

module.exports = { smartParse, parsedToEvidence };
