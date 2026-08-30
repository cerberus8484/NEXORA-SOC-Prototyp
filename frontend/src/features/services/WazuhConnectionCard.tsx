import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Cable, PlugZap, CheckCircle2, ShieldAlert, Save } from 'lucide-react';
import { Badge, Button, Field, Input, Spinner, HelpLabel, ExampleHint } from '../../components/ui';
import { servicesApi, type ConnectionTestResult } from './servicesApi';
import {
  sectionFormFromMasked, sectionPatch, sectionError, sourceLabel,
  type MaskedConnection, type SectionForm,
} from './wazuhConnectionModel';
import { ArmPasswordDialog } from './ArmPasswordDialog';
import { ApiError } from '../../lib/apiClient';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

// Wazuh-Verbindung (Layer 2): URL/Benutzer/Passwort für Wazuh-API + Indexer aus
// der UI verwalten — verschlüsselt in der DB, ENV bleibt Fallback. Speichern nur
// mit Passwort-Step-up; der Verbindungstest speichert NICHTS.

const s: Record<string, CSSProperties> = {
  card:      { position: 'relative', overflow: 'hidden',
               background: 'linear-gradient(160deg, var(--bg-card) 0%, color-mix(in srgb, var(--bg-card) 88%, var(--accent)) 140%)',
               border: '1px solid var(--border)', borderRadius: 'var(--radius)',
               display: 'flex', flexDirection: 'column', gap: 16, padding: 18 },
  top:       { display: 'flex', alignItems: 'flex-start', gap: 12 },
  iconBox:   { width: 40, height: 40, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
               background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
               border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' },
  name:      { fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0 },
  desc:      { fontSize: 12.5, color: 'var(--text-dim)', margin: '4px 0 0', lineHeight: 1.6, maxWidth: 760 },

  sections:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 },
  section:   { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--border-soft)',
               borderRadius: 'var(--radius-sm)', padding: 14 },
  secHead:   { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  secTitle:  { fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 },

  inlineErr: { fontSize: 11.5, color: 'var(--danger)', lineHeight: 1.5 },
  testRow:   { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const },
  testMsg:   { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, lineHeight: 1.5 },

  footer:    { display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--border-soft)',
               paddingTop: 14, flexWrap: 'wrap' as const },
  feedback:  { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, padding: '9px 12px',
               borderRadius: 'var(--radius-sm)', lineHeight: 1.5 },
};

type SectionKey = 'api' | 'indexer';

const sectionMeta = (): Record<SectionKey, { title: string; hint: string }> => ({
  api:     { title: 'Wazuh-API',     hint: i18n.t('settings.wazuhManagerApiHint') },
  indexer: { title: 'Wazuh-Indexer', hint: i18n.t('ui.opensearchPort9200DashboardTelemetry') },
});

interface SaveFeedback {
  tone: 'success' | 'error';
  text: string;
}

/** Testergebnis-Zeile — ehrlich inkl. Fehlergrund und Latenz. */
function TestResultLine({ result }: { result: ConnectionTestResult }) {
  const { t: tr } = useTranslation();
  if (result.ok) {
    return (
      <span style={{ ...s.testMsg, color: 'var(--success)' }}>
        <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
        Verbindung ok ({result.latencyMs} ms)
      </span>
    );
  }
  return (
    <span style={{ ...s.testMsg, color: 'var(--danger)' }}>
      <ShieldAlert size={13} style={{ flexShrink: 0 }} />
      Fehlgeschlagen: {result.error ?? tr('common.unknownError')}
    </span>
  );
}

/**
 * Verwaltungs-Karte der Wazuh-Verbindung (admin-only, unter Services).
 * Läd die maskierte Sicht (NIE Passwörter), erlaubt Ändern + Testen und speichert
 * mit Passwort-Step-up. Herkunft (UI/ENV/nicht konfiguriert) wird ehrlich angezeigt.
 */
export function WazuhConnectionCard() {
  const { t: tr } = useTranslation();
  const [masked, setMasked] = useState<MaskedConnection | null>(null);
  const [loadError, setLoadError] = useState('');
  const [forms, setForms] = useState<Record<SectionKey, SectionForm>>({
    api: { url: '', user: '', password: '' },
    indexer: { url: '', user: '', password: '' },
  });
  const [tests, setTests] = useState<Partial<Record<SectionKey, ConnectionTestResult>>>({});
  const [testBusy, setTestBusy] = useState<Partial<Record<SectionKey, boolean>>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Pro Sektion die zuletzt gestartete Test-Anfrage — verwirft veraltete Antworten,
  // wenn schnell hintereinander getestet wird ("last request wins", nicht "last response").
  const testSeq = useRef<Record<SectionKey, number>>({ api: 0, indexer: 0 });

  useEffect(() => {
    const ctrl = new AbortController();
    setLoadError('');
    servicesApi.getWazuhConnection({ signal: ctrl.signal })
      .then((res) => applyMasked(res.data))
      .catch(() => {
        if (!ctrl.signal.aborted) setLoadError(i18n.t('ui.wazuhConnectionCouldNotLoaded'));
      });
    return () => ctrl.abort();
  }, [reloadKey]);

  function applyMasked(conn: MaskedConnection) {
    setMasked(conn);
    setForms({ api: sectionFormFromMasked(conn.api), indexer: sectionFormFromMasked(conn.indexer) });
  }

  function setField(section: SectionKey, field: keyof SectionForm, value: string) {
    setForms((prev) => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
  }

  async function runTest(section: SectionKey) {
    const formState = forms[section];
    const seq = testSeq.current[section] + 1;
    testSeq.current[section] = seq;
    // Nur die jüngste Anfrage darf State setzen (verwirft überholte Antworten).
    const isStale = () => testSeq.current[section] !== seq;

    setTestBusy((prev) => ({ ...prev, [section]: true }));
    setTests((prev) => ({ ...prev, [section]: undefined }));
    try {
      // Leere Felder testen serverseitig die effektive Verbindung (inkl. gespeichertem Passwort).
      const res = await servicesApi.testWazuhConnection({
        target: section, url: formState.url.trim(), user: formState.user.trim(), password: formState.password,
      });
      if (isStale()) return;
      setTests((prev) => ({ ...prev, [section]: res.data }));
    } catch (err) {
      if (isStale()) return;
      const message = err instanceof ApiError && err.status === 400
        ? tr('ui.invalidInputUrlMustPoint')
        : tr('ui.testFailedServerReachable');
      setTests((prev) => ({ ...prev, [section]: { ok: false, latencyMs: 0, error: message } }));
    } finally {
      if (!isStale()) setTestBusy((prev) => ({ ...prev, [section]: false }));
    }
  }

  async function doSave(stepUpPassword: string) {
    if (!masked) return;
    setSaving(true);
    setDialogError('');
    try {
      const payload: { password: string; api?: ReturnType<typeof sectionPatch>; indexer?: ReturnType<typeof sectionPatch> } = {
        password: stepUpPassword,
        api: sectionPatch(forms.api, masked.api),
        indexer: sectionPatch(forms.indexer, masked.indexer),
      };
      const res = await servicesApi.saveWazuhConnection(payload);
      applyMasked(res.data);
      setDialogOpen(false);
      setFeedback({ tone: 'success', text: tr('ui.wazuhConnectionSavedEffectiveImmediately') });
      setTests({});
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 403) {
        setDialogError(tr('common.invalidPassword'));
      } else if (status === 400) {
        setDialogOpen(false);
        setFeedback({ tone: 'error', text: tr('ui.saveRejectedInputIncompleteUrl') });
      } else {
        setDialogOpen(false);
        setFeedback({ tone: 'error', text: tr('common.savingFailed') });
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div style={s.card}>
        <div style={s.top}>
          <div style={s.iconBox}><Cable size={20} style={{ color: 'var(--accent)' }} /></div>
          <div style={{ flex: 1 }}>
            <p style={s.name}>{tr('settings.wazuhConnection')}</p>
            <p style={{ ...s.inlineErr, marginTop: 6 }}>{loadError}</p>
            <Button size="sm" variant="ghost" style={{ marginTop: 10 }} onClick={() => setReloadKey((k) => k + 1)}>
              Erneut versuchen
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!masked) {
    return <div style={s.card}><Spinner /></div>;
  }

  const errors: Record<SectionKey, string> = {
    api: sectionError(forms.api, masked.api),
    indexer: sectionError(forms.indexer, masked.indexer),
  };
  const hasChanges = sectionPatch(forms.api, masked.api) !== undefined
    || sectionPatch(forms.indexer, masked.indexer) !== undefined;
  const hasErrors = errors.api !== '' || errors.indexer !== '';

  return (
    <div style={s.card}>
      <div style={s.top}>
        <div style={s.iconBox}><Cable size={20} style={{ color: 'var(--accent)' }} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={s.name}>{tr('settings.wazuhConnection')}</p>
          <p style={s.desc}>{tr('settings.wazuhIntro')}</p>
        </div>
      </div>

      <div style={s.sections}>
        {(Object.keys(sectionMeta()) as SectionKey[]).map((key) => {
          const meta = sectionMeta()[key];
          const maskedSection = masked[key];
          const formState = forms[key];
          const test = tests[key];
          return (
            <div key={key} style={s.section}>
              <div style={s.secHead}>
                <p style={s.secTitle}>{meta.title}</p>
                <Badge tone={maskedSection.source === 'none' ? 'muted' : maskedSection.source === 'db' ? 'success' : 'accent'}>
                  {sourceLabel(maskedSection.source)}
                </Badge>
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>{meta.hint}</p>

              <Field label={<HelpLabel text="URL" topic="integrationen" hint={(
                <ExampleHint
                  title={tr('ui.whereNexoraConnectsWazuhSection')}
                  text={tr('ui.actualTargetAddressApiIndexer')}
                  exampleLabel={tr('common.typicalTargets')}
                  rows={key === 'api'
                    ? [{ label: 'API', value: 'https://wazuh.nexora.local:55000' }]
                    : [{ label: 'Indexer', value: 'https://wazuh-indexer.nexora.local:9200' }]}
                  footer={tr('ui.apiIndexerDeliberatelySeparateAlways')}
                />
              )} />}>
                <Input
                  value={formState.url}
                  placeholder="https://10.x.x.x:Port"
                  onChange={(e) => setField(key, 'url', e.target.value)}
                />
              </Field>
              <Field label={<HelpLabel text={tr('common.users')} topic="integrationen" hint={(
                <ExampleHint
                  title={tr('text.whichAccountNexoraUses')}
                  text={tr('ui.usernameMustBelongTechnicalService')}
                  exampleLabel="Beispiele"
                  rows={key === 'api'
                    ? [{ label: 'API-User', value: 'nexora-api' }]
                    : [{ label: 'Indexer-User', value: 'nexora-indexer' }]}
                  footer={tr('text.useDedicatedTechnicalAccountsBoth')}
                />
              )} />}>
                <Input
                  value={formState.user}
                  autoComplete="off"
                  onChange={(e) => setField(key, 'user', e.target.value)}
                />
              </Field>
              <Field label={<HelpLabel text={tr('common.password')} topic="integrationen" hint={(
                <ExampleHint
                  title={tr('ui.secretSelectedServiceAccount')}
                  text={tr('ui.useFieldOnlySetRotate')}
                  exampleLabel="Praxis"
                  rows={[
                    { label: tr('common.reset'), value: tr('settings.enterSave') },
                    { label: 'Behalten', value: tr('settings.leaveFieldEmpty') },
                  ]}
                  footer={tr('ui.interfaceNeverShowsYouExisting')}
                />
              )} />}>
                <Input
                  type="password"
                  value={formState.password}
                  autoComplete="new-password"
                  placeholder={maskedSection.passwordSet ? tr('ui.storedLeaveEmptyKeep') : ''}
                  onChange={(e) => setField(key, 'password', e.target.value)}
                />
              </Field>

              {errors[key] !== '' && <span style={s.inlineErr} role="alert">{errors[key]}</span>}

              <div style={s.testRow}>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<PlugZap size={13} />}
                  disabled={testBusy[key] === true}
                  onClick={() => runTest(key)}
                >
                  {testBusy[key] === true ? 'Teste…' : tr('settings.testConnection')}
                </Button>
                {test && <TestResultLine result={test} />}
              </div>
            </div>
          );
        })}
      </div>

      <div style={s.footer}>
        <Button
          variant="primary"
          icon={<Save size={14} />}
          disabled={!hasChanges || hasErrors || saving}
          onClick={() => { setDialogError(''); setFeedback(null); setDialogOpen(true); }}
        >{tr('common.save')}</Button>
        {!hasChanges && (
          <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{tr('common.noChanges')}</span>
        )}
        {feedback && (
          <div
            role="status"
            style={{
              ...s.feedback,
              color: feedback.tone === 'success' ? 'var(--success)' : 'var(--danger)',
              background: `color-mix(in srgb, ${feedback.tone === 'success' ? 'var(--success)' : 'var(--danger)'} 10%, transparent)`,
              border: `1px solid ${feedback.tone === 'success' ? 'var(--success)' : 'var(--danger)'}`,
            }}
          >
            {feedback.tone === 'success'
              ? <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              : <ShieldAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
            <span>{feedback.text}</span>
          </div>
        )}
      </div>

      <ArmPasswordDialog
        open={dialogOpen}
        busy={saving}
        error={dialogError}
        title={tr('ui.confirmConnectionChange')}
        description={
          tr('ui.confirmYourPasswordSaveWazuh') + ' '
          + tr('ui.storedEncryptedChangeLoggedTakes')
        }
        confirmLabel={tr('common.save')}
        onConfirm={doSave}
        onCancel={() => setDialogOpen(false)}
      />
    </div>
  );
}
