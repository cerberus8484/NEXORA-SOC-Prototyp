import { useEffect, useState, type CSSProperties } from 'react';
import { X, ShieldOff, ScrollText, ListTree, Boxes, Lock, HeartPulse } from 'lucide-react';
import { Badge, Button, Spinner, ErrorCard } from '../../components/ui';
import { useTranslation } from 'react-i18next';
import {
  correlatorsApi,
  type CorrelatorSummary, type JobSummary, type ResultSummary,
  type CorrelatorConfig, type AuditEntry, type BoundCapability, type DraftView,
  type ValidationResult, type ApplyPlan, type WorkerHealth,
} from './correlatorsApi';
import {
  jobStatusTone, jobStatusLabel, riskTone, riskLabel,
  isApproved, approvedNotAppliedNotice, supersededExplanation,
  canEditConfig, canDecideConfig, diffEntries,
  validationSummary, eligibilityLabel, eligibilityTone, planNoApplyNotice,
  applyGateLabel, applyGateTone,
  heartbeatLabel, heartbeatTone, queueStateLabel, queueStateTone, applyReadinessLabel, applyReadinessTone,
} from './correlatorsView';

const s: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1050, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' },
  modal: { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', width: '100%', maxWidth: 900, marginTop: 24 },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' },
  body: { padding: '16px 18px' },
  foot: { display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 18px', borderTop: '1px solid var(--border-soft)' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 },
  label: { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 3 },
  section: { fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, margin: '18px 0 8px', display: 'flex', alignItems: 'center', gap: 6 },
  th: { textAlign: 'left', fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, padding: '6px 10px', borderBottom: '1px solid var(--border-soft)' },
  td: { fontSize: 12, padding: '7px 10px', borderBottom: '1px solid var(--border-soft)' },
  hint: { fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 },
  capCard: { background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginBottom: 10 },
  input: { width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '6px 9px', fontSize: 13, boxSizing: 'border-box' as const },
  banner: { padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: 12, marginTop: 8 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={s.label}>{label}</div>
      <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

interface Props {
  correlator: CorrelatorSummary;
  role: string | undefined;
  onClose: () => void;
}

export function CorrelatorDetailModal({ correlator, role, onClose }: Props) {
  const { t: tr } = useTranslation();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [results, setResults] = useState<ResultSummary[] | null>(null);
  const [config, setConfig] = useState<CorrelatorConfig | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  async function loadAll(signal?: AbortSignal) {
    try {
      const [j, r, c, a, wh] = await Promise.all([
        correlatorsApi.listJobs(correlator.id, { limit: 25 }, { signal }),
        correlatorsApi.listResults(correlator.id, { limit: 25 }, { signal }),
        correlatorsApi.getConfig(correlator.id, { signal }),
        correlatorsApi.listAudit(correlator.id, { limit: 50 }, { signal }),
        correlatorsApi.getWorkerHealth(correlator.id, { signal }),
      ]);
      setJobs(j.data); setResults(r.data); setConfig(c.data); setAudit(a.data); setWorkerHealth(wh.data);
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') setError(e.message);
    }
  }

  useEffect(() => {
    const ctrl = new AbortController();
    void loadAll(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correlator.id]);

  async function reload() { setActionError(''); await loadAll(); }
  function onActionError(e: unknown) { setActionError(e instanceof Error ? e.message : tr('tickets.errors.action')); }

  const hasSuperseded = (jobs ?? []).some((j) => j.superseded);

  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-labelledby="cd-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div style={s.modal}>
        <div style={s.head}>
          <span id="cd-title" style={{ fontWeight: 700, fontSize: 15 }}>{correlator.name}</span>
          <button type="button" aria-label={tr('common.close')} onClick={onClose} style={s.closeBtn}><X size={16} /></button>
        </div>
        <div style={s.body}>
          {error && <ErrorCard message={error} />}
          {!error && (!jobs || !config) && <Spinner />}
          {!error && jobs && config && (
            <>
              {/* Overview */}
              <div style={s.grid}>
                <Field label="Zweck"><span style={{ fontSize: 12.5 }}>{correlator.description}</span></Field>
                <Field label="Engine-Version"><code>{correlator.engineVersion}</code></Field>
                <Field label="Inputs">{correlator.inputSources.map((i) => <Badge key={i} tone="muted">{i}</Badge>)}</Field>
                <Field label="Outputs">{correlator.outputTypes.map((o) => <Badge key={o} tone="accent">{o}</Badge>)}</Field>
                <Field label="Risiko"><Badge tone={riskTone(correlator.riskClass)} dot>{riskLabel(correlator.riskClass)}</Badge></Field>
                <Field label="Status-Herkunft"><span style={s.hint}>{tr('correlators.derivedFromJobs')}</span></Field>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Badge tone="accent">{correlator.queue.active} aktiv</Badge>
                <Badge tone="success">{correlator.queue.completed} abgeschlossen</Badge>
                <Badge tone="danger">{correlator.queue.failed} fehlgeschlagen</Badge>
                <Badge tone="warning">{correlator.queue.superseded} ersetzt</Badge>
              </div>

              {/* Worker Live-Health (Stufe 3) — ehrliche Read-only-Anzeige */}
              <div style={s.section}><HeartPulse size={13} /> Worker Live-Health</div>
              {workerHealth && <WorkerHealthPanel health={workerHealth} />}

              {/* Jobs */}
              <div style={s.section}><ListTree size={13} /> Jobs ({jobs.length})</div>
              <JobsTable jobs={jobs} />
              {hasSuperseded && (
                <div style={{ ...s.banner, background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.30)' }}>
                  <strong>Ersetzt (superseded):</strong> {supersededExplanation()}
                </div>
              )}

              {/* Results */}
              <div style={s.section}><Boxes size={13} /> Results ({(results ?? []).length})</div>
              <ResultsTable results={results ?? []} />

              {/* Config */}
              <div style={s.section}><ShieldOff size={13} /> {tr('app.configurationApplyNotSupported')}</div>
              <ConfigPanel correlatorId={correlator.id} config={config} role={role}
                onChanged={reload} onError={onActionError} />
              {actionError && <ErrorCard message={actionError} />}

              {/* Audit */}
              <div style={s.section}><ScrollText size={13} /> Audit ({(audit ?? []).length})</div>
              <AuditTimeline audit={audit ?? []} />
            </>
          )}
        </div>
        <div style={s.foot}>
          <Button variant="primary" onClick={onClose}>{tr('common.close')}</Button>
        </div>
      </div>
    </div>
  );
}

function WorkerHealthPanel({ health }: { health: WorkerHealth }) {
  const { t: tr } = useTranslation();
  const adopted = Object.entries(health.adoptedConfigVersions);
  return (
    <div style={s.capCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <Badge tone={heartbeatTone(health)} dot>Heartbeat: {heartbeatLabel(health)}</Badge>
        <Badge tone={queueStateTone(health)}>Queue: {queueStateLabel(health.queueProcessingState)}</Badge>
        <Badge tone={health.killSwitchEnabled ? 'warning' : 'muted'}>
          Kill-Switch: {health.killSwitchEnabled ? 'an' : 'aus (gesperrt)'}
        </Badge>
        {health.lastJobOutcome && <Badge tone="muted">Letzter Job: {health.lastJobOutcome}</Badge>}
      </div>
      <div style={s.hint}>
        Übernommene Config-Versionen: {adopted.length === 0 ? '—' : adopted.map(([k, v]) => (
          <span key={k} style={{ marginRight: 10 }}><code>{k}</code>: v{v}</span>
        ))}
      </div>
      <div style={{ ...s.banner, marginTop: 6, background: health.applyReady ? 'rgba(234,179,8,0.10)' : 'rgba(120,120,120,0.10)', border: `1px solid ${health.applyReady ? 'rgba(234,179,8,0.30)' : 'var(--border-soft)'}` }}>
        <Badge tone={applyReadinessTone(health)}>{health.applyReady ? 'Apply-Ready' : tr('text.applyBlocked')}</Badge>
        <span style={{ marginLeft: 8 }}>{applyReadinessLabel(health)}</span>
      </div>
    </div>
  );
}

function JobsTable({ jobs }: { jobs: JobSummary[] }) {
  const { t: tr } = useTranslation();
  if (jobs.length === 0) return <span style={s.hint}>{tr('text.noJobs')}</span>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Ticket', 'Status', 'Engine', 'Versuche', 'Erstellt'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td style={{ ...s.td, fontFamily: 'var(--font-mono)' }}>{j.ticketId}</td>
              <td style={s.td}>
                <Badge tone={jobStatusTone(j.presentationStatus)} dot>{jobStatusLabel(j.presentationStatus)}</Badge>
                {j.failureSummary && <span style={{ ...s.hint, marginLeft: 6 }}>{j.failureSummary}</span>}
              </td>
              <td style={{ ...s.td, fontFamily: 'var(--font-mono)' }}>{j.engineVersion}</td>
              <td style={s.td}>{j.retryCount}</td>
              <td style={s.td}>{j.createdAt ? new Date(j.createdAt).toLocaleString('de-DE') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsTable({ results }: { results: ResultSummary[] }) {
  const { t: tr } = useTranslation();
  if (results.length === 0) return <span style={s.hint}>{tr('text.noResults')}</span>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Ticket', 'Events', tr('common.sources'), 'Evidence-Refs', 'Erstellt'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.id}>
              <td style={{ ...s.td, fontFamily: 'var(--font-mono)' }}>{r.ticketId}</td>
              <td style={s.td}>{r.eventCount}</td>
              <td style={s.td}>{r.sources.map((src) => `${src.source} (${src.count})`).join(', ') || '—'}</td>
              <td style={s.td}>{r.evidenceRefCount}</td>
              <td style={s.td}>{r.createdAt ? new Date(r.createdAt).toLocaleString('de-DE') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTimeline({ audit }: { audit: AuditEntry[] }) {
  const { t: tr } = useTranslation();
  if (audit.length === 0) return <span style={s.hint}>{tr('app.noAuditEntries')}</span>;
  return (
    <div>
      {audit.map((a) => (
        <div key={a.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--border-soft)' }}>
          <Badge tone="muted">{a.type.replace('config.draft.', '')}</Badge>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{a.capabilityId}</span>
          <span style={{ color: 'var(--text-dim)' }}>{a.actor ?? '—'}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>{new Date(a.at).toLocaleString('de-DE')}</span>
        </div>
      ))}
    </div>
  );
}

// ── Konfigurationsbereich: gebundene Capabilities + Draft-Lifecycle ──────────

function ConfigPanel({ correlatorId, config, role, onChanged, onError }: {
  correlatorId: string; config: CorrelatorConfig; role: string | undefined;
  onChanged: () => void; onError: (e: unknown) => void;
}) {
  const { t: tr } = useTranslation();
  return (
    <>
      {config.bound.map((cap) => (
        <BoundCapabilityCard key={cap.id} correlatorId={correlatorId} cap={cap} role={role}
          onChanged={onChanged} onError={onError} />
      ))}
      {config.reserved.length > 0 && (
        <>
          <div style={{ ...s.label, marginTop: 14 }}>{tr('app.reservedVisibleNotEditable')}</div>
          {config.reserved.map((cap) => (
            <div key={cap.id} style={{ ...s.capCard, opacity: 0.75 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Lock size={12} /> <code>{cap.id}</code>
                <Badge tone={riskTone(cap.risk)}>{riskLabel(cap.risk)}</Badge>
              </div>
              <div style={s.hint}>{cap.description} — host-/netznah, nicht über diesen Correlator administrierbar.</div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function BoundCapabilityCard({ correlatorId, cap, role, onChanged, onError }: {
  correlatorId: string; cap: BoundCapability; role: string | undefined;
  onChanged: () => void; onError: (e: unknown) => void;
}) {
  const { t: tr } = useTranslation();
  const field = cap.fields[0];
  const [value, setValue] = useState<string>(field?.default !== undefined ? String(field.default) : '');
  const [busy, setBusy] = useState(false);
  const canEdit = canEditConfig(role);

  function buildValue(): Record<string, unknown> {
    const v = field?.type === 'number' ? Number(value) : value;
    return field ? { [field.name]: v } : {};
  }

  async function createDraft() {
    setBusy(true);
    try { await correlatorsApi.createDraft(correlatorId, { capabilityId: cap.id, value: buildValue() }); onChanged(); }
    catch (e) { onError(e); } finally { setBusy(false); }
  }

  return (
    <div style={s.capCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <code style={{ fontWeight: 600 }}>{cap.id}</code>
        <Badge tone={riskTone(cap.risk)}>{riskLabel(cap.risk)}</Badge>
        <Badge tone="muted">Apply-Impact: {cap.applyImpact}</Badge>
        <Badge tone={applyGateTone(cap.applyStatus)}>{applyGateLabel(cap.applyStatus)}</Badge>
      </div>
      <div style={{ ...s.hint, marginBottom: 8 }}>{cap.description} — {cap.effect}</div>

      {field && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12 }}>{field.name} (Default {String(field.default)}):</span>
          <input style={{ ...s.input, maxWidth: 140 }} value={value} disabled={!canEdit}
            aria-label={`${cap.id} ${field.name}`} onChange={(e) => setValue(e.target.value)} />
          {canEdit && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void createDraft()}>
              {busy ? tr('common.creatingShort') : tr('deploy.createDraftValidate')}
            </Button>
          )}
        </div>
      )}

      {cap.drafts.map((d) => (
        <DraftRow key={d.id} correlatorId={correlatorId} draft={d} role={role} onChanged={onChanged} onError={onError} />
      ))}
    </div>
  );
}

function DraftRow({ correlatorId, draft, role, onChanged, onError }: {
  correlatorId: string; draft: DraftView; role: string | undefined;
  onChanged: () => void; onError: (e: unknown) => void;
}) {
  const { t: tr } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const canEdit = canEditConfig(role);
  const canDecide = canDecideConfig(role);
  const diffs = diffEntries(null, draft.value);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); onChanged(); } catch (e) { onError(e); } finally { setBusy(false); }
  }

  // Separate, nicht-mutierende Aktionen — sie laden NICHT neu (kein onChanged).
  async function doValidate() {
    setBusy(true);
    try { setValidation((await correlatorsApi.validateDraft(correlatorId, draft.id)).data); }
    catch (e) { onError(e); } finally { setBusy(false); }
  }
  async function doPlan() {
    setBusy(true);
    try { setPlan((await correlatorsApi.getPlan(correlatorId, draft.id)).data); }
    catch (e) { onError(e); } finally { setBusy(false); }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 8, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
        <Badge tone={draft.status === 'approved' ? 'success' : draft.status === 'rejected' ? 'danger' : 'warning'} dot>{draft.status}</Badge>
        <span style={{ color: 'var(--text-dim)' }}>rev {draft.revision} · {draft.createdBy}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {/* Separater Validierungsschritt (Engineer-Aktion, nicht-mutierend) */}
          {canEdit && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void doValidate()}>{tr('common.validate')}</Button>
          )}
          {/* Apply-Plan-Vorschau — read-only, KEIN Apply */}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void doPlan()}>{tr('deploy.showApplyPlan')}</Button>
          {canEdit && draft.status === 'draft' && (
            <Button variant="ghost" size="sm" disabled={busy}
              onClick={() => void run(() => correlatorsApi.submitDraft(correlatorId, draft.id, { expectedVersion: draft.version }))}>{tr('common.submitForApproval')}</Button>
          )}
          {canDecide && draft.status === 'pending_approval' && (
            <>
              <Button variant="primary" size="sm" disabled={busy}
                onClick={() => void run(() => correlatorsApi.decideDraft(correlatorId, draft.id, { decision: 'approved', expectedVersion: draft.version, note: '' }))}>
                Genehmigen
              </Button>
              <Button variant="danger" size="sm" disabled={busy}
                onClick={() => void run(() => correlatorsApi.decideDraft(correlatorId, draft.id, { decision: 'rejected', expectedVersion: draft.version, note: '' }))}>
                Ablehnen
              </Button>
            </>
          )}
        </span>
      </div>
      {/* Redigierter Diff */}
      <div style={{ ...s.hint, marginTop: 4 }}>
        {diffs.map((d) => <span key={d.key} style={{ marginRight: 10 }}><code>{d.key}</code>: {String(d.after)}</span>)}
      </div>

      {/* Validierungsergebnis (separat) */}
      {validation && (
        <div style={{ ...s.banner, background: validation.valid ? 'rgba(34,197,94,0.10)' : 'rgba(220,38,38,0.10)', border: `1px solid ${validation.valid ? 'rgba(34,197,94,0.30)' : 'rgba(220,38,38,0.30)'}` }}>
          {validationSummary(validation)}
        </div>
      )}

      {/* Apply-Plan-Vorschau — beschreibt nur, was passieren WÜRDE; wendet nichts an */}
      {plan && (
        <div style={{ ...s.capCard, marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <strong style={{ fontSize: 12 }}>{tr('deploy.applyPlanPreview')}</strong>
            <Badge tone={eligibilityTone(plan)}>{eligibilityLabel(plan)}</Badge>
            <Badge tone="muted">Impact: {plan.applyImpact}</Badge>
            <Badge tone="muted">Status: {plan.applyStatus}</Badge>
            <Badge tone={plan.wouldApply ? 'danger' : 'success'}>wouldApply: {String(plan.wouldApply)}</Badge>
          </div>
          <div style={s.hint}>
            <div><u>{tr('app.wouldChange')}</u>: {plan.changes.length === 0 ? '—' : plan.changes.map((c) => <span key={c.key} style={{ marginRight: 10 }}><code>{c.key}</code>: {String(c.before)} → {String(c.after)}</span>)}</div>
            <div><u>{tr('app.wouldStayUnchanged')}</u>: {plan.unchanged.length === 0 ? '—' : plan.unchanged.map((u) => <span key={u.key} style={{ marginRight: 10 }}><code>{u.key}</code>: {String(u.value)}</span>)}</div>
          </div>
          <div style={{ ...s.banner, background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.30)' }}>
            {planNoApplyNotice(plan)}
          </div>
        </div>
      )}

      {isApproved(draft) && (
        <div style={{ ...s.banner, background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.30)' }}>
          {approvedNotAppliedNotice()}
        </div>
      )}
    </div>
  );
}
