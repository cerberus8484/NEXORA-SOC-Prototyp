import { useState, type CSSProperties, type FormEvent } from 'react';
import { X, Plus, Copy, Check, ShieldCheck, Server } from 'lucide-react';
import { Button, Field, Input, ErrorCard } from '../../components/ui';
import { hostsApi, type EnrolledHost } from './hostsApi';
import { validateAddHost, enrollmentSteps } from './hostEnrollView';
import { ApiError } from '../../lib/apiClient';
import { useTranslation } from 'react-i18next';

const s: Record<string, CSSProperties> = {
  overlay:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal:    { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' },
  head:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' },
  body:     { padding: '16px 18px' },
  foot:     { display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 18px', borderTop: '1px solid var(--border-soft)' },
  hint:     { fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 },
  keyBox:   { fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-all', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', color: 'var(--accent)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 },
  ol:       { margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 },
  tabs:     { display: 'flex', gap: 4, padding: '8px 18px 0' },
  tab:      { padding: '7px 12px', fontSize: 12.5, fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', borderBottom: '2px solid transparent', display: 'inline-flex', alignItems: 'center', gap: 6 },
  tabOn:    { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' },
  textarea: { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 56 },
};

type Mode = 'agent' | 'manual';

interface Props {
  onClose: () => void;
  onEnrolled?: () => void;
}

export function AddHostModal({ onClose, onEnrolled }: Props) {
  const { t: tr } = useTranslation();
  const [mode, setMode] = useState<Mode>('agent');
  // Wazuh-Agent-Enrollment
  const [form, setForm] = useState({ name: '', ip: '' });
  const [enrolled, setEnrolled] = useState<EnrolledHost | null>(null);
  const [copied, setCopied] = useState(false);
  // Manuelles Asset
  const [manual, setManual] = useState({ hostname: '', ips: '', os: '', customer: '', notes: '' });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const v = validateAddHost(form);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!v.ok) return;
    setError(''); setBusy(true);
    try {
      const res = await hostsApi.addHost({ name: form.name.trim(), ip: form.ip.trim() || undefined });
      setEnrolled(res.data);
      onEnrolled?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('app.hostEnrolmentFailedWazuhApi'));
    } finally { setBusy(false); }
  }

  async function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    const hostname = manual.hostname.trim();
    if (!hostname) return;
    setError(''); setBusy(true);
    try {
      const ipAddresses = manual.ips.split(',').map((x) => x.trim()).filter(Boolean);
      await hostsApi.addManualHost({
        hostname,
        ipAddresses: ipAddresses.length ? ipAddresses : undefined,
        os: manual.os.trim() || undefined,
        customer: manual.customer.trim() || undefined,
        notes: manual.notes.trim() || undefined,
      });
      onEnrolled?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('hosts.createAssetFailed'));
    } finally { setBusy(false); }
  }

  function copyKey() {
    if (!enrolled) return;
    navigator.clipboard?.writeText(enrolled.key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }

  const title = mode === 'manual' ? tr('hosts.createManualAsset') : tr('hosts.registerHostAgent');

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.head}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {mode === 'manual' ? <Server size={16} /> : <ShieldCheck size={16} />} {title}
          </strong>
          <button style={s.closeBtn} onClick={onClose} aria-label={tr('common.close')}><X size={18} /></button>
        </div>

        {/* Modus-Umschalter — nur solange kein Enrollment-Key angezeigt wird. */}
        {!enrolled && (
          <div style={s.tabs}>
            <button style={{ ...s.tab, ...(mode === 'agent' ? s.tabOn : {}) }} onClick={() => { setMode('agent'); setError(''); }}>
              <ShieldCheck size={14} /> Wazuh-Agent
            </button>
            <button style={{ ...s.tab, ...(mode === 'manual' ? s.tabOn : {}) }} onClick={() => { setMode('manual'); setError(''); }}>
              <Server size={14} /> Manuelles Asset
            </button>
          </div>
        )}

        {enrolled ? (
          <div>
            <div style={s.body}>
              <ol style={s.ol}>
                {enrollmentSteps(enrolled).map((step, i) => <li key={i}>{step}</li>)}
              </ol>
              <div style={{ marginTop: 12 }}>
                <div style={s.hint}>Enrollment-Key (einmalig):</div>
                <div style={s.keyBox}>{enrolled.key}</div>
                <div style={{ marginTop: 8 }}>
                  <Button variant="default" size="sm" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copyKey}>
                    {copied ? tr('common.copied') : tr('common.copyKey')}
                  </Button>
                </div>
              </div>
            </div>
            <div style={s.foot}>
              <Button variant="primary" onClick={onClose}>Fertig</Button>
            </div>
          </div>
        ) : mode === 'agent' ? (
          <form onSubmit={handleSubmit}>
            <div style={s.body}>
              <p style={s.hint}>{tr('app.registersNewAgentWazuhManager')}</p>
              <div style={{ marginTop: 12 }}>
                <Field label="Agent-Name" hint={tr('app.zZ09No')}>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z. B. web01" autoFocus />
                </Field>
                <Field label="IP (optional)" hint={tr('text.leaveEmptyWazuhAllowsAny')}>
                  <Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="z. B. 10.0.10.20" />
                </Field>
              </div>
              {form.name && v.errors.name && <div style={{ ...s.hint, color: 'var(--danger)' }}>{v.errors.name}</div>}
              {form.ip && v.errors.ip && <div style={{ ...s.hint, color: 'var(--danger)' }}>{v.errors.ip}</div>}
              {error && <div style={{ marginTop: 10 }}><ErrorCard message={error} /></div>}
            </div>
            <div style={s.foot}>
              <Button type="button" variant="ghost" onClick={onClose}>{tr('common.cancel2')}</Button>
              <Button type="submit" variant="primary" icon={<Plus size={15} />} disabled={!v.ok || busy}>
                {busy ? tr('hosts.registering') : tr('hosts.register')}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleManualSubmit}>
            <div style={s.body}>
              <p style={s.hint}>{tr('app.assetWithoutWazuhAgentAppliance')}</p>
              <div style={{ marginTop: 12 }}>
                <Field label="Hostname" hint={tr('app.zZ09No')}>
                  <Input value={manual.hostname} onChange={(e) => setManual({ ...manual, hostname: e.target.value })} placeholder="z. B. fw-edge" autoFocus />
                </Field>
                <Field label={tr('hosts.ipAddressesOptional')} hint="Mehrere per Komma trennen.">
                  <Input value={manual.ips} onChange={(e) => setManual({ ...manual, ips: e.target.value })} placeholder="z. B. 10.0.10.1, 10.0.20.1" />
                </Field>
                <Field label="Betriebssystem (optional)">
                  <Input value={manual.os} onChange={(e) => setManual({ ...manual, os: e.target.value })} placeholder="z. B. OPNsense 24.7" />
                </Field>
                <Field label="Kunde / Zone (optional)">
                  <Input value={manual.customer} onChange={(e) => setManual({ ...manual, customer: e.target.value })} placeholder="z. B. ACME" />
                </Field>
                <Field label="Notizen (optional)">
                  <textarea style={s.textarea} value={manual.notes} onChange={(e) => setManual({ ...manual, notes: e.target.value })} placeholder="Kontext, Standort, Verantwortliche …" />
                </Field>
              </div>
              {error && <div style={{ marginTop: 10 }}><ErrorCard message={error} /></div>}
            </div>
            <div style={s.foot}>
              <Button type="button" variant="ghost" onClick={onClose}>{tr('common.cancel2')}</Button>
              <Button type="submit" variant="primary" icon={<Plus size={15} />} disabled={!manual.hostname.trim() || busy}>
                {busy ? 'Legt an …' : tr('hosts.createAsset')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
