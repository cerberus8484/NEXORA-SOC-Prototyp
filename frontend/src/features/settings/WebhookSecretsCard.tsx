import { useEffect, useState, type CSSProperties } from 'react';
import { Webhook, Save, RefreshCw, Trash2, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button, Input, Spinner, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchWebhookSecrets, saveWebhookSecret } from './settingsApi';
import {
  webhookSourceLabel, webhookOriginLabel, webhookOriginTone, generateWebhookSecret,
  type MaskedWebhookSecret,
} from './webhookSecretsModel';
import { cardStyles } from './connectionCardKit';
import { ApiError } from '../../lib/apiClient';

// Inbound-Webhook-Secrets (Layer 2): je Quelle das HMAC-Secret verwalten, mit dem
// eingehende Alert-Webhooks signiert sein muessen (Alert->Ticket). Verschluesselt in DB,
// DB > ENV, Rotation greift sofort (kein Neustart). Admin-only, auditiert.

const s: Record<string, CSSProperties> = {
  row:      { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingBottom: 12, borderBottom: '1px solid var(--border-soft)' },
  meta:     { minWidth: 210, display: 'flex', flexDirection: 'column', gap: 4 },
  name:     { fontSize: 13, fontWeight: 600, color: 'var(--text)' },
  feedback: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '8px 12px', borderRadius: 'var(--radius-sm)' },
};

interface Feedback { tone: 'success' | 'error'; text: string; }

/** Inbound-Webhook-Secrets-Karte (admin-only, Settings -> Integrationen). */
export function WebhookSecretsCard() {
  const [masked, setMasked] = useState<MaskedWebhookSecret[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let alive = true;
    setLoadError('');
    fetchWebhookSecrets()
      .then((d) => { if (alive) setMasked(d); })
      .catch(() => { if (alive) setLoadError('Webhook-Secrets konnten nicht geladen werden.'); });
    return () => { alive = false; };
  }, [reloadKey]);

  const setDraft = (source: string, value: string) => setDrafts((p) => ({ ...p, [source]: value }));

  async function save(source: string, secret: string) {
    setBusy(source);
    setFeedback(null);
    try {
      const next = await saveWebhookSecret({ source, secret });
      setMasked(next);
      setDraft(source, '');
      setFeedback({
        tone: 'success',
        text: secret === ''
          ? `${webhookSourceLabel(source)}: Secret geloescht - nutzt jetzt den Fallback.`
          : `${webhookSourceLabel(source)}: Secret gespeichert - greift sofort (ohne Neustart). Der Sender muss dasselbe Secret setzen. Protokolliert.`,
      });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setFeedback({ tone: 'error', text: status === 400 ? 'Ungueltige Quelle.' : 'Speichern fehlgeschlagen.' });
    } finally {
      setBusy('');
    }
  }

  return (
    <Card>
      <CardHeader title="Inbound-Webhook-Secrets" actions={<Webhook size={15} style={{ color: 'var(--accent)' }} />} />
      <CardBody>
        {loadError ? (
          <div>
            <p style={{ fontSize: 12.5, color: 'var(--danger)', margin: 0 }}>{loadError}</p>
            <Button size="sm" variant="ghost" style={{ marginTop: 10 }} onClick={() => setReloadKey((k) => k + 1)}>Erneut versuchen</Button>
          </div>
        ) : masked === null ? (
          <Spinner />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={cardStyles.hint}>
              HMAC-Secrets, mit denen eingehende Alert-Webhooks signiert sein muessen (Alert-&gt;Ticket). Je Quelle
              verschluesselt in der Datenbank; leer = die Quelle nutzt das <code>generic</code>-Secret bzw. den
              ENV-Wert. Rotation greift sofort (kein Neustart) - der Sender (z.B. das Wazuh-Integrations-Script)
              muss dasselbe Secret setzen.
            </p>

            {masked.map((m) => (
              <div key={m.source} style={s.row}>
                <div style={s.meta}>
                  <span style={s.name}>{webhookSourceLabel(m.source)}</span>
                  <Badge tone={webhookOriginTone(m)}>{webhookOriginLabel(m.origin)}</Badge>
                </div>
                <label style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    <HelpLabel text="HMAC-Secret" topic="integrationen" hint={(
                      <ExampleHint
                        title="Gemeinsames Signatur-Secret fuer Quelle und Nexora"
                        text="Dieses Secret muss exakt auf beiden Seiten gleich sein: beim Sender und hier in Nexora."
                        exampleLabel="Merksatz"
                        rows={[
                          { label: 'Sender', value: 'signiert Webhook' },
                          { label: 'Nexora', value: 'prueft dieselbe Signatur' },
                        ]}
                        footer="Nach dem Rotieren muss auch das externe System sofort auf denselben neuen Wert umgestellt werden."
                      />
                    )} />
                  </span>
                  <Input
                    type="password"
                    value={drafts[m.source] ?? ''}
                    autoComplete="new-password"
                    placeholder={m.set ? '••••••••  (gesetzt - neues Secret = rotieren)' : 'Secret setzen'}
                    onChange={(e) => setDraft(m.source, e.target.value)}
                    style={{ flex: 1, minWidth: 160 }}
                  />
                </label>
                <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => setDraft(m.source, generateWebhookSecret())}>
                  Generieren
                </Button>
                <Button size="sm" variant="primary" icon={<Save size={13} />}
                  disabled={busy === m.source || (drafts[m.source] ?? '') === ''}
                  onClick={() => save(m.source, drafts[m.source] ?? '')}>
                  Speichern
                </Button>
                {m.origin === 'db' && (
                  <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} disabled={busy === m.source} onClick={() => save(m.source, '')}>
                    Loeschen
                  </Button>
                )}
              </div>
            ))}

            {feedback && (
              <div role="status" style={{
                ...s.feedback,
                color: feedback.tone === 'success' ? 'var(--success)' : 'var(--danger)',
                background: `color-mix(in srgb, ${feedback.tone === 'success' ? 'var(--success)' : 'var(--danger)'} 10%, transparent)`,
                border: `1px solid ${feedback.tone === 'success' ? 'var(--success)' : 'var(--danger)'}`,
              }}>
                {feedback.tone === 'success' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                <span>{feedback.text}</span>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
