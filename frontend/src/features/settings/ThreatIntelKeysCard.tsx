import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Shield, PlugZap, CheckCircle2, ShieldAlert, Save } from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button, Field, Input, Spinner, HelpLabel, ExampleHint } from '../../components/ui';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import {
  fetchTiKeys, saveTiKeys, testTiProvider, type TiTestResult,
} from './settingsApi';
import {
  TI_PROVIDER_META, tiSourceLabel, buildTiSavePatch, hasTiChanges,
  type TiKeyStatus, type TiKeyForm, type TiProvider,
} from './tiKeysModel';

// Threat-Intel-Provider-Keys (Layer 2): VirusTotal + AbuseIPDB admin-seitig
// verwalten — verschlüsselt in der DB, ENV bleibt Fallback. GET liefert nie einen
// Key-Wert (nur keySet + Quelle). Speichern rekonfiguriert die Provider sofort.

const s: Record<string, CSSProperties> = {
  grid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 },
  provider: { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-sm)', padding: 14 },
  head:     { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  title:    { fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 },
  hint:     { fontSize: 11.5, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 },
  testRow:  { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const },
  testMsg:  { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, lineHeight: 1.5 },
  footer:   { display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--border-soft)',
              paddingTop: 14, marginTop: 4, flexWrap: 'wrap' as const },
  feedback: { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, padding: '9px 12px',
              borderRadius: 'var(--radius-sm)', lineHeight: 1.5 },
};

interface SaveFeedback { tone: 'success' | 'error'; text: string; }

function TestLine({ result }: { result: TiTestResult }) {
  const { t: tr } = useTranslation();
  if (result.ok) {
    return (
      <span style={{ ...s.testMsg, color: 'var(--success)' }}>
        <CheckCircle2 size={13} style={{ flexShrink: 0 }} /> Verbindung ok{result.latencyMs != null ? ` (${result.latencyMs} ms)` : ''}
      </span>
    );
  }
  const label = result.reason === 'not_configured'
    ? tr('text.noKeySet')
    : tr('common.failedWith', { reason: result.error ?? result.reason ?? tr('common.unknown') });
  return (
    <span style={{ ...s.testMsg, color: result.reason === 'not_configured' ? 'var(--text-dim)' : 'var(--danger)' }}>
      <ShieldAlert size={13} style={{ flexShrink: 0 }} /> {label}
    </span>
  );
}

/**
 * Threat-Intel-Keys-Karte (admin-only, Integrations-Tab). Läd maskierten Status,
 * erlaubt Key-Eingabe (leer = unverändert), Verbindungstest und Speichern.
 */
export function ThreatIntelKeysCard() {
  const { t: tr } = useTranslation();
  const [status, setStatus] = useState<TiKeyStatus[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<TiKeyForm>({ virustotal: '', abuseipdb: '' });
  const [tests, setTests] = useState<Partial<Record<TiProvider, TiTestResult>>>({});
  const [testBusy, setTestBusy] = useState<Partial<Record<TiProvider, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  const testSeq = useRef<Record<TiProvider, number>>({ virustotal: 0, abuseipdb: 0 });

  useEffect(() => {
    let alive = true;
    setLoadError('');
    fetchTiKeys()
      .then((data) => { if (alive) setStatus(data); })
      .catch(() => { if (alive) setLoadError(i18n.t('settings.threatIntelKeysCouldNot')); });
    return () => { alive = false; };
  }, [reloadKey]);

  const setField = (provider: TiProvider, value: string) =>
    setForm((prev) => ({ ...prev, [provider]: value }));

  async function runTest(provider: TiProvider) {
    const seq = testSeq.current[provider] + 1;
    testSeq.current[provider] = seq;
    const isStale = () => testSeq.current[provider] !== seq;
    const candidate = form[provider].trim();

    setTestBusy((prev) => ({ ...prev, [provider]: true }));
    setTests((prev) => ({ ...prev, [provider]: undefined }));
    try {
      const res = await testTiProvider(provider, candidate !== '' ? candidate : undefined);
      if (!isStale()) setTests((prev) => ({ ...prev, [provider]: res }));
    } catch {
      if (!isStale()) setTests((prev) => ({ ...prev, [provider]: { ok: false, error: tr('settings.testFailedDot') } }));
    } finally {
      if (!isStale()) setTestBusy((prev) => ({ ...prev, [provider]: false }));
    }
  }

  async function doSave() {
    setSaving(true);
    setFeedback(null);
    try {
      const next = await saveTiKeys(buildTiSavePatch(form));
      setStatus(next);
      setForm({ virustotal: '', abuseipdb: '' }); // eingegebene Keys nicht im State halten
      setTests({});
      setFeedback({ tone: 'success', text: tr('settings.threatIntelKeysSavedActive') });
    } catch {
      setFeedback({ tone: 'error', text: tr('common.savingFailed') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Threat-Intel-Keys"
        actions={<Shield size={15} style={{ color: 'var(--accent)' }} />}
      />
      <CardBody>
        {loadError ? (
          <div>
            <p style={{ fontSize: 12.5, color: 'var(--danger)', margin: 0 }}>{loadError}</p>
            <Button size="sm" variant="ghost" style={{ marginTop: 10 }} onClick={() => setReloadKey((k) => k + 1)}>
              Erneut versuchen
            </Button>
          </div>
        ) : status === null ? (
          <Spinner />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: 0, lineHeight: 1.6, maxWidth: 760 }}>{tr('settings.tiKeysIntro')}</p>

            <div style={s.grid}>
              {TI_PROVIDER_META.map((meta) => {
                const st = status.find((p) => p.provider === meta.provider);
                const source = st?.source ?? 'none';
                const test = tests[meta.provider];
                return (
                  <div key={meta.provider} style={s.provider}>
                    <div style={s.head}>
                      <p style={s.title}>{meta.label}</p>
                      <Badge tone={source === 'none' ? 'muted' : source === 'db' ? 'success' : 'accent'}>
                        {tiSourceLabel(source)}
                      </Badge>
                      {st?.keySet && <Badge tone="muted">Key gesetzt</Badge>}
                    </div>
                    <p style={s.hint}>{meta.docsHint}</p>

                    <Field label={<HelpLabel text="API-Key" topic="integrationen" hint={(
                      <ExampleHint
                        title={tr('settings.tiKeyFor', { label: meta.label })}
                        text={tr('settings.enterActualProviderKeyNexora')}
                        exampleLabel="Praxis"
                        rows={[
                          { label: 'Provider', value: meta.label },
                          { label: tr('common.change'), value: 'eintragen, leer = behalten' },
                        ]}
                        footer={tr('settings.fieldOnlySettingRotatingKeys')}
                      />
                    )} />}>
                      <Input
                        type="password"
                        value={form[meta.provider]}
                        autoComplete="new-password"
                        placeholder={st?.keySet ? tr('settings.setLeaveEmptyKeep2') : 'API-Key eingeben'}
                        onChange={(e) => setField(meta.provider, e.target.value)}
                      />
                    </Field>

                    <div style={s.testRow}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<PlugZap size={13} />}
                        disabled={testBusy[meta.provider] === true}
                        onClick={() => runTest(meta.provider)}
                      >
                        {testBusy[meta.provider] === true ? 'Teste…' : tr('settings.testConnection')}
                      </Button>
                      {test && <TestLine result={test} />}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={s.footer}>
              <Button
                variant="primary"
                icon={<Save size={14} />}
                disabled={!hasTiChanges(form) || saving}
                onClick={doSave}
              >{tr('common.save')}</Button>
              {!hasTiChanges(form) && <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{tr('common.noChanges')}</span>}
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
          </div>
        )}
      </CardBody>
    </Card>
  );
}
