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

// ── Konstanten ─────────────────────────────────────────────────────────────

const ACTION_CLASS_LABELS: Record<ActionClass, string> = {
  enrichment:       'Enrichment',
  internal_state:   'Internal State',
  draft_generation: 'Draft Generation',
  detection_write:  'Detection Write',
  host_response:    'Host Response',
  external_comms:   'External Comms',
};

const ACTION_CLASS_DESCS: Record<ActionClass, string> = {
  enrichment:       'TI-Lookup anhängen, Entities normalisieren',
  internal_state:   'FP intern schließen, Tags setzen',
  draft_generation: 'Report-/Kundenantwort-Entwurf (kein Versand)',
  detection_write:  'Wazuh-FP-Regel schreiben + Restart',
  host_response:    'Host-Isolation, Block (personenwirksam)',
  external_comms:   'Mail/Ticket an Kunden senden',
};

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
            aria-label="Schließen"
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
                title="Fuer wen diese Policy gilt"
                text="Der Mandant grenzt ein, fuer welchen Kunden oder Tenant die Regel aktiv sein soll."
                exampleLabel="Beispiel"
                rows={[
                  { label: 'Alle', value: '*' },
                  { label: 'Einzeln', value: 'kunde-nord' },
                ]}
                footer="Mit * baust du eine globale Default-Policy. Einzelne Mandanten koennen spaeter gezielt abweichen."
              />
            ))}</label>
            <input
              id="pol-customer"
              style={s.input}
              value={form.customer}
              onChange={(e) => set('customer', e.target.value)}
              placeholder="* = alle Mandanten"
            />
            <span style={s.hint}>„*" gilt als Default für alle Mandanten.</span>
          </div>

          {/* actionClass */}
          <div style={s.formGroup}>
            <label htmlFor="pol-actionClass" style={s.label}>{formLabel('Aktionsklasse *', (
              <ExampleHint
                title="Welche Art von Aktion die Policy steuert"
                text="Die Aktionsklasse entscheidet, ob es nur um Enrichment geht oder um schreibende, kritische Schritte."
                exampleLabel="Typischer Kontrast"
                rows={[
                  { label: 'Vorsichtig', value: 'enrichment' },
                  { label: 'Kritisch', value: 'host_response' },
                ]}
                footer="Je schreibender die Klasse, desto strenger sollte der Rest der Policy sein."
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
            <span style={s.hint}>{ACTION_CLASS_DESCS[form.actionClass]}</span>
          </div>

          {/* mode */}
          <div style={s.formGroup}>
            <label htmlFor="pol-mode" style={s.label}>{formLabel('Modus *', (
              <ExampleHint
                title="Wie frei die KI handeln darf"
                text="Advisory bedeutet nur Empfehlung, Assisted braucht Bestaetigung, Autonomous darf innerhalb der Decke selbst ausfuehren."
                exampleLabel="Sicherer Start"
                rows={[
                  { label: 'Einsteiger', value: 'advisory' },
                  { label: 'Spaeter', value: 'assisted' },
                ]}
                footer="Starte lieber konservativ und erhoehe erst nach nachweisbar stabilen Ergebnissen."
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
                Mode „{form.mode}" überschreitet die Decke für „{ACTION_CLASS_LABELS[form.actionClass]}"
                (max: {ACTION_CLASS_CEILINGS[form.actionClass]}). Die Policy wäre inert — Backend erzwingt die Decke.
              </div>
            )}
          </div>

          {/* minVerdict */}
          <div style={s.formGroup}>
            <label htmlFor="pol-minVerdict" style={s.label}>{formLabel('Min. Verdict *', 'Ab welchem fachlichen Urteil die Policy ueberhaupt greift, zum Beispiel erst ab suspicious.')}</label>
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
                title="Wie sicher das Modell mindestens sein muss"
                text="Erst ab diesem Schwellenwert darf die Policy fuer den Treffer greifen."
                exampleLabel="Bewaehrter Bereich"
                rows={[
                  { label: 'Vorsichtig', value: '80%' },
                  { label: 'Strenger', value: '90%' },
                ]}
                footer="Hoehere Werte reduzieren Risiko, koennen aber nützliche Automation ausbremsen."
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
            <label htmlFor="pol-maxPerHour" style={s.label}>{formLabel('Max. pro Stunde', 'Begrenzt, wie oft diese Policy pro Stunde feuern darf. 0 bedeutet kein zusaetzliches Limit.')}</label>
            <input
              id="pol-maxPerHour"
              type="number"
              min={0}
              style={s.input}
              value={form.maxPerHour}
              onChange={(e) => set('maxPerHour', parseInt(e.target.value, 10) || 0)}
            />
            <span style={s.hint}>0 = kein Limit (Circuit-Breaker bleibt aktiv).</span>
          </div>

          {/* requireEvidenceFloor */}
          <div style={s.formGroup}>
            <label style={s.label}>{formLabel('Evidence Floor', 'Erzwingt einen belastbaren, deterministischen Mindestbeleg bevor die Policy wirksam wird.')}</label>
            <label style={{ ...s.row, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.requireEvidenceFloor}
                onChange={(e) => set('requireEvidenceFloor', e.target.checked)}
              />
              Deterministischen Evidence-Floor voraussetzen
            </label>
            <span style={s.hint}>Pflicht für schreibende Klassen (ADR-016).</span>
          </div>

          {/* enabled */}
          <div style={s.formGroup}>
            <label style={s.label}>{formLabel('Status', 'Nur aktivierte Policies werden ausgewertet. Ohne aktive Policy bleibt das Verhalten beim Default-Deny.')}</label>
            <label style={{ ...s.row, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
              />
              Policy aktiviert
            </label>
            <span style={s.hint}>Ohne aktive Policy gilt Default-Deny (advisory).</span>
          </div>
        </div>

        {error && (
          <div style={{ margin: '0 18px 14px', padding: '8px 12px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        <div style={s.modalFoot}>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            icon={busy ? undefined : <Check size={13} />}
            disabled={busy || !form.customer.trim()}
            onClick={() => void onSave(form)}
          >
            {busy ? 'Speichern …' : 'Speichern'}
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
  const { user } = useAuth();

  // Render-Gate: nur für Admins sichtbar.
  // HINWEIS: Echte Durchsetzung liegt serverseitig; diese Prüfung ist rein informativ/UI.
  if (!can.admin(user?.role)) {
    return (
      <div style={{ ...s.page, paddingTop: 48, textAlign: 'center' }}>
        <ShieldOff size={40} style={{ color: 'var(--text-dim)', marginBottom: 12 }} />
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Zugriff verweigert</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>
          Diese Seite ist nur für Administratoren zugänglich.
        </div>
      </div>
    );
  }

  return <AutonomyPoliciesContent />;
}

// Inhalt in eigene Komponente ausgelagert, damit der Auth-Guard früh returnen kann
// ohne Hook-Reihenfolge zu verletzen.
function AutonomyPoliciesContent() {
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
      setLoadError(e instanceof Error ? e.message : 'Laden fehlgeschlagen');
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
        showToast('Policy aktualisiert.');
      } else {
        await autonomyApi.createPolicy(body);
        showToast('Policy angelegt.');
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setFormBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await autonomyApi.deletePolicy(deleteTarget.id);
      showToast('Policy gelöscht.');
      setDeleteTarget(null);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Löschen fehlgeschlagen');
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
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2 }}>
            Policy-Verwaltung pro Mandant × Aktionsklasse (ADR-016).
            Policies sind vorbereitet — Aktivierung erfolgt über den globalen Kill-Switch.
          </div>
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
              ? 'Autonomie global aktiviert — Policies werden ausgewertet'
              : 'Autonomie global deaktiviert — Policies sind vorbereitet, aber inert'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 3 }}>
            {globalEnabled
              ? 'ENV AUTONOMY_ENABLED=true. Policies mit enabled=true werden aktiv ausgewertet.'
              : 'ENV AUTONOMY_ENABLED=false (Default). Kein Mandant erhält autonome Aktionen — unabhängig von Policy-Konfiguration. Zum Aktivieren AUTONOMY_ENABLED=true setzen und Server neu starten.'}
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
          <span style={{ fontSize: 13, fontWeight: 700 }}>Aktionsklassen-Decken (unveränderlich, ADR-016)</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-dim)', marginLeft: 8 }}>
            Policies können diese Decken nicht überschreiten — das Backend erzwingt sie.
          </span>
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
                  {ACTION_CLASS_DESCS[ac]}
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
                  <td colSpan={9} style={{ ...s.td, textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                    Noch keine Policies angelegt. Klicke „Policy anlegen" um zu beginnen.
                  </td>
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
                        {pol.enabled ? 'Aktiv' : 'Inaktiv'}
                      </Badge>
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Pencil size={12} />}
                          onClick={() => openEdit(pol)}
                          title="Bearbeiten"
                        >
                          Bearbeiten
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={<Trash2 size={12} />}
                          onClick={() => setDeleteTarget(pol)}
                          title="Löschen"
                        >
                          Löschen
                        </Button>
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
          title={editTarget ? `Policy bearbeiten: ${editTarget.customer} × ${ACTION_CLASS_LABELS[editTarget.actionClass]}` : 'Policy anlegen'}
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
              <span id="del-modal-title" style={{ fontWeight: 700, fontSize: 14 }}>Policy löschen?</span>
              <button
                type="button"
                aria-label="Schließen"
                onClick={() => setDeleteTarget(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
              Policy für Mandant <strong>{deleteTarget.customer}</strong> ×{' '}
              <strong>{ACTION_CLASS_LABELS[deleteTarget.actionClass]}</strong> löschen?
              <br />
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                Diese Aktion kann nicht rückgängig gemacht werden.
              </span>
            </div>
            <div style={s.modalFoot}>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Abbrechen</Button>
              <Button
                variant="danger"
                icon={deleteBusy ? undefined : <Trash2 size={13} />}
                disabled={deleteBusy}
                onClick={() => void handleDelete()}
              >
                {deleteBusy ? 'Löschen …' : 'Löschen'}
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
