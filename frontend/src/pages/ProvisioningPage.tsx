import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useConfirm } from '../hooks/useConfirm';
import { Server, ShieldOff, Plus, KeyRound, X, Check, Copy, RefreshCw, Lightbulb } from 'lucide-react';
import { Badge, Button, Spinner, ErrorCard, HelpTip, ExampleHint } from '../components/ui';
import {
  provisioningApi,
  NODE_ROLES,
  CAPABILITIES,
  type InstalledNode,
  type EnrollmentProfile,
  type NodeDetail,
  type NodeRole,
  type Capability,
  type CreateEnrollmentProfileBody,
  type NodeCredentialSummary,
} from '../features/provisioning/provisioningApi';
import {
  nodeStatusTone, heartbeatTone, enrollmentTone, relativeTime, isHeartbeatStale,
  credentialStatusTone, canRevokeCredential, canRetireNode, revokeConfirmText, retireConfirmText,
} from '../features/provisioning/provisioningView';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';
import { useTranslation } from 'react-i18next';

// ── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  page:      { padding: '16px 20px' },
  head:      { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' },
  panel:     { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', marginBottom: 16 },
  panelHead: { padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 10 },
  th:        { textAlign: 'left', fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, padding: '8px 12px', borderBottom: '1px solid var(--border-soft)' },
  td:        { fontSize: 12.5, padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', verticalAlign: 'middle' },
  label:     { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4, display: 'block' },
  input:     { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' as const },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: 4, marginBottom: 14 },
  hint:      { fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.45 },
  overlay:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal:     { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' as const },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' },
  modalBody: { padding: '16px 18px' },
  modalFoot: { display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 18px', borderTop: '1px solid var(--border-soft)' },
  capGrid:   { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 },
  capItem:   { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' },
  tokenBox:  { fontFamily: 'var(--font-mono)', fontSize: 12.5, wordBreak: 'break-all' as const, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', color: 'var(--accent)' },
  closeBtn:  { background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 },
  helpLabel: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
  helpBulb:  { display: 'inline-flex', alignItems: 'center', color: 'var(--warning)' },
};

const ROLE_LABELS: Record<NodeRole, string> = {
  control_plane:         'Control Plane',
  normal_agent:          'Normal Agent',
  integration_connector: 'Integration Connector',
  network_sensor:        'Network Sensor',
  gateway_sensor:        'Gateway Sensor',
};

const EMPTY_PROFILE: CreateEnrollmentProfileBody = { name: '', role: 'normal_agent', capabilities: [] };

function formLabel(text: string, hint: ReactNode) {
  return (
    <span style={s.helpLabel}>
      <span>{text}</span>
      <HelpTip topic="provisioning" hint={hint}>
        <span style={s.helpBulb} aria-label={`${text} erklaeren`}>
          <Lightbulb size={13} aria-hidden />
        </span>
      </HelpTip>
    </span>
  );
}

// ── Modal: Enrollment-Profil anlegen ────────────────────────────────────────

interface CreateProfileModalProps {
  onSave: (body: CreateEnrollmentProfileBody) => Promise<void>;
  onClose: () => void;
  busy: boolean;
  error: string;
}

function CreateProfileModal({ onSave, onClose, busy, error }: CreateProfileModalProps) {
  const { t: tr } = useTranslation();
  const [form, setForm] = useState<CreateEnrollmentProfileBody>(EMPTY_PROFILE);

  function toggleCap(cap: Capability) {
    setForm((prev) => {
      const has = (prev.capabilities ?? []).includes(cap);
      const capabilities = has
        ? (prev.capabilities ?? []).filter((c) => c !== cap)
        : [...(prev.capabilities ?? []), cap];
      return { ...prev, capabilities };
    });
  }

  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-labelledby="cp-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div style={s.modal}>
        <div style={s.modalHead}>
          <span id="cp-title" style={{ fontWeight: 700, fontSize: 14 }}>{tr('provisioning.createEnrollmentProfile')}</span>
          <button type="button" aria-label={tr('common.close')} onClick={onClose} style={s.closeBtn}><X size={16} /></button>
        </div>
        <div style={s.modalBody}>
          <div style={s.formGroup}>
            <label htmlFor="cp-name" style={s.label}>{formLabel('Name *', (
              <ExampleHint
                title={tr('text.internalNameEnrolmentProfile')}
                text={tr('deploy.nameLaterDescribesWhichNode')}
                exampleLabel="Typischer Profilname"
                rows={[
                  { label: 'Sensor', value: 'branch-sensor-lab' },
                  { label: 'Connector', value: 'tenant-a-connector' },
                ]}
                footer={tr('deploy.pickNameMakesRoleLocation')}
              />
            ))}</label>
            <input id="cp-name" style={s.input} value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="z. B. lab-sensor" />
          </div>
          <div style={s.formGroup}>
            <label htmlFor="cp-role" style={s.label}>{formLabel(tr('users.roleRequired'), (
              <ExampleHint
                title={tr('deploy.whatTaskFutureNodeTakes')}
                text={tr('deploy.roleDeterminesHowNodeClassified')}
                exampleLabel="Einfacher Start"
                rows={[
                  { label: 'Standard-Agent', value: 'Normal Agent' },
                  { label: 'Netzsicht', value: 'Network Sensor' },
                ]}
                footer={tr('deploy.chooseRoleItsActualPurpose')}
              />
            ))}</label>
            <select id="cp-role" style={s.input} value={form.role}
              onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as NodeRole }))}>
              {NODE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <div style={s.formGroup}>
            <label style={s.label}>{formLabel('Capabilities (read-only)', (
              <ExampleHint
                title={tr('deploy.whichCapabilitiesProfileShouldGrant')}
                text={tr('deploy.hereYouDefineWhichTechnical')}
                exampleLabel={tr('common.typicalMix')}
                rows={[
                  { label: 'Basis', value: 'heartbeat, inventory' },
                  { label: 'Sensor', value: 'netflow, packet-metadata' },
                ]}
                footer={tr('deploy.enableOnlyWhatNodeGenuinely')}
              />
            ))}</label>
            <div style={s.capGrid}>
              {CAPABILITIES.map((cap) => (
                <label key={cap} style={s.capItem}>
                  <input type="checkbox" checked={(form.capabilities ?? []).includes(cap)} onChange={() => toggleCap(cap)} />
                  {cap}
                </label>
              ))}
            </div>
          </div>
          {error && (
            <div style={{ padding: '8px 12px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, color: 'var(--danger)' }}>
              {error}
            </div>
          )}
        </div>
        <div style={s.modalFoot}>
          <Button variant="ghost" onClick={onClose}>{tr('common.cancel2')}</Button>
          <Button variant="primary" icon={busy ? undefined : <Check size={13} />} disabled={busy || !form.name.trim()}
            onClick={() => void onSave(form)}>
            {busy ? tr('common.creatingShort') : tr('common.create')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Token (Klartext EINMALIG) ────────────────────────────────────────

function TokenModal({ token, onClose }: { token: string; onClose: () => void }) {
  const { t: tr } = useTranslation();
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard?.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-labelledby="tk-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div style={{ ...s.modal, maxWidth: 520 }}>
        <div style={s.modalHead}>
          <span id="tk-title" style={{ fontWeight: 700, fontSize: 14 }}>Enrollment-Token</span>
          <button type="button" aria-label={tr('common.close')} onClick={onClose} style={s.closeBtn}><X size={16} /></button>
        </div>
        <div style={s.modalBody}>
          <div style={{ fontSize: 12.5, color: 'var(--warning)', marginBottom: 10 }}>
            Dieser Token wird <strong>{tr('text.onceOnly')}</strong>{tr('settings.tokenCopyNow')}</div>
          <div style={s.tokenBox}>{token}</div>
        </div>
        <div style={s.modalFoot}>
          <Button variant="ghost" icon={<Copy size={13} />} onClick={copy}>
            {copied ? tr('common.copied') : tr('common.copy')}
          </Button>
          <Button variant="primary" onClick={onClose}>Fertig</Button>
        </div>
      </div>
    </div>
  );
}

// (Bestätigungs-Dialog für destruktive Lifecycle-Aktionen läuft über den
//  zentralen useConfirm-Hook mit Async-Action-Modus — siehe NodeDetailModal.)

// ── Modal: Node-Detail (inkl. Credential-Lifecycle) ─────────────────────────

function NodeDetailModal({ nodeId, role, onClose, onChanged }: {
  nodeId: string; role: string | undefined; onClose: () => void; onChanged: () => void;
}) {
  const { t: tr } = useTranslation();
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [credentials, setCredentials] = useState<NodeCredentialSummary[]>([]);
  const [error, setError] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  async function loadAll(signal?: AbortSignal) {
    try {
      const [nodeRes, credRes] = await Promise.all([
        provisioningApi.getNode(nodeId, { signal }),
        provisioningApi.listNodeCredentials(nodeId, { signal }),
      ]);
      setDetail(nodeRes.data);
      setCredentials(credRes.data);
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') setError(e.message);
    }
  }

  useEffect(() => {
    const ctrl = new AbortController();
    void loadAll(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Destruktive Lifecycle-Aktionen über useConfirm (Async-Action-Modus: Dialog bleibt
  // offen + busy während des API-Calls, Fehler erscheint inline). Bei Erfolg neu laden.
  async function doRevoke(credentialId: string) {
    if (!detail) return;
    const ok = await confirm({
      title: 'Credential widerrufen',
      message: revokeConfirmText(detail.node),
      confirmLabel: 'Widerrufen',
      danger: true,
      action: async () => { await provisioningApi.revokeCredential(nodeId, credentialId); },
    });
    if (ok) { await loadAll(); onChanged(); }
  }

  async function doRetire() {
    if (!detail) return;
    const ok = await confirm({
      title: 'Node stilllegen',
      message: retireConfirmText(detail.node),
      confirmLabel: 'Stilllegen',
      danger: true,
      action: async () => { await provisioningApi.retireNode(nodeId); },
    });
    if (ok) { await loadAll(); onChanged(); }
  }

  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-labelledby="nd-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div style={s.modal}>
        <div style={s.modalHead}>
          <span id="nd-title" style={{ fontWeight: 700, fontSize: 14 }}>
            {detail ? detail.node.name : 'Node'}
          </span>
          <button type="button" aria-label={tr('common.close')} onClick={onClose} style={s.closeBtn}><X size={16} /></button>
        </div>
        <div style={s.modalBody}>
          {error && <ErrorCard message={error} />}
          {!error && !detail && <Spinner />}
          {detail && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <Field label="Status"><Badge tone={nodeStatusTone(detail.node.status)} dot>{detail.node.status}</Badge></Field>
                <Field label={tr('common.role')}>{ROLE_LABELS[detail.node.role]}</Field>
                <Field label="IP">{detail.node.ip ?? '—'}</Field>
                <Field label="OS / Version">{[detail.node.os, detail.node.version].filter(Boolean).join(' / ') || '—'}</Field>
                <Field label="Zuletzt gesehen">
                  {relativeTime(detail.node.lastSeenAt)}
                  {isHeartbeatStale(detail.node.lastSeenAt) && detail.node.lastSeenAt && (
                    <Badge tone="warning">stale</Badge>
                  )}
                </Field>
                <Field label="Letzter Heartbeat">
                  {detail.latestHeartbeat
                    ? <Badge tone={heartbeatTone(detail.latestHeartbeat.status)}>{detail.latestHeartbeat.status}</Badge>
                    : '—'}
                </Field>
              </div>

              {/* Credential-Lifecycle — NIE Hash/Klartext; nur Präfix + Status. */}
              <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Credentials ({credentials.length})
              </div>
              {credentials.length === 0 && <span style={s.hint}>{tr('text.noCredentials')}</span>}
              {credentials.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{c.prefix || '—'}</span>
                  <Badge tone={credentialStatusTone(c.status)} dot>{c.status}</Badge>
                  <span style={{ color: 'var(--text-dim)' }}>seit {relativeTime(c.issuedAt)}</span>
                  <div style={{ marginLeft: 'auto' }}>
                    {canRevokeCredential(role, c.status) && (
                      <Button variant="danger" size="sm" onClick={() => void doRevoke(c.id)}>
                        Widerrufen
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '16px 0 6px' }}>
                Capabilities ({detail.capabilities.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {detail.capabilities.length === 0 && <span style={s.hint}>{tr('text.noneReported')}</span>}
                {[...new Set(detail.capabilities.map((c) => c.name))].map((name) => (
                  <Badge key={name} tone="accent">{name}</Badge>
                ))}
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Heartbeats ({detail.heartbeats.length})
              </div>
              {detail.heartbeats.length === 0 && <span style={s.hint}>{tr('deploy.noHeartbeatsYet')}</span>}
              {detail.heartbeats.slice(-8).reverse().map((hb) => (
                <div key={hb.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                  <Badge tone={heartbeatTone(hb.status)}>{hb.status}</Badge>
                  <span style={{ color: 'var(--text-dim)' }}>{relativeTime(hb.receivedAt)}</span>
                  {hb.agentVersion && <span style={{ fontFamily: 'var(--font-mono)' }}>v{hb.agentVersion}</span>}
                </div>
              ))}
            </>
          )}
        </div>
        <div style={s.modalFoot}>
          {detail && canRetireNode(role, detail.node.status) && (
            <Button variant="danger" icon={<ShieldOff size={13} />} style={{ marginRight: 'auto' }}
              onClick={() => void doRetire()}>
              Node stilllegen
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>{tr('common.close')}</Button>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={s.label}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>{children}</div>
    </div>
  );
}

// ── Seite ───────────────────────────────────────────────────────────────────

export function ProvisioningPage() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  // Render-Gate (UI-only; echte Durchsetzung serverseitig admin-only).
  if (!can.admin(user?.role)) {
    return (
      <div style={{ ...s.page, paddingTop: 48, textAlign: 'center' }}>
        <ShieldOff size={40} style={{ color: 'var(--text-dim)', marginBottom: 12 }} />
        <div style={{ fontSize: 16, fontWeight: 600 }}>{tr('common.accessDenied')}</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>{tr('common.adminOnlyPage')}</div>
      </div>
    );
  }
  return <ProvisioningContent />;
}

function ProvisioningContent() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const [nodes, setNodes] = useState<InstalledNode[] | null>(null);
  const [profiles, setProfiles] = useState<EnrollmentProfile[] | null>(null);
  const [loadError, setLoadError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');

  const [mintedToken, setMintedToken] = useState('');
  const [detailNodeId, setDetailNodeId] = useState('');
  const [toast, setToast] = useState('');

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3500); }

  async function load() {
    try {
      const [nodesRes, profilesRes] = await Promise.all([
        provisioningApi.listNodes({ limit: 200 }),
        provisioningApi.listEnrollmentProfiles(),
      ]);
      setNodes(nodesRes.data);
      setProfiles(profilesRes.data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : tr('text.loadingFailed2'));
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate(body: CreateEnrollmentProfileBody) {
    setCreateBusy(true);
    setCreateError('');
    try {
      await provisioningApi.createEnrollmentProfile(body);
      setCreateOpen(false);
      showToast('Enrollment-Profil angelegt.');
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : tr('common.createFailed'));
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleMint(profileId: string) {
    try {
      const res = await provisioningApi.mintToken(profileId);
      setMintedToken(res.data.token);
    } catch (e) {
      showToast(e instanceof Error ? e.message : tr('settings.tokenCreationFailed'));
    }
  }

  if (loadError) return <div style={s.page}><ErrorCard message={loadError} /></div>;
  if (!nodes || !profiles) return <div style={s.page}><Spinner /></div>;

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.head}>
        <Server size={26} style={{ color: 'var(--accent)', marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            Provisioning <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>/ Registry</span>
            <HelpTip topic="provisioning" />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2 }}>{tr('provisioning.subtitle')}</div>
        </div>
        <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load()} title={tr('label.refresh')}>{tr('label.refresh')}</Button>
      </div>

      {/* Enrollment-Profile */}
      <div style={s.panel}>
        <div style={s.panelHead}>
          <KeyRound size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Enrollment-Profile ({profiles.length})</span>
          <div style={{ marginLeft: 'auto' }}>
            <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => { setCreateError(''); setCreateOpen(true); }}>{tr('provisioning.createProfile')}</Button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Name', tr('common.role'), 'Capabilities', 'Status', 'Aktion'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {profiles.length === 0 && (
                <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>{tr('provisioning.noProfiles')}</td></tr>
              )}
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{p.name}</td>
                  <td style={s.td}>{ROLE_LABELS[p.role]}</td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {p.capabilities.length === 0 ? '—' : p.capabilities.map((c) => <Badge key={c} tone="muted">{c}</Badge>)}
                    </div>
                  </td>
                  <td style={s.td}><Badge tone={enrollmentTone(p.status)} dot>{p.status}</Badge></td>
                  <td style={s.td}>
                    <Button variant="ghost" size="sm" icon={<KeyRound size={12} />}
                      disabled={p.status !== 'active'} onClick={() => void handleMint(p.id)} title={tr('settings.createToken')}>
                      Token
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nodes */}
      <div style={s.panel}>
        <div style={s.panelHead}>
          <Server size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Nodes ({nodes.length})</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Name', tr('common.role'), 'IP', 'Version', 'Status', 'Zuletzt gesehen'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {nodes.length === 0 && (
                <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                  Noch keine Nodes enrollt.
                </td></tr>
              )}
              {nodes.map((n) => (
                <tr key={n.id} style={{ cursor: 'pointer' }} onClick={() => setDetailNodeId(n.id)}>
                  <td style={{ ...s.td, fontWeight: 600, color: 'var(--accent)' }}>{n.name}</td>
                  <td style={s.td}>{ROLE_LABELS[n.role]}</td>
                  <td style={{ ...s.td, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{n.ip ?? '—'}</td>
                  <td style={{ ...s.td, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{n.version ?? '—'}</td>
                  <td style={s.td}><Badge tone={nodeStatusTone(n.status)} dot>{n.status}</Badge></td>
                  <td style={s.td}>
                    {relativeTime(n.lastSeenAt)}
                    {isHeartbeatStale(n.lastSeenAt) && n.lastSeenAt && (
                      <Badge tone="warning">stale</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && <CreateProfileModal onSave={handleCreate} onClose={() => setCreateOpen(false)} busy={createBusy} error={createError} />}
      {mintedToken && <TokenModal token={mintedToken} onClose={() => setMintedToken('')} />}
      {detailNodeId && (
        <NodeDetailModal nodeId={detailNodeId} role={user?.role}
          onClose={() => setDetailNodeId('')} onChanged={() => void load()} />
      )}

      {toast && (
        // Toast wird per role="status" angesagt; Klick zum Wegklicken ist reine Maus-Ergänzung
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <div role="status" style={{ position: 'fixed', bottom: 20, right: 20, background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '12px 16px', fontSize: 13, zIndex: 1100, cursor: 'pointer', maxWidth: 360 }}
          onClick={() => setToast('')}>
          {toast}
        </div>
      )}
    </div>
  );
}
