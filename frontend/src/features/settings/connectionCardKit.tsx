import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { PlugZap, CheckCircle2, ShieldAlert, Save } from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button, Spinner } from '../../components/ui';
import { ArmPasswordDialog } from '../services/ArmPasswordDialog';
import { ApiError } from '../../lib/apiClient';
import { useTranslation } from 'react-i18next';

// Geteilte Bausteine der Layer-2-Verbindungs-Karten (CrowdSec/QRadar/Qdrant/IMAP …).
// Vorher war der State + Save-/Test-Flow + die JSX-Shell in jeder Karte 1:1 dupliziert.
// Hier gebündelt: der Zustands-Hook `useConnectionCard`, die Shell `ConnectionCardShell`
// und die identischen Präsentations-Teile (Styles, TestLine). Jede Karte liefert nur
// noch ihre Felder + Modell-Funktionen + Texte.

export type ConnectionSource = 'db' | 'env' | 'none';

/** Einheitliches Testergebnis aller Verbindungs-Endpunkte. */
export interface ConnTestResult { ok: boolean; latencyMs?: number; reason?: string; error?: string; warning?: string; }

interface MaskedBase { source: ConnectionSource; }
interface SaveFeedback { tone: 'success' | 'error'; text: string; }

export const cardStyles: Record<string, CSSProperties> = {
  hint:     { fontSize: 12.5, color: 'var(--text-dim)', margin: 0, lineHeight: 1.6, maxWidth: 760 },
  head:     { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  inlineErr:{ fontSize: 11.5, color: 'var(--danger)', lineHeight: 1.5 },
  row2:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  testRow:  { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  testMsg:  { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, lineHeight: 1.5 },
  footer:   { display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--border-soft)', paddingTop: 14, flexWrap: 'wrap' },
  feedback: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '8px 12px', borderRadius: 'var(--radius-sm)' },
};

/** Ehrliche Testzeile: ok / nicht konfiguriert / Fehlgeschlagen (identisch für alle Karten).
 *  Eine etwaige Klartext-Warnung (http zu externem Ziel) wird orthogonal darunter gezeigt —
 *  auch bei „Verbindung ok", da sie ein Sicherheitshinweis ist, kein Verbindungsfehler. */
export function TestLine({ result }: { result: ConnTestResult }) {
  const { t: tr } = useTranslation();
  const status = result.ok
    ? <span style={{ ...cardStyles.testMsg, color: 'var(--success)' }}><CheckCircle2 size={13} /> Verbindung ok{result.latencyMs != null ? ` (${result.latencyMs} ms)` : ''}</span>
    : (() => {
        const notConfigured = result.reason === 'not_configured';
        const label = notConfigured ? tr('text.notConfigured') : tr('common.failedWith', { reason: result.error ?? result.reason ?? tr('common.unknown') });
        return <span style={{ ...cardStyles.testMsg, color: notConfigured ? 'var(--text-dim)' : 'var(--danger)' }}><ShieldAlert size={13} /> {label}</span>;
      })();
  if (!result.warning) return status;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      {status}
      <span style={{ ...cardStyles.testMsg, color: 'var(--warning)' }}><ShieldAlert size={13} /> {result.warning}</span>
    </span>
  );
}

/** Karten-spezifische Verdrahtung; der Hook kapselt den gemeinsamen Ablauf. */
export interface ConnectionCardConfig<M extends MaskedBase, F, P> {
  fetchConnection: () => Promise<M>;
  saveConnection: (payload: { password: string } & P) => Promise<M>;
  testConnection: (form: F) => Promise<ConnTestResult>;
  formFromMasked: (m: M) => F;
  buildPatch: (form: F, masked: M) => P | null;
  connError: (form: F, masked: M) => string;
  emptyForm: F;               // Initialer Formularzustand (vor dem Laden nicht sichtbar).
  emptyPatch: P;              // Lösch-Patch (Sektion → ENV).
  loadErrorText: string;
  successText: string;
  testErrorText: (status: number) => string;
  saveErrorText: (status: number) => string;
}

export interface ConnectionCardController<M, F> {
  masked: M | null;
  form: F;
  setForm: Dispatch<SetStateAction<F>>;
  loadError: string;
  reload: () => void;
  test: ConnTestResult | null;
  testBusy: boolean;
  runTest: () => Promise<void>;
  dialogOpen: boolean;
  dialogError: string;
  saving: boolean;
  feedback: SaveFeedback | null;
  err: string;
  canSave: boolean;
  openSave: () => void;
  closeDialog: () => void;
  doSave: (stepUpPassword: string) => Promise<void>;
}

/**
 * Gemeinsamer Zustands-/Ablauf-Hook: Laden (mit Reload), Formular, Verbindungstest
 * (mit Race-Guard), Speichern über den Step-up-Dialog inkl. Feedback. Alle Karten
 * teilen sich damit exakt dasselbe Verhalten — die Unterschiede stehen in der Config.
 */
export function useConnectionCard<M extends MaskedBase, F, P>(cfg: ConnectionCardConfig<M, F, P>): ConnectionCardController<M, F> {
  const { t: tr } = useTranslation();
  const [masked, setMasked] = useState<M | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<F>(cfg.emptyForm);
  const [test, setTest] = useState<ConnTestResult | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  const testSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    setLoadError('');
    cfg.fetchConnection()
      .then((data) => { if (alive) { setMasked(data); setForm(cfg.formFromMasked(data)); } })
      .catch(() => { if (alive) setLoadError(cfg.loadErrorText); });
    return () => { alive = false; };
    // cfg ist beim Karten-Render stabil (Modul-/API-Referenzen); reloadKey triggert das Neuladen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  async function runTest() {
    const seq = testSeq.current + 1;
    testSeq.current = seq;
    const stale = () => testSeq.current !== seq;
    setTestBusy(true);
    setTest(null);
    try {
      const res = await cfg.testConnection(form);
      if (!stale()) setTest(res);
    } catch (err) {
      if (!stale()) {
        const status = err instanceof ApiError ? err.status : 0;
        setTest({ ok: false, reason: 'error', error: cfg.testErrorText(status) });
      }
    } finally {
      if (!stale()) setTestBusy(false);
    }
  }

  async function doSave(stepUpPassword: string) {
    if (!masked) return;
    setSaving(true);
    setDialogError('');
    try {
      const patch = cfg.buildPatch(form, masked) ?? cfg.emptyPatch;
      const next = await cfg.saveConnection({ password: stepUpPassword, ...patch });
      setMasked(next);
      setForm(cfg.formFromMasked(next));
      setDialogOpen(false);
      setTest(null);
      setFeedback({ tone: 'success', text: cfg.successText });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 403) setDialogError(tr('common.invalidPassword'));
      else { setDialogOpen(false); setFeedback({ tone: 'error', text: cfg.saveErrorText(status) }); }
    } finally {
      setSaving(false);
    }
  }

  const err = masked ? cfg.connError(form, masked) : '';
  const canSave = masked ? (cfg.buildPatch(form, masked) !== null && err === '') : false;

  return {
    masked, form, setForm, loadError, reload: () => setReloadKey((k) => k + 1),
    test, testBusy, runTest, dialogOpen, dialogError, saving, feedback, err, canSave,
    openSave: () => { setDialogError(''); setFeedback(null); setDialogOpen(true); },
    closeDialog: () => setDialogOpen(false),
    doSave,
  };
}

export interface ConnectionCardShellProps<M extends MaskedBase, F> {
  title: string;
  icon: ReactNode;
  hint: ReactNode;
  sourceLabel: (source: ConnectionSource) => string;
  dialogTitle: string;
  dialogDescription: string;
  controller: ConnectionCardController<M, F>;
  children: ReactNode; // die karten-spezifischen Felder
}

/** Gemeinsame Karten-Shell: Header, Ladefehler/Spinner, Badge+Hinweis, Testzeile,
 *  Speichern-Footer+Feedback und der Step-up-Dialog. Die Felder kommen als children. */
export function ConnectionCardShell<M extends MaskedBase, F>({
  title, icon, hint, sourceLabel, dialogTitle, dialogDescription, controller, children,
}: ConnectionCardShellProps<M, F>) {
  const { t: tr } = useTranslation();
  const c = controller;
  return (
    <Card>
      <CardHeader title={title} actions={icon} />
      <CardBody>
        {c.loadError ? (
          <div>
            <p style={{ fontSize: 12.5, color: 'var(--danger)', margin: 0 }}>{c.loadError}</p>
            <Button size="sm" variant="ghost" style={{ marginTop: 10 }} onClick={c.reload}>{tr('common.retry')}</Button>
          </div>
        ) : c.masked === null ? (
          <Spinner />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={cardStyles.head}>
                <Badge tone={c.masked.source === 'none' ? 'muted' : c.masked.source === 'db' ? 'success' : 'accent'}>
                  {sourceLabel(c.masked.source)}
                </Badge>
              </div>
              <p style={cardStyles.hint}>{hint}</p>
            </div>

            {children}
            {c.err !== '' && <span style={cardStyles.inlineErr} role="alert">{c.err}</span>}

            <div style={cardStyles.testRow}>
              <Button size="sm" variant="ghost" icon={<PlugZap size={13} />} disabled={c.testBusy} onClick={c.runTest}>
                {c.testBusy ? 'Teste…' : tr('settings.testConnection')}
              </Button>
              {c.test && <TestLine result={c.test} />}
            </div>

            <div style={cardStyles.footer}>
              <Button variant="primary" icon={<Save size={14} />} disabled={!c.canSave || c.saving} onClick={c.openSave}>{tr('common.save')}</Button>
              {!c.canSave && <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{tr('common.noChanges')}</span>}
              {c.feedback && (
                <div role="status" style={{
                  ...cardStyles.feedback,
                  color: c.feedback.tone === 'success' ? 'var(--success)' : 'var(--danger)',
                  background: `color-mix(in srgb, ${c.feedback.tone === 'success' ? 'var(--success)' : 'var(--danger)'} 10%, transparent)`,
                  border: `1px solid ${c.feedback.tone === 'success' ? 'var(--success)' : 'var(--danger)'}`,
                }}>
                  {c.feedback.tone === 'success' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                  <span>{c.feedback.text}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </CardBody>

      <ArmPasswordDialog
        open={c.dialogOpen}
        busy={c.saving}
        error={c.dialogError}
        title={dialogTitle}
        description={dialogDescription}
        confirmLabel={tr('common.save')}
        onConfirm={c.doSave}
        onCancel={c.closeDialog}
      />
    </Card>
  );
}
