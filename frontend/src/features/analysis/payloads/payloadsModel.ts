// Reine, testbare Ableitung der Payload-Untersuchung aus echten Ticketfeldern.
// Quelle: ParsedEvidence (file, process/command, payload/HTTP, dns, destination) + dekodierter
// Encoded-Command. KEINE erfundenen Dateien/Hashes/URLs/Registry — alles per deterministischer
// Extraktion aus realem Inhalt. Fehlt ein Feld, bleibt es undefined → UI zeigt „—".
import type { ParsedEvidence } from '../analysisModel';
import { parseHashes, decodeEncodedCommand } from '../deckModel';
import i18n from '../../../i18n';

const blank = (v?: string | null): string | undefined => (v && String(v).trim() ? String(v).trim() : undefined);
const baseName = (p?: string): string | undefined => { const v = blank(p); return v ? (v.split(/[\\/]/).pop() || v) : undefined; };
const hashOf = (ev: ParsedEvidence, algo: RegExp): string | undefined =>
  [...parseHashes(ev.file?.hashes), ...parseHashes(ev.process?.hashes)].find((h) => algo.test(h.algo))?.value;

const FILE_TYPES: Record<string, string> = {
  ps1: 'PowerShell Script', psm1: 'PowerShell Module', exe: 'Executable', dll: 'DLL', sys: 'Driver',
  bat: 'Batch Script', cmd: 'Batch Script', vbs: 'VBScript', js: 'JScript', hta: 'HTML Application',
  tmp: 'Temp File', zip: 'ZIP Archive', rar: 'RAR Archive', docx: 'Word Document', xlsx: i18n.t('tickets.excelFile'), pdf: 'PDF',
};
const fileType = (name?: string): string | undefined => {
  const ext = (name || '').split('.').pop()?.toLowerCase();
  return ext && ext !== name ? FILE_TYPES[ext] : undefined;
};

/** Dekodierter PowerShell-Encoded-Command (rein lokal, kein Exec). */
export function decodePowerShell(ev: ParsedEvidence): string | undefined {
  return decodeEncodedCommand(ev.process?.commandLine) || undefined;
}

// ── Normalized Payload (Datei-Metadaten) ──────────────────────────────────────
export interface NormalizedPayload {
  fileName?: string; filePath?: string; fileType?: string;
  sha256?: string; md5?: string; created?: string; modified?: string; user?: string;
}
export function normalizedPayload(ev: ParsedEvidence): NormalizedPayload {
  const filePath = blank(ev.file?.name);
  return {
    filePath,
    fileName: baseName(ev.file?.name),
    fileType: fileType(ev.file?.name) ?? blank(ev.payload.type),
    sha256: hashOf(ev, /sha-?256/i),
    md5: hashOf(ev, /^md5$/i),
    created: blank(ev.detection.timestamp),
    modified: undefined,
    user: blank(ev.process?.user) ?? blank(ev.source.user),
  };
}

// ── Parsed Payload Fields (Extraktion aus Command/Decoded) ────────────────────
const SCRIPT_ENGINE: Record<string, string> = {
  'powershell.exe': 'Microsoft PowerShell', 'pwsh.exe': 'PowerShell Core',
  'cmd.exe': 'Windows Command Processor', 'wscript.exe': 'Windows Script Host',
  'cscript.exe': 'Windows Script Host', 'mshta.exe': 'HTML Application Host',
};
const LOLBINS = new Set(['rundll32.exe', 'mshta.exe', 'regsvr32.exe', 'bitsadmin.exe', 'certutil.exe', 'wmic.exe', 'installutil.exe', 'msbuild.exe', 'powershell.exe', 'cscript.exe', 'wscript.exe']);

const firstUrl = (text: string): string | undefined => text.match(/https?:\/\/[^\s"'<>)]+/i)?.[0];
const firstExePath = (text: string): string | undefined =>
  text.match(/(?:[A-Za-z]:\\|%[A-Za-z]+%\\|\$env:[A-Za-z]+\\)[^\s"'<>|]*\.(?:exe|dll|scr)/i)?.[0];
const firstRunKey = (text: string): string | undefined =>
  text.match(/HK(?:CU|LM|CR|U|CC)[:\\][^\s"'<>]*\\Run[^\s"'<>]*/i)?.[0]
  ?? text.match(/HK(?:CU|LM|CR|U|CC)[:\\][^\s"'<>]*Run\b/i)?.[0];

export interface ParsedPayloadFields {
  scriptEngine?: string; invocation?: string; executionPolicy?: string;
  downloadedFrom?: string; droppedFile?: string; dropsTo?: string;
  persistence?: string; lolbin?: string; commandType?: string;
}
export function parsePayloadFields(ev: ParsedEvidence, decoded?: string): ParsedPayloadFields {
  const img = baseName(ev.process?.image)?.toLowerCase();
  const cmd = blank(ev.process?.commandLine) ?? '';
  const text = [decoded, cmd, blank(ev.payload.url)].filter(Boolean).join('\n');
  const epMatch = /(?:-ep|-executionpolicy)\s+(\w+)/i.exec(cmd);
  const executionPolicy = epMatch ? cap(epMatch[1]) : (/bypass/i.test(cmd) ? 'Bypass' : undefined);
  const isEncoded = /-enc(odedcommand)?\b/i.test(cmd);
  const droppedFile = blank(ev.file?.name);
  const dropsTo = firstExePath(text);
  return {
    scriptEngine: img ? SCRIPT_ENGINE[img] : undefined,
    invocation: cmd || undefined,
    executionPolicy,
    downloadedFrom: firstUrl(text) ?? blank(ev.payload.url),
    droppedFile,
    dropsTo: dropsTo && dropsTo !== droppedFile ? dropsTo : (droppedFile ? undefined : dropsTo),
    persistence: firstRunKey(text),
    lolbin: img && LOLBINS.has(img) ? baseName(ev.process?.image) : undefined,
    commandType: isEncoded ? 'EncodedCommand' : (cmd ? 'CommandLine' : undefined),
  };
}
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// ── Extracted Strings (URLs/IPs/Pfade/Registry aus dem realen Inhalt) ─────────
export function extractStrings(ev: ParsedEvidence, decoded?: string): string[] {
  const text = [decoded, blank(ev.process?.commandLine), blank(ev.payload.url), blank(ev.dns?.query)].filter(Boolean).join('\n');
  if (!text) return [];
  const out = new Set<string>();
  const add = (re: RegExp) => { for (const m of text.match(re) ?? []) out.add(m); };
  add(/https?:\/\/[^\s"'<>)]+/gi);
  add(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g);
  add(/[A-Za-z]:\\[^\s"'<>|]+/g);
  add(/%[A-Za-z]+%\\[^\s"'<>|]+/g);
  add(/\$env:[A-Za-z]+\\[^\s"'<>|]*/gi);
  add(/HK(?:CU|LM|CR|U|CC)[:\\][^\s"'<>]+/gi);
  return [...out];
}

// ── Indicators Found (abgeleitete, prüfenswerte Befunde mit Severity) ─────────
export type IndicatorSeverity = 'high' | 'medium' | 'low';
export interface PayloadIndicator { label: string; severity: IndicatorSeverity }
const SUSPICIOUS_TLDS = ['.top', '.xyz', '.gq', '.tk', '.ml', '.cf', '.ga', '.zip', '.mov', '.click', '.work'];

export function payloadIndicators(ev: ParsedEvidence, parsed: ParsedPayloadFields, decoded?: string): PayloadIndicator[] {
  const out: PayloadIndicator[] = [];
  if (parsed.commandType === 'EncodedCommand' || decoded) out.push({ label: 'Encoded PowerShell', severity: 'high' });
  if (parsed.downloadedFrom) out.push({ label: 'External URL', severity: 'high' });
  if (parsed.droppedFile || parsed.dropsTo) out.push({ label: 'Dropped File', severity: 'high' });
  if (parsed.lolbin) out.push({ label: 'LOLBIN Usage', severity: 'medium' });
  if (parsed.persistence) out.push({ label: 'Run Key Persistence', severity: 'medium' });
  const hay = [parsed.downloadedFrom, blank(ev.destination.fqdn), blank(ev.dns?.query)].filter(Boolean).join(' ').toLowerCase();
  const tld = SUSPICIOUS_TLDS.find((d) => hay.includes(d));
  if (tld) out.push({ label: `Suspicious TLD (${tld})`, severity: 'low' });
  return out;
}

// ── Raw Event Snippet (echtes Roh-Event bevorzugt, sonst kompaktes JSON) ──────
export function rawSnippet(ev: ParsedEvidence): string {
  if (ev.raw && typeof ev.raw === 'object') {
    try { return JSON.stringify(ev.raw, null, 2); } catch { /* fällt unten zurück */ }
  }
  const snap = {
    timestamp: blank(ev.detection.timestamp),
    rule: { id: blank(ev.detection.ruleId), level: blank(ev.detection.severity), description: blank(ev.detection.ruleName) || blank(ev.detection.description) },
    agent: { name: blank(ev.metadata.agentName), id: blank(ev.metadata.agentId), ip: blank(ev.source.ip) },
    user: blank(ev.process?.user) ?? blank(ev.source.user),
    data: {
      srcip: blank(ev.source.ip),
      file: blank(ev.file?.name),
      sha256: hashOf(ev, /sha-?256/i),
      process: blank(ev.process?.image),
      command: blank(ev.process?.commandLine),
    },
  };
  return JSON.stringify(snap, null, 2);
}

// ── Payload Relationships (Prozess → Script → URL → Drop) ─────────────────────
export type PayloadNodeKind = 'process' | 'file' | 'url' | 'dropped';
export interface PayloadChainNode { id: string; kind: PayloadNodeKind; label: string; sub?: string; edge?: string }
export function buildPayloadChain(ev: ParsedEvidence, parsed: ParsedPayloadFields): PayloadChainNode[] {
  const nodes: PayloadChainNode[] = [];
  const proc = baseName(ev.process?.image);
  if (proc) nodes.push({ id: 'process', kind: 'process', label: proc, sub: ev.process?.processId ? `PID ${ev.process.processId}` : 'Process' });
  const file = blank(ev.file?.name);
  if (file) nodes.push({ id: 'file', kind: 'file', label: baseName(file)!, sub: fileType(file) ?? i18n.t('common.file'), edge: nodes.length ? 'dropped' : undefined });
  if (parsed.downloadedFrom) nodes.push({ id: 'url', kind: 'url', label: parsed.downloadedFrom, sub: 'External URL', edge: nodes.length ? 'downloads' : undefined });
  if (parsed.dropsTo) nodes.push({ id: 'dropped', kind: 'dropped', label: baseName(parsed.dropsTo)!, sub: parsed.dropsTo, edge: nodes.length ? 'drops / executes' : undefined });
  return nodes;
}
