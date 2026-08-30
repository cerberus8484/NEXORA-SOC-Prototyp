import { useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, X, Ticket, Archive, Crosshair, Monitor, Check, AlertTriangle, ShieldOff, ShieldAlert } from 'lucide-react';
import { Badge, Button, type Tone } from '../../components/ui';
import type { HuntFinding, FindingVerdict } from '../../lib/types';
import { onActivateKey } from '../../lib/a11y';
import { huntApi } from './huntApi';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

interface FindingDetailPanelProps {
  finding: HuntFinding;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onCreateTicket: () => void;
  onAddEvidence: () => void;
  onRunFollowUp: () => void;
  onOpenRdp: () => void;
  /** Callback nach erfolgreichem Verdict-Setzen — aktualisiert Parent-State */
  onVerdictSet?: (updated: HuntFinding) => void;
}

const sevTone = (sev: string): Tone =>
  sev === 'critical' || sev === 'high' ? 'danger' : sev === 'medium' ? 'warning' : 'muted';

const verdictTone = (v: FindingVerdict): Tone => {
  if (v === 'benign')      return 'success';
  if (v === 'suspicious')  return 'warning';
  if (v === 'malicious')   return 'danger';
  if (v === 'inconclusive') return 'muted';
  return 'muted';
};

const verdictLabels = (): Record<FindingVerdict, string> => ({
  '':             i18n.t('text.noVerdict'),
  benign:         'Benign',
  suspicious:     'Suspicious',
  malicious:      'Malicious',
  inconclusive:   'Inconclusive',
});

const s: Record<string, CSSProperties> = {
  panel:  { width: 400, flexShrink: 0, background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: 16 },
  head:   { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-soft)' },
  body:   { padding: 16, overflowY: 'auto' },
  label:  { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  val:    { fontSize: 13, color: 'var(--text)', marginTop: 2 },
  grid:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 },
  mono:   { fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-terminal)', padding: '8px 10px', borderRadius: 6, color: 'var(--accent-cyan, var(--accent))', wordBreak: 'break-all' as const },
  iconBtn:{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'inline-flex', padding: 2 },
  tabBar: { display: 'flex', gap: 4, padding: '0 16px', borderBottom: '1px solid var(--border-soft)' },
  tab:    { padding: '8px 10px', fontSize: 12.5, cursor: 'pointer', borderBottom: '2px solid transparent', color: 'var(--text-dim)' },
  tabOn:  { color: 'var(--text)', borderBottomColor: 'var(--accent)' },
};

function Row({ label, value }: { label: string; value?: string | number }) {
  return (
    <div>
      <div style={s.label}>{label}</div>
      <div style={s.val}>{value === undefined || value === '' ? '—' : value}</div>
    </div>
  );
}

export function FindingDetailPanel(p: FindingDetailPanelProps) {
  const { t: tr } = useTranslation();
  const { finding: f } = p;
  const ctx = f.context || {};
  const [tab, setTab] = useState<'overview' | 'raw' | 'actions'>('overview');
  const [verdict, setVerdict] = useState<FindingVerdict>(f.verdict ?? '');
  const [verdictPending, setVerdictPending] = useState(false);
  const [verdictError, setVerdictError] = useState('');
  const isWindows = /win|server/i.test(ctx.host || '') || ctx.destinationPort === 3389;
  const recommendations = (f.recommendation || '').split('\n').filter(Boolean);

  async function handleSetVerdict(v: FindingVerdict) {
    if (verdictPending) return;
    setVerdictPending(true);
    setVerdictError('');
    try {
      const res = await huntApi.setFindingVerdict(f.sessionId, f.id, v);
      const updated = res.data;
      setVerdict(updated.verdict);
      if (p.onVerdictSet) p.onVerdictSet(updated);
    } catch {
      setVerdictError(tr('ui.verdictCouldNotSet'));
    } finally {
      setVerdictPending(false);
    }
  }

  return (
    <div style={s.panel}>
      <div style={s.head}>
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>Finding Detail</span>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{p.index + 1} of {p.total}</span>
        <button style={s.iconBtn} onClick={p.onPrev} title="Vorheriges"><ChevronLeft size={16} /></button>
        <button style={s.iconBtn} onClick={p.onNext} title={tr('ui.next')}><ChevronRight size={16} /></button>
        <button style={s.iconBtn} onClick={p.onClose} title={tr('common.close')}><X size={16} /></button>
      </div>

      <div style={{ padding: '12px 16px 0' }}>
        <Badge tone={sevTone(f.severity)}>{f.severity}</Badge>
        <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>{f.title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2 }}>{f.description}</div>
      </div>

      <div style={{ ...s.tabBar, marginTop: 12 }} role="tablist">
        {([['overview', 'Overview'], ['raw', 'Raw Data'], ['actions', 'Actions']] as const).map(([id, lbl]) => (
          <div
            key={id}
            role="tab"
            tabIndex={0}
            aria-selected={tab === id}
            style={{ ...s.tab, ...(tab === id ? s.tabOn : {}) }}
            onClick={() => setTab(id)}
            onKeyDown={onActivateKey(() => setTab(id))}
          >{lbl}</div>
        ))}
      </div>

      <div style={s.body}>
        {tab === 'overview' && (
          <>
            <div style={s.grid}>
              <Row label="Status" value={ctx.status || f.severity} />
              <Row label="MITRE Tactic" value={ctx.mitreTactic} />
              <Row label="MITRE Technique" value={ctx.mitreTechnique || f.mitreAttack} />
              <Row label="Host" value={ctx.host} />
              <Row label="User" value={ctx.user} />
              <Row label="Source IP" value={ctx.sourceIp} />
              <Row label="Process" value={ctx.process} />
              <Row label="PID" value={ctx.pid} />
              <Row label="Parent Process" value={ctx.parentProcess} />
              <Row label="Destination" value={ctx.destinationIp ? `${ctx.destinationIp}${ctx.destinationPort ? ':' + ctx.destinationPort : ''}` : (ctx.destinationPort ? String(ctx.destinationPort) : '')} />
            </div>

            {ctx.commandLine && (
              <div style={{ marginBottom: 14 }}>
                <div style={s.label}>Command Line</div>
                <div style={{ ...s.mono, marginTop: 4 }}>{ctx.commandLine}</div>
              </div>
            )}

            {recommendations.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={s.label}>Recommendation</div>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--text)' }}>
                  {recommendations.map((r) => <li key={r} style={{ marginBottom: 3 }}>{r}</li>)}
                </ul>
              </div>
            )}

            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
              <div><div style={s.label}>Severity</div><Badge tone={sevTone(f.severity)}>{f.severity}</Badge></div>
              {ctx.confidencePct !== undefined && (
                <div style={{ flex: 1 }}>
                  <div style={s.label}>Confidence</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <div style={{ flex: 1, height: 6, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${ctx.confidencePct}%`, height: '100%', background: 'var(--accent)' }} />
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text)' }}>{ctx.confidencePct}%</span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'raw' && (
          <div style={{ ...s.mono, whiteSpace: 'pre-wrap' }}>{JSON.stringify(f, null, 2)}</div>
        )}

        {(tab === 'actions' || tab === 'overview') && (
          <div style={{ marginTop: 16 }}>
            <div style={s.label}>Actions</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <Button variant="primary" size="sm" icon={<Ticket size={13} />} onClick={p.onCreateTicket}>Create Ticket</Button>
              <Button variant="ghost" size="sm" icon={<Archive size={13} />} onClick={p.onAddEvidence}>Add to Evidence</Button>
              <Button variant="ghost" size="sm" icon={<Crosshair size={13} />} onClick={p.onRunFollowUp}>Run Follow-up Hunt</Button>
              <Button variant="ghost" size="sm" icon={<Monitor size={13} />} onClick={p.onOpenRdp} disabled={!isWindows} title={isWindows ? tr('hosts.generateRdpFile') : tr('ui.windowsHostsOnly')}>Open RDP Session</Button>
            </div>

            {/* Verdict-Sektion */}
            <div style={{ marginTop: 14 }}>
              <div style={{ ...s.label, marginBottom: 6 }}>
                Analyst Verdict
                {verdict !== '' && (
                  <span style={{ marginLeft: 8 }}>
                    <Badge tone={verdictTone(verdict)}>{verdictLabels()[verdict]}</Badge>
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Button
                  variant={verdict === 'benign' ? 'primary' : 'ghost'}
                  size="sm"
                  icon={<Check size={13} />}
                  onClick={() => handleSetVerdict('benign')}
                  disabled={verdictPending}
                >
                  Mark Benign
                </Button>
                <Button
                  variant={verdict === 'suspicious' ? 'primary' : 'ghost'}
                  size="sm"
                  icon={<AlertTriangle size={13} />}
                  onClick={() => handleSetVerdict('suspicious')}
                  disabled={verdictPending}
                >
                  Mark Suspicious
                </Button>
                <Button
                  variant={verdict === 'malicious' ? 'primary' : 'ghost'}
                  size="sm"
                  icon={<ShieldAlert size={13} />}
                  onClick={() => handleSetVerdict('malicious')}
                  disabled={verdictPending}
                >
                  Mark Malicious
                </Button>
                <Button
                  variant={verdict === 'inconclusive' ? 'primary' : 'ghost'}
                  size="sm"
                  icon={<ShieldOff size={13} />}
                  onClick={() => handleSetVerdict('inconclusive')}
                  disabled={verdictPending}
                >
                  Inconclusive
                </Button>
              </div>
              {verdictError && (
                <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--color-danger, #ef4444)' }}>
                  {verdictError}
                </div>
              )}
            </div>

            {isWindows && (
              <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--text-dim)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <Monitor size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                RDP access should be audited and used responsibly.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
