import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { X, ShieldCheck, FileCode2, Copy, Download, AlertTriangle, Lightbulb, Power, Undo2 } from 'lucide-react';
import { Button, Badge, type Tone } from '../../../components/ui';
import { ticketApi } from '../../tickets/ticketApi';
import { useAuth } from '../../../lib/auth';
import { can } from '../../../lib/rbac';
import { apiErrorText } from '../../../lib/apiErrorText';
import type { ParsedEvidence, FpPreviewResult, FpScope, FpRuleTarget, WazuhFpException, FpStatus } from '../analysisModel';
import { useFocusTrap, useReturnFocus } from '../../../hooks/useFocusTrap';
import { useConfirm } from '../../../hooks/useConfirm';

const OVERLAY: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'grid', placeItems: 'center', padding: 20 };
const PANEL: CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-pop)', width: 'min(880px, 96vw)', maxHeight: '92vh', overflow: 'auto', padding: 20 };
const INP: CSSProperties = { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font-mono)' };
const LBL: CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' };

const ST_TONE: Record<FpStatus, Tone> = { draft: 'muted', submitted: 'warning', applied: 'accent', restart_required: 'warning', active: 'success', reverted: 'muted', failed: 'danger' };
const splitList = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

interface Props { ticketId: string; evidence: ParsedEvidence; initialReason?: string; onClose: () => void }

export function WazuhExceptionBuilderModal({ ticketId, evidence, initialReason = '', onClose }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canForward = can.act(user?.role);    // analyst+ : erstellen + weiterleiten
  const canApplyRole = can.apply(user?.role); // engineer/admin : anwenden
  const panelRef = useRef<HTMLDivElement>(null);

  // A11y: focus trap + Escape + focus-return (WCAG 2.4.3).
  useFocusTrap(panelRef, true, onClose);
  useReturnFocus(true);
  const { confirm, confirmDialog } = useConfirm();

  const [ruleId, setRuleId]   = useState(evidence.detection?.ruleId || '');
  const [srcips, setSrcips]   = useState(evidence.source?.ip || '');
  const [dstips, setDstips]   = useState(evidence.destination?.ip || '');
  const [dstports, setDstports] = useState(evidence.destination?.port ? String(evidence.destination.port) : '');
  const [protocol, setProtocol] = useState('');
  const [useProto, setUseProto] = useState(false);
  const [usePorts, setUsePorts] = useState(false);
  const [reason, setReason]   = useState(initialReason);
  const [suggestion, setSuggestion] = useState('');
  const [preview, setPreview] = useState<FpPreviewResult | null>(null);
  const [ruleTarget, setRuleTarget] = useState<FpRuleTarget | null>(null);
  const [busy, setBusy] = useState(false);

  const [exceptions, setExceptions] = useState<WazuhFpException[]>([]);
  const [applyEnabled, setApplyEnabled] = useState(false); // Safety-Gate (vom Backend)
  const [confirmApply, setConfirmApply] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canApply = canApplyRole && applyEnabled;

  const scope = (): Partial<FpScope> => ({
    ruleId,
    srcips: splitList(srcips),
    dstips: splitList(dstips),
    dstports: usePorts ? splitList(dstports) : [],
    protocol: useProto ? protocol : '',
    reason,
    ticketId,
  });

  const loadExceptions = () => {
    ticketApi.fpList(ticketId)
      .then((r) => { setExceptions(r.data || []); setApplyEnabled(!!r.capabilities?.applyEnabled); })
      // Bewusste sichere Degradierung: wenn der Kontext nicht lädt, wird Apply DEAKTIVIERT
      // (kein blindes Schreiben auf Wazuh) — kein Fake-Erfolg, sondern konservativ-sicher.
      .catch(() => { setExceptions([]); setApplyEnabled(false); });
  };

  useEffect(() => {
    ticketApi.fpSuggest(ticketId).then((r) => {
      setRuleTarget(r.ruleTarget ?? null);
      const s = r.data; if (!s) return;
      if (s.ruleId) setRuleId(s.ruleId);
      if (s.srcips?.length) setSrcips(s.srcips.join(', '));
      if (s.dstips?.length) setDstips(s.dstips.join(', '));
      if (s.dstports?.length) setDstports(s.dstports.join(', '));
      if (s.protocol) setProtocol(s.protocol);
      if (s.dstipSuggestion) setSuggestion(s.dstipSuggestion);
    }).catch(() => { /* Evidence-Vorbefüllung reicht */ });
    loadExceptions();
  }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  const genPreview = async () => {
    setBusy(true);
    try { setPreview(await ticketApi.fpPreview(ticketId, scope())); }
    catch (e) { setPreview({ ok: false, errors: [e instanceof Error ? e.message : 'Preview fehlgeschlagen'], warnings: [], xml: '', ruleId: 0, file: '', applied: false }); }
    finally { setBusy(false); }
  };

  const doForward = async () => {
    setBusy(true); setActionMsg(null);
    try {
      const r = await ticketApi.fpForward(ticketId, scope());
      setActionMsg(r.ok
        ? { ok: true, text: r.idempotent ? 'Bereits weitergeleitet (idempotent).' : 'Weitergeleitet — wartet auf Freigabe durch Engineer/Admin. Kein Wazuh-Write.' }
        : { ok: false, text: (r.errors || ['Weiterleiten fehlgeschlagen']).join(' · ') });
      loadExceptions();
    } catch (e) { setActionMsg({ ok: false, text: apiErrorText(e, 'Weiterleiten fehlgeschlagen') }); }
    finally { setBusy(false); }
  };

  const doApply = async () => {
    setBusy(true); setActionMsg(null);
    try {
      const r = await ticketApi.fpApply(ticketId, scope());
      setActionMsg(r.ok
        ? { ok: true, text: r.idempotent ? 'Ausnahme existiert bereits (idempotent) — nichts geschrieben.' : 'Geschrieben & validiert. Status: restart_required — Manager-Restart erforderlich.' }
        : { ok: false, text: (r.errors || ['Apply fehlgeschlagen']).join(' · ') });
      loadExceptions();
    } catch (e) { setActionMsg({ ok: false, text: apiErrorText(e, 'Apply fehlgeschlagen') }); }
    finally { setBusy(false); setConfirmApply(false); }
  };

  const doRestart = async (ex: WazuhFpException) => {
    if (!(await confirm({
      title: 'Wazuh-Manager neu starten?',
      message: 'Das lädt das geänderte Ruleset — kurze Unterbrechung von analysisd.',
      confirmLabel: 'Neu starten',
      danger: true,
    }))) return;
    setBusy(true);
    try { const r = await ticketApi.fpRestart(ticketId, ex.id); setActionMsg(r.ok ? { ok: true, text: 'Manager neu gestartet — Ausnahme aktiv.' } : { ok: false, text: (r.errors || []).join(' · ') }); loadExceptions(); }
    catch (e) { setActionMsg({ ok: false, text: apiErrorText(e, 'Restart fehlgeschlagen') }); }
    finally { setBusy(false); }
  };

  const doRevert = async (ex: WazuhFpException) => {
    if (!(await confirm({
      title: 'Wazuh-Ausnahme entfernen?',
      message: 'Die Regel wird aus der Datei gelöscht. Anschließend Restart bestätigen, damit es wirksam wird.',
      confirmLabel: 'Entfernen',
      danger: true,
    }))) return;
    setBusy(true);
    try { const r = await ticketApi.fpRevert(ticketId, ex.id); setActionMsg(r.ok ? { ok: true, text: 'Regel entfernt — Restart erforderlich, um wirksam zu werden.' } : { ok: false, text: (r.errors || []).join(' · ') }); loadExceptions(); }
    catch (e) { setActionMsg({ ok: false, text: apiErrorText(e, 'Revert fehlgeschlagen') }); }
    finally { setBusy(false); }
  };

  const download = () => {
    if (!preview?.xml) return;
    const b = new Blob([preview.xml], { type: 'application/xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = preview.file || 'soc_fp_exceptions.xml'; a.click();
  };

  return (
    <div style={OVERLAY} onClick={onClose} aria-hidden="true">
      {/* onClick nur zur Event-Eindämmung (stopPropagation), keine Aktion; ESC via useFocusTrap */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wazuh-fp-modal-title"
        style={PANEL}
        onClick={(e) => e.stopPropagation()}
      >
        {confirmDialog}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 id="wazuh-fp-modal-title" style={{ margin: 0, fontSize: 16, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}><ShieldCheck size={18} style={{ color: 'var(--accent)' }} /> False-Positive-Ausnahme (Wazuh)</h3>
          <button aria-label="Schließen" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--warning)', background: 'var(--warning-soft)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', padding: '7px 10px', margin: '8px 0 14px' }}>
          <AlertTriangle size={14} /> <strong>This modifies Wazuh rule files.</strong> Apply schreibt + validiert die Datei, startet den Manager aber NICHT automatisch.
        </div>

        {/* Scope-Editor */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={LBL}>Parent-Rule (if_sid) *</label><input style={INP} value={ruleId} onChange={(e) => setRuleId(e.target.value)} placeholder="87702" /></div>
          <div><label style={LBL}>Agent (nur Info)</label><input style={{ ...INP, opacity: 0.7 }} value={evidence.metadata?.agentId || '—'} readOnly /></div>
          <div><label style={LBL}>Source IP / CIDR / Liste <span style={{ color: 'var(--text-dim)' }}>(optional bei Multicast/Broadcast)</span></label><input style={INP} value={srcips} onChange={(e) => setSrcips(e.target.value)} placeholder="192.168.240.109, 192.168.240.0/24" /></div>
          <div>
            <label style={LBL}>Destination IP / CIDR / Liste *</label>
            <input style={INP} value={dstips} onChange={(e) => setDstips(e.target.value)} placeholder="224.0.0.7" />
            {suggestion && <button onClick={() => setDstips(suggestion)} style={{ marginTop: 5, fontSize: 11, background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 'var(--radius-pill)', padding: '3px 9px', cursor: 'pointer' }}>Multicast-Vorschlag: {suggestion}</button>}
          </div>
          <div>
            <label style={{ ...LBL, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={usePorts} onChange={(e) => setUsePorts(e.target.checked)} /> Destination-Port (optional)</label>
            <input style={{ ...INP, opacity: usePorts ? 1 : 0.5 }} value={dstports} onChange={(e) => setDstports(e.target.value)} disabled={!usePorts} placeholder="5353, 1900" />
          </div>
          <div>
            <label style={{ ...LBL, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={useProto} onChange={(e) => setUseProto(e.target.checked)} /> Protokoll (optional)</label>
            <input style={{ ...INP, opacity: useProto ? 1 : 0.5 }} value={protocol} onChange={(e) => setProtocol(e.target.value)} disabled={!useProto} placeholder="UDP" />
          </div>
        </div>
        {ruleTarget?.isFrequencyRule && ruleTarget.baseRuleId && ruleTarget.baseRuleId !== ruleId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10, padding: '8px 11px', borderRadius: 'var(--radius-sm)', background: 'var(--warning-soft)', border: '1px solid var(--warning)' }}>
            <Lightbulb size={15} style={{ color: 'var(--warning)' }} />
            <span style={{ fontSize: 12, color: 'var(--text)' }}>
              Regel <code>{ruleId}</code> ist eine <strong>Frequency-Regel</strong> (aggregiert Treffer der Basis-Regel <code>{ruleTarget.baseRuleId}</code>). Eine Ausnahme auf {ruleId} unterdrückt erst die Aggregation — besser die <strong>Basis-Regel</strong> scopen, damit das Rauschen gar nicht erst zählt.
            </span>
            <Button variant="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={() => setRuleId(ruleTarget.baseRuleId as string)}>
              Auf Basis-Regel {ruleTarget.baseRuleId} legen
            </Button>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <label style={LBL}>Begründung (Pflicht) *</label>
          <textarea style={{ ...INP, fontFamily: 'inherit', minHeight: 52 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Lokaler Multicast-Traffic, von Firewall geblockt, erwartetes Verhalten." />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <Button variant="primary" icon={<FileCode2 size={15} />} disabled={busy} onClick={genPreview}>Vorschau erzeugen</Button>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Keine globale Ausnahme. Mind. Destination Pflicht; quell-agnostisch (ohne Source) nur für Multicast/Broadcast-Ziele oder mit Port.</span>
        </div>

        {/* Preview */}
        {preview && (
          <div style={{ marginTop: 14 }}>
            {preview.errors.length > 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--danger)', background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', marginBottom: 8 }}>
                <strong>Nicht erzeugt:</strong><ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>{preview.errors.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            {preview.warnings.length > 0 && <div style={{ fontSize: 12, color: 'var(--warning)', display: 'flex', gap: 6, marginBottom: 8 }}><Lightbulb size={14} /> {preview.warnings.join(' · ')}</div>}
            {preview.ok && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ziel: <code>{preview.file}</code> · Rule-ID <code>{preview.ruleId}</code> <Badge tone="muted">Vorschau</Badge></span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <Button variant="ghost" size="sm" icon={<Copy size={13} />} onClick={() => navigator.clipboard?.writeText(preview.xml)}>XML kopieren</Button>
                    <Button variant="ghost" size="sm" icon={<Download size={13} />} onClick={download}>Download</Button>
                  </span>
                </div>
                <pre style={{ margin: 0, background: 'var(--bg-terminal)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: 12, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{preview.xml}</pre>
              </>
            )}
          </div>
        )}

        {/* Apply (admin, 2-Step) */}
        {preview?.ok && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
            {!applyEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-card-soft)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '7px 10px', marginBottom: 10 }}>
                <AlertTriangle size={14} style={{ color: 'var(--text-dim)' }} /> <strong>Wazuh FP apply is disabled by configuration</strong> (<code>WAZUH_FP_APPLY_ENABLED</code>). Vorschau &amp; XML-Export bleiben möglich.
              </div>
            )}
            {/* Analyst: erstellen + weiterleiten (kein Write) */}
            {canForward && (
              <Button variant="ghost" icon={<ShieldCheck size={15} />} disabled={busy} onClick={doForward} style={{ marginRight: 8 }}>
                Weiterleiten (zur Freigabe)
              </Button>
            )}
            {!canApplyRole ? (
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Anwenden erfordert <strong>Engineer</strong> oder <strong>Admin</strong>. Analyst kann erstellen + weiterleiten.</span>
            ) : !confirmApply ? (
              <Button variant="danger" icon={<ShieldCheck size={15} />} disabled={busy || !canApply} title={!applyEnabled ? 'Disabled by configuration (WAZUH_FP_APPLY_ENABLED)' : ''} onClick={() => setConfirmApply(true)}>Apply to Wazuh</Button>
            ) : (
              <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
                <div style={{ fontSize: 12.5, color: 'var(--text)', marginBottom: 8 }}><strong>Bestätigen:</strong> schreibt die Regel in <code>soc_fp_exceptions.xml</code> und validiert die Config. Der Manager wird <strong>nicht</strong> automatisch neu gestartet (separater Schritt).</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="danger" size="sm" disabled={busy} onClick={doApply}>Bestätigen &amp; Anwenden</Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmApply(false)}>Abbrechen</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {actionMsg && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: actionMsg.ok ? 'var(--success)' : 'var(--danger)', background: actionMsg.ok ? 'var(--success-soft)' : 'var(--danger-soft)', border: `1px solid ${actionMsg.ok ? 'var(--success)' : 'var(--danger)'}`, borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>{actionMsg.text}</div>
        )}

        {/* Bestehende Ausnahmen + Lifecycle */}
        {exceptions.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Ausnahmen an diesem Ticket</div>
            {exceptions.map((ex) => (
              <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <Badge tone={ST_TONE[ex.status]}>{ex.status}</Badge>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)' }}>
                  Rule <code>{ex.parentRuleId}</code> → <code>{ex.generatedRuleId ?? '—'}</code> · {ex.srcips.join(',')} → {ex.dstips.join(',')}
                  {ex.status === 'failed' && ex.lastError && <span style={{ color: 'var(--danger)' }}> · {ex.lastError}</span>}
                </span>
                {isAdmin && (ex.status === 'restart_required' || ex.status === 'reverted') && (
                  <Button variant="ghost" size="sm" icon={<Power size={13} />} disabled={busy || !canApply} title={!applyEnabled ? 'Disabled by configuration' : ''} onClick={() => doRestart(ex)}>Restart Manager now</Button>
                )}
                {isAdmin && (ex.status === 'active' || ex.status === 'restart_required') && (
                  <Button variant="ghost" size="sm" icon={<Undo2 size={13} />} disabled={busy || !canApply} title={!applyEnabled ? 'Disabled by configuration' : ''} onClick={() => doRevert(ex)}>Revert</Button>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
          <Button variant="ghost" onClick={onClose}>Schließen</Button>
        </div>
      </div>
    </div>
  );
}
