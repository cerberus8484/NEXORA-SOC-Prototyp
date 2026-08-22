// Overview — wichtigste Korrelationen auf einen Blick:
// Top Conversations · Communication Map · Event Timeline Preview · Payload Preview · Commands Executed.
import { useState } from 'react';
import { ArrowRight, Clock, FileCode, Globe, Monitor, Network, Terminal, Cloud } from 'lucide-react';
import { Badge, Button, type Tone } from '../../../components/ui';
import type { Ticket } from '../../../lib/types';
import type { CorrelationStatusInfo, NetworkCorrelation, ParsedEvidence, TicketTimeline } from '../analysisModel';
import { topConversations, decodeEncodedCommand, fmtBytes, parseHashes } from '../deckModel';
import { deriveCorrProvenance } from '../correlationStatusView';
import { DeckCard, KV, TH, TD, LABEL, Hint } from './deckUi';
import type { DeckSection } from './AnalysisSubNav';

const actTone = (a?: string): Tone => a === 'block' || a === 'drop' || a === 'reject' ? 'danger' : a === 'pass' || a === 'allow' ? 'success' : 'muted';
const fmtTs = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('de-DE') : '—');

function EndpointBox({ icon, title, lines }: { icon: React.ReactNode; title: string; lines: (string | undefined)[] }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--accent)', marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</div>
      {lines.filter(Boolean).map((l, i) => (
        <div key={l} className="mono" style={{ fontSize: 11, color: i === 0 ? 'var(--text)' : 'var(--text-muted)', marginTop: 3, overflowWrap: 'anywhere' }}>{l}</div>
      ))}
      {lines.filter(Boolean).length === 0 && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>—</div>}
    </div>
  );
}

export function OverviewSection({ t, ev, tl, network, tlLoading, onOpenSection, correlationStatus }: {
  t: Ticket; ev: ParsedEvidence; tl: TicketTimeline | null; network?: NetworkCorrelation | null; tlLoading: boolean;
  onOpenSection: (s: DeckSection) => void;
  correlationStatus?: CorrelationStatusInfo;
}) {
  const [payloadTab, setPayloadTab] = useState<'normalized' | 'parsed' | 'raw'>('normalized');
  // CE-3: korrelierte Flows (Firewall + Sysmon Event 3) bevorzugen, sonst Timeline-Ableitung.
  const netConvs = network?.topConversations ?? [];
  const conversations = netConvs.length > 0
    ? netConvs.map((c) => ({ srcIp: c.sourceIp || '—', dstIp: c.destinationIp || '—', protocol: c.protocol || '?', srcPort: undefined, dstPort: c.destinationPort ?? undefined, action: undefined as string | undefined, count: c.count }))
    : topConversations(tl, 5);
  const decoded = decodeEncodedCommand(ev.process?.commandLine);
  const totalBytes = (ev.network.bytesSent ?? 0) + (ev.network.bytesReceived ?? 0);
  const proto = ev.network.protocol || ev.network.transport || '';
  const hashes = [...parseHashes(ev.process?.hashes), ...parseHashes(ev.file?.hashes)];
  const previewEvents = tl?.events.slice(0, 6) ?? [];
  // P_CORR_1c.4: einzige Quelle für Korrelations-Provenance ist correlationStatus.result.
  // ev.correlation (alter Sync-Engine-Output) wird hier nicht mehr genutzt.
  const corrRender = deriveCorrProvenance(correlationStatus);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      {/* Provenance — ausschließlich aus correlationStatus.result (P_CORR_1c.4) */}
      {corrRender.kind === 'meta' && corrRender.meta.eventCount > 1 && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '8px 12px', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' }}>
          <Network size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Korreliert aus <strong style={{ color: 'var(--text)' }}>{corrRender.meta.eventCount} Events</strong> · Quellen:
          </span>
          {corrRender.meta.sources.map((s) => <Badge key={s.source} tone="accent">{s.source} ×{s.count}</Badge>)}
          {corrRender.stale && corrRender.staleAt && (
            <span style={{ fontSize: 11, color: 'var(--warning)', marginLeft: 4 }}>
              — Letzter Stand: {fmtTs(corrRender.staleAt)}
            </span>
          )}
        </div>
      )}
      {corrRender.kind === 'loading' && (
        <div style={{ gridColumn: '1 / -1', padding: '8px 12px', background: 'var(--bg-input)',
          border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)',
          fontSize: 12, color: 'var(--text-dim)' }}>
          Korrelation wird berechnet – Ergebnis steht in Kürze bereit.
        </div>
      )}
      {corrRender.kind === 'failed_no_result' && (
        <div style={{ gridColumn: '1 / -1', padding: '8px 12px', background: 'var(--bg-input)',
          border: '1px solid var(--danger, #ef4444)', borderRadius: 'var(--radius-sm)',
          fontSize: 12, color: 'var(--danger, #ef4444)' }}>
          Korrelationsberechnung fehlgeschlagen – kein gespeichertes Ergebnis vorhanden.
        </div>
      )}
      {corrRender.kind === 'superseded' && (
        <div style={{ gridColumn: '1 / -1', padding: '8px 12px', background: 'var(--bg-input)',
          border: '1px solid var(--warning, #f59e0b)', borderRadius: 'var(--radius-sm)',
          fontSize: 12, color: 'var(--warning, #f59e0b)' }}>
          Ticketdaten haben sich geändert – Korrelationsresultat wird neu berechnet.
        </div>
      )}
      {corrRender.kind === 'unavailable' && (
        <div style={{ gridColumn: '1 / -1', padding: '8px 12px', background: 'var(--bg-input)',
          border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)',
          fontSize: 12, color: 'var(--text-dim)' }}>
          Korrelationsstatus vorübergehend nicht verfügbar.
        </div>
      )}

      {/* Windows Event (win.system) — Inhalte von EventChannel-Events (z. B. WMI-Activity),
          die nicht in eventdata stehen. Sonst wirkt das Deck für solche Events leer. */}
      {ev.windowsEvent && (
        <DeckCard title="Windows Event" icon={<Monitor size={15} style={{ color: 'var(--accent)' }} />} style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
            <div>
              <KV label="Provider" value={ev.windowsEvent.provider} />
              <KV label="Event ID" value={ev.windowsEvent.eventId} mono />
              <KV label="Channel" value={ev.windowsEvent.channel} mono />
            </div>
            <div>
              <KV label="Computer" value={ev.windowsEvent.computer || ev.source.host} />
              <KV label="MITRE" value={[ev.metadata.mitreTactic, ev.metadata.mitreTechnique].filter(Boolean).join(' · ') || undefined} />
              <KV label="Event" value={ev.detection.ruleName} />
            </div>
          </div>
          {ev.windowsEvent.message && (
            <pre style={{ margin: '8px 0 0', maxHeight: 220, overflow: 'auto', background: 'var(--bg-terminal)',
              borderRadius: 'var(--radius-sm)', padding: 10, fontSize: 11, color: 'var(--text-muted)',
              whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>{ev.windowsEvent.message}</pre>
          )}
          <Hint>Quelle: Windows-Event-Channel ({ev.windowsEvent.channel || 'EventLog'}). Dieses Event trägt seine Daten in <code>win.system</code> statt in <code>eventdata</code>.</Hint>
        </DeckCard>
      )}
      {/* A) Top Conversations */}
      <DeckCard title="Top Conversations" icon={<Network size={15} style={{ color: 'var(--accent)' }} />}
        action={<Button variant="ghost" size="sm" onClick={() => onOpenSection('network')}>Alle Flows</Button>}>
        {tlLoading ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Timeline wird geladen …</div>
          : conversations.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine korrelierten Netzwerk-Flows vorhanden. Quelle liefert derzeit keine passenden Events oder die Sysmon-Event-3-Regel ist noch nicht aktiv.</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Source IP', 'Destination IP', 'Proto', 'DPort', 'Action', 'Events'].map((h) => <th key={h} style={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {conversations.map((c) => (
                  <tr key={`${c.srcIp}-${c.dstIp}-${c.protocol}`}>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{c.srcIp}</td>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{c.dstIp}</td>
                    <td style={TD}><Badge tone="muted">{c.protocol.toUpperCase()}</Badge></td>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{c.dstPort ?? '—'}</td>
                    <td style={TD}><Badge tone={actTone(c.action)}>{c.action || '—'}</Badge></td>
                    <td style={{ ...TD, fontWeight: 700 }}>{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        <Hint>Gruppiert aus der Offense-Timeline (Wazuh-Indexer). Byte-Zahlen pro Flow liefert die Quelle nicht — Events-Spalte zeigt die Häufigkeit.</Hint>
      </DeckCard>

      {/* B) Communication Map */}
      <DeckCard title="Communication Map" icon={<Globe size={15} style={{ color: 'var(--accent)' }} />}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <EndpointBox icon={<Monitor size={20} />} title="Source"
            lines={[ev.source.host, ev.source.ip || t.srcIp, ev.source.user, ev.source.macAddress]} />
          <div style={{ textAlign: 'center', flexShrink: 0, minWidth: 90 }}>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 700 }}>
              {proto ? proto.toUpperCase() : '—'}{ev.destination.port ? `/${ev.destination.port}` : ''}
            </div>
            <ArrowRight size={18} style={{ color: 'var(--accent)' }} />
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
              {tl ? `${tl.count} Events` : '—'}{totalBytes > 0 ? ` · ${fmtBytes(totalBytes)}` : ''}
            </div>
          </div>
          <EndpointBox icon={<Cloud size={20} />} title="Destination"
            lines={[ev.destination.ip || t.dstIp, ev.destination.fqdn, ev.destination.organization, ev.destination.country]} />
        </div>
        {(ev.nat.originalSourceIp || ev.nat.postNatSourceIp) && (
          <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {([['Pre-NAT Source', ev.nat.originalSourceIp], ['Post-NAT Source', ev.nat.postNatSourceIp],
              ['Pre-NAT Port', ev.nat.originalSourcePort], ['Post-NAT Port', ev.nat.postNatSourcePort]] as const).map(([l, v]) => (
              <div key={l}>
                <div style={LABEL}>{l}</div>
                <div className="mono" style={{ fontSize: 11.5, color: 'var(--text)', marginTop: 2 }}>{v ?? '—'}</div>
              </div>
            ))}
          </div>
        )}
        <Hint>Quelle: normalisierte Evidence{ev.nat.postNatSourceIp ? ' · NAT-Translation erkannt' : ''}. Details unter „Network &amp; NAT".</Hint>
      </DeckCard>

      {/* C) Event Timeline Preview */}
      <DeckCard title="Event Timeline" icon={<Clock size={15} style={{ color: 'var(--purple)' }} />}
        action={<Button variant="ghost" size="sm" onClick={() => onOpenSection('timeline')}>Alle Events</Button>}>
        {tlLoading ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Timeline wird geladen …</div>
          : previewEvents.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine Timeline-Events im Zeitfenster.</div>
          : previewEvents.map((e) => (
            <div key={`${e.time}-${e.srcIp}-${e.dstIp}-${e.action}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border-soft)' }}>
              <span className="mono" style={{ color: 'var(--accent)', fontSize: 11, width: 118, flexShrink: 0 }}>{fmtTs(e.time)}</span>
              <Badge tone={actTone(e.action)}>{e.action || '—'}</Badge>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                {e.srcIp} → {e.dstIp}{e.dstPort ? `:${e.dstPort}` : ''}
              </span>
            </div>
          ))}
        {tl && tl.count > previewEvents.length && <Hint>{previewEvents.length} von {tl.count} Events — vollständig unter „Timeline".</Hint>}
      </DeckCard>

      {/* D) Payload Preview */}
      <DeckCard title="Payload Preview" icon={<FileCode size={15} style={{ color: 'var(--warning)' }} />}
        action={<Button variant="ghost" size="sm" onClick={() => onOpenSection('payloads')}>Payload-Details</Button>}>
        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-soft)', marginBottom: 8 }}>
          {([['normalized', 'Normalized'], ['parsed', 'Parsed'], ['raw', 'Raw']] as const).map(([id, lbl]) => (
            <button key={id} onClick={() => setPayloadTab(id)} style={{
              padding: '5px 10px', fontSize: 11.5, fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer',
              borderBottom: payloadTab === id ? '2px solid var(--accent)' : '2px solid transparent',
              color: payloadTab === id ? 'var(--accent)' : 'var(--text-muted)',
            }}>{lbl}</button>
          ))}
        </div>
        {payloadTab === 'normalized' && (
          <>
            <KV label="Source IP" value={ev.source.ip || t.srcIp} mono />
            <KV label="Source Port" value={ev.source.port} mono />
            <KV label="Destination IP" value={ev.destination.ip || t.dstIp} mono />
            <KV label="Destination Port" value={ev.destination.port} mono />
            <KV label="Protocol" value={proto ? proto.toUpperCase() : undefined} />
            <KV label="User" value={ev.source.user} />
            <KV label="Log Source" value={ev.metadata.logSource || ev.detection.sourceSystem} />
            <KV label="Event" value={ev.detection.ruleName} />
          </>
        )}
        {payloadTab === 'parsed' && (
          <>
            <KV label="Method" value={ev.payload.method} />
            <KV label="URL" value={ev.payload.url} mono />
            <KV label="Host Header" value={ev.payload.hostHeader} mono />
            <KV label="User-Agent" value={ev.payload.userAgent} mono />
            <KV label="SNI" value={ev.destination.sni} mono />
            <KV label="DNS Query" value={ev.dns?.query} mono />
          </>
        )}
        {payloadTab === 'raw' && (
          ev.raw || ev.payload.preview
            ? <pre style={{ margin: 0, maxHeight: 160, overflow: 'auto', background: 'var(--bg-terminal)', borderRadius: 'var(--radius-sm)', padding: 8, fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>
                {ev.payload.preview || JSON.stringify(ev.raw, null, 2)}
              </pre>
            : <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Kein Raw-Payload vorhanden.</div>
        )}
      </DeckCard>

      {/* E) Commands Executed */}
      <DeckCard title="Commands Executed" icon={<Terminal size={15} style={{ color: 'var(--success)' }} />} style={{ gridColumn: '1 / -1' }}
        action={<Button variant="ghost" size="sm" onClick={() => onOpenSection('commands')}>Command-Details</Button>}>
        {!ev.process?.image && !ev.process?.commandLine ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine Prozess-Evidence vorhanden (Sysmon Event 1 / Security 4688 fehlt am Ticket).</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
            <div>
              <KV label="Host" value={ev.source.host} />
              <KV label="User" value={ev.process?.user || ev.source.user} />
              <KV label="Process" value={ev.process?.image} mono />
              <KV label="Parent Process" value={ev.process?.parentImage} mono />
            </div>
            <div>
              <KV label="Command Line" value={ev.process?.commandLine} mono />
              <KV label="Decoded Command" value={decoded || undefined} mono />
              <KV label="Hash" value={hashes[0] ? `${hashes[0].algo}: ${hashes[0].value}` : undefined} mono />
              <KV label="Event Source" value={ev.metadata.logSource || ev.detection.sourceSystem} />
            </div>
          </div>
        )}
      </DeckCard>
    </div>
  );
}
