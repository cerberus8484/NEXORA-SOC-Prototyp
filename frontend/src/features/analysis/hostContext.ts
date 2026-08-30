// Pure Ableitung des Host-Kontexts eines Incidents (W2): auf welchem Endpoint läuft
// der Vorfall? Quelle sind ausschließlich echte Felder — Hostname (ev.source.host →
// t.hostname), Wazuh-Agent (ev.metadata.agentName/agentId) und die Source-IP.
// Fehlt alles, ist `hasAny=false` und die UI blendet den Host-Block ehrlich aus
// bzw. zeigt „—". KEINE erfundenen Werte.
import type { ParsedEvidence } from './analysisModel';
import type { Ticket } from '../../lib/types';

const blank = (v?: string | null): string | undefined => {
  const s = (v ?? '').trim();
  return s ? s : undefined;
};

export interface HostContext {
  /** Anzeigename des Hosts: Hostname, sonst Agent-Name (Wazuh), sonst undefined. */
  hostname?: string;
  /** Wazuh-Agent-Name, falls bekannt und nicht bereits == hostname. */
  agentName?: string;
  /** Wazuh-Agent-ID, falls bekannt. */
  agentId?: string;
  /** Source-/Endpoint-IP, falls bekannt. */
  ip?: string;
  /** Angemeldeter Benutzer am Host, falls bekannt. */
  user?: string;
  /** True, sobald irgendein Host-Identifikator (Hostname/Agent/IP) vorliegt. */
  hasAny: boolean;
}

/**
 * Leitet den Host-Kontext deterministisch aus Evidence + Ticket ab.
 * Hostname-Priorität: ev.source.host → metadata.agentName → t.hostname.
 * agentName wird nur separat geführt, wenn er sich vom angezeigten Hostnamen unterscheidet
 * (sonst redundant).
 */
export function hostContext(t: Pick<Ticket, 'hostname' | 'srcIp' | 'user'>, ev: ParsedEvidence): HostContext {
  const agentName = blank(ev.metadata.agentName);
  const agentId = blank(ev.metadata.agentId);
  const hostname = blank(ev.source.host) ?? agentName ?? blank(t.hostname);
  const ip = blank(ev.source.ip) ?? blank(t.srcIp);
  const user = blank(ev.source.user) ?? blank(t.user);
  // agentName nur zusätzlich zeigen, wenn er nicht ohnehin der Hostname ist.
  const distinctAgentName = agentName && agentName !== hostname ? agentName : undefined;
  return {
    hostname,
    agentName: distinctAgentName,
    agentId,
    ip,
    user,
    hasAny: Boolean(hostname || agentId || ip),
  };
}
