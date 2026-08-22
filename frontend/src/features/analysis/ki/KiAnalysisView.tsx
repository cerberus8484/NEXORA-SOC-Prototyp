// Analysis → KI Analyse — operative Ansicht im Mockup-Layout: KI-Abfragen-Raster (9 Analysen),
// Ergebnis-Karten (AI Verdict / Evidence-backed Reasoning / Confidence & Recommendation),
// Extracted IOCs & Entities, Traceability, Analyst-Approval-Bar. Nutzt ausschließlich die echten
// Endpunkte (agentApi). KI-Ausgabe ist klar als NICHT bestätigte Evidence markiert; Approval bleibt
// Human-in-the-loop (kein Auto-Exec). KEINE erfundenen KI-Ergebnisse.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Bot, ShieldCheck, Lightbulb, Crosshair, FileText, MessageSquare, Search, Boxes, ArrowRight,
  Activity, Gavel, AlertCircle, Loader2, CheckCircle2, XCircle, Sparkles, Globe, Info, type LucideIcon,
} from 'lucide-react';
import { Card, Badge, Button, Spinner, type Tone } from '../../../components/ui';
import { agentApi, type AgentSuggestion, type AgentAnalysis } from '../../aiAgent/agentApi';
import { parseHashes } from '../deckModel';
import type { ParsedEvidence, TicketTimeline } from '../analysisModel';
import { KI_QUERIES, buildKiIocRows, kiIocTabs, type KiIocRow } from './kiModel';
import { buildKiHistoryModel } from './kiHistoryModel';
import { buildKiNoteText } from './kiNote';

const head: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' };
const lbl: CSSProperties = { fontSize: 9.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 };
const th: CSSProperties = { ...lbl, fontWeight: 600, textAlign: 'left', padding: '0 8px 6px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' };
const tdc: CSSProperties = { fontSize: 11.5, color: 'var(--text)', padding: '6px 8px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' };

const fmtDate = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const verdictTone = (v?: string): Tone => { const x = (v || '').toLowerCase(); return x.includes('malicious') || x.includes('confirmed') || x.includes('true_positive') ? 'danger' : x.includes('suspicious') ? 'warning' : x.includes('false_positive') || x.includes('benign') ? 'success' : 'muted'; };
const confColor = (v?: string): string => { const x = (v || '').toLowerCase(); if (/high|malicious/.test(x)) return 'var(--danger)'; if (/med|suspicious/.test(x)) return 'var(--warning)'; if (/low|clean|benign/.test(x)) return 'var(--success)'; return 'var(--text-dim)'; };
const sevScore = (s?: string): number | null => { const x = (s || '').toLowerCase(); if (!x) return null; if (x.includes('crit')) return 10; if (x.includes('high')) return 8; if (x.includes('med')) return 5; if (x.includes('low')) return 2; if (x.includes('info')) return 1; return null; };
const repTone = (r?: string): Tone => { const x = (r || '').toLowerCase(); return x === 'malicious' ? 'danger' : x === 'suspicious' ? 'warning' : x === 'clean' || x === 'harmless' ? 'success' : 'muted'; };

const QUERY_ICON: Record<string, LucideIcon> = {
  triage: FileText, false_positive_review: ShieldCheck, incident_recommendation: Lightbulb,
  hunt_suggestion: Crosshair, report_draft: FileText, customer_response: MessageSquare,
  evidence_explanation: Search, mitre_mapping: Boxes, next_steps: ArrowRight,
};

function Section({ title, icon, children, right }: { title: string; icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return <Card style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}><div style={head}>{icon}<span style={{ flex: 1 }}>{title}</span>{right}</div><div style={{ padding: '12px 14px', flex: 1, minWidth: 0 }}>{children}</div></Card>;
}
function KV({ label, value, valueNode, mono }: { label: string; value?: string; valueNode?: ReactNode; mono?: boolean }) {
  const empty = !valueNode && (value === undefined || value === null || value === '');
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 12, borderBottom: '1px solid var(--border-soft)' }}>
      <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: empty ? 'var(--text-dim)' : 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : undefined, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{valueNode ?? (empty ? '—' : value)}</span>
    </div>
  );
}
function RiskBar({ label, value }: { label: string; value: number | null }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(10, value)) * 10;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <span style={{ fontSize: 10.5, color: 'var(--text-dim)', width: 92, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, height: 5, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden' }}><span style={{ display: 'block', width: `${pct}%`, height: '100%', background: pct >= 70 ? 'var(--danger)' : pct >= 40 ? 'var(--warning)' : 'var(--accent)' }} /></span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text)', width: 30, textAlign: 'right' }}>{value == null ? '—' : `${value}/10`}</span>
    </div>
  );
}
function KiDisclaimer() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--warning)', background: 'var(--warning-soft)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', padding: '7px 10px' }}>
      <Sparkles size={14} style={{ flexShrink: 0 }} /> <span><strong>KI-Einschätzung</strong> — generiert vom konfigurierten KI-Provider, <strong>keine bestätigte Evidence</strong>. Vor Maßnahmen verifizieren.</span>
    </div>
  );
}

export function KiAnalysisView({ ev, ticketId, canAct, onAddNote }: {
  ev: ParsedEvidence; tl: TicketTimeline | null; ticketId: string; canAct: boolean;
  /** Übernimmt einen KI-Notiz-Text in die Ticket-Notizen. Optional — sonst Button inert. */
  onAddNote?: (text: string) => Promise<void> | void;
}) {
  const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [actErr, setActErr] = useState('');
  const [iocTab, setIocTab] = useState('all');
  const alive = useRef(true);

  const load = useCallback(async () => {
    setLoadErr('');
    try { const r = await agentApi.forTicket(ticketId); if (alive.current) setSuggestions(r.data ?? []); }
    catch (e) { if (alive.current) setLoadErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen.'); }
    finally { if (alive.current) setLoading(false); }
  }, [ticketId]);

  useEffect(() => { alive.current = true; setLoading(true); setSuggestions([]); void load(); return () => { alive.current = false; }; }, [load]);

  async function propose(kind: string, note?: string) {
    if (!canAct) return;
    setBusyKind(kind); setActErr('');
    try { await agentApi.propose(ticketId, kind, note); await load(); }
    catch (e) { setActErr(e instanceof Error ? e.message : `Analyse „${kind}" fehlgeschlagen.`); }
    finally { setBusyKind(null); }
  }
  async function approve(id: string) { setActErr(''); try { await agentApi.approve(id); await load(); } catch (e) { setActErr(e instanceof Error ? e.message : 'Genehmigen fehlgeschlagen.'); } }
  async function reject(id: string, reason: string) { setActErr(''); try { await agentApi.reject(id, reason); await load(); } catch (e) { setActErr(e instanceof Error ? e.message : 'Ablehnen fehlgeschlagen.'); } }

  const withAnalysis = suggestions.filter((s) => s.analysis).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const current = withAnalysis[0] ?? null;
  const a: AgentAnalysis | null = current?.analysis ?? null;
  const history = buildKiHistoryModel(suggestions);

  if (loading) return <Card style={{ padding: '16px' }}><Spinner label="KI-Analyse wird geladen …" /></Card>;

  const iocRows = a ? buildKiIocRows(a) : [];
  const tabs = kiIocTabs(iocRows);
  const shownIocs = iocTab === 'all' ? iocRows : iocRows.filter((r) => r.type === iocTab);
  const sha = parseHashes(ev.process?.hashes || ev.file?.hashes).find((h) => /sha-?256/i.test(h.algo))?.value;
  const firstSeen = ev.firstSeen ?? ev.detection.timestamp;
  const grid3: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, alignItems: 'start' };
  const errBox = (msg: string) => <div role="alert" style={{ fontSize: 12, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 6 }}><AlertCircle size={14} /> {msg}</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 18, alignItems: 'start' }}>
      {/* ── Hauptinhalt ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* KI-Abfragen-Raster */}
        <Section title="KI-Abfragen" icon={<Bot size={15} style={{ color: 'var(--accent)' }} />}>
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 12 }}>Wählen Sie eine Analyse aus, um KI-gestützte Erkenntnisse zu diesem Vorfall zu erhalten.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {KI_QUERIES.map((q) => {
              const Icon = QUERY_ICON[q.kind] ?? Sparkles;
              const busy = busyKind === q.kind;
              return (
                <div key={q.kind} style={{ display: 'flex', gap: 10, padding: '12px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' }}>
                  <Icon size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{q.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45, margin: '3px 0 8px' }}>{q.description}</div>
                    <Button variant="ghost" size="sm" disabled={!canAct || busyKind !== null}
                      icon={busy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRight size={13} />}
                      onClick={() => void propose(q.kind)}>{busy ? 'Läuft …' : 'Starten'}</Button>
                  </div>
                </div>
              );
            })}
          </div>
          {!canAct && <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 10 }}>Analysefunktionen ab Rolle <strong>analyst</strong>.</div>}
          {actErr && <div style={{ marginTop: 10 }}>{errBox(actErr)}</div>}
          {loadErr && <div style={{ marginTop: 10 }}>{errBox(loadErr)}</div>}
        </Section>

        {!a ? (
          <Card style={{ padding: '32px 24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', maxWidth: 460, margin: '0 auto' }}>
              <Bot size={30} style={{ color: 'var(--accent)' }} />
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>Noch keine KI-Analyse für dieses Ticket</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                Wähle oben eine Abfrage. Die KI-Triage läuft über den konfigurierten KI-Provider und kann bis zu 3 Minuten dauern. Ergebnisse sind <strong>Vorschläge</strong>, keine bestätigte Evidence — es wird nichts automatisch ausgeführt.
              </div>
            </div>
          </Card>
        ) : (
          <>
            <KiDisclaimer />

            <div style={grid3}>
              {/* AI Verdict / Triage Summary */}
              <Section title="AI Verdict / Triage Summary" icon={<Bot size={15} style={{ color: 'var(--accent)' }} />} right={a.verdict ? <Badge tone={verdictTone(a.verdict)}>{a.verdict}</Badge> : undefined}>
                <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6 }}>{a.assessment || current?.proposal || '—'}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 10 }}>Generiert von Nexora KI ({current?.model || '—'}) am {fmtDate(current?.createdAt)}.</div>
              </Section>

              {/* Evidence-backed Reasoning */}
              <Section title="Evidence-backed Reasoning" icon={<CheckCircle2 size={15} style={{ color: 'var(--success)' }} />}>
                {(a.confirmedFacts.length === 0 && a.suspiciousIndicators.length === 0) ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine belegten Punkte benannt.</div> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {a.confirmedFacts.map((f) => (
                      <div key={`f-${f}`} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}><CheckCircle2 size={13} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} /><span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.45 }}>{f}</span></div>
                    ))}
                    {a.suspiciousIndicators.map((s) => (
                      <div key={`s-${s.value}-${s.reason}`} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}><AlertCircle size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} /><span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>{[s.value, s.reason].filter(Boolean).join(' — ')}</span></div>
                    ))}
                  </div>
                )}
                {a.mitreAttack.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
                    {a.mitreAttack.map((m) => <Badge key={m.techniqueId || m.technique} tone="warning">{m.techniqueId || m.technique}</Badge>)}
                  </div>
                )}
                {a.missingEvidence.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>Fehlende Evidence: {a.missingEvidence.join(' · ')}</div>}
              </Section>

              {/* Confidence & Recommendation */}
              <Section title="Confidence & Recommendation" icon={<Activity size={15} style={{ color: 'var(--accent)' }} />}>
                <KV label="Verdict" valueNode={a.verdict ? <Badge tone={verdictTone(a.verdict)}>{a.verdict}</Badge> : undefined} />
                <KV label="Business Impact" value={a.businessSeverity} />
                <div style={{ padding: '8px 0 4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}><span style={{ color: 'var(--text-dim)' }}>Confidence</span><span style={{ fontWeight: 700, color: 'var(--text)' }}>{typeof a.confidence === 'number' ? `${a.confidence}%` : '—'}</span></div>
                  <span style={{ display: 'block', height: 6, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden' }}><span style={{ display: 'block', width: `${typeof a.confidence === 'number' ? a.confidence : 0}%`, height: '100%', background: verdictTone(a.verdict) === 'danger' ? 'var(--danger)' : 'var(--accent)' }} /></span>
                </div>
                <div style={{ ...lbl, marginTop: 8, marginBottom: 4 }}>Recommended Next Steps</div>
                {a.recommendedActions.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Keine vorgeschlagen.</div>
                  : <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>{[...a.recommendedActions].sort((x, y) => (x.priority ?? 99) - (y.priority ?? 99)).slice(0, 4).map((act) => <li key={act.action} style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.45 }}>{act.action}</li>)}</ul>}
              </Section>
            </div>

            <Section title="KI-Verlauf" icon={<Activity size={15} style={{ color: 'var(--accent)' }} />} right={<Badge tone="accent">{history.summary.totalRuns}</Badge>}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
                {[
                  ['Runs', String(history.summary.totalRuns)],
                  ['Pending', String(history.summary.pending)],
                  ['Approved', String(history.summary.approved)],
                  ['Trend', history.summary.trendLabel],
                ].map(([label, value]) => (
                  <div key={label} style={{ padding: '10px 12px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>{value}</div>
                  </div>
                ))}
              </div>

              {history.points.length < 2 && (
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Bisher gibt es erst einen belastbaren KI-Lauf. Fuer echte Verlaufsaussagen braucht es mindestens zwei Analysen.
                </div>
              )}

              <div role="list" aria-label="KI-Verlaufsliste" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {history.points.map((point, index) => (
                  <div key={point.id} role="listitem" style={{ padding: '11px 12px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Run {index + 1}</span>
                      <Badge tone="muted">{point.kindLabel}</Badge>
                      <Badge tone={verdictTone(point.verdict)}>{point.verdict}</Badge>
                      <Badge tone={point.status === 'approved' ? 'success' : point.status === 'rejected' ? 'muted' : 'warning'}>{point.status}</Badge>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{fmtDate(point.createdAt)}</span>
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-dim)' }}>Confidence</span>
                        <span style={{ color: 'var(--text)', fontWeight: 700 }}>{point.confidence == null ? 'unbekannt' : `${point.confidence}%`}</span>
                      </div>
                      <span style={{ display: 'block', height: 7, background: 'var(--bg-input)', borderRadius: 999, overflow: 'hidden' }}>
                        <span style={{ display: 'block', width: `${point.confidence ?? 0}%`, height: '100%', background: verdictTone(point.verdict) === 'danger' ? 'var(--danger)' : verdictTone(point.verdict) === 'warning' ? 'var(--warning)' : 'var(--accent)' }} />
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>
                      <span>Model: {point.model}</span>
                      <span style={{ flex: 1, minWidth: 220, color: 'var(--text)' }}>{point.note || 'Keine zusaetzliche Analysebegruendung.'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Extracted IOCs & Entities */}
            <Section title="Extracted IOCs & Entities" icon={<Boxes size={15} style={{ color: 'var(--accent)' }} />} right={<Badge tone="accent">{iocRows.length}</Badge>}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {tabs.map((tb) => {
                  const n = tb === 'all' ? iocRows.length : iocRows.filter((r) => r.type === tb).length;
                  const on = iocTab === tb;
                  return <button key={tb} type="button" onClick={() => setIocTab(tb)} style={{ background: on ? 'var(--accent-soft)' : 'transparent', border: `1px solid ${on ? 'var(--accent)' : 'var(--border-soft)'}`, color: on ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 'var(--radius-pill)', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '3px 10px' }}>{tb === 'all' ? 'Alle' : tb.toUpperCase()} ({n})</button>;
                })}
              </div>
              {shownIocs.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine IOCs/Entities aus der KI-Analyse extrahiert.</div> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                    <thead><tr><th style={th}>Type</th><th style={th}>Value</th><th style={th}>Description</th><th style={th}>Source</th><th style={th}>First Seen</th><th style={{ ...th, textAlign: 'right' }}>Confidence</th></tr></thead>
                    <tbody>
                      {shownIocs.map((r: KiIocRow) => (
                        <tr key={`${r.type}:${r.value}`}>
                          <td style={tdc}><Badge tone="muted">{r.type.toUpperCase()}</Badge></td>
                          <td style={{ ...tdc, fontFamily: 'var(--font-mono)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.value}>{r.value}</td>
                          <td style={{ ...tdc, color: 'var(--text-muted)' }}>{r.description ?? '—'}</td>
                          <td style={{ ...tdc, color: 'var(--text-muted)' }}>{r.source ?? '—'}</td>
                          <td style={{ ...tdc, color: 'var(--text-muted)' }}>{fmtDate(firstSeen)}</td>
                          <td style={{ ...tdc, textAlign: 'right', color: confColor(r.confidence), fontWeight: 700 }}>{r.confidence ? r.confidence.charAt(0).toUpperCase() + r.confidence.slice(1) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Why the AI says this / Traceability */}
            <Section title="Why the AI says this / Traceability" icon={<Info size={15} style={{ color: 'var(--accent)' }} />}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 10 }}>
                Diese Analyse basiert auf den korrelierten Evidenzen des Tickets. Die Modellzuordnung erfolgt nach MITRE ATT&CK; Verdict/Confidence stammen direkt aus der KI-Ausgabe — nichts wird automatisch ausgeführt.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 24px' }}>
                <KV label="Model" value={current?.model} />
                <KV label="Analysis Time" value={fmtDate(current?.createdAt)} />
                <KV label="Belegte Punkte" value={String(a.confirmedFacts.length + a.iocs.length)} />
                <KV label="IOCs / Entities" value={String(iocRows.length)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 'var(--radius-sm)', padding: '7px 10px', marginTop: 10 }}>
                <Info size={13} style={{ flexShrink: 0 }} /> KI-Ausgabe erfordert Analysten-Validierung.
              </div>
            </Section>

            {/* Analyst Approval */}
            <ApprovalBar current={current} canAct={canAct} onApprove={approve} onReject={reject} onAddNote={onAddNote}
              onNeedsContext={(note) => propose(current.kind, note)} />
            {actErr && errBox(actErr)}
          </>
        )}
      </div>

      {/* ── Right Rail ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Section title="Analyst Summary" icon={<Bot size={15} style={{ color: 'var(--accent)' }} />}>
          <div style={{ fontSize: 12, color: a?.assessment ? 'var(--text)' : 'var(--text-dim)', lineHeight: 1.5 }}>{a?.assessment || a?.whyItMatters || 'Noch keine KI-Zusammenfassung — Abfrage starten.'}</div>
        </Section>

        <Section title="Threat Intel Snapshot" icon={<Globe size={15} style={{ color: 'var(--accent)' }} />}>
          <KV label="Malicious IP" valueNode={ev.destination.ip ? <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}><span className="mono">{ev.destination.ip}</span>{ev.destination.reputation && <Badge tone={repTone(ev.destination.reputation)}>{ev.destination.reputation}</Badge>}</span> : undefined} />
          <KV label="File Hash" value={sha ? `${sha.slice(0, 14)}…` : undefined} mono />
          <KV label="Domain" value={ev.destination.fqdn ?? ev.dns?.query} mono />
          <KV label="ASN" value={ev.destination.asn} />
          <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 8 }}>Aus der Ticket-Evidence — keine Live-Anreicherung.</div>
        </Section>

        <Section title="Risk & Impact" icon={<Activity size={15} style={{ color: 'var(--accent)' }} />}>
          {a ? (
            <>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 8 }}>
                <div style={{ width: 58, height: 58, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', border: `4px solid ${verdictTone(a.verdict) === 'danger' ? 'var(--danger)' : 'var(--accent)'}` }}>
                  <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{typeof a.confidence === 'number' ? a.confidence : '—'}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <RiskBar label="Business Impact" value={sevScore(a.businessSeverity)} />
                  <RiskBar label="Likelihood" value={typeof a.confidence === 'number' ? Math.round(a.confidence / 10) : null} />
                  <RiskBar label="Severity" value={sevScore(a.siemSeverity) ?? sevScore(a.riskLevel)} />
                </div>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>Confidence direkt aus der KI; Impact/Severity aus den Severity-Stufen abgeleitet.</div>
            </>
          ) : <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Noch keine Bewertung.</div>}
        </Section>

        <Section title="Approval Queue" icon={<Gavel size={15} style={{ color: 'var(--accent)' }} />}>
          <KV label="Status" valueNode={current ? <Badge tone={current.status === 'approved' ? 'success' : current.status === 'rejected' ? 'muted' : 'warning'}>{current.status}</Badge> : undefined} />
          <KV label="Reviewer" value={current?.reviewedBy ?? undefined} />
          <KV label="Reviewed At" value={current?.reviewedAt ? fmtDate(current.reviewedAt) : undefined} />
          <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 8 }}>Human-in-the-loop — es wird <strong>nichts automatisch ausgeführt</strong>.</div>
        </Section>
      </div>
    </div>
  );
}

function ApprovalBar({ current, canAct, onApprove, onReject, onAddNote, onNeedsContext }: {
  current: AgentSuggestion | null; canAct: boolean;
  onApprove: (id: string) => Promise<void>; onReject: (id: string, reason: string) => Promise<void>;
  onAddNote?: (text: string) => Promise<void> | void;
  /** Re-Propose mit Analyst-Hinweis: löst eine neue Analyse desselben Kind mit Zusatzkontext aus. */
  onNeedsContext?: (note: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteDone, setNoteDone] = useState(false);
  const [wantCtx, setWantCtx] = useState(false);
  const [ctxNote, setCtxNote] = useState('');
  if (!current) return null;
  const reviewed = current.status !== 'pending';
  return (
    <Section title="Analyst Approval" icon={<Gavel size={15} style={{ color: 'var(--accent)' }} />}>
      <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 10 }}>Prüfe die KI-Analyse und entscheide den nächsten Schritt. Human-in-the-loop — es wird <strong>nichts automatisch ausgeführt</strong>.</div>
      {reviewed ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {current.status === 'approved' ? <CheckCircle2 size={13} style={{ color: 'var(--success)', verticalAlign: 'middle' }} /> : <XCircle size={13} style={{ color: 'var(--text-dim)', verticalAlign: 'middle' }} />}{' '}
          <strong>{current.reviewedBy || '—'}</strong> — {current.status}{current.reviewReason ? ` (${current.reviewReason})` : ''}
        </div>
      ) : !canAct ? (
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Genehmigung ab Rolle <strong>analyst</strong>.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="primary" size="sm" disabled={busy} icon={busy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={13} />}
              onClick={async () => { setBusy(true); try { await onApprove(current.id); } finally { setBusy(false); } }}>Approve &amp; Add to Report</Button>
            <Button variant="ghost" size="sm" disabled={busy || noteDone || !onAddNote}
              icon={noteDone ? <CheckCircle2 size={13} /> : undefined}
              title={onAddNote ? 'Hängt Verdict + Assessment an die Ticket-Notizen an' : 'Kein eigener Backend-Workflow (noch nicht verfügbar)'}
              onClick={async () => { setBusy(true); try { await onAddNote?.(buildKiNoteText({ verdict: current.analysis?.verdict, assessment: current.analysis?.assessment })); setNoteDone(true); } finally { setBusy(false); } }}>
              {noteDone ? 'Als Notiz hinzugefügt' : 'Add as Note'}</Button>
            <Button variant="ghost" size="sm" disabled={busy || !onNeedsContext} aria-expanded={wantCtx}
              title={onNeedsContext ? 'KI mit gezieltem Zusatzkontext erneut fragen' : 'Kein eigener Backend-Workflow (noch nicht verfügbar)'}
              onClick={() => setWantCtx((v) => !v)}>Needs More Context</Button>
          </div>
          {wantCtx && onNeedsContext && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <input value={ctxNote} onChange={(e) => setCtxNote(e.target.value)} aria-label="Fehlender Kontext für die KI"
                placeholder="Welcher Kontext fehlt der KI? (fließt in die erneute Analyse)"
                style={{ flex: 1, minWidth: 220, padding: '6px 10px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12 }} />
              <Button variant="ghost" size="sm" disabled={busy || !ctxNote.trim()}
                icon={busy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={13} />}
                onClick={async () => { setBusy(true); try { await onNeedsContext(ctxNote.trim()); setWantCtx(false); setCtxNote(''); } finally { setBusy(false); } }}>Erneut analysieren</Button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ablehnungsgrund (Pflicht für Reject)" aria-label="Ablehnungsgrund"
              style={{ flex: 1, minWidth: 200, padding: '6px 10px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12 }} />
            <Button variant="ghost" size="sm" disabled={busy || !reason.trim()} icon={<XCircle size={13} />}
              onClick={async () => { setBusy(true); try { await onReject(current.id, reason.trim()); } finally { setBusy(false); } }}>Reject Analysis</Button>
          </div>
        </>
      )}
    </Section>
  );
}
