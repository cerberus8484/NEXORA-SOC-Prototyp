// Reine, testbare Ableitung der Command-Evidence aus echten Ticketfeldern.
// Quelle: ParsedEvidence.process (Sysmon Event 1 / Security 4688) + Prozess-Images aus
// korrelierten Netzwerk-Flows (Sysmon Event 3). KEINE erfundenen Prozesse/Hashes/Parents.
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence, NetworkCorrelation } from '../analysisModel';
import { parseHashes, decodeEncodedCommand, type HashEntry } from '../deckModel';

export interface CommandRow {
  id: string;
  time?: string;
  image?: string;
  commandLine?: string;
  decoded?: string;
  parentImage?: string;
  parentCommandLine?: string;
  user?: string;
  host?: string;
  source?: string;
  ruleId?: string;
  level?: number;
  hashes: HashEntry[];
  mitre: string[];
  pid?: string;
  parentPid?: string;
  integrityLevel?: string;
  cwd?: string;
  /** Echtes Risiko-Signal: dekodierter Encoded-Command ODER hoher Rule-Level. Keine neue Erkennungslogik. */
  suspicious: boolean;
}

const blank = (v?: string | null): string | undefined => (v && String(v).trim() ? String(v).trim() : undefined);
const baseName = (img?: string | null): string => (img && String(img).trim() ? (img.split(/[\\/]/).pop() || img).toLowerCase() : '');
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** Leitet die beobachteten Commands ab — zuerst die volle Prozess-Evidence des Tickets,
 *  dann zusätzliche Prozess-Images aus korrelierten Flows (ohne Command Line). */
export function deriveCommands(t: Ticket, ev: ParsedEvidence, network?: NetworkCorrelation | null): CommandRow[] {
  const rows: CommandRow[] = [];
  const p = ev.process;
  const mitre = [ev.metadata.mitreTactic, ev.metadata.mitreTechnique, t.mitre].map(blank).filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

  if (p && (blank(p.image) || blank(p.commandLine))) {
    const decoded = decodeEncodedCommand(p.commandLine);
    rows.push({
      id: 'process',
      time: ev.detection.timestamp,
      image: blank(p.image),
      commandLine: blank(p.commandLine),
      decoded: decoded || undefined,
      parentImage: blank(p.parentImage),
      parentCommandLine: blank(p.parentCommandLine),
      user: blank(p.user) ?? blank(ev.source.user),
      host: blank(ev.source.host),
      source: blank(ev.metadata.logSource) ?? blank(ev.detection.sourceSystem),
      ruleId: blank(ev.detection.ruleId),
      level: undefined,
      hashes: [...parseHashes(p.hashes), ...parseHashes(ev.file?.hashes)],
      mitre,
      pid: blank(p.processId),
      parentPid: blank(p.parentProcessId),
      integrityLevel: blank(p.integrityLevel),
      cwd: blank(p.currentDirectory),
      suspicious: Boolean(decoded),
    });
  }

  // Prozess-Images aus Flows (Sysmon Event 3) — nur echte, deduped, ohne Command Line.
  const seen = new Set(rows.map((r) => (r.image || '').toLowerCase()));
  (network?.flows ?? []).forEach((f, i) => {
    const img = blank(f.processImage);
    if (!img || seen.has(img.toLowerCase())) return;
    seen.add(img.toLowerCase());
    rows.push({
      id: `flow-${i}`, time: blank(f.timestamp), image: img, user: blank(f.user) ?? blank(ev.source.user),
      host: blank(ev.source.host), source: f.sourceType || 'flow', hashes: [], mitre: [], suspicious: false,
    });
  });

  return rows.sort((a, b) => String(b.time ?? '').localeCompare(String(a.time ?? '')));
}

// ── Klassifikation: Interpreter & LOLBins (deterministisches Namens-Matching) ──
const INTERPRETERS = new Set(['powershell.exe', 'pwsh.exe', 'cmd.exe', 'wscript.exe', 'cscript.exe', 'mshta.exe', 'python.exe']);
export function isInterpreter(image?: string | null): boolean {
  return INTERPRETERS.has(baseName(image));
}

const LOLBINS: Record<string, { technique: string; label: string }> = {
  'rundll32.exe': { technique: 'T1218.011', label: 'Rundll32' },
  'mshta.exe': { technique: 'T1218.005', label: 'Mshta' },
  'regsvr32.exe': { technique: 'T1218.010', label: 'Regsvr32' },
  'installutil.exe': { technique: 'T1218.004', label: 'InstallUtil' },
  'msbuild.exe': { technique: 'T1127.001', label: 'MSBuild' },
  'bitsadmin.exe': { technique: 'T1197', label: 'BITS Jobs' },
  'certutil.exe': { technique: 'T1140', label: 'Certutil' },
  'wmic.exe': { technique: 'T1047', label: 'WMI' },
};
export function isLolbin(image?: string | null): boolean {
  return baseName(image) in LOLBINS;
}
export interface LolbinHit { name: string; technique: string; label: string }
export function detectLolbins(rows: CommandRow[]): LolbinHit[] {
  const out: LolbinHit[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const n = baseName(r.image); const def = LOLBINS[n];
    if (def && !seen.has(n)) { seen.add(n); out.push({ name: n, technique: def.technique, label: def.label }); }
  }
  return out;
}

// ── Severity & Confidence pro Command (qualitativ, aus realen Signalen) ────────
export type CmdLevel = 'high' | 'medium' | 'low';
function hasSuspiciousPsFlags(cmd?: string): boolean {
  const c = blank(cmd); if (!c) return false;
  return /-enc(odedcommand)?\b/i.test(c) || /-w\s*hidden|-windowstyle\s*hidden/i.test(c)
    || /-nop\b|-noprofile/i.test(c) || /(?:-ep|-executionpolicy)\b/i.test(c) || /-noni\b|-noninteractive/i.test(c);
}
export function commandSeverity(r: CommandRow): CmdLevel {
  if (r.suspicious || r.decoded || isLolbin(r.image) || hasSuspiciousPsFlags(r.commandLine)) return 'high';
  if (isInterpreter(r.image) || blank(r.commandLine)) return 'medium';
  return 'low';
}
/** Confidence = Stärke der Korroboration (Anzahl belegter Signale), kein erfundener Prozentwert. */
export function commandConfidence(r: CommandRow): CmdLevel {
  let n = 0;
  if (blank(r.commandLine)) n += 1;
  if (r.decoded) n += 1;
  if (isLolbin(r.image)) n += 1;
  if (hasSuspiciousPsFlags(r.commandLine)) n += 1;
  if (r.mitre.length) n += 1;
  if (r.hashes.length) n += 1;
  if (blank(r.parentImage)) n += 1;
  return n >= 4 ? 'high' : n >= 2 ? 'medium' : 'low';
}

// ── Extracted Interpreters ────────────────────────────────────────────────────
export interface InterpreterHit { name: string; arg: string }
function keyArg(cmd?: string): string {
  const c = blank(cmd); if (!c) return '';
  if (/-enc(odedcommand)?\b/i.test(c)) return '-EncodedCommand';
  const m = c.match(/(\/c|\/k|-c|-command|javascript:|vbscript:)[^\n]*/i);
  if (m) return m[0].slice(0, 48);
  return c.replace(/^\S+\s*/, '').slice(0, 48);
}
export function extractInterpreters(rows: CommandRow[]): InterpreterHit[] {
  const out: InterpreterHit[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const n = baseName(r.image);
    if (INTERPRETERS.has(n) && !seen.has(n)) { seen.add(n); out.push({ name: n, arg: keyArg(r.commandLine) }); }
  }
  return out;
}

// ── PowerShell Insights (nur aus der realen PowerShell-Command-Line) ──────────
export interface PowerShellInsights {
  present: boolean;
  executionPolicy?: string;
  encodedCommand: boolean;
  suspiciousFlags: string[];
  decoded?: string;
}
export function powershellInsights(rows: CommandRow[]): PowerShellInsights {
  const ps = rows.find((r) => /powershell|pwsh/.test(baseName(r.image)) && blank(r.commandLine));
  if (!ps || !ps.commandLine) return { present: false, encodedCommand: false, suspiciousFlags: [] };
  const c = ps.commandLine;
  const flags: string[] = [];
  if (/-nop\b|-noprofile\b/i.test(c)) flags.push('-NoProfile');
  if (/-w\s*hidden\b|-windowstyle\s*hidden\b/i.test(c)) flags.push('-WindowStyle Hidden');
  if (/-noni\b|-noninteractive\b/i.test(c)) flags.push('-NonInteractive');
  if (/-enc(odedcommand)?\b/i.test(c)) flags.push('-EncodedCommand');
  const policyMatch = /(?:-ep|-executionpolicy)\s+(\w+)/i.exec(c);
  const executionPolicy = policyMatch ? cap(policyMatch[1]) : (/(?:-ep|-executionpolicy)\b/i.test(c) ? 'gesetzt' : undefined);
  return { present: true, executionPolicy, encodedCommand: /-enc(odedcommand)?\b/i.test(c), suspiciousFlags: flags, decoded: ps.decoded };
}

// ── Command Highlights (abgeleitete, prüfenswerte Befunde) ────────────────────
export interface CommandHighlight { text: string; severity: CmdLevel }
export function commandHighlights(rows: CommandRow[]): CommandHighlight[] {
  const out: CommandHighlight[] = [];
  if (rows.some((r) => r.decoded || (/powershell|pwsh/.test(baseName(r.image)) && /-enc(odedcommand)?\b/i.test(r.commandLine || '')))) {
    out.push({ text: 'Encoded PowerShell command', severity: 'high' });
  }
  for (const l of detectLolbins(rows)) {
    out.push({ text: `LOLBin ${l.name} verwendet`, severity: l.name === 'bitsadmin.exe' ? 'medium' : 'high' });
  }
  if (rows.some((r) => baseName(r.image) === 'bitsadmin.exe' && /transfer|download|https?:/i.test(r.commandLine || ''))) {
    out.push({ text: 'bitsadmin.exe lädt Daten herunter', severity: 'medium' });
  }
  return out;
}

// ── Execution Chain (Process Tree) — aus Parent/Child-Beziehungen der Rows ─────
export interface ProcessNode { id: string; name: string; pid?: string; path?: string; suspicious: boolean; children: ProcessNode[] }
export function buildProcessTree(rows: CommandRow[]): ProcessNode[] {
  const byKey = new Map<string, ProcessNode>();
  const keyOf = (image?: string, pid?: string) => (blank(pid) ? `pid:${pid}` : `img:${baseName(image)}`);
  const ensure = (image?: string, pid?: string, suspicious = false, path?: string): ProcessNode | undefined => {
    const img = blank(image); if (!img) return undefined;
    const k = keyOf(image, pid);
    let n = byKey.get(k);
    if (!n) { n = { id: k, name: baseName(img) || img, pid: blank(pid), path, suspicious, children: [] }; byKey.set(k, n); }
    else { if (suspicious) n.suspicious = true; if (!n.path && path) n.path = path; }
    return n;
  };
  const childIds = new Set<string>();
  for (const r of rows) {
    const node = ensure(r.image, r.pid, r.suspicious, blank(r.image));
    const parent = ensure(r.parentImage, r.parentPid, false, blank(r.parentImage));
    if (node && parent && parent.id !== node.id) {
      if (!parent.children.some((c) => c.id === node.id)) parent.children.push(node);
      childIds.add(node.id);
    }
  }
  return [...byKey.values()].filter((n) => !childIds.has(n.id));
}
