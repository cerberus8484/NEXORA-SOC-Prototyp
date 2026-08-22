// Reine, testbare Ableitungen für die KI-Analyse-Ansicht. Quelle: AgentAnalysis (echte
// KI-Ausgabe). KEINE erfundenen IOCs/Entities — nur was die Analyse tatsächlich liefert.
import type { AgentAnalysis } from '../../aiAgent/agentApi';

// ── KI-Abfragen-Katalog (entspricht den backend AgentSuggestion-KINDS) ────────
export interface KiQuery { kind: string; title: string; description: string }
export const KI_QUERIES: KiQuery[] = [
  { kind: 'triage', title: 'Triage Summary', description: 'Erstellt eine strukturierte KI-Triage für dieses Ticket.' },
  { kind: 'false_positive_review', title: 'False Positive Review', description: 'Bewertet, ob es sich um ein False Positive handeln könnte.' },
  { kind: 'incident_recommendation', title: 'Incident Recommendation', description: 'Empfiehlt konkrete Maßnahmen für diesen Vorfall.' },
  { kind: 'hunt_suggestion', title: 'Threat Hunt Suggestion', description: 'Schlägt Threat-Hunt-Szenarien basierend auf dem Kontext vor.' },
  { kind: 'report_draft', title: 'Report Draft', description: 'Erstellt einen Berichtsentwurf für dieses Ticket.' },
  { kind: 'customer_response', title: 'Customer Response Draft', description: 'Entwirft eine Kundenantwort zu diesem Vorfall.' },
  { kind: 'evidence_explanation', title: 'Evidence Explanation', description: 'Erklärt die gesammelten Evidenzen und IOCs verständlich.' },
  { kind: 'mitre_mapping', title: 'MITRE Mapping', description: 'Ordnet die Aktivität MITRE ATT&CK-Taktiken und -Techniken zu.' },
  { kind: 'next_steps', title: 'Next Steps', description: 'Leitet priorisierte konkrete nächste Analyse-Schritte ab.' },
];

// ── Extracted IOCs & Entities ─────────────────────────────────────────────────
export interface KiIocRow { type: string; value: string; description?: string; source?: string; confidence?: string }

const normType = (t?: string): string => {
  const x = (t || '').toLowerCase().trim();
  if (/sha|md5|hash/.test(x)) return 'hash';
  if (/url/.test(x)) return 'url';
  if (/domain|fqdn/.test(x)) return 'domain';
  if (/\bip\b|ipv4|ipv6|address/.test(x)) return 'ip';
  if (/file|filename|path/.test(x)) return 'file';
  if (/process|image|exe/.test(x)) return 'process';
  if (/user|account/.test(x)) return 'user';
  if (/mitre|technique|tactic/.test(x)) return 'mitre';
  return x || 'other';
};

/** Kombiniert KI-IOCs + strukturierte Entities + MITRE zu einer deduplizierten Zeilenliste. */
export function buildKiIocRows(a: AgentAnalysis): KiIocRow[] {
  const rows: KiIocRow[] = [];
  const seen = new Set<string>();
  const add = (type: string, value?: string, description?: string, source?: string, confidence?: string) => {
    const v = (value || '').trim();
    if (!v) return;
    const key = `${type}|${v.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ type, value: v, description, source, confidence });
  };

  for (const i of a.iocs ?? []) add(normType(i.type), i.value, i.reason || i.role, i.evidenceSource, i.verdict);

  const e = a.entities ?? {};
  if (e.network?.destinationIp) add('ip', e.network.destinationIp, 'Destination IP', 'Entities');
  if (e.network?.sourceIp) add('ip', e.network.sourceIp, 'Source IP', 'Entities');
  if (e.dns?.query) add('domain', e.dns.query, 'DNS Query', 'Entities');
  if (e.process?.hashSha256) add('hash', e.process.hashSha256, 'Process SHA256', 'Entities');
  if (e.file?.hashSha256) add('hash', e.file.hashSha256, 'File SHA256', 'Entities');
  if (e.file?.name) add('file', e.file.name, 'File', 'Entities');
  if (e.process?.name) add('process', e.process.name, 'Process', 'Entities');
  if (e.user?.username) add('user', e.user.username, 'User', 'Entities');

  for (const m of a.mitreAttack ?? []) add('mitre', m.techniqueId || m.technique || '', m.technique || m.tactic, 'MITRE ATT&CK');

  return rows;
}

/** Vorhandene Typ-Tabs in fester Reihenfolge, immer mit „all" voran. */
export function kiIocTabs(rows: KiIocRow[]): string[] {
  const order = ['ip', 'domain', 'hash', 'file', 'process', 'user', 'url', 'mitre'];
  const present = new Set(rows.map((r) => r.type));
  return ['all', ...order.filter((t) => present.has(t))];
}
