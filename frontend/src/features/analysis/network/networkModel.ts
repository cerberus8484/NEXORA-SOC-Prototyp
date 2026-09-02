// Reine, testbare Ableitungen für die Network-&-NAT-Ermittlungsansicht.
// Quelle: ParsedEvidence (aus dem Ticket) + korrelierte Timeline/Flows. KEINE erfundenen
// Geo-/ASN-/Reputations-/Byte-Werte. Fehlt etwas, bleibt das Feld null → UI zeigt „—".
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence, TicketTimeline, NetworkCorrelation, NetworkFlow } from '../analysisModel';

const blank = (v?: string | null): string | undefined => (v && String(v).trim() ? String(v).trim() : undefined);
const num = (v?: number | null): number | undefined => (typeof v === 'number' && !isNaN(v) ? v : undefined);
const toPort = (v?: string | number | null): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return isNaN(n) ? undefined : n;
};
function durationBetween(first?: string | null, last?: string | null): number | null {
  if (!first || !last) return null;
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, b - a);
}

// ── Well-known Service je Port (deterministische IANA-Ableitung, klar gekennzeichnet) ──
const SERVICE_BY_PORT: Record<number, string> = {
  20: 'FTP', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 68: 'DHCP',
  80: 'HTTP', 110: 'POP3', 123: 'NTP', 135: 'RPC', 137: 'NetBIOS', 138: 'NetBIOS', 139: 'NetBIOS',
  143: 'IMAP', 161: 'SNMP', 162: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS',
  514: 'Syslog', 587: 'SMTP', 636: 'LDAPS', 993: 'IMAPS', 995: 'POP3S', 1433: 'MSSQL', 1521: 'Oracle',
  3306: 'MySQL', 3389: 'RDP', 5432: 'PostgreSQL', 5985: 'WinRM', 5986: 'WinRM', 8080: 'HTTP-Alt', 8443: 'HTTPS-Alt',
};
export function wellKnownService(port?: number | null): string | undefined {
  return port != null ? SERVICE_BY_PORT[port] : undefined;
}

// ── Externe Ziel-IPs (alle real beobachteten Destinations, dedupliziert) ──────
export function externalIps(t: Ticket, ev: ParsedEvidence, tl: TicketTimeline | null, network?: NetworkCorrelation | null): string[] {
  const internal = new Set([blank(ev.source.ip), blank(t.srcIp), blank(ev.nat.originalSourceIp)].filter(Boolean) as string[]);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (ip?: string | null) => {
    const v = blank(ip);
    if (!v || internal.has(v) || seen.has(v)) return;
    seen.add(v); out.push(v);
  };
  add(ev.destination.ip); add(t.dstIp); add(ev.nat.postNatDestinationIp);
  (network?.topConversations ?? []).forEach((c) => add(c.destinationIp));
  (network?.flows ?? []).forEach((f) => add(f.destinationIp));
  (tl?.events ?? []).forEach((e) => add(e.dstIp));
  return out;
}

// ── Top Conversations (Flows bevorzugt → bytes + lastSeen) ─────────────────────
export interface ConversationRow {
  destinationIp: string;
  destinationPort?: number;
  protocol?: string;
  events: number;
  bytes: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
}
// Verfolgt firstSeen (Minimum) + lastSeen (Maximum) je Conversation aus echten Zeitstempeln.
function trackSeen(row: ConversationRow, ts?: string | null): void {
  if (!ts) return;
  if (!row.firstSeen || ts < row.firstSeen) row.firstSeen = ts;
  if (!row.lastSeen || ts > row.lastSeen) row.lastSeen = ts;
}
export function deriveConversations(tl: TicketTimeline | null, network: NetworkCorrelation | null | undefined, max = 5): ConversationRow[] {
  const flows = network?.flows ?? [];
  if (flows.length) {
    const map = new Map<string, ConversationRow>();
    for (const f of flows) {
      const ip = blank(f.destinationIp); if (!ip) continue;
      const port = f.destinationPort ?? undefined;
      const proto = blank(f.protocol) ?? blank(f.transport);
      const key = `${ip}|${port ?? ''}|${proto ?? ''}`;
      const bytes = (num(f.bytesSent) ?? 0) + (num(f.bytesReceived) ?? 0);
      let cur = map.get(key);
      if (cur) {
        cur.events += 1;
        cur.bytes = (cur.bytes ?? 0) + bytes;
      } else {
        cur = { destinationIp: ip, destinationPort: port ?? undefined, protocol: proto, events: 1, bytes: bytes || null, firstSeen: null, lastSeen: null };
        map.set(key, cur);
      }
      trackSeen(cur, f.timestamp);
    }
    return [...map.values()].sort((a, b) => b.events - a.events).slice(0, max);
  }
  if (network?.topConversations?.length) {
    return network.topConversations
      .filter((c) => blank(c.destinationIp))
      .map((c): ConversationRow => ({ destinationIp: c.destinationIp as string, destinationPort: c.destinationPort ?? undefined, protocol: blank(c.protocol), events: c.count, bytes: null, firstSeen: null, lastSeen: null }))
      .sort((a, b) => b.events - a.events)
      .slice(0, max);
  }
  if (tl?.events?.length) {
    const map = new Map<string, ConversationRow>();
    for (const e of tl.events) {
      const ip = blank(e.dstIp); if (!ip) continue;
      const port = toPort(e.dstPort);
      const proto = blank(e.protocol);
      const key = `${ip}|${port ?? ''}|${proto ?? ''}`;
      let cur = map.get(key);
      if (cur) {
        cur.events += 1;
      } else {
        cur = { destinationIp: ip, destinationPort: port, protocol: proto, events: 1, bytes: null, firstSeen: null, lastSeen: null };
        map.set(key, cur);
      }
      trackSeen(cur, e.time);
    }
    return [...map.values()].sort((a, b) => b.events - a.events).slice(0, max);
  }
  return [];
}

// ── Flow-Statistik (ev.network bevorzugt, sonst aus Flows summiert) ────────────
export interface FlowStats {
  totalEvents: number | null;
  bytesSent: number | null;
  bytesReceived: number | null;
  packets: number | null;
  durationMs: number | null;
}
export function deriveFlowStats(ev: ParsedEvidence, tl: TicketTimeline | null, network?: NetworkCorrelation | null): FlowStats {
  let bytesSent = num(ev.network.bytesSent) ?? null;
  let bytesReceived = num(ev.network.bytesReceived) ?? null;
  let packets = ((num(ev.network.packetsSent) ?? 0) + (num(ev.network.packetsReceived) ?? 0)) || null;
  let durationMs = num(ev.network.durationMs) ?? null;

  const flows = network?.flows ?? [];
  if (flows.length) {
    const sum = (sel: (f: NetworkFlow) => number | null) => flows.reduce((a, f) => a + (num(sel(f)) ?? 0), 0);
    if (bytesSent == null) bytesSent = sum((f) => f.bytesSent) || null;
    if (bytesReceived == null) bytesReceived = sum((f) => f.bytesReceived) || null;
    if (packets == null) packets = (sum((f) => f.packetsSent) + sum((f) => f.packetsReceived)) || null;
    if (durationMs == null) {
      const d = Math.max(0, ...flows.map((f) => num(f.durationMs) ?? 0));
      durationMs = d || null;
      if (durationMs == null) {
        const starts = flows.map((f) => f.flowStart ?? f.timestamp).filter(Boolean) as string[];
        const ends = flows.map((f) => f.flowEnd ?? f.timestamp).filter(Boolean) as string[];
        if (starts.length && ends.length) {
          durationMs = durationBetween(
            starts.reduce((min, t) => (t < min ? t : min)),
            ends.reduce((max, t) => (t > max ? t : max)),
          );
        }
      }
    }
  } else if (durationMs == null) {
    // Timeline-Fenster bevorzugt; sonst das am Ticket gespeicherte Flow-Fenster
    // (Dataplane-Ticket ohne korrelierte Timeline).
    durationMs = durationBetween(tl?.first, tl?.last)
      ?? durationBetween(ev.network.firstSeen, ev.network.lastSeen);
  }
  // Event-Zahl: Timeline → Flows → am Ticket gespeicherte eventCount (Dataplane).
  const totalEvents = tl?.count ?? (flows.length || null) ?? num(ev.network.eventCount) ?? null;
  return { totalEvents, bytesSent, bytesReceived, packets, durationMs };
}

type TrafficAction = 'denied' | 'permitted' | 'unknown';
const DENIED_ACTIONS = new Set(['block', 'blocked', 'drop', 'dropped', 'reject', 'rejected', 'deny', 'denied']);
const PERMITTED_ACTIONS = new Set(['pass', 'passed', 'allow', 'allowed', 'permit', 'permitted', 'accept', 'accepted']);
function classifyTrafficAction(action?: string | null): TrafficAction {
  const a = blank(action)?.toLowerCase();
  if (!a) return 'unknown';
  if (DENIED_ACTIONS.has(a)) return 'denied';
  if (PERMITTED_ACTIONS.has(a)) return 'permitted';
  return 'unknown';
}

export interface TrafficBucket {
  events: number;
  bytes: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
}
export interface TrafficBreakdown {
  total: TrafficBucket;
  denied: TrafficBucket;
  permitted: TrafficBucket;
}
export function deriveTrafficBreakdown(ev: ParsedEvidence, tl: TicketTimeline | null, network?: NetworkCorrelation | null): TrafficBreakdown {
  const stats = deriveFlowStats(ev, tl, network);
  const totalBytes = (stats.bytesSent ?? 0) + (stats.bytesReceived ?? 0);
  const out: TrafficBreakdown = {
    total: { events: stats.totalEvents ?? 0, bytes: totalBytes || null, firstSeen: null, lastSeen: null },
    denied: { events: 0, bytes: null, firstSeen: null, lastSeen: null },
    permitted: { events: 0, bytes: null, firstSeen: null, lastSeen: null },
  };
  const addTime = (bucket: TrafficBucket, first?: string | null, last?: string | null) => {
    if (first && (!bucket.firstSeen || first < bucket.firstSeen)) bucket.firstSeen = first;
    if (last && (!bucket.lastSeen || last > bucket.lastSeen)) bucket.lastSeen = last;
  };
  const add = (bucket: TrafficBucket, events: number, bytes: number | null, first?: string | null, last?: string | null) => {
    bucket.events += events;
    if (bytes != null) bucket.bytes = (bucket.bytes ?? 0) + bytes;
    addTime(bucket, first, last);
  };

  const flows = network?.flows ?? [];
  if (flows.length) {
    for (const f of flows) {
      const first = f.flowStart ?? f.timestamp;
      const last = f.flowEnd ?? f.timestamp;
      addTime(out.total, first, last);
      const action = classifyTrafficAction(f.action);
      if (action === 'unknown') continue;
      const bytes = (num(f.bytesSent) ?? 0) + (num(f.bytesReceived) ?? 0);
      add(out[action], 1, bytes || null, first, last);
    }
    return out;
  }

  // Total-Fenster: Timeline bevorzugt, sonst das am Ticket gespeicherte Flow-Fenster.
  addTime(out.total, tl?.first ?? ev.network.firstSeen, tl?.last ?? ev.network.lastSeen);
  for (const a of tl?.actions ?? []) {
    const action = classifyTrafficAction(a.action);
    if (action === 'unknown') continue;
    const matchingTimes = (tl?.events ?? [])
      .filter((e) => classifyTrafficAction(e.action) === action)
      .map((e) => e.time)
      .filter(Boolean);
    const first = matchingTimes.length ? matchingTimes.reduce((min, t) => (t < min ? t : min)) : null;
    const last = matchingTimes.length ? matchingTimes.reduce((max, t) => (t > max ? t : max)) : null;
    add(out[action], a.count, null, first, last);
  }

  // Ehrlicher Fallback für ein Dataplane-Ticket: keine Flows/Timeline, aber eine
  // am Ticket gespeicherte Firewall-Action + Event-Zahl + Zeitfenster (aus ev.network).
  // Ereignis-Zahl und Fenster echt aus dem Ticket, nicht auf 1/Detektionszeit hart.
  const evidenceAction = classifyTrafficAction(ev.network.action);
  if (evidenceAction !== 'unknown' && out[evidenceAction].events === 0) {
    const first = blank(ev.network.firstSeen) ?? ev.detection.timestamp;
    const last = blank(ev.network.lastSeen) ?? ev.detection.timestamp;
    const events = stats.totalEvents ?? 1;
    add(out[evidenceAction], events, out.total.bytes, first, last);
  }

  // Ehrlicher Fallback: es gibt Traffic (Bytes/Events), aber kein Zeitfenster war
  // ableitbar (Dataplane-Ticket ohne Flows/Timeline/ev.network-Fenster). Die
  // Detektionszeit ist ein REALER Beobachtungszeitpunkt dieses Traffics → statt „—"
  // anzeigen. Kein erfundener Wert; nur wenn tatsächlich Traffic vorliegt.
  if (!out.total.firstSeen && ((out.total.events ?? 0) > 0 || (out.total.bytes ?? 0) > 0)) {
    const ts = blank(ev.detection.timestamp);
    if (ts) { out.total.firstSeen = ts; if (!out.total.lastSeen) out.total.lastSeen = ts; }
  }
  return out;
}

// ── NAT-Translation (Pre → Post; unveränderte Felder als Passthrough) ─────────
export interface NatRow { label: string; pre?: string; post?: string }
export function deriveNatTranslation(t: Ticket, ev: ParsedEvidence, network?: NetworkCorrelation | null): NatRow[] {
  const flow = (network?.flows ?? []).find((f) => f.postNatSourceIp || f.postNatDestinationIp || f.natType || f.natRule);

  const preSrcIp = blank(ev.nat.originalSourceIp) ?? blank(ev.source.ip) ?? blank(t.srcIp) ?? blank(flow?.originalSourceIp) ?? blank(flow?.sourceIp);
  const postSrcIp = blank(ev.nat.postNatSourceIp) ?? blank(flow?.postNatSourceIp);
  const preSrcPort = ev.nat.originalSourcePort ?? ev.source.port ?? flow?.originalSourcePort ?? flow?.sourcePort ?? undefined;
  const postSrcPort = ev.nat.postNatSourcePort ?? flow?.postNatSourcePort ?? undefined;
  const preDstIp = blank(ev.nat.originalDestinationIp) ?? blank(ev.destination.ip) ?? blank(t.dstIp) ?? blank(flow?.originalDestinationIp) ?? blank(flow?.destinationIp);
  const postDstIp = blank(ev.nat.postNatDestinationIp) ?? blank(flow?.postNatDestinationIp);
  const preDstPort = ev.nat.originalDestinationPort ?? ev.destination.port ?? flow?.originalDestinationPort ?? flow?.destinationPort ?? undefined;
  const postDstPort = ev.nat.postNatDestinationPort ?? flow?.postNatDestinationPort ?? undefined;
  const proto = blank(ev.network.protocol) ?? blank(ev.network.transport) ?? blank(flow?.protocol) ?? blank(flow?.transport);

  // Ein gleiches Pre-/Post-Paar ist eine Durchleitung, keine NAT-Translation.
  // Das verhindert doppelte Werte und eine irreführende NAT-Ansicht im UI.
  const differs = (pre?: string | number, post?: string | number) => {
    const before = pre == null || pre === '' ? undefined : String(pre);
    const after = post == null || post === '' ? undefined : String(post);
    return before !== undefined && after !== undefined && before !== after;
  };
  const hasNat = differs(preSrcIp, postSrcIp)
    || differs(preSrcPort, postSrcPort)
    || differs(preDstIp, postDstIp)
    || differs(preDstPort, postDstPort);
  if (!hasNat) return [];

  const str = (v?: string | number) => (v == null || v === '' ? undefined : String(v));
  const passthrough = (pre?: string | number, post?: string | number) => ({ pre: str(pre), post: str(post) ?? str(pre) });

  const rows: NatRow[] = [
    { label: 'Source IP', ...passthrough(preSrcIp, postSrcIp) },
    { label: 'Source Port', ...passthrough(preSrcPort, postSrcPort) },
    { label: 'Destination IP', ...passthrough(preDstIp, postDstIp) },
    { label: 'Destination Port', ...passthrough(preDstPort, postDstPort) },
    { label: 'Protocol', ...passthrough(proto?.toUpperCase(), proto?.toUpperCase()) },
  ];
  return rows.filter((r) => r.pre || r.post);
}

// ── Geolocation / Reputation ──────────────────────────────────────────────────
// Bevorzugt das Auto-Threat-Intel der öffentlichen Ticket-IP (Honeypot → Angreifer-
// Source-IP, Land/ASN/Reputation/Verdict via VirusTotal/AbuseIPDB). Fallback: real
// vorhandene Destination-Felder aus der Evidence. Nie erfundene Werte.
export interface GeoInfo {
  ip?: string;
  ipLabel: string;            // „Angreifer-IP" (Source-Enrichment) oder „Destination IP"
  country?: string;
  organization?: string;
  asn?: string;
  reputation?: string;        // z. B. „malicious (100)"
  usageType?: string;
  reports?: number;
  source?: string;            // 'provider' (echt) | 'mock' | 'cache'
  hasAny: boolean;
}
export function deriveGeo(ev: ParsedEvidence, network?: NetworkCorrelation | null): GeoInfo {
  // 1) Auto-Threat-Intel (öffentliche IP, z. B. Honeypot-Angreifer) hat Vorrang.
  const ti = (network?.threatIntel ?? [])[0];
  if (ti) {
    const country = blank(ti.country);
    const organization = blank(ti.asnOwner);
    const usageType = blank(ti.usageType);
    const reputation = ti.verdict && ti.verdict !== 'unknown'
      ? `${ti.verdict}${typeof ti.score === 'number' ? ` (${ti.score})` : ''}`
      : undefined;
    const reports = typeof ti.totalReports === 'number' ? ti.totalReports : undefined;
    const hasAny = Boolean(country || organization || usageType || reputation || reports != null);
    if (hasAny) {
      return {
        ip: blank(ti.indicatorValue), ipLabel: 'Angreifer-IP',
        country, organization, asn: organization, reputation, usageType, reports,
        source: blank(ti.source), hasAny: true,
      };
    }
  }
  // 2) Fallback: real vorhandene Destination-Felder aus der Evidence.
  const country = blank(ev.destination.country);
  const organization = blank(ev.destination.organization);
  const asn = blank(ev.destination.asn);
  const reputation = blank(ev.destination.reputation);
  return {
    ip: blank(ev.destination.ip), ipLabel: 'Destination IP',
    country, organization, asn, reputation,
    hasAny: Boolean(country || organization || asn || reputation),
  };
}
