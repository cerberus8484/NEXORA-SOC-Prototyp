// CE-3: korrelierte Netzwerk-Flows (Firewall + Sysmon Event 3) als Tabelle +
// dezenter „Missing-Reason"-Hinweis. Keine erfundenen Werte — fehlt ein Feld,
// steht ein dezentes „—" mit Tooltip statt eines Platzhalters.
import { Badge, type Tone } from '../../../components/ui';
import type { NetworkCorrelation, NetworkGap } from '../analysisModel';
import { TH, TD } from './deckUi';

const fmtTs = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('de-DE') : '—');
const baseName = (p?: string | null) => (p ? p.split(/[\\/]/).pop() || p : null);

const SOURCE_BADGE: Record<string, { label: string; tone: Tone }> = {
  firewall:      { label: 'Firewall', tone: 'warning' },
  sysmon_event3: { label: 'Sysmon E3', tone: 'accent' },
  suricata:      { label: 'Suricata', tone: 'accent' },
  unknown:       { label: 'Unbekannt', tone: 'muted' },
};

const REASON_LABEL: Record<string, string> = {
  source_provides_none: 'Quelle liefert dieses Feld nicht',
  field_missing:        'im Event nicht enthalten',
  inventory_not_loaded: 'kommt aus Host-Inventory (CE-4)',
  not_in_inventory:     'IP keinem Wazuh-Agent zugeordnet',
  threat_intel_pending: 'kommt aus Threat-Intel/DNS (CE-5)',
  no_match:             'kein Treffer',
};

const Dash = ({ title }: { title: string }) => (
  <span style={{ color: 'var(--text-dim)' }} title={title}>—</span>
);

const reasonOf = (mr: Record<string, string> | undefined, field: string) =>
  REASON_LABEL[mr?.[field] || ''] || 'nicht verfügbar';

// Eine kleine, beschriftete Zeile in einer Endpoint-/Firewall-Zelle. Fehlt der
// Wert, steht ein dezentes „—" mit Missing-Reason-Tooltip statt eines Fake-Werts.
function MetaLine({ label, value, missing, mono }: {
  label: string; value?: string | number | null; missing: string; mono?: boolean;
}) {
  return (
    <div style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'nowrap' }}>
      <span style={{ color: 'var(--text-dim)' }}>{label} </span>
      {value || value === 0
        ? <span style={mono ? { fontFamily: 'var(--font-mono)' } : undefined}>{value}</span>
        : <Dash title={missing} />}
    </div>
  );
}

// Host-Seite (Source/Destination): IP:Port + Host + FQDN + MAC + Host-Interface (CE-4).
function EndpointCell({ ip, port, host, fqdn, mac, hostInterface, mr, prefix }: {
  ip: string | null; port: number | null; host: string | null; fqdn: string | null; mac: string | null;
  hostInterface: string | null; mr: Record<string, string> | undefined; prefix: 'source' | 'destination';
}) {
  const cap = prefix === 'source' ? 'source' : 'destination';
  return (
    <td style={{ ...TD, verticalAlign: 'top' }}>
      <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{ip || '—'}{port ? `:${port}` : ''}</div>
      <MetaLine label="Host:" value={host} missing={reasonOf(mr, `${cap}Host`)} />
      <MetaLine label="FQDN:" value={fqdn} mono missing={reasonOf(mr, `${cap}Fqdn`)} />
      <MetaLine label="MAC:" value={mac} mono missing={reasonOf(mr, `${cap}Mac`)} />
      <MetaLine label="Host IF:" value={hostInterface} missing={reasonOf(mr, `${cap}HostInterface`)} />
    </td>
  );
}

export function NetworkFlowsTable({ network }: { network?: NetworkCorrelation | null }) {
  const flows = network?.flows ?? [];
  if (flows.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Keine korrelierten Netzwerk-Flows vorhanden. Quelle liefert derzeit keine NetworkConnect-/Firewall-Events
        oder die Sysmon-Event-3-Regel ist noch nicht aktiv.
      </div>
    );
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>{['Time', 'Source', 'Destination', 'Firewall', 'Process', 'Source Type'].map((h) => <th key={h} style={TH}>{h}</th>)}</tr></thead>
      <tbody>
        {flows.map((f) => {
          const st = SOURCE_BADGE[f.sourceType] || SOURCE_BADGE.unknown;
          return (
            <tr key={`${f.timestamp}-${f.sourceIp}:${f.sourcePort ?? ''}-${f.destinationIp}:${f.destinationPort ?? ''}`}>
              <td style={{ ...TD, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', color: 'var(--accent)', verticalAlign: 'top' }}>{fmtTs(f.timestamp)}</td>
              <EndpointCell prefix="source" ip={f.sourceIp} port={f.sourcePort} host={f.sourceHost} fqdn={f.sourceFqdn} mac={f.sourceMac} hostInterface={f.sourceHostInterface} mr={f.missingReason} />
              <EndpointCell prefix="destination" ip={f.destinationIp} port={f.destinationPort} host={f.destinationHost} fqdn={f.destinationFqdn} mac={f.destinationMac} hostInterface={f.destinationHostInterface} mr={f.missingReason} />
              <td style={{ ...TD, verticalAlign: 'top' }}>
                <div style={{ marginBottom: 3 }}>
                  {f.action ? <Badge tone={f.action === 'block' ? 'danger' : 'muted'}>{f.action}</Badge> : <Dash title={reasonOf(f.missingReason, 'action')} />}
                </div>
                <MetaLine label="FW IF:" value={f.firewallInterface ?? null} missing={reasonOf(f.missingReason, 'firewallInterface')} />
                <MetaLine label="Rule:" value={f.firewallRule} mono missing={reasonOf(f.missingReason, 'firewallRule')} />
                <MetaLine label="Proto:" value={(f.protocol || '').toUpperCase() || null} missing="nicht verfügbar" />
              </td>
              <td style={{ ...TD, verticalAlign: 'top' }}>
                <div style={{ fontFamily: 'var(--font-mono)' }}>{baseName(f.processImage) || <Dash title={reasonOf(f.missingReason, 'processImage')} />}</div>
                <MetaLine label="User:" value={f.user} missing="nicht von Quelle geliefert" />
              </td>
              <td style={{ ...TD, verticalAlign: 'top' }}><Badge tone={st.tone}>{st.label}</Badge></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Dezenter Info-Hinweis (keine Alarmfarbe), welche Felder warum fehlen.
export function NetworkGaps({ gaps }: { gaps?: NetworkGap[] }) {
  if (!gaps || gaps.length === 0) return null;
  return (
    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {gaps.map((g) => (
        <span key={`${g.field}|${g.missingReason}`} title={`${g.count}×`}
          style={{ fontSize: 11, color: 'var(--text-dim)', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '2px 7px' }}>
          {g.field}: {REASON_LABEL[g.missingReason] || g.missingReason}
        </span>
      ))}
    </div>
  );
}
