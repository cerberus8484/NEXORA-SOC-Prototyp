// Reine, testbare Ableitung der Entity-Ermittlungsansicht. Basis: die bereits deduplizierte
// EntityItem-Liste (deckModel) + ParsedEvidence für den Beziehungs-Graph. KEINE erfundenen
// Hosts/User/Confidence/MITRE/Reputation. Fehlende Werte bleiben null → die UI zeigt „—".
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence } from '../analysisModel';
import { parseHashes, type EntityItem, type EntityKind } from '../deckModel';
import i18n from '../../../i18n';

const blank = (v?: string | null): string | undefined => (v && String(v).trim() ? String(v).trim() : undefined);

/** Entities einer Art (z. B. für die Tabellen-Cards). */
export function entitiesOfKind(items: EntityItem[], kinds: EntityKind[]): EntityItem[] {
  return items.filter((e) => kinds.includes(e.kind));
}

// ── Type-Label ───────────────────────────────────────────────────────────────
const TYPE_LABEL: Record<EntityKind, string> = {
  host: 'Host', user: 'User', ip: 'IP', mac: 'MAC', domain: 'Domain',
  process: 'Process', file: 'File', hash: 'Hash', url: 'URL', other: 'Other',
};
export function entityTypeLabel(kind: EntityKind): string {
  return TYPE_LABEL[kind] ?? 'Other';
}

// ── Beobachtungstiefe → Evidence-Zahl & Confidence ────────────────────────────
// Ehrlich abgeleitet: wie oft wurde die Entity tatsächlich beobachtet? Die Provenance-Notiz
// trägt Quellen-Counts („Wazuh ×38 · QRadar ×2") — sonst der Event-Count. Kein Wert → null.
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function observationCount(e: EntityItem): number | null {
  const matches = (e.note ?? '').match(/×\s*(\d+)/g);
  if (matches) {
    const sum = matches.reduce((acc, m) => acc + Number(m.replace(/\D/g, '')), 0);
    if (sum > 0) return sum;
  }
  if (typeof e.events === 'number' && e.events > 0) return e.events;
  return null;
}

/** Confidence = Korroboration aus der Beobachtungstiefe — kein Verdict, keine Reputation. */
export function entityConfidence(e: EntityItem): ConfidenceLevel | null {
  const n = observationCount(e);
  if (n == null) return null;
  if (n >= 10) return 'high';
  if (n >= 3) return 'medium';
  return 'low';
}

// ── Tabellen-Zeile ────────────────────────────────────────────────────────────
export interface EntityRow {
  kind: EntityKind;
  value: string;
  typeLabel: string;
  note?: string;
  firstSeen?: string | null;
  lastSeen?: string | null;
  confidence: ConfidenceLevel | null;
  evidence: number | null;
}

export function toEntityRow(e: EntityItem): EntityRow {
  return {
    kind: e.kind,
    value: e.value,
    typeLabel: entityTypeLabel(e.kind),
    note: e.note,
    firstSeen: e.firstSeen,
    lastSeen: e.lastSeen,
    confidence: entityConfidence(e),
    evidence: observationCount(e),
  };
}

export function entityRowsOfKind(items: EntityItem[], kinds: EntityKind[]): EntityRow[] {
  return entitiesOfKind(items, kinds).map(toEntityRow);
}

// ── Entities of Interest („Top Suspicious") ───────────────────────────────────
// Transparente Triage-Heuristik nach Entity-Art/Provenance — KEINE erfundene Reputation.
// Externe Ziele/Artefakte sind prüfenswert; der Grund benennt nur den beobachtbaren Anlass.
export interface InterestRow extends EntityRow {
  reason: string;
}
const INTEREST_REASON: Partial<Record<EntityKind, string>> = {
  url: 'URL-Artefakt',
  file: i18n.t('analysis.fileArtefact'),
  hash: i18n.t('analysis.fileHash'),
  domain: 'Externe Domain',
};
export function entitiesOfInterest(items: EntityItem[]): InterestRow[] {
  const rows: InterestRow[] = [];
  for (const e of items) {
    let reason: string | undefined = INTEREST_REASON[e.kind];
    if (!reason && e.kind === 'ip') {
      const note = (e.note ?? '').toLowerCase();
      if (note.includes('destination')) reason = i18n.t('analysis.externalTarget');
      else if (note.includes('post-nat')) reason = i18n.t('analysis.postNatSource');
    }
    if (!reason) continue;
    rows.push({ ...toEntityRow(e), reason });
  }
  // Nach Beobachtungstiefe absteigend; ohne Count zuletzt (stabil im Übrigen).
  return rows.sort((a, b) => (b.evidence ?? 0) - (a.evidence ?? 0));
}

// ── MITRE-verknüpfte Entities ─────────────────────────────────────────────────
// Nur die real am Ticket vorhandene ATT&CK-Technik, dem primären Artefakt zugeordnet.
// Keine pro-Entity erfundenen Mappings.
export interface MitreRow {
  value: string;
  typeLabel: string;
  technique: string;
  tactic?: string;
  confidence: ConfidenceLevel | null;
  evidence: number | null;
}
export function mitreLinkedEntities(ev: ParsedEvidence, items: EntityItem[]): MitreRow[] {
  const technique = blank(ev.metadata.mitreTechnique);
  if (!technique) return [];
  const tactic = blank(ev.metadata.mitreTactic);
  // Primäres Artefakt: Prozess > Datei > Host > erste Entity.
  const primary =
    items.find((e) => e.kind === 'process') ??
    items.find((e) => e.kind === 'file') ??
    items.find((e) => e.kind === 'host') ??
    items[0];
  if (!primary) return [];
  return [{
    value: primary.value,
    typeLabel: entityTypeLabel(primary.kind),
    technique,
    tactic,
    confidence: entityConfidence(primary),
    evidence: observationCount(primary),
  }];
}

// ── Beziehungs-Graph (Relationship Map) ───────────────────────────────────────
// Nur tatsächlich beobachtete Knoten aus der Evidence. „observed" = strukturell sicher
// (Host startet Prozess, Parent spawnt Kind), „inferred" = kausale Vermutung (Prozess
// erzeugt Datei, lädt Payload). Kein Knoten/keine Kante ohne reale Quelle.
export type GraphRole = 'actor' | 'host' | 'process' | 'artifact';
export interface GraphNode {
  id: string;
  kind: EntityKind;
  label: string;
  sub?: string;
  role: GraphRole;
}
export interface GraphEdge {
  from: string;
  to: string;
  label: string;
  inferred: boolean;
}
export interface EntityGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function shortHash(v: string): string {
  return v.length > 16 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v;
}

export function buildEntityGraph(t: Ticket, ev: ParsedEvidence): EntityGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const ids = new Set<string>();
  const addNode = (id: string, kind: EntityKind, label: string | undefined, role: GraphRole, sub?: string): string | undefined => {
    if (!label || ids.has(id)) return label ? id : undefined;
    ids.add(id);
    nodes.push({ id, kind, label, role, sub });
    return id;
  };
  const addEdge = (from?: string, to?: string, label?: string, inferred = false): void => {
    if (from && to && label) edges.push({ from, to, label, inferred });
  };

  const hostV = blank(ev.source.host) ?? blank(ev.metadata.agentName);
  const userV = blank(ev.source.user);
  const parentV = blank(ev.process?.parentImage);
  const procV = blank(ev.process?.image);
  const fileV = blank(ev.file?.name);
  const destIp = blank(ev.destination.ip) ?? blank(t.dstIp) ?? blank(ev.nat.postNatDestinationIp);
  const domainV = blank(ev.destination.fqdn) ?? blank(ev.dns?.query) ?? blank(ev.payload.hostHeader);
  const urlV = blank(ev.payload.url);
  const fileHash = [...parseHashes(ev.file?.hashes), ...parseHashes(ev.process?.hashes)][0];

  const host = addNode('host', 'host', hostV, 'host', blank(ev.source.ip) ?? blank(t.srcIp));
  const user = addNode('user', 'user', userV, 'actor');
  const parent = addNode('parent', 'process', parentV, 'actor', 'Parent');
  const proc = addNode('proc', 'process', procV, 'process');
  const file = addNode('file', 'file', fileV, 'artifact', fileHash ? `${fileHash.algo}: ${shortHash(fileHash.value)}` : undefined);
  const ip = addNode('ip', 'ip', destIp, 'artifact', 'Destination');
  const domain = addNode('domain', 'domain', domainV, 'artifact');
  const url = addNode('url', 'url', urlV, 'artifact');

  const origin = proc ?? host; // wer agiert/kommuniziert

  // observed — strukturell sicher
  addEdge(host, proc, 'gestartet');
  addEdge(proc, user, i18n.t('misc.executed'));
  addEdge(parent, proc, 'spawned');
  addEdge(origin, ip, i18n.t('analysis.connectsTo'));
  addEdge(origin, domain, i18n.t('misc.resolution'));
  // inferred — kausale Vermutung
  addEdge(origin, file, 'erzeugt', true);
  addEdge(origin, url, i18n.t('analysis.loads'), true);

  return { nodes, edges };
}
