import { useEffect, useState, type CSSProperties } from 'react';
import { Send, Save, CheckCircle2, ShieldAlert, Power } from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button, Field, Input, Select, Toggle, Spinner } from '../../components/ui';
import { notificationsApi, type NotifConfigMasked, type NotifSource } from './notificationsApi';
import {
  emptyOutboundForm, formFromMasked, buildNotifConfigPatch, notifSourceLabel,
  type OutboundForm,
} from './outboundConfigModel';
import { formatTestResult } from './notificationsHelpers';

// Outbound-Konfiguration (Layer 2): SMTP + Webhooks + Master-Schalter admin-seitig
// verwalten — Secrets verschlüsselt in der DB, ENV bleibt Fallback. Wirkt sofort
// (deliverOutbound liest die effektive Config zur Sendezeit). Test-Versand nutzt
// den bestehenden /notifications/test-Endpoint.

const s: Record<string, CSSProperties> = {
  grid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 },
  section:  { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-sm)', padding: 14 },
  secHead:  { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  secTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 },
  row2:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  footer:   { display: 'flex', alignItems: 'center', gap: 12, borderTop: '1px solid var(--border-soft)',
              paddingTop: 14, marginTop: 4, flexWrap: 'wrap' as const },
  feedback: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '8px 12px',
              borderRadius: 'var(--radius-sm)' },
  enableRow:{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card-soft)' },
};

function srcBadge(source: NotifSource) {
  return (
    <Badge tone={source === 'none' ? 'muted' : source === 'db' ? 'success' : 'accent'}>
      {notifSourceLabel(source)}
    </Badge>
  );
}

interface SaveFeedback { tone: 'success' | 'error'; text: string; }

/** Admin-Editor für die Outbound-Kanäle (SMTP + Webhooks + Enable). */
export function OutboundConfigCard() {
  const [masked, setMasked] = useState<NotifConfigMasked | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<OutboundForm>(emptyOutboundForm());
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState('');

  useEffect(() => {
    let alive = true;
    setLoadError('');
    notificationsApi.getConfig()
      .then((data) => { if (alive) { setMasked(data); setForm(formFromMasked(data)); } })
      .catch(() => { if (alive) setLoadError('Outbound-Konfiguration konnte nicht geladen werden.'); });
    return () => { alive = false; };
  }, [reloadKey]);

  const setEmail = (field: keyof OutboundForm['email'], value: string | number | boolean) =>
    setForm((prev) => ({ ...prev, email: { ...prev.email, [field]: value } }));

  async function doSave() {
    setSaving(true);
    setFeedback(null);
    try {
      const next = await notificationsApi.saveConfig(buildNotifConfigPatch(form));
      setMasked(next);
      setForm(formFromMasked(next));
      setFeedback({ tone: 'success', text: 'Gespeichert — sofort aktiv, ohne Neustart. Die Änderung wurde protokolliert.' });
    } catch {
      setFeedback({ tone: 'error', text: 'Speichern fehlgeschlagen.' });
    } finally {
      setSaving(false);
    }
  }

  async function doTest() {
    setTestBusy(true);
    setTestResult('');
    try {
      const res = await notificationsApi.sendTest();
      setTestResult(formatTestResult(res.data));
    } catch {
      setTestResult('Test-Versand fehlgeschlagen.');
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Outbound-Konfiguration" actions={<Power size={15} style={{ color: 'var(--accent)' }} />} />
      <CardBody>
        {loadError ? (
          <div>
            <p style={{ fontSize: 12.5, color: 'var(--danger)', margin: 0 }}>{loadError}</p>
            <Button size="sm" variant="ghost" style={{ marginTop: 10 }} onClick={() => setReloadKey((k) => k + 1)}>
              Erneut versuchen
            </Button>
          </div>
        ) : masked === null ? (
          <Spinner />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: 0, lineHeight: 1.6, maxWidth: 780 }}>
              SMTP und Webhooks für den externen Versand — verschlüsselt in der Datenbank, sofort wirksam.
              Falls noch ein vorhandener Systemwert existiert, greift er nur ohne UI-Eintrag. Ein leeres Passwort- oder URL-Feld lässt das
              gespeicherte Secret unverändert. Versand erfolgt nur, wenn der Schalter unten aktiv ist
              <em> und</em> mindestens ein Kanal konfiguriert ist.
            </p>

            <div style={s.enableRow}>
              <Toggle checked={form.outboundEnabled} onChange={(v) => setForm((prev) => ({ ...prev, outboundEnabled: v }))} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Externen Versand aktivieren</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                  Master-Schalter. Aus = nur In-App-Benachrichtigungen (kein externer Versand).
                </div>
              </div>
            </div>

            {/* SMTP */}
            <div style={s.section}>
              <div style={s.secHead}>
                <p style={s.secTitle}>E-Mail (SMTP)</p>
                {srcBadge(masked.email.source)}
              </div>
              <div style={s.row2}>
                <Field label="Host"><Input value={form.email.host} placeholder="mail.intern" onChange={(e) => setEmail('host', e.target.value)} /></Field>
                <Field label="Port"><Input type="number" value={String(form.email.port)} onChange={(e) => setEmail('port', Number(e.target.value) || 0)} /></Field>
              </div>
              <div style={s.row2}>
                <Field label="Benutzer"><Input value={form.email.user} autoComplete="off" onChange={(e) => setEmail('user', e.target.value)} /></Field>
                <Field label="Passwort">
                  <Input
                    type="password"
                    value={form.email.pass}
                    autoComplete="new-password"
                    placeholder={masked.email.passwordSet ? '••••••••  (gesetzt — leer = behalten)' : ''}
                    onChange={(e) => setEmail('pass', e.target.value)}
                  />
                </Field>
              </div>
              <div style={s.row2}>
                <Field label="Absender (From)"><Input value={form.email.from} placeholder="soc@intern" onChange={(e) => setEmail('from', e.target.value)} /></Field>
                <Field label="Empfänger (To, kommagetrennt)"><Input value={form.email.to} placeholder="team@intern" onChange={(e) => setEmail('to', e.target.value)} /></Field>
              </div>
              <Field label="Verschlüsselung">
                <Select
                  value={form.email.secure ? 'tls' : 'starttls'}
                  onChange={(e) => setEmail('secure', e.target.value === 'tls')}
                  options={[{ value: 'starttls', label: 'STARTTLS (Port 587)' }, { value: 'tls', label: 'TLS/SSL (Port 465)' }]}
                />
              </Field>
            </div>

            {/* Webhooks */}
            <div style={s.section}>
              <div style={s.secHead}><p style={s.secTitle}>Webhooks</p></div>
              <p style={{ fontSize: 11.5, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
                Webhook-URLs enthalten Tokens → als Secret behandelt (nie angezeigt). Leer lassen = gespeicherte URL behalten.
              </p>
              {([
                { key: 'slackWebhookUrl' as const, id: 'slack', label: 'Slack' },
                { key: 'teamsWebhookUrl' as const, id: 'teams', label: 'Microsoft Teams' },
                { key: 'genericWebhookUrl' as const, id: 'webhook', label: 'Generischer Webhook' },
              ]).map(({ key, id, label }) => {
                const ch = masked.channels.find((c) => c.id === id);
                return (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
                      {ch && srcBadge(ch.source)}
                    </div>
                    <Input
                      type="password"
                      value={form[key]}
                      autoComplete="new-password"
                      placeholder={ch?.urlSet ? '••••••••  (gesetzt — leer = behalten)' : 'https://…'}
                      onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>

            <div style={s.footer}>
              <Button variant="primary" icon={<Save size={14} />} disabled={saving} onClick={doSave}>Speichern</Button>
              <Button variant="ghost" icon={<Send size={13} />} disabled={testBusy} onClick={doTest}
                title="Schickt eine Test-Benachrichtigung an die konfigurierten Outbound-Kanäle">
                {testBusy ? 'Sende Test …' : 'Test-Benachrichtigung senden'}
              </Button>
              {testResult && <span role="status" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{testResult}</span>}
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
          </div>
        )}
      </CardBody>
    </Card>
  );
}
