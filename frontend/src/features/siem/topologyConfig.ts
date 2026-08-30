import { ZONES, QUICK_LINKS, type ZoneDef, type ZoneHostDef, type QuickLink } from './topology';

// Operator-Override der Netz-Topologie (Zonen + Quick-Links).
//
// WARUM: topology.ts enthält bewusst NUR sanitierte Platzhalter-Werte (IPs, Agent-Namen,
// URLs) — echte Infrastruktur-Werte gehören NICHT ins Repo (Privacy, siehe Repo-IP-History).
// Damit das Dashboard trotzdem echte Hosts/Links/Status zeigt, kann der Betrieb zur Laufzeit
// eine `topology.config.json` bereitstellen (per Web-Server/Volume ausgeliefert, nicht committet).
// Fehlt sie oder ist sie ungültig → Fallback auf die eingebauten Platzhalter (kein Bruch).
//
// So werden „falsche IP" / „nicht grün" / „toter Link" lösbar, ohne echte Werte einzuchecken:
// der Operator trägt echte Wazuh-Agent-Namen, IPs und Panel-URLs in die Override-Datei ein.

export interface TopologyConfig {
  zones: ZoneDef[];
  quickLinks: QuickLink[];
}

/** Default-Pfad der Override-Datei (vom Web-Server statisch ausgeliefert). Überschreibbar via ENV. */
export const TOPOLOGY_CONFIG_URL =
  (import.meta.env?.VITE_TOPOLOGY_CONFIG_URL as string | undefined) || '/config/topology.json';

/** Eingebaute, sanitierte Default-Topologie (Fallback). */
export const DEFAULT_TOPOLOGY: TopologyConfig = { zones: ZONES, quickLinks: QUICK_LINKS };

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function parseHost(raw: unknown): ZoneHostDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  if (!isStr(h.label) || !isStr(h.ip)) return null;
  const host: ZoneHostDef = { label: h.label, ip: h.ip };
  if (isStr(h.agent)) host.agent = h.agent;
  if (isStr(h.note)) host.note = h.note;
  return host;
}

function parseZone(raw: unknown): ZoneDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const z = raw as Record<string, unknown>;
  if (!isStr(z.key) || !isStr(z.label) || !isStr(z.color) || !isStr(z.subnet)) return null;
  if (!isStrArray(z.agents) || !Array.isArray(z.hosts)) return null;
  const hosts = z.hosts.map(parseHost);
  if (hosts.some((h) => h === null)) return null;
  const zone: ZoneDef = {
    key: z.key, label: z.label, color: z.color, subnet: z.subnet,
    agents: z.agents, hosts: hosts as ZoneHostDef[],
  };
  if (typeof z.isolated === 'boolean') zone.isolated = z.isolated;
  return zone;
}

function parseQuickLink(raw: unknown): QuickLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  if (!isStr(l.label) || !isStr(l.url) || !isStr(l.desc)) return null;
  // Nur http/https zulassen — kein javascript:/data: aus einer Operator-Datei.
  try {
    const u = new URL(l.url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  } catch {
    return null;
  }
  return { label: l.label, url: l.url, desc: l.desc };
}

/**
 * Validiert eine (ungetrust) geladene Topologie-Konfiguration. Gibt `null` zurück, wenn die
 * Struktur ungültig ist (→ Aufrufer nutzt den Default). Fehlt eine der beiden Listen, wird
 * für diese der Default genutzt; vorhandene Einträge müssen aber wohlgeformt sein.
 */
export function parseTopologyConfig(raw: unknown): TopologyConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const cfg = raw as Record<string, unknown>;
  let zones = DEFAULT_TOPOLOGY.zones;
  let quickLinks = DEFAULT_TOPOLOGY.quickLinks;

  if (cfg.zones !== undefined) {
    if (!Array.isArray(cfg.zones)) return null;
    const parsed = cfg.zones.map(parseZone);
    if (parsed.some((z) => z === null)) return null;
    zones = parsed as ZoneDef[];
  }
  if (cfg.quickLinks !== undefined) {
    if (!Array.isArray(cfg.quickLinks)) return null;
    const parsed = cfg.quickLinks.map(parseQuickLink);
    if (parsed.some((l) => l === null)) return null;
    quickLinks = parsed as QuickLink[];
  }
  return { zones, quickLinks };
}

/**
 * Lädt die Operator-Override-Topologie. Bei fehlender/ungültiger Datei → eingebauter Default.
 * Wirft nie — das Dashboard soll immer rendern.
 */
export async function loadTopology(url: string = TOPOLOGY_CONFIG_URL): Promise<TopologyConfig> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return DEFAULT_TOPOLOGY;
    const parsed = parseTopologyConfig(await res.json());
    return parsed ?? DEFAULT_TOPOLOGY;
  } catch {
    return DEFAULT_TOPOLOGY;
  }
}
