// ─────────────────────────────────────────────────────────────────────────
// Analysis Deck — Datenmodell + neutrale Defaults (keine Demo-/Fake-Daten)
// Echte Evidence/Enrichment/Timeline kommen später aus:
//   GET /v1/tickets/:id/evidence · /enrichment · /timeline · /v1/evidence/:id/parse
// VT/AbuseIPDB laufen NUR serverseitig (keine Keys im Frontend).
// ─────────────────────────────────────────────────────────────────────────

import i18n from '../../i18n';

export interface ParsedEvidence {
  id: string;
  type: 'network' | 'dns' | 'payload' | 'process' | 'alert' | 'enrichment' | 'command_output';
  detection: {
    sourceSystem: string;
    ruleId?: string;
    ruleName?: string;
    severity?: string;
    timestamp: string;
    status?: string;
    description?: string;
  };
  source: { host?: string; user?: string; ip?: string; port?: number; zone?: string; interface?: string; macAddress?: string };
  destination: { ip?: string; port?: number; fqdn?: string; sni?: string; httpHost?: string; country?: string; asn?: string; organization?: string; reputation?: string };
  nat: { originalSourceIp?: string; originalSourcePort?: number; postNatSourceIp?: string; postNatSourcePort?: number; originalDestinationIp?: string; originalDestinationPort?: number; postNatDestinationIp?: string; postNatDestinationPort?: number; natType?: string; firewallRule?: string };
  network: { protocol?: string; transport?: string; direction?: string; action?: string; connectionState?: string; bytesSent?: number; bytesReceived?: number; packetsSent?: number; packetsReceived?: number; durationMs?: number; firewallRule?: string; eventCount?: number; firstSeen?: string; lastSeen?: string };
  payload: { type?: string; method?: string; url?: string; hostHeader?: string; userAgent?: string; contentType?: string; statusCode?: number; contentLength?: number; preview?: string; containsCredentials?: boolean | 'unknown'; containsToken?: boolean | 'unknown'; containsScript?: boolean | 'unknown'; containsBase64?: boolean | 'unknown'; suspiciousKeywords?: string[] };
  metadata: { mitreTactic?: string; mitreTechnique?: string; logSource?: string; agentId?: string; agentName?: string };
  // Windows Process Creation (Sysmon EventID 1 / Security 4688)
  process?: {
    image?: string; commandLine?: string; parentImage?: string; parentCommandLine?: string;
    user?: string; logonId?: string; processId?: string; processGuid?: string; parentProcessId?: string;
    currentDirectory?: string; integrityLevel?: string; originalFileName?: string; hashes?: string;
  };
  // Sysmon EventID 22: DNS-Query
  dns?: { query?: string; answers?: string; status?: string };
  // Sysmon EventID 11: FileCreate — erzeugte Datei
  file?: { name?: string; hashes?: string };
  // Windows EventChannel (win.system) — Provider/EventID/Channel/Message,
  // wenn das Event seine Inhalte nicht in eventdata trägt (z. B. WMI-Activity).
  windowsEvent?: { eventId?: string; provider?: string; channel?: string; computer?: string; message?: string };
  firstSeen?: string;
  lastSeen?: string;
  raw?: unknown;
  // Correlation Engine (CE-2/3): über mehrere Events aggregierte Herkunft.
  correlation?: CorrelationMeta;
}

// Provenance der Korrelation: aus wie vielen Events/Quellen stammt diese Evidence.
export interface SourceCount { source: string; count: number }
export interface CorrelatedEntity {
  kind: string; value: string; note?: string; events: number;
  firstSeen?: string | null; lastSeen?: string | null;
  sources: SourceCount[];
}
export interface CorrelationMeta {
  eventCount: number;
  sources: SourceCount[];
  entities?: CorrelatedEntity[];
}

// Async-Korrelationsstatus aus GET /tickets/:id/evidence (P_CORR_1c).
// 'completed' wird backend-seitig auf 'current' gemappt — kein zweiter Fertig-Status.
export type CorrelationJobStatus =
  | 'current'
  | 'pending' | 'running' | 'retrying'
  | 'failed' | 'superseded' | 'unavailable';

export interface CorrelationStatusInfo {
  status: CorrelationJobStatus;
  result: unknown | null;
  resultCreatedAt: string | null;
  sourceRevision: string;
  lastFailureReason: string | null;
}

export interface EvidenceApiResponse {
  data: ParsedEvidence | null;
  source: string;
  correlation?: CorrelationStatusInfo;
}

export type IocType = 'ip' | 'domain' | 'hash' | 'url' | 'file' | 'other';

// Robuste IoC-Typ-Erkennung — Dateipfade NICHT als Domain fehlklassifizieren.
export function classifyIoc(v: string): IocType {
  const s = v.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return 'ip';
  if (/^[0-9a-f:]+:[0-9a-f:]+$/i.test(s) && s.includes('::')) return 'ip';        // grob IPv6
  if (/^https?:\/\//i.test(s)) return 'url';
  if (/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(s)) return 'hash';
  if (/[\\/]/.test(s) || /^[a-z]:/i.test(s) || /\.(exe|dll|ps1|bat|cmd|scr|vbs|js|jar|sys|tmp|dat|docm?|xlsm?)$/i.test(s)) return 'file';
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(s)) return 'domain';
  return 'other';
}
export interface Ioc { type: IocType; value: string; reputation?: 'malicious' | 'suspicious' | 'harmless' | 'unknown' }

// ── Threat Intel (P17) — normalisiertes Enrichment (Mock-first) ──
export type TiVerdict = 'unknown' | 'clean' | 'suspicious' | 'malicious';
export interface ThreatIntelProviderResult {
  provider: string;
  status: 'not_configured' | 'ok' | 'error' | 'rate_limited';
  verdict: TiVerdict;
  score: number;
  confidence: number;
  rawSummary?: string;
  details?: { tags?: string[]; category?: string };
  checkedAt?: string;
}
export interface ThreatIntelResult {
  id: string;
  indicatorType: IocType;
  indicatorValue: string;
  verdict: TiVerdict;
  confidence: number;
  score: number;
  providers: ThreatIntelProviderResult[];
  summary: string;
  tags: string[];
  source: 'mock' | 'cache' | 'provider';
  createdAt: string;
  cachedUntil?: string;
}

export interface EnrichmentData {
  virusTotal: { status: 'completed' | 'pending' | 'none'; malicious: number; suspicious: number; harmless: number; undetected: number; total: number };
  abuseIpDb: { status: 'completed' | 'pending' | 'none'; confidence: number; reports: number; lastReport: string; country: string; isp: string; usageType: string; domainCount: number };
  whois: { ip: string; asn: string; org: string; registered: string; dns: string };
  wazuhEvents: { time: string; text: string }[];
}

export interface TimelineEvent { time: string; title: string; detail?: string; kind: 'user' | 'network' | 'alert' | 'enrichment' | 'analyst' }

// Echte Flow-/Event-Timeline aus dem Wazuh-Indexer (pro Ticket/Offense).
export interface FlowEvent {
  time: string; ruleId?: string; level?: number; description?: string;
  host?: string; srcIp?: string; dstIp?: string; srcPort?: string | number; dstPort?: string | number;
  protocol?: string; action?: string;
}
export interface TicketTimeline {
  count: number;
  first: string | null;
  last: string | null;
  dstPorts: { port: string | number; count: number }[];
  actions: { action: string; count: number }[];
  events: FlowEvent[];
}

// ── CE-3: einheitliches Network-Flow-Modell (Firewall + Sysmon Event 3) ──────
export type FlowSourceType = 'firewall' | 'sysmon_event3' | 'suricata' | 'cowrie' | 'unknown';
export interface FlowProvenanceEntry {
  source?: string; fieldPath?: string | null; confidence?: string | null;
  collectedAt?: string; missingReason?: string;
}
export interface NetworkFlow {
  sourceType: FlowSourceType;
  timestamp: string | null;
  sourceIp: string | null; sourcePort: number | null; sourceHost: string | null;
  // Host-/Endpoint-Inventory-Kontext (Host-NIC, aus CE-4) — getrennt vom Firewall-Interface.
  sourceFqdn: string | null; sourceMac: string | null; sourceHostInterface: string | null; sourceZone: string | null;
  destinationIp: string | null; destinationPort: number | null; destinationHost: string | null;
  destinationFqdn: string | null; destinationMac: string | null; destinationHostInterface: string | null; destinationZone: string | null;
  protocol: string | null; transport: string | null; direction: string | null; action: string | null;
  bytesSent: number | null; bytesReceived: number | null; packetsSent: number | null; packetsReceived: number | null; durationMs: number | null;
  originalSourceIp: string | null; originalSourcePort: number | null; postNatSourceIp: string | null; postNatSourcePort: number | null;
  originalDestinationIp: string | null; originalDestinationPort: number | null; postNatDestinationIp: string | null; postNatDestinationPort: number | null;
  natType: string | null; natRule: string | null; firewallRule: string | null;
  // Firewall-/Network-Device-Kontext (Interface, auf dem die Regel matchte, aus CE-3).
  firewallInterface?: string | null; firewallIngressInterface?: string | null; firewallEgressInterface?: string | null;
  // Slice 2b.4: 'partial' = Quelle liefert kein vollständiges 5-Tuple (z.B. Cowrie ohne Ziel/Ports).
  flowCompleteness?: 'partial' | 'full';
  processImage: string | null; processId: string | number | null; processGuid: string | null; user: string | null;
  // Honeypot-Session-Kontext (Cowrie, Slice 1) — nur an cowrie-Flows gesetzt, sonst undefined.
  service?: string | null; sessionId?: string | null; sensorId?: string | null;
  connectionState?: string | null; flowStart?: string | null; flowEnd?: string | null;
  // Suricata-eve-Flow (S1) — additive Metadaten, nur an suricata-Flows.
  appProtocol?: string | null; flowId?: string | null; communityId?: string | null;
  provenance?: Record<string, FlowProvenanceEntry>;
  missingReason?: Record<string, string>;
}
export interface NetworkConversation {
  sourceIp: string | null; destinationIp: string | null; protocol: string | null; destinationPort: number | null; count: number;
}
export interface NetworkFieldSummary { distinct: number; top: { value: string; count: number }[] }
export interface NetworkGap { field: string; missingReason: string; count: number }
export interface NetworkCorrelation {
  flows: NetworkFlow[];
  topConversations: NetworkConversation[];
  sourceSummary?: NetworkFieldSummary;
  destinationSummary?: NetworkFieldSummary;
  gaps?: NetworkGap[];
  // Honeypot-Sessions (Cowrie) — SEPARATER Block, nie mit flows vermischt (Slice 2b).
  honeypotSessions?: HoneypotSession[];
  // Correlated Exposure Paths (ADR-034) — korreliert, NIE behauptete NAT-Translation.
  exposureCorrelations?: ExposureCorrelation[];
  // Auto-Threat-Intel der öffentlichen Ticket-IPs (Honeypot → Angreifer-Source-IP).
  // Backend reichert beim Deck-Load automatisch an (Land/ASN/Reputation/Verdict).
  threatIntel?: TicketThreatIntelEntry[];
}

// Ein Auto-Enrichment-Eintrag je öffentlicher IP (Backend correlation/ticketThreatIntel).
export interface TicketThreatIntelEntry {
  indicatorValue: string;
  verdict: string;
  score: number;
  confidence: number;
  source: string;
  summary?: string | null;
  country?: string | null;
  asnOwner?: string | null;
  usageType?: string | null;
  totalReports?: number | null;
  tags?: string[];
}

// honeypot_session (Backend honeypotSessionNormalizer) — passwortfrei: NUR
// passwordObserved/passwordAttempts, niemals der Klartext.
export interface HoneypotCommand { timestamp: string | null; command: string; truncated?: boolean }
export interface HoneypotDownload { url?: string; filename?: string; hash?: string }
export interface HoneypotFingerprint { hassh?: string; version?: string }
export interface HoneypotSession {
  sessionId: string;
  sensor: string | null;
  service: string | null;
  sourceIp: string | null;          // Cowrie data.src_ip → externe Angreifer-IP
  sourcePort: number | null;
  destinationIp: string | null;     // interne Honeypot-IP (Post-DNAT)
  destinationPort: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  durationMs: number | null;
  loginAttempts: number;
  loginSucceeded: number;
  loginFailed: number;
  authSuccess: boolean | null;
  usernames: string[];
  usernamesTruncated?: boolean;
  passwordObserved: boolean;
  passwordAttempts: number;
  commands: HoneypotCommand[];
  commandCount: number;
  commandsTruncated: boolean;
  downloads: HoneypotDownload[];
  fingerprint: HoneypotFingerprint;
  relatedFlowSessionId: string | null;
}

// Correlated Exposure Path (ADR-034): korrelierte Ableitung Honeypot ⨝ Firewall-5-Tuple.
// natVerified IMMER false, provenance IMMER "correlated" — keine behauptete NAT-Translation.
export interface ExposureCorrelation {
  sessionId: string;
  relatedFlowSessionId: string | null;
  remoteSourceIp: string;
  firewallEventId: string | null;
  firewallTimestamp: string | null;
  firewallDestinationIp: string | null;
  firewallDestinationPort: number | null;
  firewallProtocol: string | null;
  firewallAction: string | null;
  confidence: 'high' | 'medium' | 'none';
  correlationType: 'firewall_to_honeypot';
  natVerified: false;
  provenance: 'correlated';
  missingReason: string | null;
}

export interface PlaybookStep { label: string; status: 'pending' | 'in_progress' | 'done' | 'skipped' | 'needs_review' }
export interface Playbook { id: string; name: string; steps: PlaybookStep[] }

// Empfehlung fürs Ausnahme-Ziel (Frequency-Regel → Basis-Regel scopen).
export interface FpRuleTarget {
  isFrequencyRule: boolean;
  baseRuleId: string | null;
  recommendedIfSid: string | null;
}

// ── False-Positive-Exception (Stage 2–3: nur Preview/Draft, KEIN Wazuh-Write) ──
export interface FpScope {
  ruleId: string;
  srcips: string[];
  dstips: string[];
  dstipSuggestion?: string;
  dstports: string[];
  protocol?: string;
  agentId?: string;
  reason?: string;
  ticketId?: string;
}
export interface FpPreviewResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  xml: string;
  ruleId: number;
  file: string;
  applied: boolean;
}

export type FpStatus = 'draft' | 'submitted' | 'applied' | 'restart_required' | 'active' | 'reverted' | 'failed';
export interface WazuhFpException {
  id: string;
  ticketId: string;
  parentRuleId: string;
  generatedRuleId: number | null;
  srcips: string[];
  dstips: string[];
  dstports: string[];
  protocol: string;
  agentId: string;
  reason: string;
  status: FpStatus;
  file: string;
  lastError: string;
  createdAt: string;
  appliedAt?: string | null;
  revertedAt?: string | null;
}
export interface FpActionResult {
  ok: boolean;
  errors?: string[];
  warnings?: string[];
  exception?: WazuhFpException;
  restartRequired?: boolean;
  idempotent?: boolean;
  retryable?: boolean;
  action?: 'forwarded' | 'applied'; // nur /quick: rollenabhängiger Ein-Klick
}

// ── Neutrale Defaults (keine erfundenen Werte) ─────────────────────────────

export const EMPTY_EVIDENCE: ParsedEvidence = {
  id: '', type: 'alert',
  detection: { sourceSystem: '', timestamp: '' },
  source: {}, destination: {}, nat: {}, network: {}, payload: {}, metadata: {},
};

export const EMPTY_ENRICHMENT: EnrichmentData = {
  virusTotal: { status: 'none', malicious: 0, suspicious: 0, harmless: 0, undetected: 0, total: 0 },
  abuseIpDb: { status: 'none', confidence: 0, reports: 0, lastReport: '', country: '', isp: '', usageType: '', domainCount: 0 },
  whois: { ip: '', asn: '', org: '', registered: '', dns: '' },
  wazuhEvents: [],
};

// Geführte Untersuchungs-Vorlagen (statische Templates, kein gefälschter Fortschritt)
export const PLAYBOOKS: Playbook[] = [
  { id: 'susp-ip', name: 'Suspicious IP', steps: [
    { label: 'Validate alert', status: 'pending' }, { label: 'Extract IoCs', status: 'pending' },
    { label: 'Check VirusTotal', status: 'pending' }, { label: 'Check AbuseIPDB', status: 'pending' },
    { label: 'Check DNS / ASN', status: 'pending' }, { label: 'Check affected host', status: 'pending' },
    { label: 'Decide severity', status: 'pending' }, { label: 'Create recommendation', status: 'pending' },
  ] },
  { id: 'malware', name: 'Malware Alert', steps: [{ label: 'Isolate host', status: 'pending' }, { label: 'Collect sample', status: 'pending' }, { label: 'Hash lookup', status: 'pending' }] },
  { id: 'failed-logins', name: 'Failed Logins', steps: [{ label: 'Identify source IP', status: 'pending' }, { label: 'Check account', status: 'pending' }] },
  { id: 'privesc', name: 'Privilege Escalation', steps: [{ label: 'Identify account', status: 'pending' }] },
  { id: 'phishing', name: 'Phishing', steps: [{ label: 'Analyze mail headers', status: 'pending' }] },
  { id: 'lateral', name: 'Lateral Movement', steps: [{ label: 'Map connections', status: 'pending' }] },
];

export const INVESTIGATION_CHECKLIST = [
  i18n.t('analysis.iocsChecked'), i18n.t('analysis.virustotalChecked'), i18n.t('analysis.abuseipdbChecked'), i18n.t('analysis.hostChecked'), i18n.t('analysis.userActivityChecked'), i18n.t('analysis.recommendationDocumented'),
];

export const COMMAND_TEMPLATES = (target = '<target>', ip = '<ip>') => [
  `nslookup ${target}`,
  `whois ${target}`,
  `ping ${ip}`,
  `tracert ${ip}`,
  `curl -I https://${target}`,
];

export const IMPORT_SOURCES = [
  'Wazuh Alert', 'Splunk Event', 'QRadar Offense', 'Firewall Log', 'Paste Raw Log', 'Upload File', 'Command Output', 'Enrichment Result',
] as const;


export function correlationInsights(e: ParsedEvidence, enr: EnrichmentData): string[] {
  const out: string[] = [];
  if (e.source.host && e.destination.fqdn) out.push(`Source host ${e.source.host} established an outbound ${e.network.transport || e.network.protocol || ''} connection to ${e.destination.fqdn}.`.replace('  ', ' '));
  if (e.destination.ip && String(e.destination.reputation).toLowerCase() === 'malicious' && enr.virusTotal.status === 'completed') out.push(`Destination IP ${e.destination.ip} matches VirusTotal malicious reputation (${enr.virusTotal.malicious}/${enr.virusTotal.total}).`);
  if (enr.abuseIpDb.status === 'completed' && enr.abuseIpDb.confidence) out.push(`AbuseIPDB reports ${enr.abuseIpDb.confidence}% abuse confidence for the destination IP.`);
  if (e.nat.postNatSourceIp) out.push(`Source NAT translated ${e.nat.originalSourceIp}:${e.nat.originalSourcePort} to ${e.nat.postNatSourceIp}:${e.nat.postNatSourcePort}.`);
  if (e.network.action) out.push(`Firewall action was ${e.network.action}${e.network.action === 'Allowed' ? ', so the connection was not blocked.' : '.'}`);
  if (e.payload.suspiciousKeywords?.length) out.push(`Payload keywords (${e.payload.suspiciousKeywords.join(', ')}) indicate possible beacon/check-in behavior.`);
  return out;
}

export function iocsFromParsed(ev: ParsedEvidence): Ioc[] {
  const out: Ioc[] = [];
  const add = (value?: string, type?: IocType, reputation: Ioc['reputation'] = 'unknown') => {
    const v = (value || '').trim(); if (!v) return;
    out.push({ type: type || classifyIoc(v), value: v, reputation });
  };
  add(ev.destination.ip, 'ip', (ev.destination.reputation as Ioc['reputation']) || 'unknown');
  add(ev.source.ip, 'ip');
  add(ev.destination.fqdn);          // classifyIoc → domain (kein Dateipfad-Fehlklassifizieren)
  add(ev.dns?.query, 'domain');
  add(ev.payload.url, 'url');
  add(ev.file?.name, 'file');        // Sysmon FileCreate: erzeugte Datei
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.value) ? false : (seen.add(i.value), true)));
}
