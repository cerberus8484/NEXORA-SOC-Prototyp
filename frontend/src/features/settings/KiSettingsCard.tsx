import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { RefreshCw, ShieldAlert, Check, Plug, Cpu, Cloud } from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button, Field, Input, Select, Spinner, Toggle } from '../../components/ui';
import { KiGuardrailsMetrics } from './KiGuardrailsMetrics';
import {
  fetchKiConfig, saveKiConfig, fetchKiModels, fetchKiProviders, testKiProvider,
  type KiConfig, type KiProvider, type LlmProviderKind, type KiTestResult,
} from './settingsApi';
import { getOllamaUiState } from './kiStatusModel';

type Meta = { kind: LlmProviderKind; label: string; tagline: string; cloud: boolean };
const PROVIDERS: Meta[] = [
  { kind: 'ollama',    label: 'Ollama',    tagline: 'Lokal · Schnell · Datenschutz', cloud: false },
  { kind: 'anthropic', label: 'Anthropic', tagline: 'Cloud · Claude',                cloud: true },
  { kind: 'google',    label: 'Google AI', tagline: 'Cloud · Gemini',                cloud: true },
  { kind: 'openai',    label: 'OpenAI',    tagline: 'Cloud · GPT',                   cloud: true },
  { kind: 'stub',      label: 'Stub',      tagline: 'Test · kein echtes Modell',     cloud: false },
];

const CLOUD_MODEL: Record<string, { modelKey: 'anthropicModel' | 'openaiModel' | 'googleModel'; keyField: 'anthropicApiKey' | 'openaiApiKey' | 'googleApiKey'; placeholder: string }> = {
  anthropic: { modelKey: 'anthropicModel', keyField: 'anthropicApiKey', placeholder: 'claude-sonnet-4-6' },
  openai:    { modelKey: 'openaiModel',    keyField: 'openaiApiKey',    placeholder: 'gpt-4o-mini' },
  google:    { modelKey: 'googleModel',    keyField: 'googleApiKey',    placeholder: 'gemini-2.0-flash' },
};

const FALLBACK_OPTIONS = [{ value: '', label: '— kein Fallback' },
  ...PROVIDERS.filter((p) => p.kind !== 'stub').map((p) => ({ value: p.kind, label: p.label }))];

/**
 * KI-Einstellungen (Welle 1): Provider-Auswahl, Provider-Konfiguration inkl.
 * im Backend gespeicherter (verschlüsselter) API-Keys + Verbindungstest,
 * Modell-Konfiguration, Primär-/Fallback-Kette. Admin-only schreibend.
 */
export function KiSettingsCard({ isAdmin }: { isAdmin: boolean }) {
  const [config, setConfig]       = useState<KiConfig>({ ollamaBaseUrl: '', ollamaModel: '', agentLlmProvider: 'stub', ragEnabled: false });
  const [models, setModels]       = useState<string[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null);
  const [ollamaMessage, setOllamaMessage] = useState('');
  const [providers, setProviders] = useState<KiProvider[]>([]);
  const [tests, setTests]         = useState<Record<string, KiTestResult | 'testing'>>({});
  const [loading, setLoading]     = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errMsg, setErrMsg]       = useState('');

  const reloadProviders = useCallback(() => {
    fetchKiProviders().then((p) => setProviders(p.providers))
      .catch(() => setErrMsg('Provider-Liste konnte nicht aktualisiert werden.'));
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchKiConfig(), fetchKiModels(), fetchKiProviders()])
      .then(([cfg, env, prov]) => {
        if (!alive) return;
        setConfig(cfg);
        setModels(env.data);
        setReachable(env.reachable);
        setModelAvailable(env.modelAvailable ?? null);
        setOllamaMessage(env.message ?? env.error ?? '');
        setProviders(prov.providers);
      })
      .catch(() => { if (alive) setErrMsg('Laden fehlgeschlagen.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const reloadModels = useCallback(() => {
    fetchKiModels()
      .then((e) => {
        setModels(e.data);
        setReachable(e.reachable);
        setModelAvailable(e.modelAvailable ?? null);
        setOllamaMessage(e.message ?? e.error ?? '');
      })
      .catch(() => {
        setModels([]);
        setReachable(false);
        setModelAvailable(null);
        setOllamaMessage('Ollama ist nicht erreichbar');
      });
  }, []);

  const runTest = async (kind: string) => {
    setTests((t) => ({ ...t, [kind]: 'testing' }));
    try {
      const res = await testKiProvider(kind);
      setTests((t) => ({ ...t, [kind]: res }));
    } catch (e) {
      setTests((t) => ({ ...t, [kind]: { ok: false, error: e instanceof Error ? e.message : 'Fehler' } }));
    }
  };

  const handleSave = async () => {
    setSaveState('saving');
    try {
      const saved = await saveKiConfig(config);
      // Getippte Keys nach dem Speichern aus dem State entfernen (write-only) + Status neu laden.
      setConfig({ ...saved, anthropicApiKey: '', openaiApiKey: '', googleApiKey: '' });
      reloadProviders();
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    } catch { setSaveState('error'); setTimeout(() => setSaveState('idle'), 3000); }
  };

  if (loading) return <Card><CardHeader title="KI-Einstellungen" /><CardBody><Spinner /></CardBody></Card>;

  const provider = config.agentLlmProvider;
  const cloud = CLOUD_MODEL[provider];
  const statusOf = (k: string) => providers.find((p) => p.provider === k);
  const modelOptions = models.length > 0 ? models.map((m) => ({ value: m, label: m })) : [{ value: config.ollamaModel, label: config.ollamaModel || 'Kein Modell' }];

  const cardBadge = (m: Meta) => {
    const s = statusOf(m.kind);
    if (m.kind === 'ollama') {
      const state = getOllamaUiState({
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaModel,
        reachable,
        modelAvailable,
      });
      if (state === 'not_configured') return <Badge tone="muted" dot>Nicht konfiguriert</Badge>;
      if (state === 'offline') return <Badge tone="warning" dot>Offline</Badge>;
      if (state === 'model_missing') return <Badge tone="warning" dot>Modell fehlt</Badge>;
      if (state === 'configured') return <Badge tone="accent" dot>Konfiguriert</Badge>;
      return <Badge tone="success" dot>Verbunden</Badge>;
    }
    if (m.cloud) return s?.configured ? <Badge tone="success" dot>Key gesetzt</Badge> : <Badge tone="warning" dot>Kein Key</Badge>;
    return <Badge>Test</Badge>;
  };

  return (
    <>
    <Card>
      <CardHeader title="1. Provider-Auswahl" actions={<span style={s.hint}><Plug size={12} /> Primär: {provider}</span>} />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Provider-Kacheln */}
          <div style={s.cardGrid}>
            {PROVIDERS.map((m) => {
              const active = provider === m.kind;
              return (
                <button key={m.kind} type="button" disabled={!isAdmin}
                  onClick={() => setConfig((c) => ({ ...c, agentLlmProvider: m.kind }))}
                  style={{ ...s.provCard, ...(active ? s.provCardActive : {}), cursor: isAdmin ? 'pointer' : 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {m.cloud ? <Cloud size={18} /> : <Cpu size={18} />}
                    {active ? <Check size={16} style={{ color: 'var(--accent)' }} /> : <span style={s.radio} />}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>{m.label}</div>
                  <div style={{ marginTop: 4 }}>{cardBadge(m)}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 6 }}>{m.tagline}</div>
                </button>
              );
            })}
          </div>

          {/* Cloud-Datenschutz-Warnung */}
          {cloud && (
            <div style={s.warn}>
              <ShieldAlert size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
              <span><strong>Cloud-Provider:</strong> Ticket-/Alert-Daten (ggf. PII/sensible Security-Daten) verlassen
                das interne Netz Richtung externem Anbieter. Nur einsetzen, wenn datenschutzrechtlich abgedeckt.
                Der API-Key wird verschlüsselt im Backend gespeichert und nie wieder im Klartext angezeigt.</span>
            </div>
          )}

          {/* 2. Provider-Konfiguration */}
          <div style={s.section}>2. Provider-Konfiguration</div>
          {provider === 'ollama' && (
            <>
              <Field label="Ollama Base-URL">
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input value={config.ollamaBaseUrl} disabled={!isAdmin} placeholder="http://10.99.99.78:11434"
                    onChange={(e) => setConfig((c) => ({ ...c, ollamaBaseUrl: e.target.value }))} />
                  {isAdmin && <Button variant="ghost" onClick={reloadModels} title="Modelle neu laden"><RefreshCw size={13} /></Button>}
                </div>
              </Field>
              {ollamaMessage && (
                <div style={{
                  fontSize: 11.5,
                  color: modelAvailable === false || reachable === false ? 'var(--warning)' : 'var(--text-dim)',
                  marginTop: -4,
                }}
                >
                  {ollamaMessage}
                </div>
              )}
            </>
          )}
          {cloud && (
            <Field label={`API-Key (${statusOf(provider)?.keyEnvVar || ''})`}>
              <Input type="password" disabled={!isAdmin}
                value={config[cloud.keyField] ?? ''}
                placeholder={statusOf(provider)?.configured ? '•••••••••• (gesetzt — leer lassen zum Behalten)' : 'API-Key eingeben'}
                onChange={(e) => setConfig((c) => ({ ...c, [cloud.keyField]: e.target.value }))} />
            </Field>
          )}

          {provider !== 'stub' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {isAdmin && <Button variant="ghost" size="sm" onClick={() => runTest(provider)} disabled={tests[provider] === 'testing'}>
                {tests[provider] === 'testing' ? 'Teste …' : 'Verbindung testen'}
              </Button>}
              <TestResult result={tests[provider]} />
            </div>
          )}

          {/* Primär + Fallback-Kette */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field label="Bevorzugt">
              <Select value={provider} disabled={!isAdmin}
                options={PROVIDERS.map((p) => ({ value: p.kind, label: p.label }))}
                onChange={(e) => setConfig((c) => ({ ...c, agentLlmProvider: e.target.value as LlmProviderKind }))} />
            </Field>
            <Field label="Fallback 1">
              <Select value={config.agentFallback1 ?? ''} disabled={!isAdmin} options={FALLBACK_OPTIONS}
                onChange={(e) => setConfig((c) => ({ ...c, agentFallback1: e.target.value }))} />
            </Field>
            <Field label="Fallback 2">
              <Select value={config.agentFallback2 ?? ''} disabled={!isAdmin} options={FALLBACK_OPTIONS}
                onChange={(e) => setConfig((c) => ({ ...c, agentFallback2: e.target.value }))} />
            </Field>
          </div>

          {/* 3. Modell-Konfiguration */}
          <div style={s.section}>3. Modell-Konfiguration</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Modell">
              {provider === 'ollama' && models.length > 0
                ? <Select value={config.ollamaModel} disabled={!isAdmin} options={modelOptions} onChange={(e) => setConfig((c) => ({ ...c, ollamaModel: e.target.value }))} />
                : provider === 'ollama'
                  ? <Input value={config.ollamaModel} disabled={!isAdmin} placeholder="llama3.2:3b" onChange={(e) => setConfig((c) => ({ ...c, ollamaModel: e.target.value }))} />
                  : cloud
                    ? <Input value={config[cloud.modelKey] ?? ''} disabled={!isAdmin} placeholder={cloud.placeholder} onChange={(e) => setConfig((c) => ({ ...c, [cloud.modelKey]: e.target.value }))} />
                    : <Input value="—" disabled />}
            </Field>
            <Field label="Max Tokens">
              <Input type="number" value={String(config.llmMaxTokens ?? '')} disabled={!isAdmin} placeholder="2000"
                onChange={(e) => setConfig((c) => ({ ...c, llmMaxTokens: e.target.value }))} />
            </Field>
            <Field label="Temperatur (0–2)">
              <Input type="number" value={String(config.llmTemperature ?? '')} disabled={!isAdmin} placeholder="0.2"
                onChange={(e) => setConfig((c) => ({ ...c, llmTemperature: e.target.value }))} />
            </Field>
            <Field label="Top P (0–1)">
              <Input type="number" value={String(config.llmTopP ?? '')} disabled={!isAdmin} placeholder="(Provider-Default)"
                onChange={(e) => setConfig((c) => ({ ...c, llmTopP: e.target.value }))} />
            </Field>
          </div>

          {/* RAG */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>RAG aktiviert</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Wissens-Retrieval aus Qdrant für KI-Analysen</div>
            </div>
            <Toggle checked={config.ragEnabled} label="RAG aktiviert"
              onChange={isAdmin ? (v) => setConfig((c) => ({ ...c, ragEnabled: v })) : () => undefined} />
          </div>

          {errMsg && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{errMsg}</div>}
          {isAdmin && (
            <Button variant={saveState === 'saved' ? 'success' : 'primary'} onClick={handleSave} disabled={saveState === 'saving'}>
              {saveState === 'saving' ? 'Wird gespeichert …' : saveState === 'saved' ? '✓ Gespeichert' : 'KI-Einstellungen speichern'}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
    <KiGuardrailsMetrics />
    </>
  );
}

function TestResult({ result }: { result: KiTestResult | 'testing' | undefined }) {
  if (!result || result === 'testing') return null;
  if (result.ok) return <span style={{ fontSize: 12, color: 'var(--success)' }}>✓ OK{result.latencyMs != null ? ` · ${result.latencyMs} ms` : ''}{result.model ? ` · ${result.model}` : ''}</span>;
  return <span style={{ fontSize: 12, color: 'var(--danger)' }}>✗ {result.error || 'fehlgeschlagen'}</span>;
}

const s: Record<string, CSSProperties> = {
  hint:      { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-dim)' },
  section:   { fontSize: 12, fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border-soft)', paddingBottom: 6, marginTop: 4 },
  cardGrid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 },
  provCard:  { textAlign: 'left', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', color: 'var(--text)' },
  provCardActive: { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent) inset' },
  radio:     { width: 14, height: 14, borderRadius: '50%', border: '1px solid var(--border-soft)', display: 'inline-block' },
  warn:      { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', background: 'color-mix(in srgb, var(--warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)', borderRadius: 'var(--radius-sm)', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 },
};
