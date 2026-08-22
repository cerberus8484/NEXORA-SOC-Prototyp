// Reine, testbare Ableitung der Ermittlungs-Timeline. Aus den realen Evidence-Facetten
// (Process/Command/File/DNS/Detection) + korrelierten Flows/Timeline-Events werden geordnete
// Event-Gruppen gebaut. KEINE erfundenen Events/Zeiten — fehlt eine Facette, gibt es keine Gruppe.
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence, TicketTimeline, NetworkCorrelation } from '../analysisModel';
import { decodeEncodedCommand, parseHashes } from '../deckModel';

const blank = (v?: string | null): string | undefined => (v && String(v).trim() ? String(v).trim() : undefined);
const procName = (p?: string | null): string | undefined => {
  const v = blank(p);
  return v ? (v.split(/[\\/]/).pop() || v) : undefined;
};

export type TimelineCategory = 'process' | 'script' | 'file' | 'detection' | 'network' | 'dns';
export const CATEGORY_LABEL: Record<TimelineCategory, string> = {
  process: 'Process', script: 'Script Execution', file: 'File Write',
  detection: 'Detection', network: 'Network', dns: 'DNS',
};

export interface TimelineSubEvent { time: string | null; text: string; source: string }
export interface TimelineMeta { label: string; value: string }
export interface TimelineGroup {
  id: string;
  title: string;
  category: TimelineCategory;
  time: string | null;
  meta: TimelineMeta[];
  sub: TimelineSubEvent[];
}

/** Ermittlungs-Timeline als geordnete Event-Gruppen — nur aus tatsächlich vorhandener Evidence. */
export function buildTimelineGroups(_t: Ticket, ev: ParsedEvidence, tl: TicketTimeline | null, network?: NetworkCorrelation | null): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  const base = blank(ev.detection.timestamp) ?? blank(ev.firstSeen) ?? tl?.first ?? null;
  const sys = blank(ev.detection.sourceSystem) ?? blank(ev.metadata.logSource) ?? 'Wazuh';

  // Process created
  const img = procName(ev.process?.image);
  if (img) {
    const meta: TimelineMeta[] = [{ label: 'Source', value: sys }];
    const host = blank(ev.source.host); const user = blank(ev.process?.user) ?? blank(ev.source.user); const pid = blank(ev.process?.processId);
    if (host) meta.push({ label: 'Host', value: host });
    if (user) meta.push({ label: 'User', value: user });
    if (pid) meta.push({ label: 'PID', value: pid });
    const sub: TimelineSubEvent[] = [];
    const parent = procName(ev.process?.parentImage);
    if (parent) sub.push({ time: base, text: `Parent: ${parent}`, source: 'Sysmon (Event ID 1)' });
    groups.push({ id: 'process', title: `Process created: ${img}`, category: 'process', time: base, meta, sub });
  }

  // Command / Script execution
  const cmd = blank(ev.process?.commandLine);
  if (cmd) {
    const sub: TimelineSubEvent[] = [{ time: base, text: cmd, source: 'Sysmon (Event ID 1)' }];
    const decoded = decodeEncodedCommand(ev.process?.commandLine);
    if (decoded) sub.push({ time: base, text: `Decoded: ${decoded}`, source: 'Decoded (lokal)' });
    groups.push({ id: 'script', title: 'Command execution', category: 'script', time: base, meta: [], sub });
  }

  // File written to disk
  const fileName = blank(ev.file?.name);
  if (fileName) {
    const sub: TimelineSubEvent[] = [{ time: base, text: `File created: ${fileName}`, source: 'Sysmon (Event ID 11)' }];
    for (const h of parseHashes(ev.file?.hashes)) sub.push({ time: base, text: `${h.algo}: ${h.value}`, source: 'Wazuh (File Integrity)' });
    groups.push({ id: 'file', title: 'Executable file written to disk', category: 'file', time: base, meta: [], sub });
  }

  // DNS query
  const dnsQ = blank(ev.dns?.query);
  if (dnsQ) {
    const sub: TimelineSubEvent[] = [{ time: base, text: `Query: ${dnsQ}`, source: 'Sysmon (Event ID 22)' }];
    const ans = blank(ev.dns?.answers); if (ans) sub.push({ time: base, text: `Resolved: ${ans}`, source: sys });
    groups.push({ id: 'dns', title: `DNS query: ${dnsQ}`, category: 'dns', time: base, meta: [], sub });
  }

  // Detection / Alert
  const ruleName = blank(ev.detection.ruleName); const ruleId = blank(ev.detection.ruleId); const desc = blank(ev.detection.description);
  if (ruleName || ruleId || desc) {
    const sub: TimelineSubEvent[] = [];
    if (ruleId) sub.push({ time: base, text: `Regel ${ruleId} ausgelöst${blank(ev.detection.severity) ? ` (Level ${ev.detection.severity})` : ''}${ruleName ? `: ${ruleName}` : ''}`, source: sys });
    else if (desc) sub.push({ time: base, text: desc, source: sys });
    groups.push({ id: 'detection', title: ruleName || 'Detection ausgelöst', category: 'detection', time: base, meta: [], sub });
  }

  // Network — reale Flows/Timeline-Events bevorzugt, sonst Destination-Zusammenfassung
  const flowSubs: TimelineSubEvent[] = [];
  for (const e of tl?.events ?? []) {
    const src = `${blank(e.srcIp) ?? '—'}${e.srcPort ? `:${e.srcPort}` : ''}`;
    const dst = `${blank(e.dstIp) ?? '—'}${e.dstPort ? `:${e.dstPort}` : ''}`;
    const proto = (blank(e.protocol) ?? '?').toUpperCase();
    const act = blank(e.action);
    flowSubs.push({ time: e.time, text: `${act ? `${act}: ` : ''}${src} → ${dst} (${proto})`, source: 'Indexer' });
  }
  for (const f of network?.flows ?? []) {
    const dst = `${blank(f.destinationIp) ?? '—'}${f.destinationPort ? `:${f.destinationPort}` : ''}`;
    const proc = procName(f.processImage);
    const proto = (blank(f.protocol) ?? '?').toUpperCase();
    flowSubs.push({ time: f.timestamp, text: `${proc ? `${proc} → ` : 'Connection to '}${dst} (${proto})`, source: blank(f.sourceType) ?? 'flow' });
  }
  if (flowSubs.length) {
    flowSubs.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const t0 = flowSubs.find((s) => s.time)?.time ?? base;
    groups.push({ id: 'network', title: 'Network connection initiated', category: 'network', time: t0, meta: [], sub: flowSubs });
  } else if (blank(ev.destination.ip)) {
    const dst = `${ev.destination.ip}${ev.destination.port ? `:${ev.destination.port}` : ''}`;
    const proto = (blank(ev.network.protocol) ?? blank(ev.network.transport) ?? '?').toUpperCase();
    groups.push({ id: 'network', title: 'Network connection initiated', category: 'network', time: base, meta: [], sub: [{ time: base, text: `Connection to ${dst} (${proto})`, source: sys }] });
  }

  // Chronologisch (älteste zuerst); Gruppen ohne Zeit ans Ende.
  return groups.sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time) return -1;
    if (b.time) return 1;
    return 0;
  });
}

/** Relativer Versatz zur ersten Event-Zeit (z. B. „+2s", „+1m 3s"). Leer, wenn ≤ 0/unbekannt. */
export function relativeOffset(baseIso: string | null, iso: string | null): string {
  if (!baseIso || !iso) return '';
  const a = new Date(baseIso).getTime(); const b = new Date(iso).getTime();
  if (isNaN(a) || isNaN(b)) return '';
  const s = Math.round((b - a) / 1000);
  if (s <= 0) return '';
  if (s < 60) return `+${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `+${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `+${h}h ${m % 60}m`;
}

/** Verschiedene Quellen über alle Sub-Events — für den „All Sources"-Filter. */
export function timelineSources(groups: TimelineGroup[]): string[] {
  const set = new Set<string>();
  for (const g of groups) for (const s of g.sub) if (s.source) set.add(s.source);
  return [...set].sort();
}
