// ─────────────────────────────────────────────────────────────────────────
// Analyst Deck — pure Ableitungen aus echten Ticket-/Evidence-/Timeline-Daten.
// Keine Fetches, keine erfundenen Werte: fehlt eine Quelle, bleibt das Feld
// null/leer und die UI zeigt „—" (ADR-009: keine Fake-Daten).
// ─────────────────────────────────────────────────────────────────────────
import type { Ticket } from '../../lib/types';
import type { CorrelationMeta, NetworkCorrelation, ParsedEvidence, TicketTimeline } from './analysisModel';
import { classifyIoc } from './analysisModel';
import i18n from '../../i18n';

// ── Analyst Summary ────────────────────────────────────────────────────────
export type BulletKind = 'process' | 'decoded' | 'network' | 'data' | 'c2' | 'recommend' | 'info';
export interface SummaryBullet { kind: BulletKind; text: string }

// ── Risk & Impact ──────────────────────────────────────────────────────────
export interface RiskModel {
  magnitude: number | null;   // 0–10, gewichtet aus Severity + Credibility
  severity: number | null;    // 0–10, aus Ticket-Priority
  credibility: number | null; // 0–10, aus Analyst-Confidence (null = nicht bewertet)
  relevance: number | null;   // 0–10, aus Evidence-Tiefe (wie viele Facetten belegt sind)
  score: number | null;       // 0–100
  businessImpact: 'High' | 'Medium' | 'Low';
}

export interface Conversation {
  srcIp: string; dstIp: string; protocol: string;
  srcPort?: string | number; dstPort?: string | number;
  action?: string; count: number;
}

export type EntityKind = 'user' | 'host' | 'ip' | 'mac' | 'domain' | 'process' | 'file' | 'hash' | 'url' | 'other';
export interface EntityItem {
  kind: EntityKind; value: string;
  firstSeen?: string | null; lastSeen?: string | null;
  events?: number; note?: string;
}

export interface HashEntry { algo: string; value: string }

// ── Helpers ────────────────────────────────────────────────────────────────
export function fmtBytes(n?: number | null): string {
  if (n == null || isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** PowerShell `-enc`/`-EncodedCommand` Base64 (UTF-16LE) dekodieren — rein lokal, kein Exec. */
export function decodeEncodedCommand(commandLine?: string | null): string {
  if (!commandLine) return '';
  const m = commandLine.match(/-enc(?:odedcommand)?\s+["']?([A-Za-z0-9+/=]{8,})/i);
  if (!m) return '';
  try {
    const bin = atob(m[1]);
    let out = '';
    // UTF-16LE: nur Low-Bytes übernehmen — High-Bytes (NUL bei ASCII) werden übersprungen.
    for (let i = 0; i < bin.length; i += 2) out += bin[i];
    return out.trim();
  } catch { return ''; }
}

/** Sysmon-Hash-String („SHA256=…,MD5=…") in Einzelwerte zerlegen. */
export function parseHashes(hashes?: string | null): HashEntry[] {
  if (!hashes) return [];
  return hashes.split(',')
    .map((part) => part.trim())
    .filter((part) => part.includes('='))
    .map((part) => {
      const idx = part.indexOf('=');
      return { algo: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() };
    })
    .filter((h) => h.algo && h.value);
}

function fileName(path?: string): string {
  return (path || '').split(/[\\/]/).pop() || '';
}

// ── Analyst Summary — Bullets aus dem, was die Evidence tatsächlich hergibt ──
export function buildAnalystSummary(ev: ParsedEvidence, tl: TicketTimeline | null): SummaryBullet[] {
  const bullets: SummaryBullet[] = [];
  const host = ev.source.host || '';
  const user = ev.source.user || '';

  const exe = fileName(ev.process?.image);
  if (exe) {
    bullets.push({ kind: 'process', text: i18n.t('analysis.processExecuted', {
      exe,
      where: host ? i18n.t('analysis.onHost', { host }) : '',
      who: user ? i18n.t('analysis.byUser', { user }) : '',
    }) });
  }

  const decoded = decodeEncodedCommand(ev.process?.commandLine);
  if (decoded) bullets.push({ kind: 'decoded', text: i18n.t('analysis.encodedCommandDetectedDecoded') });
  else if (ev.payload.containsBase64 === true) bullets.push({ kind: 'decoded', text: i18n.t('tickets.base64Detected') });

  if (ev.destination.ip) {
    const port = ev.destination.port ? `:${ev.destination.port}` : '';
    const proto = ev.network.protocol || ev.network.transport || '';
    bullets.push({ kind: 'network', text: i18n.t('analysis.outboundConnection', {
      ip: ev.destination.ip,
      port,
      proto: proto ? ` (${proto.toUpperCase()})` : '',
    }) });
  }

  const totalBytes = (ev.network.bytesSent ?? 0) + (ev.network.bytesReceived ?? 0);
  if (totalBytes > 0) bullets.push({ kind: 'data', text: i18n.t('analysis.bytesTransferred', { bytes: fmtBytes(totalBytes) }) });

  if (ev.dns?.query) bullets.push({ kind: 'network', text: `DNS-Query: ${ev.dns.query}.` });

  if (tl) {
    const blocked = tl.actions.filter((a) => ['block', 'drop', 'reject'].includes(a.action)).reduce((sum, a) => sum + a.count, 0);
    if (blocked > 0) bullets.push({ kind: 'network', text: i18n.t('analysis.firewallBlocked', { count: blocked }) });
  }

  if (ev.metadata.mitreTechnique) {
    bullets.push({ kind: 'c2', text: `MITRE: ${ev.metadata.mitreTactic ? `${ev.metadata.mitreTactic} · ` : ''}${ev.metadata.mitreTechnique}.` });
  }
  if (decoded && ev.destination.ip) {
    bullets.push({ kind: 'c2', text: i18n.t('label.possibleCommandControlCommunication') });
  }

  if (bullets.length === 0) {
    return [{ kind: 'info', text: i18n.t('analysis.noStructuredEvidenceAvailableImport') }];
  }
  bullets.push({ kind: 'recommend', text: i18n.t('analysis.recommendationReviewCommandsPayloadsDocument') });
  return bullets;
}

// ── Risk & Impact — deterministisch aus Priority/Confidence/Evidence-Tiefe ──
const SEVERITY_BY_PRIORITY: Record<string, number> = { critical: 10, high: 8, medium: 5, low: 3, info: 1 };

function evidenceFacetCount(ev: ParsedEvidence): number {
  const facets = [ev.process?.image, ev.dns?.query, ev.file?.name, ev.payload.url, ev.destination.ip];
  return facets.filter(Boolean).length;
}

export function deriveRisk(t: Ticket, ev: ParsedEvidence): RiskModel {
  const severity = SEVERITY_BY_PRIORITY[t.priority] ?? 5;
  const credibility = typeof t.confidence === 'number' ? Math.round(t.confidence / 10) : null;
  const facets = evidenceFacetCount(ev);
  const relevance = Math.min(10, 2 + facets * 2);
  const magnitude = credibility != null ? Math.round((severity * 2 + credibility) / 3) : severity;
  const score = Math.min(100, magnitude * 10);
  const businessImpact: RiskModel['businessImpact'] = severity >= 8 ? 'High' : severity >= 5 ? 'Medium' : 'Low';
  return { magnitude, severity, credibility, relevance, score, businessImpact };
}

// ── Top Conversations — Timeline-Events nach Verbindung gruppieren ──────────
export function topConversations(tl: TicketTimeline | null, max = 5): Conversation[] {
  if (!tl || !tl.events.length) return [];
  const groups = new Map<string, Conversation>();
  for (const e of tl.events) {
    if (!e.srcIp || !e.dstIp) continue;
    const key = `${e.srcIp}|${e.dstIp}|${e.protocol || '?'}|${e.dstPort ?? ''}`;
    const cur = groups.get(key);
    if (cur) groups.set(key, { ...cur, count: cur.count + 1 });
    else groups.set(key, { srcIp: e.srcIp, dstIp: e.dstIp, protocol: e.protocol || '?', srcPort: e.srcPort, dstPort: e.dstPort, action: e.action, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, max);
}

// ── Entities — alles Beobachtbare aus Ticket + Evidence + Timeline ──────────
export function deriveEntities(t: Ticket, ev: ParsedEvidence, tl: TicketTimeline | null): EntityItem[] {
  const out: EntityItem[] = [];
  const seen = new Set<string>();
  const ipEventCount = (ip: string): number | undefined => {
    if (!tl) return undefined;
    const n = tl.events.filter((e) => e.srcIp === ip || e.dstIp === ip).length;
    return n > 0 ? n : undefined;
  };
  const add = (kind: EntityKind, value?: string | null, note?: string) => {
    const v = (value || '').trim();
    if (!v) return;
    const key = `${kind}|${v.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      kind, value: v, note,
      firstSeen: ev.firstSeen || tl?.first || null,
      lastSeen: ev.lastSeen || tl?.last || null,
      events: kind === 'ip' ? ipEventCount(v) : undefined,
    });
  };

  add('user', ev.source.user);
  add('host', ev.source.host);
  add('host', ev.metadata.agentName, 'Wazuh-Agent');
  add('ip', ev.source.ip, 'Source');
  add('ip', t.srcIp, 'Source');
  add('ip', ev.destination.ip, 'Destination');
  add('ip', t.dstIp, 'Destination');
  add('ip', ev.nat.postNatSourceIp, 'Post-NAT');
  add('mac', ev.source.macAddress);
  add('domain', ev.destination.fqdn);
  add('domain', ev.dns?.query);
  add('domain', ev.payload.hostHeader);
  add('url', ev.payload.url);
  add('process', ev.process?.image);
  add('process', ev.process?.parentImage, 'Parent');
  add('file', ev.file?.name);
  for (const h of [...parseHashes(ev.process?.hashes), ...parseHashes(ev.file?.hashes)]) {
    add('hash', h.value, h.algo);
  }
  // Freitext-IoCs vom Ticket nachklassifizieren (Dateipfade nicht als Domain).
  addTicketIocs(t, add);
  return out;
}

function addTicketIocs(t: Ticket, add: (kind: EntityKind, value?: string | null, note?: string) => void): void {
  (t.iocs ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean).forEach((v) => {
    const cls = classifyIoc(v);
    const kind: EntityKind = cls === 'ip' ? 'ip' : cls === 'domain' ? 'domain' : cls === 'hash' ? 'hash' : cls === 'url' ? 'url' : cls === 'file' ? 'file' : 'other';
    add(kind, v, 'Ticket-IoC');
  });
}

// ── Korrelierte Entities (Server, CE-2) → EntityItem fürs Deck ──────────────
const ENTITY_KINDS = new Set<EntityKind>(['user', 'host', 'ip', 'mac', 'domain', 'url', 'process', 'file', 'hash', 'other']);

/** Server-korrelierte Entitäten (mit Quellen-Provenance) in Deck-EntityItems mappen. */
export function correlatedEntitiesToItems(corr?: CorrelationMeta | null): EntityItem[] {
  if (!corr?.entities?.length) return [];
  return corr.entities.map((e) => ({
    kind: (ENTITY_KINDS.has(e.kind as EntityKind) ? e.kind : 'other') as EntityKind,
    value: e.value,
    firstSeen: e.firstSeen ?? null,
    lastSeen: e.lastSeen ?? null,
    events: e.events,
    // Provenance als Notiz: „Wazuh ×38 · QRadar ×2" (Fallback auf Roh-Notiz).
    note: e.sources.map((s) => `${s.source} ×${s.count}`).join(' · ') || e.note,
  }));
}

// ── CE-3: zusätzliche Entities aus korrelierten Network-Flows ───────────────
/** Source-/Destination-IP, Prozess, User, Domain aus network.flows als EntityItems. */
export function flowsToEntities(network?: NetworkCorrelation | null): EntityItem[] {
  if (!network?.flows?.length) return [];
  const out: EntityItem[] = [];
  const seen = new Set<string>();
  const add = (kind: EntityKind, value: string | null, note: string) => {
    const v = (value || '').trim();
    if (!v) return;
    const key = `${kind}|${v.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value: v, note, firstSeen: null, lastSeen: null });
  };
  for (const f of network.flows) {
    add('ip', f.sourceIp, `Flow-Source · ${f.sourceType}`);
    add('ip', f.destinationIp, `Flow-Destination · ${f.sourceType}`);
    add('process', f.processImage, `Flow · ${f.sourceType}`);
    add('user', f.user, `Flow · ${f.sourceType}`);
    add('domain', f.destinationFqdn || f.destinationHost, `Flow-Destination · ${f.sourceType}`);
  }
  return out;
}

// ── Export-Markdown — Ticket + Summary + Entities + Timeline in einem Report ──
export function buildExportMarkdown(t: Ticket, bullets: SummaryBullet[], entities: EntityItem[], tl: TicketTimeline | null): string {
  const lines: string[] = [
    `# Incident Report — ${t.ticketNr || t.id}`, '',
    `**Titel:** ${t.title || '—'}`,
    i18n.t('analysis.reportPriorityLine', { priority: t.priority, state: t.state ?? 'OPEN', status: t.status }),
    i18n.t('analysis.reportAnalystLine', {
      analyst: t.analyst || 'unassigned',
      customer: t.customer || '—',
      source: t.source || 'manual',
    }), '',
    '## Analyst Summary',
    ...bullets.map((b) => `- ${b.text}`), '',
    '## Entities',
    ...(entities.length ? entities.map((e) => `- [${e.kind}] ${e.value}${e.note ? ` (${e.note})` : ''}`) : ['- keine Entities abgeleitet']), '',
    '## Timeline',
    ...(tl && tl.events.length
      ? tl.events.map((e) => `- ${e.time} · ${e.action ?? '—'} · ${e.srcIp ?? '?'}${e.srcPort ? `:${e.srcPort}` : ''} → ${e.dstIp ?? '?'}${e.dstPort ? `:${e.dstPort}` : ''} (${e.protocol ?? '?'})`)
      : [i18n.t('analysis.noTimelineDataAvailable')]), '',
    '## Decision', t.decision || '—', '',
    '## Recommendation', t.recommendation || '—',
  ];
  return lines.join('\n');
}
