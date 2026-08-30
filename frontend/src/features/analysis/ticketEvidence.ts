// Ableitung einer ParsedEvidence aus den am Ticket gespeicherten Feldern — der Fallback,
// wenn (noch) keine importierte/gepollte Evidence vorliegt. Nur echte Ticketfelder werden
// gemappt; fehlende Felder bleiben undefined (die Cards zeigen dann ehrlich „—"). KEINE Fake-Daten.
import { EMPTY_EVIDENCE, type ParsedEvidence } from './analysisModel';
import { badge } from '../../lib/badges';
import type { Ticket } from '../../lib/types';

const fmtDate = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const blank = (v?: string): string | undefined => (v && v.trim() ? v.trim() : undefined);

const toNum = (v?: string): number | undefined => {
  const s = blank(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Roh-Hash (nur Hex) in das `algo=value`-Format bringen, das die Evidence-Cards erwarten. */
export function toHashes(hash?: string): string | undefined {
  const h = blank(hash);
  if (!h) return undefined;
  if (h.includes('=')) return h; // bereits „sha256=…"
  if (/^[a-f0-9]{64}$/i.test(h)) return `sha256=${h}`;
  if (/^[a-f0-9]{40}$/i.test(h)) return `sha1=${h}`;
  if (/^[a-f0-9]{32}$/i.test(h)) return `md5=${h}`;
  return `hash=${h}`;
}

export function buildEvidence(t: Ticket): ParsedEvidence {
  const hashes = toHashes(t.hash);
  const proc = blank(t.process);
  const cmd = blank(t.commandLine);
  return {
    ...EMPTY_EVIDENCE,
    detection: {
      ...EMPTY_EVIDENCE.detection,
      sourceSystem: t.source || EMPTY_EVIDENCE.detection.sourceSystem,
      ruleId: t.offenseId || EMPTY_EVIDENCE.detection.ruleId,
      ruleName: t.title || EMPTY_EVIDENCE.detection.ruleName,
      severity: badge.severity(t.priority).label,
      timestamp: fmtDate(t.createdAt),
    },
    source: {
      ...EMPTY_EVIDENCE.source,
      host: blank(t.hostname),
      user: blank(t.user),
      ip: blank(t.srcIp) ?? EMPTY_EVIDENCE.source.ip,
      port: toNum(t.port),
      macAddress: blank(t.mac),
    },
    destination: {
      ...EMPTY_EVIDENCE.destination,
      ip: blank(t.dstIp) ?? EMPTY_EVIDENCE.destination.ip,
      fqdn: blank(t.dstFqdn),
    },
    nat: {
      ...EMPTY_EVIDENCE.nat,
      originalSourceIp: blank(t.srcIp),
      postNatSourceIp: blank(t.postNatSrc) ?? blank(t.extIp),
      originalDestinationIp: blank(t.dstIp),
      postNatDestinationIp: blank(t.postNatDst),
    },
    network: {
      ...EMPTY_EVIDENCE.network,
      protocol: blank(t.protocol),
      bytesSent: toNum(t.bytesSent),
      bytesReceived: toNum(t.bytesRecv),
      // Flow-Statistik fürs App-Map-Traffic (Dataplane-Tickets tragen diese Felder).
      packetsSent: toNum(t.pktsSent),
      packetsReceived: toNum(t.pktsRecv),
      action: blank(t.firewallAction),
      firstSeen: blank(t.firstSeen),
      lastSeen: blank(t.lastSeen),
      eventCount: toNum(t.eventCount),
    },
    metadata: {
      ...EMPTY_EVIDENCE.metadata,
      mitreTechnique: blank(t.mitre),
    },
    // Prozess-Evidence aus Image und/oder Command-Line (Sysmon E1/4688 oder PS-ScriptBlock).
    // Hash am Prozess (falls Prozess bekannt), sonst als Datei-Hash — kein Doppeleintrag.
    process: (proc || cmd) ? { image: proc, commandLine: cmd, hashes } : undefined,
    file: hashes && !proc && !cmd ? { hashes } : undefined,
    firstSeen: fmtDate(t.createdAt),
    lastSeen: fmtDate(t.updatedAt),
  };
}
