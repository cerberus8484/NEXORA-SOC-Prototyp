// Smart-Parser — portiert aus dem Ursprungs-Tool (index.html, detectAndParse).
// Erkennt den Artefakt-Typ aus Roh-Text und befüllt die Schema-Felder vor.
// Prioritätskette (erste Übereinstimmung gewinnt):
// URL → IPv4 → Email → Registry → Hash → Domain → File → Command → Base64 → Hex → Script → User-Agent → Andere

import i18n from '../../i18n';

export interface ParsedPayload {
  type: string;
  fields: Record<string, string>;
}

const SUSP_EXTS = ['exe', 'dll', 'ps1', 'bat', 'vbs', 'hta', 'scr', 'pif', 'cpl', 'lnk', 'msi'];
const SUSP_URL_EXTS = ['exe', 'dll', 'ps1', 'bat', 'vbs', 'hta', 'msi', 'jar', 'zip', 'rar'];
const SUSP_TLDS = ['ru', 'cn', 'top', 'xyz', 'tk', 'ml', 'ga', 'cf', 'pw', 'cc'];
const LOOKALIKES = ['paypa1', 'micros0ft', 'arnazon', 'g00gle', 'suppport', 'securrity'];

/** PowerShell-Base64 (-enc) ist UTF-16LE — jedes zweite Byte ist 0. */
function decodeUtf16leBase64(b64: string): string | null {
  try {
    const bytes = atob(b64);
    let isPsEnc = true;
    for (let i = 1; i < Math.min(bytes.length, 40); i += 2) {
      if (bytes.charCodeAt(i) !== 0) { isPsEnc = false; break; }
    }
    if (!isPsEnc || bytes.length <= 4) return null;
    let decoded = '';
    for (let i = 0; i < bytes.length - 1; i += 2) decoded += String.fromCharCode(bytes.charCodeAt(i));
    return decoded;
  } catch {
    return null;
  }
}

export function detectAndParse(raw: string): ParsedPayload {
  const t = raw.trim();
  if (!t) return { type: '', fields: {} };

  // ── URL ──
  if (/^https?:\/\//i.test(t) || /^ftp:\/\//i.test(t)) {
    const f: Record<string, string> = { url: t, method: '', status: '', referrer: '', notes: '' };
    try {
      const u = new URL(t);
      const qs = [...u.searchParams.entries()];
      const notes: string[] = [`Host: ${u.hostname}`];
      if (u.pathname && u.pathname !== '/') notes.push(`Path: ${u.pathname}`);
      if (qs.length) notes.push(`Query-Params: ${qs.map(([k, v]) => `${k}=${v}`).join(', ')}`);
      if (u.protocol === 'ftp:') notes.push('Protokoll: FTP');
      const ext = (u.pathname.split('.').pop() ?? '').toLowerCase();
      if (SUSP_URL_EXTS.includes(ext)) notes.push(i18n.t('tickets.suspiciousExtension', { ext }));
      f.notes = notes.join('\n');
      f.method = u.protocol === 'ftp:' ? 'FTP' : 'GET';
    } catch { /* unparsebare URL → nur Roh-Wert */ }
    return { type: 'URL', fields: f };
  }

  // ── IPv4 (mit optionalem Port) ──
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(t)) {
    const [ip, port] = t.split(':');
    const notes: string[] = [];
    if (/^10\./.test(ip)) notes.push(i18n.t('siem.privateNet10'));
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) notes.push(i18n.t('siem.privateNet172'));
    else if (/^192\.168\./.test(ip)) notes.push(i18n.t('siem.privateNet192'));
    else if (/^127\./.test(ip)) notes.push('Loopback / Localhost');
    else notes.push(i18n.t('ui.publicIpCheckThreatIntel'));
    if (port) notes.push(`Port: ${port}`);
    return { type: 'IP', fields: { ip, geo: '', asn: '', rep: '', notes: notes.join('\n') } };
  }

  // ── Email ──
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) {
    const [user, domain] = t.split('@');
    const notes: string[] = [];
    if (LOOKALIKES.some((l) => domain.toLowerCase().includes(l))) notes.push(i18n.t('ui.possibleTyposquattingDomain'));
    if (/^\d+$/.test(user)) notes.push(i18n.t('ui.senderSLocalPartOnly'));
    return { type: 'Email', fields: { sender: t, subject: '', attach: '', origip: '', header: '', notes: notes.join('\n') } };
  }

  // ── Registry Key ──
  if (/^HK(EY_(LOCAL_MACHINE|CURRENT_USER|USERS|CLASSES_ROOT|CURRENT_CONFIG)|LM|CU|U|CR)/i.test(t)) {
    const parts = t.replace(/\//g, '\\').split('\\');
    const valname = parts.length > 1 ? (parts.pop() ?? '') : '';
    const key = parts.join('\\');
    const notes: string[] = [];
    const persistPaths = ['\\Run\\', '\\RunOnce\\', '\\RunOnceEx\\', '\\Winlogon\\', '\\Services\\', '\\ScheduledTasks\\'];
    if (persistPaths.some((p) => t.includes(p))) notes.push('⚠️ Bekannter Persistence-Pfad');
    if (/HKCU/i.test(t)) notes.push(i18n.t('ui.userContextHkcuNoAdministrator'));
    if (/HKLM/i.test(t)) notes.push(i18n.t('tickets.systemContextHklm'));
    return { type: 'Registry-Key', fields: { key, valname, valdata: '', action: '', notes: notes.join('\n') } };
  }

  // ── Hash ──
  const vtLink = (h: string) => `https://www.virustotal.com/gui/file/${h}`;
  if (/^[a-f0-9]{32}$/i.test(t)) return { type: 'Hash', fields: { algo: 'MD5', hashval: t.toLowerCase(), filename: '', vt: vtLink(t.toLowerCase()) } };
  if (/^[a-f0-9]{40}$/i.test(t)) return { type: 'Hash', fields: { algo: 'SHA1', hashval: t.toLowerCase(), filename: '', vt: vtLink(t.toLowerCase()) } };
  if (/^[a-f0-9]{64}$/i.test(t)) return { type: 'Hash', fields: { algo: 'SHA256', hashval: t.toLowerCase(), filename: '', vt: vtLink(t.toLowerCase()) } };
  if (/^[a-f0-9]{128}$/i.test(t)) return { type: 'Hash', fields: { algo: 'SHA512', hashval: t.toLowerCase(), filename: '', vt: '' } };

  // ── Domain ──
  if (/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(t) && !t.includes('/')) {
    const parts = t.split('.');
    const tld = parts[parts.length - 1];
    const notes: string[] = [];
    if (SUSP_TLDS.includes(tld.toLowerCase())) notes.push(i18n.t('tickets.suspiciousTld', { tld }));
    if (parts.length > 3) notes.push(`Subdomain-Tiefe: ${parts.length - 2}`);
    return { type: 'Domain', fields: { domain: t, resolved: '', asn: '', seen: '', notes: notes.join('\n') } };
  }

  // ── File path ──
  if (/^[a-zA-Z]:\\/.test(t) || /^\/[a-z/]/.test(t)
    || /\.(exe|dll|ps1|bat|vbs|py|sh|js|hta|jar|msi|cmd|lnk|docm|xlsm|zip|rar|7z|scr|pif|cpl)$/i.test(t)) {
    const norm = t.replace(/\\/g, '/');
    const parts = norm.split('/');
    const filename = parts.pop() || t;
    const path = parts.join('\\') || '';
    const ext = (filename.split('.').pop() ?? '').toLowerCase();
    const notes: string[] = [];
    if (SUSP_EXTS.includes(ext)) notes.push(i18n.t('tickets.executableFile', { ext }));
    if (/temp|tmp|appdata|roaming|local\\microsoft/i.test(t)) notes.push(i18n.t('ui.pathTemporaryUserDirectory'));
    if (/system32|syswow64/i.test(t)) notes.push(i18n.t('ui.system32PathCheckDllHijacking'));
    return { type: 'File', fields: { filename, path, size: '', hash: '', notes: notes.join('\n') } };
  }

  // ── Command ──
  if (/^(cmd(\.exe)?|powershell(\.exe)?|pwsh|bash|sh|python[23]?|wscript|cscript|mshta|rundll32|regsvr32|certutil|bitsadmin|msiexec)\b/i.test(t)
    || /\s(\/c|\/k|-enc|-encodedcommand|-command|-exec|-nop|-w hidden|-windowstyle hidden)\b/i.test(t)
    || t.includes(' && ') || t.includes(' | ') || t.includes('; ')) {
    const shellM = t.match(/^(\S+\.exe|\S+)\s/i);
    const shell = shellM ? shellM[1] : '';
    const notes: string[] = [];

    const runasM = t.match(/runas\s+\/user[:\s]+(\S+)/i);
    const runas = runasM ? runasM[1] : '';

    const encM = t.match(/(?:-enc|-encodedcommand)\s+([A-Za-z0-9+/=]{10,})/i);
    if (encM) {
      const decoded = decodeUtf16leBase64(encM[1]);
      notes.push(decoded ? `Decoded (-enc): ${decoded}` : `Encoded payload: ${encM[1]}`);
    }
    if (/DownloadString|DownloadFile|WebClient|Net\.WebClient/i.test(t)) notes.push('⚠️ Download-Technik erkannt (WebClient)');
    if (/bypass|unrestricted|remotesigned/i.test(t)) notes.push('⚠️ ExecutionPolicy-Bypass');
    if (/iex\s*\(|invoke-expression/i.test(t)) notes.push(i18n.t('ui.iexInvokeExpressionDynamicExecution'));
    if (/hidden|windowstyle/i.test(t)) notes.push('Verstecktes Fenster — Stealth-Technik');

    return { type: 'Command', fields: { shell, runas, cmd: t, notes: notes.join('\n') } };
  }

  // ── Base64 ──
  if (t.length > 20 && /^[A-Za-z0-9+/]+=*$/.test(t) && t.length % 4 === 0) {
    let decoded = '';
    const notes: string[] = [];
    try {
      const raw64 = atob(t);
      const utf16 = decodeUtf16leBase64(t);
      if (utf16 !== null) {
        decoded = utf16;
        notes.push(i18n.t('tickets.utf16Decoded'));
      } else {
        decoded = raw64;
      }
      if (/http|wget|curl|iex|invoke|download/i.test(decoded)) notes.push(i18n.t('ui.suspiciousKeywordsDecodedContent'));
    } catch {
      notes.push(i18n.t('tickets.decodeFailed'));
    }
    return { type: 'Encoded String', fields: { encoding: 'Base64', encoded: t, decoded, notes: notes.join('\n') } };
  }

  // ── Hex ──
  if (t.length > 20 && /^([a-f0-9]{2}\s?)+$/i.test(t)) {
    const hex = t.replace(/\s/g, '');
    let decoded = '';
    const pairs = hex.match(/.{2}/g);
    if (pairs) {
      decoded = pairs.map((b) => String.fromCharCode(parseInt(b, 16))).join('');
      // Nicht druckbare Steuerzeichen → als Binärdaten markieren
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x08\x0e-\x1f]/.test(decoded)) decoded = i18n.t('ui.binaryDataCannotDisplayed');
    }
    return { type: 'Encoded String', fields: { encoding: 'Hex', encoded: t, decoded, notes: '' } };
  }

  // ── Script ──
  if (/Invoke-|Import-Module|New-Object|IEX\b|wget\s|curl\s|chmod\s|sudo\s/i.test(t) || t.startsWith('#!')) {
    const lang = /powershell|Invoke-|IEX/i.test(t) ? 'PowerShell'
      : /python/i.test(t) ? 'Python'
        : /bash|sh\s|#!/.test(t) ? 'Bash/Shell'
          : /\bnode\b|require\(|process\.env/i.test(t) ? 'JavaScript/Node'
            : 'Script';
    const notes: string[] = [];
    if (/DownloadString|DownloadFile|WebClient/i.test(t)) notes.push('⚠️ Download-Funktion erkannt');
    if (/base64|frombase64/i.test(t)) notes.push(i18n.t('tickets.base64InScript'));
    if (/-nop|-noprofile|-windowstyle hidden/i.test(t)) notes.push('⚠️ Stealth-Parameter');
    return { type: 'Script', fields: { filename: '', lang, snippet: t, notes: notes.join('\n') } };
  }

  // ── User-Agent ──
  if (/^Mozilla\/|^curl\/|^python-requests|^Wget\/|^Go-http|^Apache-|^libwww/i.test(t)) {
    const notes: string[] = [];
    const tool = /curl/i.test(t) ? 'curl'
      : /python-requests/i.test(t) ? 'Python requests'
        : /wget/i.test(t) ? 'wget'
          : /go-http/i.test(t) ? 'Go http.Client'
            : /python/i.test(t) ? 'Python'
              : /powershell/i.test(t) ? 'PowerShell WebClient' : '';
    if (/compatible;\s*(bot|crawler|spider|scan)/i.test(t)) notes.push('⚠️ Bot/Scanner User-Agent');
    if (t.length < 30) notes.push(i18n.t('ui.veryShortUserAgentPossibly'));
    return { type: 'User-Agent', fields: { ua: t, tool, notes: notes.join('\n') } };
  }

  // ── Fallback ──
  return { type: 'Andere', fields: { label: '', value: t, notes: '' } };
}
