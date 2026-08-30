import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { Lightbulb, Sparkles, ShieldCheck, Send, Check, X, Rocket, AlertTriangle, Download, Copy } from 'lucide-react';
import { SectionHeader, Card, CardBody, Badge, Button, EmptyState, Spinner, type Tone } from '../components/ui';
import { useCaseApi, exportDraft, type UseCaseDraft, type QualityResult, type UseCaseStatus, type ExportResult } from '../features/useCases/useCaseDeveloperApi';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';
import { useTranslation } from 'react-i18next';

const EXPORT_FORMATS = ['wazuh', 'sigma', 'splunk', 'qradar'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

const STATUS_TONE: Record<UseCaseStatus, Tone> = {
  draft: 'muted', in_review: 'warning', approved: 'accent', rejected: 'danger', published: 'success',
};
const SEV_TONE = (s: string): Tone => s === 'critical' ? 'danger' : s === 'high' ? 'warning' : s === 'medium' ? 'accent' : 'muted';
const SOURCE_TYPES = ['ticket', 'finding', 'evidence', 'wazuh_rule', 'manual'] as const;

export function UseCaseDeveloperPage() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const canAct   = can.act(user?.role);     // generate + review
  const canApply = can.apply(user?.role);   // approve / reject
  const canAdmin = can.admin(user?.role);   // publish

  const [list, setList] = useState<UseCaseDraft[] | null>(null);
  const [listError, setListError] = useState(false);
  const [sel, setSel] = useState<UseCaseDraft | null>(null);
  const [quality, setQuality] = useState<QualityResult | null>(null);
  const [sourceType, setSourceType] = useState<UseCaseDraft['sourceType']>('ticket');
  const [sourceId, setSourceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ── Export-Vorschau ──
  const [exportFormat, setExportFormat] = useState<ExportFormat>('wazuh');
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadList = () => {
    setListError(false);
    useCaseApi.list({ limit: 50 })
      .then((r) => setList(r.data))
      // „leer" ≠ „Fehler": Ladefehler markieren, nicht als „keine Entwürfe" tarnen.
      .catch(() => setListError(true));
  };
  useEffect(loadList, []);

  async function generate() {
    if (!canAct) return;
    setBusy(true); setMsg(null);
    try {
      const r = await useCaseApi.generate(sourceType, sourceId.trim());
      setSel(r.data); setQuality(r.quality);
      setMsg({ ok: true, text: `Draft erzeugt: ${r.data.title || r.data.id}` });
      loadList();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : tr('useCase.generationFailed') });
    } finally { setBusy(false); }
  }

  async function open(id: string) {
    setMsg(null);
    try {
      const [d, q] = await Promise.all([useCaseApi.get(id), useCaseApi.quality(id)]);
      setSel(d.data); setQuality(q.quality);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : tr('app.useCaseCouldNotLoaded') }); }
  }

  // Export-Vorschau laden — kein Schreiben, reine Transformation
  const loadExport = useCallback(async (id: string, fmt: ExportFormat) => {
    setExportBusy(true);
    setExportResult(null);
    try {
      const r = await exportDraft(id, fmt);
      setExportResult(r);
    } catch {
      setExportResult(null);
    } finally {
      setExportBusy(false);
    }
  }, []);

  // Export zurücksetzen wenn neuer Draft gewählt
  useEffect(() => {
    setExportResult(null);
    setCopied(false);
  }, [sel?.id]);

  function handleFormatChange(fmt: ExportFormat) {
    setExportFormat(fmt);
    if (sel) void loadExport(sel.id, fmt);
  }

  function handleCopy() {
    if (!exportResult) return;
    navigator.clipboard.writeText(exportResult.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* ignore clipboard errors */ });
  }

  function handleDownload() {
    if (!exportResult || !sel) return;
    const extMap: Record<string, string> = { wazuh: 'xml', sigma: 'yml', splunk: 'spl', qradar: 'aql' };
    const ext = extMap[exportResult.format] ?? 'txt';
    const filename = `use-case-${sel.id.slice(0, 8)}.${ext}`;
    const blob = new Blob([exportResult.content], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function transition(action: 'review' | 'approve' | 'reject' | 'publish') {
    if (!sel) return;
    setBusy(true); setMsg(null);
    try {
      const r = await useCaseApi[action](sel.id);
      setSel(r.data);
      setMsg({ ok: true, text: `Status: ${r.data.status}` });
      loadList();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : tr('tickets.errors.action') });
    } finally { setBusy(false); }
  }

  return (
    <div>
      <SectionHeader title="KI Use-Case Developer" subtitle={tr('app.developsDetectionUseCaseDrafts')} help="use-case-developer" />

      {msg && (
        <div style={{ margin: '0 0 14px', fontSize: 12.5, color: msg.ok ? 'var(--success)' : 'var(--danger)', background: msg.ok ? 'var(--success-soft)' : 'var(--danger-soft)', border: `1px solid ${msg.ok ? 'var(--success)' : 'var(--danger)'}`, borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>{msg.text}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 320px', gap: 14, alignItems: 'start' }}>
        {/* ── Links: Generator + Draft-Liste ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card>
            <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                <Sparkles size={15} style={{ color: 'var(--accent)' }} /> Neuer Use Case
              </div>
              <div>
                <div style={LBL}>{tr('common.source')}</div>
                <select style={INPUT} value={sourceType} onChange={(e) => setSourceType(e.target.value as UseCaseDraft['sourceType'])}>
                  {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <div style={LBL}>Quell-ID (z. B. Ticket-Nr.)</div>
                <input style={INPUT} value={sourceId} onChange={(e) => setSourceId(e.target.value)} placeholder="INC000123 / leer = manual" />
              </div>
              <Button variant="primary" size="sm" icon={<Lightbulb size={14} />} disabled={!canAct || busy} title={!canAct ? tr('common.requiresAnalyst') : ''} onClick={() => void generate()}>
                {busy ? 'Generiere …' : tr('useCase.generate')}
              </Button>
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{tr('app.createsDraftOnlyNoRule')}</div>
            </CardBody>
          </Card>

          <Card style={{ overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700 }}>Entwürfe {list ? `(${list.length})` : ''}</div>
            <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
              {listError ? <div style={{ padding: 16, fontSize: 12, color: 'var(--danger)' }}>{tr('app.draftsCannotLoadedRequestFailed')}</div>
                : !list ? <div style={{ padding: 16 }}><Spinner label={tr('ui.loading')} /></div>
                : list.length === 0 ? <div style={{ padding: 16, fontSize: 12, color: 'var(--text-dim)' }}>{tr('app.noDraftsYet')}</div>
                : list.map((d) => (
                  <button key={d.id} onClick={() => void open(d.id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: sel?.id === d.id ? 'var(--accent-soft)' : 'transparent', border: 'none', borderLeft: sel?.id === d.id ? '3px solid var(--accent)' : '3px solid transparent', padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-soft)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 3 }}>
                      <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                      <Badge tone={SEV_TONE(d.severity)}>{d.severity}</Badge>
                    </div>
                    {d.ucNumber && <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{d.ucNumber}</div>}
                    <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || tr('tickets.untitled')}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{d.sourceType}{d.sourceId ? ` · ${d.sourceId}` : ''}</div>
                  </button>
                ))}
            </div>
          </Card>
        </div>

        {/* ── Mitte: Draft-Detail ── */}
        <div style={{ minWidth: 0 }}>
          {!sel ? (
            <Card><CardBody><EmptyState icon={<Lightbulb size={28} />} title={tr('app.noDraftSelected')} message={tr('app.generateUseCasePickDraft')} /></CardBody></Card>
          ) : (
            <Card>
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Badge tone={STATUS_TONE[sel.status]}>{sel.status}</Badge>
                  <Badge tone={SEV_TONE(sel.severity)}>{sel.severity}</Badge>
                  <Badge tone="muted">Confidence {sel.confidence}%</Badge>
                  {sel.ucNumber && <Badge tone="muted">{sel.ucNumber}</Badge>}
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto' }}>{sel.generatedBy}{sel.generatedBy?.includes('stub') ? ' ' + tr('app.sampleDraftNoLlm') : ''}</span>
                </div>
                <h2 style={{ margin: 0, fontSize: 17, color: 'var(--text)' }}>{sel.title || tr('tickets.untitled')}</h2>

                <Field title={tr('common.description')} text={sel.description} />
                <Field title={tr('detection.target')} text={sel.detectionGoal} />
                <Block title="Datenquellen" items={sel.dataSources} />
                <Block title={tr('app.requiredFields')} items={sel.requiredFields} />

                <div>
                  <div style={SUB}>Erkennungslogik <Badge tone="muted">{sel.detectionLogic?.language || 'generic'}</Badge></div>
                  <pre style={PRE}>{sel.detectionLogic?.queryOrRule || '—'}</pre>
                  {sel.detectionLogic?.explanation && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{sel.detectionLogic.explanation}</div>}
                </div>

                <div>
                  <div style={SUB}>MITRE ATT&CK</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(sel.mitre || []).length ? sel.mitre.map((m) => <Badge key={`${m.technique ?? ''}-${m.tactic ?? ''}`} tone="accent">{m.technique || ''} {m.tactic ? `· ${m.tactic}` : ''}</Badge>) : <span style={DIM}>—</span>}
                  </div>
                </div>

                <Block title="False-Positive-Risiken" items={sel.falsePositiveRisks} icon={<AlertTriangle size={13} style={{ color: 'var(--warning)' }} />} />

                <div>
                  <div style={SUB}>Testfälle ({(sel.testCases || []).length})</div>
                  {(sel.testCases || []).map((t) => (
                    <div key={t.name} style={{ fontSize: 12, padding: '6px 8px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', marginBottom: 4 }}>
                      <Badge tone={t.type === 'true_positive' ? 'danger' : 'success'}>{t.type}</Badge> <strong style={{ color: 'var(--text)' }}>{t.name}</strong>
                      <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>→ {t.expectedResult}</div>
                    </div>
                  ))}
                </div>

                <Block title="Empfohlene Response" items={sel.recommendedActions} />
                <Block title={tr('analysis.playbookSteps')} items={sel.playbookSteps} ordered />

                {/* ── Export-Vorschau ── */}
                <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ ...SUB, marginBottom: 8 }}>{tr('text.ruleExportPreview')}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>{tr('common.previewOnly')}</div>

                  {/* Format-Tabs */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
                    {EXPORT_FORMATS.map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => handleFormatChange(fmt)}
                        style={{
                          padding: '4px 10px',
                          fontSize: 11,
                          fontWeight: 600,
                          fontFamily: 'var(--font-mono)',
                          background: exportFormat === fmt ? 'var(--accent)' : 'var(--bg-input)',
                          color: exportFormat === fmt ? 'var(--bg)' : 'var(--text-muted)',
                          border: `1px solid ${exportFormat === fmt ? 'var(--accent)' : 'var(--border-soft)'}`,
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          transition: 'background 120ms, color 120ms',
                        }}
                      >
                        {fmt}
                      </button>
                    ))}
                    <button
                      onClick={() => void loadExport(sel.id, exportFormat)}
                      disabled={exportBusy}
                      style={{
                        marginLeft: 'auto',
                        padding: '4px 10px',
                        fontSize: 11,
                        background: 'var(--bg-input)',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border-soft)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: exportBusy ? 'not-allowed' : 'pointer',
                        opacity: exportBusy ? 0.6 : 1,
                      }}
                    >
                      {exportBusy ? '…' : tr('text.load')}
                    </button>
                  </div>

                  {/* Code-Vorschau */}
                  {exportBusy && <div style={{ padding: 8, fontSize: 12, color: 'var(--text-dim)' }}>{tr('useCase.generatingPreview')}</div>}
                  {!exportBusy && !exportResult && (
                    <div style={{ padding: '8px 0', fontSize: 12, color: 'var(--text-dim)' }}>{tr('common.pickFormatAndLoad')}</div>
                  )}
                  {exportResult && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <Badge tone="muted">{exportResult.language}</Badge>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                          {exportResult.content.split('\n').length} Zeilen
                        </span>
                      </div>
                      <pre style={CODE_PRE}>{exportResult.content}</pre>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <Button variant="ghost" size="sm" icon={<Copy size={12} />} onClick={handleCopy}>
                          {copied ? tr('common.copiedBang') : tr('common.copy')}
                        </Button>
                        <Button variant="ghost" size="sm" icon={<Download size={12} />} onClick={handleDownload}>
                          Download
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        {/* ── Rechts: Quality-Gate + Lifecycle ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card>
            <CardBody>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
                <ShieldCheck size={15} style={{ color: 'var(--accent)' }} /> Quality-Gate
              </div>
              {!quality ? <span style={DIM}>{tr('text.noDraftAssessed')}</span> : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <Badge tone={quality.passed ? 'success' : 'danger'}>{quality.passed ? 'Bestanden' : tr('text.notPassed')}</Badge>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Score {quality.score}</span>
                  </div>
                  {quality.checks.map((c) => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, padding: '4px 0' }}>
                      <span>{c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✗'}</span>
                      <span style={{ color: c.status === 'fail' ? 'var(--danger)' : c.status === 'warn' ? 'var(--warning)' : 'var(--text-muted)' }}>{c.label}</span>
                    </div>
                  ))}
                </>
              )}
            </CardBody>
          </Card>

          {sel && (
            <Card>
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Workflow</div>
                <Button variant="ghost" size="sm" icon={<Send size={13} />} disabled={!canAct || busy || sel.status !== 'draft'} onClick={() => void transition('review')}>{tr('app.sendReview')}</Button>
                <Button variant="primary" size="sm" icon={<Check size={13} />} disabled={!canApply || busy || sel.status !== 'in_review'} title={!canApply ? tr('common.requiresEngineer') : ''} onClick={() => void transition('approve')}>{tr('common.approve')}</Button>
                <Button variant="ghost" size="sm" icon={<X size={13} />} disabled={!canApply || busy || sel.status !== 'in_review'} onClick={() => void transition('reject')}>Ablehnen</Button>
                <Button variant="danger" size="sm" icon={<Rocket size={13} />} disabled={!canAdmin || busy || sel.status !== 'approved'} title={!canAdmin ? tr('common.requiresAdmin') : ''} onClick={() => void transition('publish')}>{tr('app.publish')}</Button>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{tr('app.analystCreatesReviewsEngineerAdministrator')}</div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ title, text }: { title: string; text?: string }) {
  return <div><div style={SUB}>{title}</div><div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{text || '—'}</div></div>;
}
function Block({ title, items, ordered, icon }: { title: string; items?: string[]; ordered?: boolean; icon?: React.ReactNode }) {
  const list = items || [];
  return (
    <div>
      <div style={SUB}>{icon}{icon ? ' ' : ''}{title}</div>
      {list.length === 0 ? <span style={DIM}>—</span> : (
        <ul style={{ margin: 0, paddingLeft: ordered ? 18 : 16, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {list.map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
    </div>
  );
}

const LBL: CSSProperties = { fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };
const SUB: CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 };
const DIM: CSSProperties = { fontSize: 12, color: 'var(--text-dim)' };
const INPUT: CSSProperties = { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const PRE: CSSProperties = { margin: 0, background: 'var(--bg-terminal)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: 10, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' };
const CODE_PRE: CSSProperties = { margin: 0, background: 'var(--bg-terminal)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: 12, fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text)', whiteSpace: 'pre', overflowX: 'auto', maxHeight: 340, lineHeight: 1.55 };
