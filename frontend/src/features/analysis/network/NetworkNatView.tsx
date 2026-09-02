// Analysis → Network & NAT — Ermittlungsansicht im Mockup-Layout: Communication Map,
// Top Conversations, NAT Translation, Flow Statistics, Geolocation/Reputation, DNS.
// Quelle ausschließlich ParsedEvidence (ticketEvidence.ts) + korrelierte Timeline/Flows.
// Fehlt ein Feld (Geo/ASN/Reputation/Bytes/NAT), steht ehrlich „—"/„Nicht verfügbar".
// Threat Intel + Evidence Actions liegen in der rechten Rail (EnrichmentSidebar).
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import {
  Monitor, Globe, ArrowRight, ArrowLeft, ArrowLeftRight, Network, Activity, MapPin, Server, ListOrdered,
  Bug, Terminal, Download, Fingerprint, ChevronRight, ChevronDown,
} from 'lucide-react';
import { Card, Badge, type Tone } from '../../../components/ui';
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence, TicketTimeline, NetworkCorrelation, ExposureCorrelation } from '../analysisModel';
import { fmtBytes } from '../deckModel';
import { hostContext } from '../hostContext';
import {
  wellKnownService, externalIps, deriveConversations, deriveFlowStats, deriveNatTranslation, deriveGeo,
  deriveTrafficBreakdown,
} from './networkModel';
import { deriveHoneypotSessions, deriveExposureCorrelations, groupHoneypotSessionsByAttacker, type HoneypotSessionView, type HoneypotAttackerGroup } from './honeypotSessionsModel';
import { useTranslation } from 'react-i18next';

// ── geteilte Styles + Helfer ───────────────────────────────────────────────────
const headCss: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' };
const lblCss: CSSProperties = { fontSize: 9.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 };
const th: CSSProperties = { ...lblCss, fontWeight: 600, textAlign: 'left', padding: '0 8px 6px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' };
const tdCss: CSSProperties = { fontSize: 11.5, color: 'var(--text)', padding: '6px 8px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap', verticalAlign: 'middle' };

const repTone = (r?: string): Tone => {
  const x = (r || '').toLowerCase();
  return x === 'malicious' ? 'danger' : x === 'suspicious' ? 'warning' : x === 'clean' || x === 'harmless' ? 'success' : 'muted';
};
const fmtTs = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const fmtNum = (n?: number | null): string => (n == null ? '—' : n.toLocaleString('de-DE'));
const fmtBytesOr = (n: number | null): string => (n == null ? '—' : fmtBytes(n));
function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function Section({ title, icon, children, right }: { title: string; icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return <Card style={{ padding: 0, overflow: 'hidden' }}><div style={headCss}>{icon}<span style={{ flex: 1 }}>{title}</span>{right}</div><div style={{ padding: '14px 16px' }}>{children}</div></Card>;
}
function Stat({ label, value, mono }: { label: string; value?: ReactNode; mono?: boolean }) {
  const empty = value === undefined || value === null || value === '';
  return (
    <div style={{ minWidth: 0 }}>
      <div style={lblCss}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3, color: empty ? 'var(--text-dim)' : 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{empty ? '—' : value}</div>
    </div>
  );
}
function fmtTimeOnly(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function TrafficMetric({ label, bucket, tone = 'muted' }: { label: string; bucket: { events: number; bytes: number | null; firstSeen: string | null; lastSeen: string | null }; tone?: 'muted' | 'success' | 'danger' }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : 'var(--text)';
  return (
    <div style={{ minWidth: 0, border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '9px 10px', background: 'var(--bg-card-soft)' }}>
      <div style={lblCss}>{label}</div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 800, color, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtBytesOr(bucket.bytes)}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{fmtNum(bucket.events)} Events</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 7px', marginTop: 7, fontSize: 10.5, color: 'var(--text-dim)' }}>
        <span>First</span><span className="mono" style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmtTimeOnly(bucket.firstSeen)}</span>
        <span>Last</span><span className="mono" style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmtTimeOnly(bucket.lastSeen)}</span>
      </div>
    </div>
  );
}
function KV({ label, value, mono, valueNode }: { label: string; value?: string; mono?: boolean; valueNode?: ReactNode }) {
  const empty = !valueNode && (value === undefined || value === null || value === '');
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 12.5, borderBottom: '1px solid var(--border-soft)' }}>
      <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: empty ? 'var(--text-dim)' : 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : undefined, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{valueNode ?? (empty ? '—' : value)}</span>
    </div>
  );
}

// ── Communication Map ───────────────────────────────────────────────────────────
function Endpoint({ icon, label, main, lines, accent }: { icon: ReactNode; label: string; main?: string; lines?: (string | undefined)[]; accent: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center', minWidth: 130 }}>
      <div style={{ width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center', background: `color-mix(in srgb, ${accent} 14%, var(--bg-card))`, border: `2px solid ${accent}` }}>{icon}</div>
      <div style={{ ...lblCss, marginTop: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>{main || '—'}</div>
      {(lines ?? []).filter(Boolean).map((l) => <div key={l} style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</div>)}
    </div>
  );
}
function FlowArrows({ portLabel, eventsLabel }: { portLabel: string; eventsLabel: string }) {
  const line: CSSProperties = { flex: 1, height: 1, background: 'var(--border)' };
  return (
    <div style={{ minWidth: 170, flex: '1 1 170px', display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--text-dim)' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{portLabel}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={line} /><ArrowRight size={14} /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={14} /><span style={line} /></div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{eventsLabel}</div>
    </div>
  );
}

function CommunicationMap({ t, ev, tl, network }: { t: Ticket; ev: ParsedEvidence; tl: TicketTimeline | null; network?: NetworkCorrelation | null }) {
  const srcHost = ev.source.host;
  const srcIp = ev.source.ip || t.srcIp || undefined;
  const dstIp = ev.destination.ip || ev.nat.postNatDestinationIp || t.dstIp || undefined;
  const dstPort = ev.destination.port;
  const proto = (ev.network.protocol || ev.network.transport || '').toUpperCase() || undefined;
  const stats = deriveFlowStats(ev, tl, network);
  const traffic = deriveTrafficBreakdown(ev, tl, network);
  const ips = externalIps(t, ev, tl, network);
  const application = wellKnownService(dstPort) ?? ev.payload.type ?? undefined;
  const portLabel = `${dstPort ?? '—'}${proto ? ` / ${proto}` : ''}`;
  const eventsLabel = stats.totalEvents != null ? `${fmtNum(stats.totalEvents)} events` : 'Events: —';

  return (
    <Section title="Communication Map" icon={<Network size={15} style={{ color: 'var(--accent)' }} />}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, flexWrap: 'wrap' }}>
        <Endpoint icon={<Monitor size={20} style={{ color: 'var(--accent)' }} />} label="Source" main={srcHost || srcIp} lines={[srcHost ? srcIp : undefined, ev.source.user]} accent="var(--accent)" />
        <FlowArrows portLabel={portLabel} eventsLabel={eventsLabel} />
        <Endpoint icon={<Globe size={20} style={{ color: 'var(--danger)' }} />} label="Destination" main={dstIp} lines={[ev.destination.fqdn, ev.destination.country]} accent="var(--danger)" />
        {ips.length > 0 && (
          <div style={{ minWidth: 150, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 16, borderLeft: '1px solid var(--border-soft)' }}>
            <div style={lblCss}>External IPs</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {ips.map((ip) => <span key={ip} className="mono" style={{ fontSize: 11, color: 'var(--text)', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '2px 7px' }}>{ip}</span>)}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 14, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-soft)' }}>
        <TrafficMetric label="Traffic" bucket={traffic.total} />
        <TrafficMetric label="Denied Traffic" bucket={traffic.denied} tone="danger" />
        <TrafficMetric label="Permitted Traffic" bucket={traffic.permitted} tone="success" />
        <Stat label="Protocol" value={proto} />
        <Stat label="Application" value={application} />
        <Stat label="Direction" value={ev.network.direction} />
        <Stat label="Bytes (Sent / Received)" value={stats.bytesSent == null && stats.bytesReceived == null ? undefined : `${fmtBytesOr(stats.bytesSent)} / ${fmtBytesOr(stats.bytesReceived)}`} mono />
        <Stat label="Duration" value={stats.durationMs == null ? undefined : fmtDuration(stats.durationMs)} mono />
        <Stat label="Events" value={stats.totalEvents == null ? undefined : fmtNum(stats.totalEvents)} mono />
      </div>
    </Section>
  );
}

// ── Top Conversations ────────────────────────────────────────────────────────────
function TopConversations({ tl, network }: { tl: TicketTimeline | null; network?: NetworkCorrelation | null }) {
  const { t: tr } = useTranslation();
  const rows = deriveConversations(tl, network);
  return (
    <Section title="Top Conversations" icon={<ListOrdered size={15} style={{ color: 'var(--accent)' }} />} right={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{rows.length}</span>}>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{tr('analysis.noConnectionsTimeWindowSource')}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 360 }}>
            <thead><tr>
              <th style={th}>Destination IP</th><th style={th}>Port</th><th style={th}>Protocol</th>
              <th style={{ ...th, textAlign: 'right' }}>Events</th><th style={{ ...th, textAlign: 'right' }}>Bytes</th>
              <th style={{ ...th, textAlign: 'right' }}>First Seen</th><th style={{ ...th, textAlign: 'right' }}>Last Seen</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.destinationIp}:${r.destinationPort ?? ''}:${r.protocol ?? ''}`}>
                  <td style={{ ...tdCss, fontFamily: 'var(--font-mono)' }}>{r.destinationIp}</td>
                  <td style={{ ...tdCss, fontFamily: 'var(--font-mono)' }}>{r.destinationPort ?? '—'}</td>
                  <td style={tdCss}>{(r.protocol || '—').toUpperCase()}</td>
                  <td style={{ ...tdCss, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmtNum(r.events)}</td>
                  <td style={{ ...tdCss, textAlign: 'right', fontFamily: 'var(--font-mono)', color: r.bytes == null ? 'var(--text-dim)' : 'var(--text)' }}>{fmtBytesOr(r.bytes)}</td>
                  <td style={{ ...tdCss, textAlign: 'right', color: 'var(--text-muted)' }}>{fmtTs(r.firstSeen)}</td>
                  <td style={{ ...tdCss, textAlign: 'right', color: 'var(--text-muted)' }}>{fmtTs(r.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ── NAT Translation ──────────────────────────────────────────────────────────────
function NatTranslation({ t, ev, network }: { t: Ticket; ev: ParsedEvidence; network?: NetworkCorrelation | null }) {
  const { t: tr } = useTranslation();
  const rows = deriveNatTranslation(t, ev, network);
  return (
    <Section title="NAT Translation" icon={<ArrowLeftRight size={15} style={{ color: 'var(--warning)' }} />}>
      {rows.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card-soft)' }}>
          <ArrowLeftRight size={17} style={{ color: 'var(--text-dim)', marginTop: 1, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>No confirmed NAT translation</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5, marginTop: 3 }}>The observed source and destination values pass through unchanged. No address or port mapping is shown for this case.</div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '0 10px', alignItems: 'center' }}>
            <div style={{ ...lblCss, gridColumn: 2 }} />
            <div />
            <div style={lblCss}>Pre-NAT (Internal)</div>
            <div />
            <div style={{ ...lblCss, textAlign: 'right' }}>Post-NAT (External)</div>
            {rows.map((r) => {
              const changed = (r.pre ?? '') !== (r.post ?? '');
              return (
                <div key={r.label} style={{ display: 'contents' }}>
                  <div style={{ gridColumn: '1 / -1', height: 1, background: 'var(--border-soft)' }} />
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{r.label}</span>
                  <span className="mono" style={{ fontSize: 12.5, color: 'var(--text)', textAlign: 'right' }}>{r.pre ?? '—'}</span>
                  <ArrowRight size={13} style={{ color: 'var(--text-dim)', justifySelf: 'center' }} />
                  <span className="mono" style={{ fontSize: 12.5, color: changed ? 'var(--warning)' : 'var(--text)', fontWeight: changed ? 700 : 400, textAlign: 'right' }}>{r.post ?? '—'}</span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 10 }}>{tr('analysis.unchangedFieldsShownPassthroughPre')}</div>
        </>
      )}
    </Section>
  );
}

// ── Flow Statistics ────────────────────────────────────────────────────────────
function FlowStatistics({ ev, tl, network }: { ev: ParsedEvidence; tl: TicketTimeline | null; network?: NetworkCorrelation | null }) {
  const s = deriveFlowStats(ev, tl, network);
  return (
    <Section title="Flow Statistics" icon={<Activity size={15} style={{ color: 'var(--accent)' }} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 14 }}>
        <Stat label="Total Events" value={s.totalEvents == null ? undefined : fmtNum(s.totalEvents)} mono />
        <Stat label="Bytes Sent" value={s.bytesSent == null ? undefined : fmtBytes(s.bytesSent)} mono />
        <Stat label="Bytes Received" value={s.bytesReceived == null ? undefined : fmtBytes(s.bytesReceived)} mono />
        <Stat label="Packets" value={s.packets == null ? undefined : fmtNum(s.packets)} mono />
        <Stat label="Duration" value={s.durationMs == null ? undefined : fmtDuration(s.durationMs)} mono />
      </div>
    </Section>
  );
}

// ── Geolocation / Reputation ─────────────────────────────────────────────────────
function Geolocation({ ev, network }: { ev: ParsedEvidence; network?: NetworkCorrelation | null }) {
  const { t: tr } = useTranslation();
  const geo = deriveGeo(ev, network);
  return (
    <Section title="Geolocation / Reputation" icon={<MapPin size={15} style={{ color: 'var(--accent)' }} />}>
      {!geo.hasAny ? (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{tr('analysis.notAvailableNoPublicIp')}</div>
      ) : (
        <>
          <KV label={geo.ipLabel} value={geo.ip} mono />
          <KV label="Country" value={geo.country} />
          <KV label="ISP / Organization" value={geo.organization} />
          <KV label="Usage Type" value={geo.usageType} />
          <KV label="Abuse-Reports" value={geo.reports == null ? undefined : String(geo.reports)} mono />
          <KV label="Reputation" valueNode={geo.reputation ? <Badge tone={repTone(geo.reputation)}>{geo.reputation}</Badge> : undefined} />
          <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 8 }}>
            {geo.source === 'provider' || geo.source === 'cache' ? tr('analysis.sourceVtAbuse') + ' ' : ''}Reputation = Kontext, keine automatische Ticket-Entscheidung.
          </div>
        </>
      )}
    </Section>
  );
}

// ── DNS Information ──────────────────────────────────────────────────────────────
function DnsInformation({ ev }: { ev: ParsedEvidence }) {
  const domain = ev.dns?.query || ev.destination.fqdn || ev.payload.hostHeader || undefined;
  const resolved = ev.dns?.answers || undefined;
  const status = ev.dns?.status || undefined;
  if (!domain && !resolved) return null;
  return (
    <Section title="DNS Information" icon={<Server size={15} style={{ color: 'var(--accent)' }} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 24px' }}>
        <KV label="Queried Domain" value={domain} mono />
        <KV label="Resolved IPs" value={resolved} mono />
        <KV label="Status" value={status} />
        <KV label="SNI / HTTP Host" value={ev.destination.sni || ev.destination.httpHost} mono />
      </div>
    </Section>
  );
}

// ── Honeypot Sessions (Cowrie) — eigene Sektion, klar getrennt von network.flows ──
const chipCss: CSSProperties = { fontSize: 11, color: 'var(--text)', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '2px 7px', fontFamily: 'var(--font-mono)' };
const codeCss: CSSProperties = { fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text)', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '1px 6px', overflowWrap: 'anywhere' };

function HoneypotSessionCard({ s }: { s: HoneypotSessionView }) {
  const { t: tr } = useTranslation();
  const authBadge = s.authSuccess === true
    ? <Badge tone="danger">Login erfolgreich</Badge>
    : s.authSuccess === false ? <Badge tone="warning">{tr('text.failedAttemptsOnly')}</Badge>
      : <Badge tone="muted">{tr('misc.noSignIns')}</Badge>;
  return (
    <div style={{ border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', background: 'var(--bg-card-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={lblCss}>Remote Source / Angreifer-IP</div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--danger)' }}>{s.attackerIp ?? '—'}{s.attackerPort != null ? `:${s.attackerPort}` : ''}</div>
        </div>
        {authBadge}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0 18px' }}>
        <KV label={tr('analysis.honeypotTarget')} value={s.honeypotIp ? `${s.honeypotIp}${s.port != null ? `:${s.port}` : ''}` : undefined} mono />
        <KV label="Service" value={s.service ?? undefined} />
        <KV label="Session-ID" value={s.sessionId} mono />
        <KV label="Start" value={fmtTs(s.firstSeen)} />
        <KV label="Ende" value={fmtTs(s.lastSeen)} />
        <KV label="Dauer" value={s.durationMs == null ? undefined : fmtDuration(s.durationMs)} />
        <KV label="Login-Versuche" value={`${s.loginAttempts} (${s.loginSucceeded} ✓ / ${s.loginFailed} ✗)`} />
        <KV label={tr('analysis.passwordObserved')} value={s.passwordObserved ? `ja (${s.passwordAttempts})` : 'nein'} />
      </div>

      {!s.honeypotIp && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>{tr('analysis.sessionBasedConnection')}</div>
      )}

      {s.usernames.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={lblCss}>Beobachtete Usernamen{s.usernamesTruncated ? ' ' + tr('misc.truncated') : ''}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
            {s.usernames.map((u) => <span key={u} style={chipCss}>{u}</span>)}
          </div>
        </div>
      )}

      {s.commands.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...lblCss, display: 'flex', alignItems: 'center', gap: 6 }}><Terminal size={12} /> Commands</div>
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {s.commands.map((c) => (
              <div key={`${c.timestamp}-${c.command}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtTs(c.timestamp)}</span>
                <code style={codeCss}>{c.command}{c.truncated ? ' …' : ''}</code>
              </div>
            ))}
          </div>
          {s.moreCommands > 0 && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 5 }}>+ {s.moreCommands} weitere Commands (begrenzt geladen)</div>}
        </div>
      )}

      {s.downloads.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...lblCss, display: 'flex', alignItems: 'center', gap: 6 }}><Download size={12} /> Downloads</div>
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {s.downloads.map((d) => (
              <div key={`${d.url || d.filename}-${d.hash ?? ''}`} className="mono" style={{ fontSize: 11, color: 'var(--text)', overflowWrap: 'anywhere' }}>
                {d.url || d.filename || '—'}{d.hash ? <span style={{ color: 'var(--text-muted)' }}> · {d.hash}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {s.fingerprint && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...lblCss, display: 'flex', alignItems: 'center', gap: 6 }}><Fingerprint size={12} /> Client-Fingerprint</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text)', marginTop: 3 }}>
            {[s.fingerprint.version, s.fingerprint.hassh ? `HASSH ${s.fingerprint.hassh}` : undefined].filter(Boolean).join(' · ')}
          </div>
        </div>
      )}

      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border-soft)', fontSize: 11.5 }}>
        {s.hasRelatedFlow
          ? <span style={{ color: 'var(--accent)' }}>✓ Zugehöriger Netzwerkflow vorhanden — siehe „Top Conversations" / „Communication Map" (Session {s.relatedFlowSessionId}).</span>
          : <span style={{ color: 'var(--text-dim)' }}>{tr('analysis.noMatchingNetworkFlowTime')}</span>}
      </div>
    </div>
  );
}

function verdictTone(v?: string): Tone {
  return v === 'malicious' ? 'danger' : v === 'suspicious' ? 'warning' : 'muted';
}

// Angreifer-Gruppe: kompakte, klickbare Kopfzeile (IP + Geo/Verdict + Zähler) mit
// Username-/Command-Zusammenfassung; Einzel-Sessions erst auf Klick (eingeklappt).
function HoneypotAttackerGroupCard({ g }: { g: HoneypotAttackerGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card-soft)' }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flexWrap: 'wrap' }}>
        {open ? <ChevronDown size={15} style={{ flexShrink: 0 }} /> : <ChevronRight size={15} style={{ flexShrink: 0 }} />}
        <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--danger)' }}>{g.attackerIp}</span>
        {g.geo?.country && <Badge tone="muted">{g.geo.country}</Badge>}
        {g.geo?.verdict && <Badge tone={verdictTone(g.geo.verdict)}>{g.geo.verdict}{g.geo.score != null ? ` (${g.geo.score})` : ''}</Badge>}
        {g.geo?.asnOwner && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{g.geo.asnOwner}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Badge tone="muted">{g.sessionCount} Sessions</Badge>
          {g.loginSucceeded > 0 && <Badge tone="danger">{g.loginSucceeded} Logins ✓</Badge>}
          {g.downloads > 0 && <Badge tone="warning">{g.downloads} Downloads</Badge>}
        </span>
      </button>
      <div style={{ padding: '0 12px 10px 37px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {g.usernames.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
            <span style={lblCss}>User</span>
            {g.usernames.map((u) => <span key={u} style={chipCss}>{u}</span>)}
          </div>
        )}
        {g.commandSamples.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
            <span style={lblCss}>Cmd</span>
            {g.commandSamples.map((c) => <code key={c} style={codeCss}>{c}</code>)}
          </div>
        )}
      </div>
      {open && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {g.sessions.map((s) => <HoneypotSessionCard key={s.sessionId} s={s} />)}
        </div>
      )}
    </div>
  );
}

export function HoneypotSessions({ network }: { network?: NetworkCorrelation | null }) {
  const { t: tr } = useTranslation();
  const sessions = deriveHoneypotSessions(network);
  const groups = groupHoneypotSessionsByAttacker(sessions, network?.threatIntel);
  return (
    <Section title="Honeypot Sessions" icon={<Bug size={15} style={{ color: 'var(--danger)' }} />}
      right={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{groups.length} Angreifer · {sessions.length} Sessions</span>}>
      {groups.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{tr('analysis.noHoneypotSessionsFoundTicket')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map((g) => <HoneypotAttackerGroupCard key={g.attackerIp} g={g} />)}
        </div>
      )}
    </Section>
  );
}

// ── Correlated Exposure Path (ADR-034) — korreliert, KEINE NAT-Behauptung ─────────
const expConfTone = (c: string): Tone => (c === 'high' ? 'danger' : c === 'medium' ? 'warning' : 'muted');

function ExposureRow({ r }: { r: ExposureCorrelation }) {
  const { t: tr } = useTranslation();
  const dst = r.firewallDestinationIp ? `${r.firewallDestinationIp}${r.firewallDestinationPort != null ? `:${r.firewallDestinationPort}` : ''}` : null;
  return (
    <div style={{ border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'var(--bg-card-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div className="mono" style={{ fontSize: 12.5, color: 'var(--text)' }}>
          <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{r.remoteSourceIp}</span>{' → '}
          {dst
            ? <>{dst}{r.firewallProtocol ? ` / ${r.firewallProtocol.toUpperCase()}` : ''}{r.firewallAction ? ` · ${r.firewallAction}` : ''}</>
            : <span style={{ color: 'var(--text-dim)' }}>{tr('analysis.severalPossibleConnectionsNotConclusive')}</span>}
        </div>
        <Badge tone={expConfTone(r.confidence)}>{r.confidence}</Badge>
      </div>
      {r.firewallTimestamp && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>Firewall-Event: {fmtTs(r.firewallTimestamp)}</div>}
      {r.confidence === 'none' && <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 4 }}>Mehrdeutig — keine eindeutige Firewall-Verbindung ({r.missingReason}).</div>}
    </div>
  );
}

export function ExposureCorrelations({ network }: { network?: NetworkCorrelation | null }) {
  const { t: tr } = useTranslation();
  const rows = deriveExposureCorrelations(network);
  if (rows.length === 0) return null; // kein Kandidat → keine künstliche Kette (ADR-034)
  return (
    <Section title="Correlated Exposure Path" icon={<ArrowLeftRight size={15} style={{ color: 'var(--warning)' }} />} right={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{rows.length}</span>}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.5 }}>{tr('analysis.correlatedFirewallHoneypot')}<strong style={{ color: 'var(--text-muted)' }}>{tr('analysis.noConfirmedNatTranslation')}</strong>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => <ExposureRow key={r.sessionId} r={r} />)}
      </div>
    </Section>
  );
}

// ── Host / Endpoint Band (W2) ─────────────────────────────────────────────────────
// Prominenter Host-Kontext im Network/NAT-Tab: auf welchem Endpoint läuft der Vorfall.
// Nur echte Werte (Hostname/Agent/IP/User); fehlt der Host-Bezug, wird die Band ausgeblendet.
function HostBand({ t, ev }: { t: Ticket; ev: ParsedEvidence }) {
  const host = hostContext(t, ev);
  if (!host.hasAny) return null;
  return (
    <Card style={{ padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <Monitor size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <span style={lblCss}>Host / Endpoint</span>
      <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{host.hostname ?? host.ip ?? '—'}</span>
      {host.ip && host.hostname && <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{host.ip}</span>}
      {host.user && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {host.user}</span>}
      {host.agentName && <Badge tone="muted">Agent {host.agentName}</Badge>}
      {host.agentId && <Badge tone="muted">ID {host.agentId}</Badge>}
    </Card>
  );
}

// ── Haupt-View ───────────────────────────────────────────────────────────────────
export function NetworkNatView({ t, ev, tl, network }: {
  t: Ticket; ev: ParsedEvidence; tl: TicketTimeline | null; network?: NetworkCorrelation | null;
}) {
  const { t: tr } = useTranslation();
  const twoCol: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, alignItems: 'start' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <HostBand t={t} ev={ev} />
      <CommunicationMap t={t} ev={ev} tl={tl} network={network} />
      <div style={twoCol}>
        <TopConversations tl={tl} network={network} />
        <NatTranslation t={t} ev={ev} network={network} />
      </div>
      <HoneypotSessions network={network} />
      <ExposureCorrelations network={network} />
      <div style={twoCol}>
        <FlowStatistics ev={ev} tl={tl} network={network} />
        <Geolocation ev={ev} network={network} />
      </div>
      <DnsInformation ev={ev} />
      <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{tr('analysis.natSourceNote')}</div>
    </div>
  );
}
