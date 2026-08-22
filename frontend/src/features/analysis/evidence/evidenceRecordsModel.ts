// Reine, testbare Vereinheitlichung der Evidence-Records aus ECHTEN Quellen:
//  - das geparste Primär-Event des Tickets (ParsedEvidence)
//  - gesicherte Evidence-Snapshots (EvidenceItem, Chain of Custody)
//  - korrelierte Timeline-/Flow-Events
// KEINE erfundenen Events/Prozesse/Hashes. Fehlende Felder bleiben leer.
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence, TicketTimeline, FlowEvent } from '../analysisModel';
import type { EvidenceItem } from '../../evidence/evidenceApi';
import { parseHashes, decodeEncodedCommand, type HashEntry } from '../deckModel';
import { provenanceLabel } from './evidenceProvenance';

export type EvidenceRecordKind = 'parsed' | 'stored' | 'flow';
export type Severity = 'High' | 'Medium' | 'Low' | 'Info';

export interface EvidenceRecord {
  id: string;
  kind: EvidenceRecordKind;
  source: string;
  provenance: string;
  eventType: string;
  severity: Severity;
  title: string;
  time?: string;
  ruleId?: string;
  level?: number;
  mitre: string[];
  hashes: HashEntry[];
  decoded?: string;
  hasMitre: boolean;
  hasFileHash: boolean;
  hasIp: boolean;
  hasUser: boolean;
  raw: string;
  // Referenzen für die Detail-Sektionen (type-spezifisch):
  ev?: ParsedEvidence;
  flow?: FlowEvent;
  item?: EvidenceItem;
}

const blank = (v?: string | null): string | undefined => (v && String(v).trim() ? String(v).trim() : undefined);
const SEV_HIGH = 10;
const SEV_MED = 7;

function flowSeverity(level?: number): Severity {
  if (typeof level !== 'number') return 'Low';
  if (level >= SEV_HIGH) return 'High';
  if (level >= SEV_MED) return 'Medium';
  return 'Low';
}
function normSeverity(s?: string): Severity {
  const x = (s || '').toLowerCase();
  if (x.includes('crit') || x.includes('high')) return 'High';
  if (x.includes('med')) return 'Medium';
  if (x.includes('low')) return 'Low';
  return s ? 'Medium' : 'Info';
}

export function buildEvidenceRecords(t: Ticket, ev: ParsedEvidence, tl: TicketTimeline | null, stored: EvidenceItem[]): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  const mitre = [ev.metadata.mitreTactic, ev.metadata.mitreTechnique, t.mitre].map(blank).filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

  // 1) Primär-Event aus der geparsten Evidence (sofern überhaupt etwas vorhanden)
  const evHashes = [...parseHashes(ev.process?.hashes), ...parseHashes(ev.file?.hashes)];
  const hasPrimary = Boolean(blank(ev.process?.image) || blank(ev.destination.ip) || blank(ev.source.ip) || blank(ev.dns?.query) || evHashes.length);
  if (hasPrimary) {
    const eventType = blank(ev.process?.image) ? 'Process Create' : blank(ev.dns?.query) ? 'DNS Query' : (blank(ev.destination.ip) || blank(ev.nat.postNatSourceIp)) ? 'Network Connection' : 'Alert';
    const decoded = decodeEncodedCommand(ev.process?.commandLine) || undefined;
    records.push({
      id: 'primary', kind: 'parsed', source: blank(ev.detection.sourceSystem) || t.source || 'manual',
      provenance: provenanceLabel(ev.detection.sourceSystem || t.source),
      eventType, severity: normSeverity(ev.detection.severity), title: blank(ev.process?.image) || blank(ev.detection.ruleName) || blank(ev.destination.ip) || eventType,
      time: blank(ev.detection.timestamp), ruleId: blank(ev.detection.ruleId), mitre, hashes: evHashes, decoded,
      hasMitre: mitre.length > 0, hasFileHash: evHashes.length > 0,
      hasIp: Boolean(blank(ev.source.ip) || blank(ev.destination.ip)), hasUser: Boolean(blank(ev.source.user) || blank(ev.process?.user)),
      raw: ev.raw ? (typeof ev.raw === 'string' ? ev.raw : JSON.stringify(ev.raw, null, 2)) : '',
      ev,
    });
  }

  // 2) Gesicherte Evidence-Snapshots
  for (const it of stored) {
    const hashes = parseHashes(it.sha256 ? `sha256=${it.sha256}` : undefined);
    records.push({
      id: `stored-${it.id}`, kind: 'stored', source: it.source, provenance: provenanceLabel(it.source),
      eventType: it.type || 'Evidence', severity: 'Info', title: it.title || it.type || 'Evidence',
      time: blank(it.eventTimestamp || '') || it.collectedAt, ruleId: blank(it.eventId), mitre: [], hashes,
      hasMitre: false, hasFileHash: Boolean(it.sha256), hasIp: false, hasUser: false,
      raw: it.rawText || '', item: it,
    });
  }

  // 3) Korrelierte Timeline-/Flow-Events
  (tl?.events ?? []).forEach((e, i) => {
    records.push({
      id: `flow-${i}`, kind: 'flow', source: 'wazuh', provenance: 'Wazuh',
      eventType: e.action ? `Firewall ${e.action}` : 'Network Connection', severity: flowSeverity(e.level),
      title: `${e.srcIp ?? '—'}${e.srcPort ? `:${e.srcPort}` : ''} → ${e.dstIp ?? '—'}${e.dstPort ? `:${e.dstPort}` : ''}`,
      time: e.time, ruleId: blank(e.ruleId), level: e.level, mitre: [], hashes: [],
      hasMitre: false, hasFileHash: false, hasIp: Boolean(e.srcIp || e.dstIp), hasUser: false,
      raw: e.description || '', flow: e,
    });
  });

  return records.sort((a, b) => String(b.time ?? '').localeCompare(String(a.time ?? '')));
}

export interface EvidenceFacets { sources: string[]; eventTypes: string[]; severities: Severity[] }
export function facetsOf(records: EvidenceRecord[]): EvidenceFacets {
  return {
    sources: [...new Set(records.map((r) => r.provenance))].sort(),
    eventTypes: [...new Set(records.map((r) => r.eventType))].sort(),
    severities: (['High', 'Medium', 'Low', 'Info'] as Severity[]).filter((s) => records.some((r) => r.severity === s)),
  };
}

export interface EvidenceFilter {
  q: string;
  source: string;       // 'all' | provenance label
  eventType: string;    // 'all' | eventType
  severity: string;     // 'all' | Severity
  hasMitre: boolean;
  hasFileHash: boolean;
  hasIp: boolean;
  hasUser: boolean;
}

export const EMPTY_FILTER: EvidenceFilter = { q: '', source: 'all', eventType: 'all', severity: 'all', hasMitre: false, hasFileHash: false, hasIp: false, hasUser: false };

export function filterRecords(records: EvidenceRecord[], f: EvidenceFilter): EvidenceRecord[] {
  const needle = f.q.trim().toLowerCase();
  return records.filter((r) => {
    if (f.source !== 'all' && r.provenance !== f.source) return false;
    if (f.eventType !== 'all' && r.eventType !== f.eventType) return false;
    if (f.severity !== 'all' && r.severity !== f.severity) return false;
    if (f.hasMitre && !r.hasMitre) return false;
    if (f.hasFileHash && !r.hasFileHash) return false;
    if (f.hasIp && !r.hasIp) return false;
    if (f.hasUser && !r.hasUser) return false;
    if (needle && ![r.title, r.eventType, r.provenance, r.ruleId, r.raw].filter(Boolean).join(' ').toLowerCase().includes(needle)) return false;
    return true;
  });
}
