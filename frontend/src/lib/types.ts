// Geteilte API-Typen — spiegeln die Backend-Domain (toJSON-Formen).

// Analyst-Workflow-Zustand pro Ticket (persistent via JSONB)
export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface PlaybookState {
  id: string;
  step: number;
  status: '' | 'in_progress' | 'done' | 'skipped';
}

export interface AnalystState {
  checklist: ChecklistItem[];
  /** Leeres Objekt ({}) wenn kein Playbook aktiv, sonst PlaybookState */
  playbook: PlaybookState | Record<string, unknown>;
}

// Ein Payload-Eintrag am Ticket (ticket.payloads, jsonb). Trägt bei Dataplane-Honeypot-
// Tickets die beobachtete Angreifer-Session-Aktivität (Shell-Befehle, Downloads, Logins,
// Tunnel). Feld `raw` ist UNTRUSTED Angreifer-Input → im UI IMMER als Text rendern.
export interface TicketPayloadFields {
  kind?: 'command' | 'login' | 'download' | 'tunnel' | string;
  user?: string;
  at?: string;
  /** Herkunft der beobachteten Aktivität, z. B. Sysmon, Zeek oder Firewall. */
  source?: string;
  host?: string;
  role?: string;
  bytes?: string;
  bytes_sent?: string;
  bytes_received?: string;
  probes?: string;
}
export interface TicketPayload {
  type: 'Command' | 'URL' | 'Andere' | string;
  raw: string;
  fields?: TicketPayloadFields;
}

export interface Ticket {
  id: string;
  ticketNr: string;
  title: string;
  priority: string;
  status: string;
  analyst: string;
  createdAt: string;
  updatedAt: string;
  state?: string;
  customer?: string;
  source?: string;
  closeReason?: string;
  kind?: string;        // 'alert' | 'case' (Parent-Case)
  parentId?: string;    // Verweis auf den Host-Case
  alertCount?: number;  // Recurrence-Counter
  // Analyse-Detailfelder (vom Backend mitgeliefert, für das Analysis-Detailpanel)
  offenseId?: string;
  category?: string;
  datetime?: string;    // Zeitpunkt des Ereignisses (Backend liefert mit)
  description?: string;
  iocs?: string;
  logs?: string;
  actions?: string;     // durchgeführte Maßnahmen (mehrzeilig)
  recommendation?: string;
  notes?: string;
  decision?: string;
  confidence?: number | null;
  srcIp?: string;
  dstIp?: string;
  mitre?: string;
  // Netzwerk / Identität / System — vom Backend mitgeliefert (createTicketSchema), für die Evidence-Ableitung
  hostname?: string;
  user?: string;
  port?: string;
  protocol?: string;
  mac?: string;
  process?: string;
  commandLine?: string;
  hash?: string;
  extIp?: string;
  srcFqdn?: string;
  dstFqdn?: string;
  postNatSrc?: string;
  postNatDst?: string;
  postNatSrcFqdn?: string;
  postNatDstFqdn?: string;
  bytesSent?: string;
  bytesRecv?: string;
  // Flow-Statistik (App-Map) — v. a. Dataplane-/Honeypot-Tickets (Conntrack-Zähler)
  pktsSent?: string;
  pktsRecv?: string;
  firewallAction?: string;  // denied/permitted-Quelle (z. B. 'block'/'pass')
  firstSeen?: string;       // Beginn des Flow-Fensters (ISO)
  lastSeen?: string;        // Ende des Flow-Fensters (ISO)
  eventCount?: string;      // Anzahl beobachteter Events (speist totalEvents)
  os?: string;
  vpn?: string;
  // Analyst-Workflow-Zustand (Checkliste + Playbook, persistiert)
  analystState?: AnalystState;
  // Beobachtete Payload-/Session-Aktivität (Dataplane-Honeypot-Tickets). Untrusted.
  payloads?: TicketPayload[];
}

export interface TicketListResponse {
  data: Ticket[];
  total: number;
  limit: number;
  offset: number;
}

export interface HuntSession {
  id: string;
  ticketId: string | null;
  analystId: string;
  targetHost: string;
  scope: string;
  hypothesis: string;
  status: string;
  huntType: string;
  title: string;
  riskLevel: string;
  summary: string;
  findingsCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  closedAt: string | null;
}

export interface HuntLog {
  id: string;
  sessionId: string;
  seq: number;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  timestamp: string;
}

export interface HuntFindingContext {
  host?: string;
  user?: string;
  sourceIp?: string;
  destinationIp?: string;
  destinationPort?: number;
  protocol?: string;
  process?: string;
  parentProcess?: string;
  pid?: number;
  commandLine?: string;
  mitreTactic?: string;
  mitreTechnique?: string;
  source?: string;
  ruleId?: string;
  verdict?: 'unknown' | 'benign' | 'suspicious' | 'confirmed';
  status?: string;
  confidencePct?: number;
}

export interface HuntCommand {
  id: string;
  sessionId: string;
  type: string;
  command: string;
  description: string;
  status: string;
  result: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  blockedReason: string;
  analystId: string;
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
  completedAt: string | null;
}

export interface HuntArtifact {
  id: string;
  sessionId: string;
  commandId: string | null;
  type: string;
  value: string;
  metadata: Record<string, unknown>;
  source: string;
  analystId: string;
  createdAt: string;
}

export type FindingVerdict = '' | 'benign' | 'suspicious' | 'malicious' | 'inconclusive';

export interface HuntFinding {
  id: string;
  sessionId: string;
  title: string;
  description: string;
  severity: string;
  confidence: string;
  artifactIds: string[];
  mitreAttack: string;
  recommendation: string;
  analystId: string;
  ticketId: string | null;
  verdict: FindingVerdict;
  context: HuntFindingContext;
  createdAt: string;
  updatedAt: string;
}

export interface HuntResponseAction {
  id: string;
  huntSessionId: string;
  targetHost: string;
  kind: 'isolate_host' | 'release_isolation' | 'privileged_command';
  command: string;
  reason: string;
  riskTier: 'containment' | 'privileged';
  status: 'requested' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' | 'expired';
  requestedBy: string | null;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  authorizationBasis: string;
  rejectionReason: string;
  note: string;
}

// ADR-042 Circuit-Breaker: globaler Containment-Kanal-Zustand.
export interface HuntResponseCircuit {
  open: boolean;
  failStreak: number;
  threshold: number;
}

export interface HuntTicketLink {
  id: string;
  huntSessionId: string;
  ticketId: string;
  sourceType: string;
  sourceId: string;
  summary: string;
  linkedBy: string;
  linkedAt: string;
}

export interface ListEnvelope<T> { data: T[]; }
