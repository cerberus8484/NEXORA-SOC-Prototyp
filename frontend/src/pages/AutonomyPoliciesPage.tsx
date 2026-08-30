import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ShieldOff, ShieldCheck, Plus, Pencil, Trash2, AlertTriangle, X, Check, Lightbulb } from 'lucide-react';
import { Badge, Button, Spinner, ErrorCard, HelpTip, ExampleHint, type Tone } from '../components/ui';
import {
  autonomyApi,
  isCeilingViolation,
  ACTION_CLASS_CEILINGS,
  type AutonomyPolicy,
  type AutonomyStatus,
  type ActionClass,
  type AutonomyMode,
  type Verdict,
  type CreatePolicyBody,
} from '../features/autonomy/autonomyApi';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

// ── Konstanten ─────────────────────────────────────────────────────────────

const ACTION_CLASS_LABELS: Record<ActionClass, string> = {
  enrichment:       'Enrichment',
  internal_state:   'Internal State',
  draft_generation: 'Draft Generation',
  detection_write:  'Detection Write',
  host_response:    'Host Response',
  external_comms:   'External Comms',
};

const actionClassDescs = (): Record<ActionClass, string> => ({
  enrichment:       i18n.t('ui.attachThreatIntelLookupNormalise'),
  internal_state:   i18n.t('ui.closeFalsePositiveInternallySet'),
  draft_generation: i18n.t('ui.draftReportCustomerReplyNothing'),
  detection_write:  i18n.t('text.writeWazuhFalsePositiveRule'),
  host_response:    'Host-Isolation, Block (personenwirksam)',
  external_comms:   'Mail/Ticket an Kunden senden',
});

const MODE_LABELS: Record<AutonomyMode, string> = {
  advisory:   'Advisory (L0)',
  assisted:   'Assisted (L1)',
  autonomous: 'Autonomous (L2)',
};

const VERDICT_LABELS: Record<Verdict, string> = {
  needs_more_info:    'Needs More Info',
  false_positive:     'False Positive',
  suspicious:         'Suspicious',
  confirmed_incident: 'Confirmed Incident',
};

const ALL_ACTION_CLASSES: ActionClass[] = [
  'enrichment', 'internal_state', 'draft_generation',
  'detection_write', 'host_response', 'external_comms',
];
const ALL_MODES: AutonomyMode[] = ['advisory', 'assisted', 'autonomous'];
const ALL_VERDICTS: Verdict[] = [
  'needs_more_info', 'false_positive', 'suspicious', 'confirmed_incident',
];

const CEILING_TONE: Record<AutonomyMode, Tone> = {
  advisory:   'danger',
  assisted:   'warning',
  autonomous: 'success',
};

const MODE_TONE = (mode: AutonomyMode): Tone =>
  mode === 'autonomous' ? 'success' : mode === 'assisted' ? 'warning' : 'muted';

// Leeres Formular — Default-werte gemäß ADR-016
const EMPTY_FORM: CreatePolicyBody = {
  customer:             '*',
  actionClass:          'enrichment',
  mode:                 'advisory',
  minVerdict:           'suspicious',
  minConfidence:        0.8,
  requireEvidenceFloor: true,
  maxPerHour:           0,
  enabled:              false,
};

// ── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  page:       { padding: '16px 20px' },
  head:       { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' },
  banner:     { padding: '12px 18px', borderRadius: 'var(--radius)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 },
  bannerWarn: { background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.30)' },
  bannerOk:   { background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' },
  panel:      { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', marginBottom: 16 },
  panelHead:  { padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 10 },
  th:         { textAlign: 'left', fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, padding: '8px 12px', borderBottom: '1px solid var(--border-soft)' },
  td:         { fontSize: 12.5, padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', verticalAlign: 'middle' },
  label:      { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4, display: 'block' },
  input:      { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' as const },
  select:     { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' as const },
  formGrid:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, padding: '16px 18px' },
  formGroup:  { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  row:        { display: 'flex', alignItems: 'center', gap: 8 },
  hint:       { fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.45 },
  ceilingBox: { marginTop: 6, padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.25)', fontSize: 11.5, color: 'var(--warning)' },
  overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal:      { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto' as const },
  modalHead:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' },
  modalFoot:  { display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 18px', borderTop: '1px solid var(--border-soft)' },
  ceilGrid:   { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: '14px 18px' },
  ceilCard:   { background: 'var(--bg-elevated, #1a2233)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' },
  helpLabel:  { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
  helpBulb:   { display: 'inline-flex', alignItems: 'center', color: 'var(--warning)' },
};

// ── Hilfsfunktionen ────────────────────────────────────────────────────────

function ceilingLabel(ceiling: AutonomyMode): string {
  if (ceiling === 'advisory') return 'Human-only (Decke: advisory)';
  if (ceiling === 'assisted') return 'Max. Assisted (Decke)';
  return 'Autonomous erlaubt';
}

function formLabel(text: string, hint: ReactNode) {
  return (
    <span style={s.helpLabel}>
      <span>{text}</span>
      <HelpTip topic="autonomy" hint={hint}>
        <span style={s.helpBulb} aria-label={`${text} erklaeren`}>
          <Lightbulb size={13} aria-hidden />
        </span>
      </HelpTip>
    </span>
  );
}

// ── PolicyForm — Modal für Anlegen/Bearbeiten ──────────────────────────────

interface PolicyFormProps {
  initial: CreatePolicyBody;
  onSave: (body: CreatePolicyBody) => Promise<void>;
  onClose: () => void;
  busy: boolean;
  error: string;
  title: string;
}

function PolicyForm({ initial, onSave, onClose, busy, error, title }: PolicyFormProps) {
  const { t: tr } = useTranslation();
  const [form, setForm] = useState<CreatePolicyBody>(initial);

  function set<K extends keyof CreatePolicyBody>(key: K, value: CreatePolicyBody[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const ceiling = isCeilingViolation(form.actionClass, form.mode);

  return (
    <div
      style={s.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-form-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div style={s.modal}>
        <div style={s.modalHead}>
          <span id="policy-form-title" style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
          <button
            type="button"
            aria-label={tr('common.close')}
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={s.formGrid}>
          {/* customer */}
          <div style={s.formGroup}>
            <label htmlFor="pol-customer" style={s.label}>{formLabel('Mandant (customer) *', (
              <ExampleHint
                title={tr('text.whoPolicyApplies')}
                text={tr('ui.tenantNarrowsDownWhichCustomer')}
                exampleLabel="Beispiel"
                rows={[
                  { label: tr('common.all'), value: '*' },
                  { label: tr('common.single'), value: 'kunde-nord' },
                ]}
                footer={tr('text.youBuildGlobalDefaultPolicy')}
              />
            ))}</label>
            <input
              id="pol-customer"
              style={s.input}
              value={form.customer}
              onChange={(e) => set('customer', e.target.value)}
              placeholder={tr('text.allTenants')}
            />
            <span style={s.hint}>{tr('ui.actsDefaultAllTenants')}</span>
          </div>

          {/* actionClass */}
          <div style={s.formGroup}>
            <label htmlFor="pol-actionClass" style={s.label}>{formLabel('Aktionsklasse *', (
              <ExampleHint
                title={tr('ui.whatKindActionPolicyGoverns')}
                text={tr('ui.actionClassDecidesWhetherOnly')}
                exampleLabel="Typischer Kontrast"
                rows={[
                  { label: 'Vorsichtig', value: 'enrichment' },
                  { label: tr('common.critical'), value: 'host_response' },
                ]}
                footer={tr('ui.moreClassWritesStricterRest')}
              />
            ))}</label>
            <select
              id="pol-actionClass"
              style={s.select}
              value={form.actionClass}
              onChange={(e) => set('actionClass', e.target.value as ActionClass)}
            >
              {ALL_ACTION_CLASSES.map((ac) => (
                <option key={ac} value={ac}>{ACTION_CLASS_LABELS[ac]}</option>
              ))}
            </select>
            <span style={s.hint}>{actionClassDescs()[form.actionClass]}</span>
          </div>

          {/* mode */}
          <div style={s.formGroup}>
            <label htmlFor="pol-mode" style={s.label}>{formLabel('Modus *', (
              <ExampleHint
                title={tr('ui.howFreelyAiMayAct')}
                text={tr('ui.advisoryMeansRecommendationOnlyAssisted')}
                exampleLabel="Sicherer Start"
                rows={[
                  { label: 'Einsteiger', value: 'advisory' },
                  { label: 'Spaeter', value: 'assisted' },
                ]}
                footer={tr('ui.startConservativelyOnlyRaiseAfter')}
              />
            ))}</label>
            <select
              id="pol-mode"
              style={s.select}
              value={form.mode}
              onChange={(e) => set('mode', e.target.value as AutonomyMode)}
            >
              {ALL_MODES.map((m) => (
                <option key={m} value={m}>{MODE_LABELS[m]}</option>
              ))}
            </select>
            {ceiling && (
              <div style={s.ceilingBox}>
                <AlertTriangle size={13} style={{ display: 'inline', marginRight: 5 }} />
                {tr('autonomy.ceilingExceeded', {
                  mode: form.mode,
                  actionClass: ACTION_CLASS_LABELS[form.actionClass],
                  max: ACTION_CLASS_CEILINGS[form.actionClass],
                })}
              </div>
            )}
          </div>

          {/* minVerdict */}
          <div style={s.formGroup}>
            <label htmlFor="pol-minVerdict" style={s.label}>{formLabel('Min. Verdict *', tr('ui.fromWhichVerdictPolicyApplies'))}</label>
            <select
              id="pol-minVerdict"
              style={s.select}
              value={form.minVerdict}
              onChange={(e) => set('minVerdict', e.target.value as Verdict)}
            >
              {ALL_VERDICTS.map((v) => (
                <option key={v} value={v}>{VERDICT_LABELS[v]}</option>
              ))}
            </select>
          </div>

          {/* minConfidence */}
          <div style={s.formGroup}>
            <label htmlFor="pol-minConf" style={s.label}>{formLabel('Min. Confidence', (
              <ExampleHint
                title={tr('ui.howConfidentModelMustMinimum')}
                text={tr('ui.onlyFromThresholdMayPolicy')}
                exampleLabel="Bewaehrter Bereich"
                rows={[
                  { label: 'Vorsichtig', value: '80%' },
                  { label: 'Strenger', value: '90%' },
                ]}
                footer={tr('ui.higherValuesReduceRiskBut')}
              />
            ))}</label>
            <div style={s.row}>
              <input
                id="pol-minConf"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={form.minConfidence}
                onChange={(e) => set('minConfidence', parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 36, textAlign: 'right' }}>
                {Math.round(form.minConfidence * 100)}%
              </span>
            </div>
          </div>

          {/* maxPerHour */}
          <div style={s.formGroup}>
            <label htmlFor="pol-maxPerHour" style={s.label}>{formLabel('Max. pro Stunde', tr('ui.limitsHowOftenPolicyMay'))}</label>
            <input
              id="pol-maxPerHour"
              type="number"
              min={0}
              style={s.input}
              value={form.maxPerHour}
              onChange={(e) => set('maxPerHour', parseInt(e.target.value, 10) || 0)}
            />
            <span style={s.hint}>{tr('ui.0NoLimitCircuitBreaker')}</span>
          </div>

          {/* requireEvidenceFloor */}
          <div style={s.formGroup}>
            <label style={s.label}>{formLabel('Evidence Floor', tr('ui.enforcesSolidDeterministicMinimumEvidence'))}</label>
            <label style={{ ...s.row, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.requireEvidenceFloor}
                onChange={(e) => set('requireEvidenceFloor', e.target.checked)}
              />
              Deterministischen Evidence-Floor voraussetzen
            </label>
            <span style={s.hint}>{tr('ui.mandatoryWritingClassesAdr016')}</span>
          </div>

          {/* enabled */}
          <div style={s.formGroup}>
            <label style={s.label}>{formLabel('Status', tr('ui.onlyEnabledPoliciesEvaluatedWithout'))}</label>
            <label style={{ ...s.row, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
              />{tr('autonomy.policyActivated')}</label>
            <span style={s.hint}>{tr('autonomy.defaultDenyWithoutPolicy')}</span>
          </div>
        </div>

        {error && (
          <div style={{ margin: '0 18px 14px', padding: '8px 12px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        <div style={s.modalFoot}>
          <Button variant="ghost" onClick={onClose}>{tr('common.cancel2')}</Button>
          <Button
            variant="primary"
            icon={busy ? undefined : <Check size={13} />}
            disabled={busy || !form.customer.trim()}
            onClick={() => void onSave(form)}
          >
            {busy ? tr('common.saving') : tr('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── AutonomyPoliciesPage ───────────────────────────────────────────────────

/**
 * Admin-only Seite zur Verwaltung von AutonomyPolicies pro Mandant × Aktionsklasse.
 *
 * WICHTIG: AUTONOMY_ENABLED ist global false (ENV-Schalter).
 * Diese Seite zeigt das prominent an — Policies sind vorbereitet, aber inert.
 * Echte Durchsetzung liegt serverseitig (admin-only Routes).
 * Das Frontend-Render-Gate hier verhindert nur die Anzeige für Nicht-Admins;
 * es ist KEIN Sicherheitsersatz für serverseitige Autorisierung.
 */
export function AutonomyPoliciesPage() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();

  // Render-Gate: nur für Admins sichtbar.
  // HINWEIS: Echte Durchsetzung liegt serverseitig; diese Prüfung ist rein informativ/UI.
  if (!can.admin(user?.role)) {
    return (
      <div style={{ ...s.page, paddingTop: 48, textAlign: 'center' }}>
        <ShieldOff size={40} style={{ color: 'var(--text-dim)', marginBottom: 12 }} />
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{tr('common.accessDenied')}</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>{tr('common.adminOnlyPage')}</div>
      </div>
    );
  }

  return <AutonomyPoliciesContent />;
}

// Inhalt in eigene Komponente ausgelagert, damit der Auth-Guard früh returnen kann
// ohne Hook-Reihenfolge zu verletzen.
function AutonomyPoliciesContent() {
  const { t: tr } = useTranslation();
  const [status, setStatus] = useState<AutonomyStatus | null>(null);
  const [policies, setPolicies] = useState<AutonomyPolicy[] | null>(null);
  const [loadError, setLoadError] = useState('');

  // Formular-State
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AutonomyPolicy | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete-Confirm
  const [deleteTarget, setDeleteTarget] = useState<AutonomyPolicy | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Toast
  const [toast, setToast] = useState('');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function load() {
    try {
      const [statusRes, listRes] = await Promise.all([
        autonomyApi.getStatus(),
        autonomyApi.listPolicies(),
      ]);
      setStatus(statusRes.data);
      setPolicies(listRes.data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : tr('text.loadingFailed2'));
    }
  }

  useEffect(() => { void load(); }, []);

  function openCreate() {
    setEditTarget(null);
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(policy: AutonomyPolicy) {
    setEditTarget(policy);
    setFormError('');
    setFormOpen(true);
  }

  async function handleSave(body: CreatePolicyBody) {
    setFormBusy(true);
    setFormError('');
    try {
      if (editTarget) {
        await autonomyApi.updatePolicy(editTarget.id, body);
        showToast(tr('autonomy.policyUpdated'));
      } else {
        await autonomyApi.createPolicy(body);
        showToast('Policy angelegt.');
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : tr('common.savingFailed2'));
    } finally {
      setFormBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await autonomyApi.deletePolicy(deleteTarget.id);
      showToast(tr('ui.policyDeleted'));
      setDeleteTarget(null);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : tr('ui.deletionFailed'));
    } finally {
      // A5: IMMER zurücksetzen — auch im Erfolgsfall (sonst hing der Button beim nächsten Modal).
      setDeleteBusy(false);
    }
  }

  if (loadError) return <div style={s.page}><ErrorCard message={loadError} /></div>;
  if (!policies) return <div style={s.page}><Spinner /></div>;

  const globalEnabled = status?.enabled ?? false;

  return (
    <div style={s.page}>
      {/* ── Header ── */}
      <div style={s.head}>
        <ShieldCheck size={26} style={{ color: 'var(--accent)', marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            Autonomy Policies{' '}
            <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>/ Admin</span>
            <HelpTip topic="autonomy" />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2 }}>{tr('autonomy.subtitle')}</div>
        </div>
        <Button variant="primary" icon={<Plus size={14} />} onClick={openCreate}>
          Policy anlegen
        </Button>
      </div>

      {/* ── Global-Status-Banner ── */}
      <div style={{ ...s.banner, ...(globalEnabled ? s.bannerOk : s.bannerWarn) }}>
        {globalEnabled
          ? <ShieldCheck size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
          : <AlertTriangle size={18} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {globalEnabled
              ? tr('ui.autonomyEnabledGloballyPoliciesEvaluated')
              : tr('ui.autonomyDisabledGloballyPoliciesPrepared')}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 3 }}>
            {globalEnabled
              ? tr('ui.autonomyEnabledTruePoliciesEnabled')
              : tr('ui.autonomyEnabledFalseDefaultNo')}
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <Badge tone={globalEnabled ? 'success' : 'warning'} dot>
            {globalEnabled ? 'ENABLED' : 'DISABLED'}
          </Badge>
        </div>
      </div>

      {/* ── Decken-Übersicht ── */}
      <div style={s.panel}>
        <div style={s.panelHead}>
          <AlertTriangle size={15} style={{ color: 'var(--warning)' }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>{tr('ui.actionClassCeilingsImmutableAdr')}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-dim)', marginLeft: 8 }}>{tr('autonomy.ceilingsNote')}</span>
        </div>
        <div style={s.ceilGrid}>
          {ALL_ACTION_CLASSES.map((ac) => {
            const ceiling = ACTION_CLASS_CEILINGS[ac];
            return (
              <div key={ac} style={s.ceilCard}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                  {ACTION_CLASS_LABELS[ac]}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                  {actionClassDescs()[ac]}
                </div>
                <Badge tone={CEILING_TONE[ceiling]}>
                  {ceilingLabel(ceiling)}
                </Badge>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Policy-Tabelle ── */}
      <div style={s.panel}>
        <div style={s.panelHead}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>
            Policies ({policies.length})
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Mandant', 'Aktionsklasse', 'Modus', 'Min. Verdict', 'Confidence', 'Max/h', 'Ev.-Floor', 'Status', 'Aktionen'].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {policies.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ ...s.td, textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>{tr('autonomy.nonePolicies')}</td>
                </tr>
              )}
              {policies.map((pol) => {
                const ceilViolated = isCeilingViolation(pol.actionClass, pol.mode);
                return (
                  <tr key={pol.id} style={{ background: ceilViolated ? 'rgba(245,158,11,0.04)' : undefined }}>
                    <td style={{ ...s.td, fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: 12 }}>
                      {pol.customer}
                    </td>
                    <td style={s.td}>
                      <div>{ACTION_CLASS_LABELS[pol.actionClass]}</div>
                      {ceilViolated && (
                        <div style={{ fontSize: 10.5, color: 'var(--warning)', marginTop: 2 }}>
                          Decke: {ACTION_CLASS_CEILINGS[pol.actionClass]}
                        </div>
                      )}
                    </td>
                    <td style={s.td}>
                      <Badge tone={MODE_TONE(pol.mode)}>{MODE_LABELS[pol.mode]}</Badge>
                    </td>
                    <td style={{ ...s.td, fontSize: 12 }}>{VERDICT_LABELS[pol.minVerdict]}</td>
                    <td style={{ ...s.td, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {Math.round(pol.minConfidence * 100)}%
                    </td>
                    <td style={{ ...s.td, fontSize: 12 }}>{pol.maxPerHour === 0 ? '∞' : pol.maxPerHour}</td>
                    <td style={s.td}>
                      <Badge tone={pol.requireEvidenceFloor ? 'success' : 'muted'}>
                        {pol.requireEvidenceFloor ? 'Ja' : 'Nein'}
                      </Badge>
                    </td>
                    <td style={s.td}>
                      <Badge tone={pol.enabled ? 'success' : 'muted'} dot>
                        {pol.enabled ? tr('common.active') : tr('text.inactive')}
                      </Badge>
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Pencil size={12} />}
                          onClick={() => openEdit(pol)}
                          title={tr('common.edit')}
                        >{tr('common.edit2')}</Button>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={<Trash2 size={12} />}
                          onClick={() => setDeleteTarget(pol)}
                          title={tr('common.delete')}
                        >{tr('common.delete3')}</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Anlegen/Bearbeiten-Modal ── */}
      {formOpen && (
        <PolicyForm
          title={editTarget ? tr('autonomy.editPolicyTitle', { customer: editTarget.customer, actionClass: ACTION_CLASS_LABELS[editTarget.actionClass] }) : tr('autonomy.createPolicy')}
          initial={editTarget
            ? {
                customer:             editTarget.customer,
                actionClass:          editTarget.actionClass,
                mode:                 editTarget.mode,
                minVerdict:           editTarget.minVerdict,
                minConfidence:        editTarget.minConfidence,
                requireEvidenceFloor: editTarget.requireEvidenceFloor,
                maxPerHour:           editTarget.maxPerHour,
                enabled:              editTarget.enabled,
              }
            : EMPTY_FORM}
          onSave={handleSave}
          onClose={() => setFormOpen(false)}
          busy={formBusy}
          error={formError}
        />
      )}

      {/* ── Delete-Confirm-Modal ── */}
      {deleteTarget && (
        <div
          style={s.overlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setDeleteTarget(null); }}
        >
          <div style={{ ...s.modal, maxWidth: 420 }}>
            <div style={s.modalHead}>
              <span id="del-modal-title" style={{ fontWeight: 700, fontSize: 14 }}>{tr('ui.deletePolicy')}</span>
              <button
                type="button"
                aria-label={tr('common.close')}
                onClick={() => setDeleteTarget(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{tr('autonomy.policyForTenant')}<strong>{deleteTarget.customer}</strong> ×{' '}
              <strong>{ACTION_CLASS_LABELS[deleteTarget.actionClass]}</strong>{tr('common.deleteQuestionSuffix')}<br />
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                Diese Aktion kann nicht rückgängig gemacht werden.
              </span>
            </div>
            <div style={s.modalFoot}>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>{tr('common.cancel2')}</Button>
              <Button
                variant="danger"
                icon={deleteBusy ? undefined : <Trash2 size={13} />}
                disabled={deleteBusy}
                onClick={() => void handleDelete()}
              >
                {deleteBusy ? tr('ui.deleting') : tr('common.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        // Toast wird per role="status" angesagt; Klick zum Wegklicken ist reine Maus-Ergänzung
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <div
          role="status"
          style={{ position: 'fixed', bottom: 20, right: 20, background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '12px 16px', fontSize: 13, zIndex: 1100, cursor: 'pointer', maxWidth: 360 }}
          onClick={() => setToast('')}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
