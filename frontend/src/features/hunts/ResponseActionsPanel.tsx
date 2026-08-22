import { useState, type CSSProperties } from 'react';
import { Shield, ShieldOff, Terminal, Clock, CheckCircle2, XCircle, AlertTriangle, Send, Zap } from 'lucide-react';
import type { HuntResponseAction } from '../../lib/types';
import { Badge, Button, type Tone } from '../../components/ui';

// ── Hilfsfunktionen ────────────────────────────────────────────────────────────

function kindIcon(kind: string) {
  if (kind === 'isolate_host')      return <Shield size={14} />;
  if (kind === 'release_isolation') return <ShieldOff size={14} />;
  return <Terminal size={14} />;
}

function kindLabel(kind: string) {
  if (kind === 'isolate_host')      return 'Host isolieren';
  if (kind === 'release_isolation') return 'Isolation aufheben';
  return 'Privilegierter Command';
}

function statusTone(status: string): Tone {
  if (status === 'completed') return 'success';
  if (status === 'executing') return 'warning';
  if (status === 'approved')  return 'success';
  if (status === 'rejected' || status === 'failed' || status === 'expired') return 'muted';
  if (status === 'requested') return 'warning';
  return 'muted';
}

function statusLabel(status: string) {
  const m: Record<string, string> = {
    requested: 'Ausstehend', approved: 'Genehmigt', rejected: 'Abgelehnt',
    executing: 'Wird ausgeführt', completed: 'Abgeschlossen', failed: 'Fehlgeschlagen', expired: 'Abgelaufen',
  };
  return m[status] ?? status;
}

function hhmmss(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  section:    { marginBottom: 14 },
  label:      { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-dim)', marginBottom: 6 } as CSSProperties,
  kindRow:    { display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' as const },
  kindBtn:    { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 11px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)', color: 'var(--text-muted)', cursor: 'pointer', transition: 'all .15s' },
  kindBtnOn:  { borderColor: 'var(--accent)', background: 'var(--accent)', color: '#000' },
  input:      { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '6px 10px', fontSize: 12.5, boxSizing: 'border-box' as const, marginBottom: 6 },
  card:       { border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 8, background: 'var(--bg-card-soft)' },
  cardDanger: { borderColor: 'var(--danger)', background: 'rgba(255,80,80,0.06)' },
  cardWarn:   { borderColor: 'var(--warning)', background: 'rgba(255,180,0,0.06)' },
  meta:       { fontSize: 10.5, color: 'var(--text-dim)', marginTop: 5, display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  rejectBox:  { marginTop: 8, display: 'flex', gap: 6 },
};

// ── Typen ─────────────────────────────────────────────────────────────────────

interface Props {
  actions: HuntResponseAction[];
  canRequest: boolean;
  canApprove: boolean;
  canExecute: boolean;
  currentUserId: string;
  onRequest: (kind: string, command?: string, reason?: string) => Promise<void>;
  onApprove: (actionId: string, authorizationBasis: string) => Promise<void>;
  onReject: (actionId: string, reason: string) => Promise<void>;
  // ADR-042 Stufe 3: echte, menschlich ausgelöste Ausführung — Passwort erzwingt eine
  // frische Reauth (der Container tauscht es gegen einen einmaligen deploy_reauth-Token).
  onExecute: (actionId: string, reauthPassword: string) => Promise<void>;
  // ADR-042 Circuit-Breaker: Kanal nach wiederholten Fehlern gesperrt; Admin kann entsperren.
  circuitOpen: boolean;
  onResetCircuit: () => Promise<void>;
}

const CONTAINMENT_KINDS = new Set(['isolate_host', 'release_isolation']);

// ── Komponente ────────────────────────────────────────────────────────────────

export function ResponseActionsPanel({ actions, canRequest, canApprove, canExecute, currentUserId, onRequest, onApprove, onReject, onExecute, circuitOpen, onResetCircuit }: Props) {
  const [kind, setKind]         = useState<string>('isolate_host');
  const [command, setCommand]   = useState('');
  const [reason, setReason]     = useState('');
  const [busy, setBusy]         = useState(false);
  const [reqError, setReqError] = useState('');

  // Pro Action: Ablehnungsgrund- + Rechtsgrundlage-Input State
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [authBasis, setAuthBasis]         = useState<Record<string, string>>({});
  const [deciding, setDeciding]           = useState('');

  // ADR-042 Stufe 3: pro Action Reauth-Passwort + Ausführ-State (frische Bestätigung).
  const [execPw, setExecPw]         = useState<Record<string, string>>({});
  const [executing, setExecuting]   = useState('');
  const [execError, setExecError]   = useState<Record<string, string>>({});
  const [resettingCircuit, setResettingCircuit] = useState(false);

  async function resetCircuit() {
    setResettingCircuit(true);
    try { await onResetCircuit(); } finally { setResettingCircuit(false); }
  }

  const KINDS = [
    { key: 'isolate_host',      label: 'Isolate Host',       tier: 'containment' },
    { key: 'release_isolation', label: 'Release Isolation',  tier: 'containment' },
    { key: 'privileged_command', label: 'Privilegierter Command', tier: 'privileged' },
  ];

  const pending  = actions.filter((a) => a.status === 'requested');
  // Genehmigte, umkehrbare Containment-Aktionen sind „scharf" — sie bekommen die
  // eigene Execute-Section (Reauth). Alles andere (inkl. genehmigter privileged_command,
  // der KEINEN Real-Exec hat) läuft unter „Abgeschlossen".
  const armed    = actions.filter((a) => a.status === 'approved' && CONTAINMENT_KINDS.has(a.kind));
  const armedIds = new Set(armed.map((a) => a.id));
  const resolved = actions.filter((a) => a.status !== 'requested' && !armedIds.has(a.id));

  async function submitRequest() {
    if (kind === 'privileged_command' && !command.trim()) { setReqError('Command ist Pflicht'); return; }
    setBusy(true); setReqError('');
    try {
      await onRequest(kind, kind === 'privileged_command' ? command.trim() : undefined, reason.trim() || undefined);
      setCommand(''); setReason('');
    } catch (e) {
      setReqError(e instanceof Error ? e.message : 'Anfrage fehlgeschlagen');
    } finally { setBusy(false); }
  }

  async function decide(actionId: string, decision: 'approve' | 'reject') {
    setDeciding(actionId + decision);
    try {
      if (decision === 'approve') await onApprove(actionId, (authBasis[actionId] ?? '').trim());
      else await onReject(actionId, rejectReasons[actionId] ?? '');
    } finally { setDeciding(''); }
  }

  function isOwnRequest(a: HuntResponseAction) {
    return a.requestedBy === currentUserId;
  }

  // ADR-042 Stufe 3: menschlich ausgelöste Ausführung. Passwort (frische Reauth) ist
  // Pflicht; der Container tauscht es gegen einen einmaligen deploy_reauth-Token.
  async function execute(a: HuntResponseAction) {
    const pw = (execPw[a.id] ?? '').trim();
    if (!pw) return;
    setExecuting(a.id);
    setExecError((prev) => ({ ...prev, [a.id]: '' }));
    try {
      await onExecute(a.id, pw);
      setExecPw((prev) => ({ ...prev, [a.id]: '' }));
    } catch (e) {
      setExecError((prev) => ({ ...prev, [a.id]: e instanceof Error ? e.message : 'Ausführung fehlgeschlagen' }));
    } finally {
      setExecuting('');
    }
  }

  return (
    <div>
      {/* ── Circuit-Breaker: Kanal nach wiederholten Fehlern gesperrt ─────────── */}
      {circuitOpen && canExecute && (
        <div style={{ ...s.card, ...s.cardDanger, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, flex: 1 }}>
            <strong>Containment-Kanal gesperrt</strong> — nach wiederholten fehlgeschlagenen Ausführungen.
            Ursache prüfen (Host/SSH/nftables), dann entsperren.
          </span>
          <Button variant="ghost" size="sm" disabled={resettingCircuit} onClick={() => void resetCircuit()}>
            {resettingCircuit ? 'Entsperre …' : 'Entsperren'}
          </Button>
        </div>
      )}

      {/* ── Neue Anfrage ──────────────────────────────────────────────────── */}
      {canRequest && (
        <div style={s.section}>
          <div style={s.label}>Neue Anfrage (Vier-Augen — kein Auto-Exec)</div>
          <div style={s.kindRow}>
            {KINDS.map((k) => (
              <button key={k.key} style={{ ...s.kindBtn, ...(kind === k.key ? s.kindBtnOn : {}) }}
                onClick={() => setKind(k.key)}>
                {kindIcon(k.key)}{k.label}
                <Badge tone={k.tier === 'containment' ? 'danger' : 'warning'}>{k.tier}</Badge>
              </button>
            ))}
          </div>

          {kind === 'privileged_command' && (
            <input style={s.input} placeholder="Befehl (z. B. net user /domain) *"
              value={command} onChange={(e) => setCommand(e.target.value)} />
          )}

          <input style={s.input} placeholder="Begründung (empfohlen)"
            value={reason} onChange={(e) => setReason(e.target.value)} />

          {reqError && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginBottom: 6 }}>{reqError}</div>}

          <Button variant="primary" size="sm" icon={<Send size={13} />}
            disabled={busy} onClick={() => void submitRequest()}>
            {busy ? 'Wird angefragt …' : 'Anfrage stellen'}
          </Button>
        </div>
      )}

      {/* ── Ausstehende Anfragen ──────────────────────────────────────────── */}
      {pending.length > 0 && (
        <div style={s.section}>
          <div style={s.label}>
            <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />
            Ausstehend ({pending.length}) — wartet auf Genehmigung
          </div>
          {pending.map((a) => {
            const cardStyle = { ...s.card, ...(a.riskTier === 'containment' ? s.cardDanger : s.cardWarn) };
            const canDecide = canApprove && !isOwnRequest(a);
            return (
              <div key={a.id} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: a.riskTier === 'containment' ? 'var(--danger)' : 'var(--warning)', display: 'inline-flex' }}>
                    {kindIcon(a.kind)}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{kindLabel(a.kind)}</span>
                  {a.command && <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.command}</code>}
                  <Badge tone={a.riskTier === 'containment' ? 'danger' : 'warning'}>{a.riskTier}</Badge>
                  <Badge tone="warning"><Clock size={10} style={{ marginRight: 3 }} />{statusLabel(a.status)}</Badge>
                </div>

                {a.reason && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}>Begründung: {a.reason}</div>}

                <div style={s.meta}>
                  <span>Angefragt von <strong>{a.requestedBy?.slice(0, 12) || '—'}</strong></span>
                  <span>{hhmmss(a.requestedAt)}</span>
                  {isOwnRequest(a) && <span style={{ color: 'var(--warning)' }}>⚠ Vier-Augen: du kannst deine eigene Anfrage nicht genehmigen</span>}
                </div>

                {canDecide && (
                  <div style={{ marginTop: 8 }}>
                    {/* Freigabe NUR mit dokumentierter Rechtsgrundlage (Betriebsrat / Notfall). */}
                    <input style={s.input}
                      placeholder="Rechtsgrundlage für Freigabe — Betriebsrat-Zustimmung / Notfall-Freigabe *"
                      value={authBasis[a.id] ?? ''}
                      onChange={(e) => setAuthBasis((prev) => ({ ...prev, [a.id]: e.target.value }))} />
                    <div style={s.rejectBox}>
                      <input style={{ ...s.input, marginBottom: 0, flex: 1 }}
                        placeholder="Ablehnungsgrund (bei Ablehnen)"
                        value={rejectReasons[a.id] ?? ''}
                        onChange={(e) => setRejectReasons((prev) => ({ ...prev, [a.id]: e.target.value }))} />
                      <Button variant="primary" size="sm" icon={<CheckCircle2 size={13} />}
                        disabled={deciding === a.id + 'approve' || !(authBasis[a.id] ?? '').trim()}
                        title={!(authBasis[a.id] ?? '').trim() ? 'Freigabe nur mit dokumentierter Rechtsgrundlage (Betriebsrat / Notfall)' : undefined}
                        onClick={() => void decide(a.id, 'approve')}>
                        Genehmigen
                      </Button>
                      <Button variant="ghost" size="sm" icon={<XCircle size={13} />}
                        disabled={deciding === a.id + 'reject'} onClick={() => void decide(a.id, 'reject')}>
                        Ablehnen
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Genehmigt — bereit zur Ausführung (ADR-042 Stufe 3, Reauth) ───── */}
      {canExecute && armed.length > 0 && (
        <div style={s.section}>
          <div style={s.label}>
            <Zap size={11} style={{ display: 'inline', marginRight: 4 }} />
            Genehmigt — bereit zur Ausführung ({armed.length}) · frische Reauth erforderlich
          </div>
          {armed.map((a) => {
            const own = isOwnRequest(a);
            const pw  = execPw[a.id] ?? '';
            return (
              <div key={a.id} style={{ ...s.card, ...s.cardDanger }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--danger)', display: 'inline-flex' }}>{kindIcon(a.kind)}</span>
                  <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{kindLabel(a.kind)}</span>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)' }}>{a.targetHost}</code>
                  <Badge tone="success">{statusLabel(a.status)}</Badge>
                </div>

                <div style={s.meta}>
                  <span>Angefragt von <strong>{a.requestedBy?.slice(0, 12) || '—'}</strong></span>
                  {a.approvedBy && <span>Genehmigt von <strong>{a.approvedBy.slice(0, 12)}</strong> · {hhmmss(a.approvedAt)}</span>}
                  {a.authorizationBasis && <span style={{ color: 'var(--text-muted)' }}>Grundlage: {a.authorizationBasis}</span>}
                </div>

                {own ? (
                  <div style={{ fontSize: 11.5, color: 'var(--warning)', marginTop: 8 }}>
                    ⚠ Drei-Parteien: du kannst deine eigene Anfrage nicht ausführen.
                  </div>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    {/* Ausführung erzwingt eine frische Passwort-Bestätigung (Reauth). */}
                    <input style={s.input} type="password"
                      aria-label="Passwort-Bestätigung (Reauth)"
                      placeholder="Passwort-Bestätigung (Reauth) *"
                      value={pw}
                      onChange={(e) => setExecPw((prev) => ({ ...prev, [a.id]: e.target.value }))} />
                    {execError[a.id] && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginBottom: 6 }}>{execError[a.id]}</div>}
                    <Button variant="primary" size="sm" icon={<Zap size={13} />}
                      disabled={executing === a.id || !pw.trim()}
                      onClick={() => void execute(a)}>
                      {executing === a.id ? 'Wird ausgeführt …' : 'Ausführen'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Erledigte Anfragen ────────────────────────────────────────────── */}
      {resolved.length > 0 && (
        <div style={s.section}>
          <div style={s.label}>Abgeschlossen ({resolved.length})</div>
          {resolved.map((a) => (
            <div key={a.id} style={s.card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text-dim)', display: 'inline-flex' }}>{kindIcon(a.kind)}</span>
                <span style={{ fontSize: 13, flex: 1 }}>{kindLabel(a.kind)}</span>
                {a.command && <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>{a.command}</code>}
                <Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge>
              </div>
              <div style={s.meta}>
                <span>Von {a.requestedBy?.slice(0, 12) || '—'} · {hhmmss(a.requestedAt)}</span>
                {a.approvedBy && <span>Entschieden von <strong>{a.approvedBy.slice(0, 12)}</strong> · {hhmmss(a.approvedAt)}</span>}
                {a.authorizationBasis && <span style={{ color: 'var(--text-muted)' }}>Grundlage: {a.authorizationBasis}</span>}
                {a.note && <span style={{ color: 'var(--text-muted)' }}>Status-Notiz: {a.note}</span>}
                {a.rejectionReason && <span style={{ color: 'var(--danger)' }}>Grund: {a.rejectionReason}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {actions.length === 0 && !canRequest && (
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>Keine Response-Aktionen.</div>
      )}
    </div>
  );
}
