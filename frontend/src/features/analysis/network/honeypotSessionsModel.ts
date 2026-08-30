// Reine Ableitung für die „Honeypot Sessions"-Sektion (Network-&-NAT-Tab).
// Quelle: network.honeypotSessions (Backend). Whitelist-View → NIEMALS ein Passwort
// ans UI durchreichen (nur passwordObserved/passwordAttempts). Kein Geo/ASN/NAT.
import type { HoneypotSession, HoneypotCommand, HoneypotDownload, HoneypotFingerprint, NetworkCorrelation, ExposureCorrelation, TicketThreatIntelEntry } from '../analysisModel';

export interface HoneypotSessionView {
  sessionId: string;
  attackerIp: string | null;        // Cowrie src_ip → eindeutig externe Angreifer-IP
  attackerPort: number | null;
  honeypotIp: string | null;        // interne Post-DNAT-Ziel-IP
  port: number | null;
  service: string | null;
  sensor: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  durationMs: number | null;
  loginAttempts: number;
  loginSucceeded: number;
  loginFailed: number;
  authSuccess: boolean | null;
  usernames: string[];
  usernamesTruncated: boolean;
  passwordObserved: boolean;
  passwordAttempts: number;
  commands: HoneypotCommand[];
  moreCommands: number;             // commandCount − angezeigte (≥ 0)
  downloads: HoneypotDownload[];
  fingerprint: HoneypotFingerprint | null;
  relatedFlowSessionId: string | null;
  hasRelatedFlow: boolean;          // existiert ein Cowrie-Flow mit dieser sessionId?
}

function toView(s: HoneypotSession, flowIds: Set<string>): HoneypotSessionView {
  const shown = Array.isArray(s.commands) ? s.commands : [];
  const total = typeof s.commandCount === 'number' ? s.commandCount : shown.length;
  const fp = s.fingerprint || {};
  const hasFp = Boolean(fp.hassh || fp.version);
  const related = s.relatedFlowSessionId ?? s.sessionId ?? null;

  // Explizite Whitelist: nur diese Felder verlassen das Modell — ein evtl. vorhandenes
  // Passwort-Rohfeld wird strukturell NICHT durchgereicht.
  return {
    sessionId: s.sessionId,
    attackerIp: s.sourceIp ?? null,
    attackerPort: s.sourcePort ?? null,
    honeypotIp: s.destinationIp ?? null,
    port: s.destinationPort ?? null,
    service: s.service ?? null,
    sensor: s.sensor ?? null,
    firstSeen: s.firstSeen ?? null,
    lastSeen: s.lastSeen ?? null,
    durationMs: s.durationMs ?? null,
    loginAttempts: s.loginAttempts ?? 0,
    loginSucceeded: s.loginSucceeded ?? 0,
    loginFailed: s.loginFailed ?? 0,
    authSuccess: s.authSuccess ?? null,
    usernames: Array.isArray(s.usernames) ? s.usernames : [],
    usernamesTruncated: Boolean(s.usernamesTruncated),
    passwordObserved: Boolean(s.passwordObserved),
    passwordAttempts: s.passwordAttempts ?? 0,
    commands: shown.map((c) => ({ timestamp: c.timestamp ?? null, command: c.command, ...(c.truncated ? { truncated: true } : {}) })),
    moreCommands: Math.max(0, total - shown.length),
    downloads: Array.isArray(s.downloads)
      ? s.downloads.map((d) => ({ ...(d.url ? { url: d.url } : {}), ...(d.filename ? { filename: d.filename } : {}), ...(d.hash ? { hash: d.hash } : {}) }))
      : [],
    fingerprint: hasFp ? { ...(fp.hassh ? { hassh: fp.hassh } : {}), ...(fp.version ? { version: fp.version } : {}) } : null,
    relatedFlowSessionId: related,
    hasRelatedFlow: Boolean(related && flowIds.has(related)),
  };
}

export function deriveHoneypotSessions(network?: NetworkCorrelation | null): HoneypotSessionView[] {
  const sessions = network?.honeypotSessions ?? [];
  const cowrieFlowSessionIds = new Set(
    (network?.flows ?? [])
      .filter((f) => f.sourceType === 'cowrie' && f.sessionId)
      .map((f) => f.sessionId as string),
  );
  return sessions.map((s) => toView(s, cowrieFlowSessionIds));
}

// ── Gruppierung nach Angreifer-IP (UI: 182 Einzel-Sessions → wenige Gruppen) ──
// Aggregiert je Angreifer-IP, hängt Geo/Verdict aus dem Auto-Threat-Intel an.
export interface HoneypotAttackerGeo {
  country?: string;
  verdict?: string;
  score?: number;
  asnOwner?: string;
}
export interface HoneypotAttackerGroup {
  attackerIp: string;
  sessionCount: number;
  loginSucceeded: number;
  loginFailed: number;
  usernames: string[];        // Union, gedeckelt
  commandSamples: string[];   // distinkte Commands, gedeckelt
  downloads: number;
  firstSeen: string | null;
  lastSeen: string | null;
  geo: HoneypotAttackerGeo | null;
  sessions: HoneypotSessionView[];
}

const GROUP_MAX_USERNAMES = 12;
const GROUP_MAX_COMMANDS = 8;

export function groupHoneypotSessionsByAttacker(
  views: HoneypotSessionView[],
  threatIntel?: TicketThreatIntelEntry[] | null,
): HoneypotAttackerGroup[] {
  const tiByIp = new Map<string, TicketThreatIntelEntry>();
  for (const t of threatIntel ?? []) if (t.indicatorValue) tiByIp.set(t.indicatorValue, t);

  const groups = new Map<string, HoneypotAttackerGroup>();
  for (const v of views) {
    const ip = v.attackerIp ?? '—';
    let g = groups.get(ip);
    if (!g) {
      const ti = tiByIp.get(ip);
      g = {
        attackerIp: ip, sessionCount: 0, loginSucceeded: 0, loginFailed: 0,
        usernames: [], commandSamples: [], downloads: 0, firstSeen: null, lastSeen: null,
        geo: ti ? {
          country: ti.country ?? undefined,
          verdict: ti.verdict && ti.verdict !== 'unknown' ? ti.verdict : undefined,
          score: typeof ti.score === 'number' ? ti.score : undefined,
          asnOwner: ti.asnOwner ?? undefined,
        } : null,
        sessions: [],
      };
      groups.set(ip, g);
    }
    g.sessionCount += 1;
    g.loginSucceeded += v.loginSucceeded;
    g.loginFailed += v.loginFailed;
    g.downloads += v.downloads.length;
    for (const u of v.usernames) if (!g.usernames.includes(u) && g.usernames.length < GROUP_MAX_USERNAMES) g.usernames.push(u);
    for (const c of v.commands) if (!g.commandSamples.includes(c.command) && g.commandSamples.length < GROUP_MAX_COMMANDS) g.commandSamples.push(c.command);
    if (v.firstSeen && (!g.firstSeen || v.firstSeen < g.firstSeen)) g.firstSeen = v.firstSeen;
    if (v.lastSeen && (!g.lastSeen || v.lastSeen > g.lastSeen)) g.lastSeen = v.lastSeen;
    g.sessions.push(v);
  }
  return [...groups.values()].sort((a, b) => b.sessionCount - a.sessionCount);
}

// Correlated Exposure Paths (ADR-034) — Passthrough + Sortierung high → medium → none.
// Kein Umschreiben: natVerified/provenance kommen wie geliefert (immer false/"correlated").
const CONFIDENCE_ORDER: Record<string, number> = { high: 0, medium: 1, none: 2 };
export function deriveExposureCorrelations(network?: NetworkCorrelation | null): ExposureCorrelation[] {
  const list = network?.exposureCorrelations ?? [];
  return [...list].sort((a, b) => (CONFIDENCE_ORDER[a.confidence] ?? 9) - (CONFIDENCE_ORDER[b.confidence] ?? 9));
}
