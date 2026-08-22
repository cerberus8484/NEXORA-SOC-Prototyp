import { useEffect, useState, type CSSProperties } from 'react';
import { KeyRound, ShieldAlert, Fingerprint, RefreshCw, DownloadCloud, Copy, Check } from 'lucide-react';
import { Card, CardHeader, CardBody, Button, Badge, Field, Input, Spinner, ErrorCard, EmptyState } from '../../components/ui';
import { deployApi, type DeployKeypairInfo } from './deployApi';
import { provisioningApi, type InstalledNode } from '../provisioning/provisioningApi';
import { managedNodes, nodeActionState, shortFingerprint } from './managedNodesView';
import { ApiError } from '../../lib/apiClient';

// Bedien-UI für den „updatebar"-Pfad (Deployment Center, Slice 7c): Deploy-Keypair
// generieren/rotieren, Host-Key verwalteter Windows-Nodes pinnen und gated Updates
// auslösen. Jede schreibende Aktion erzwingt eine frische Passwort-Reauth (X-Reauth-
// Token, one-shot). Die echte Durchsetzung (NODE_UPDATE_ENABLED, fail-closed, kein
// TOFU) liegt ausschließlich im Backend — diese UI ist NIE die Sicherheitsgrenze.

const s: Record<string, CSSProperties> = {
  hint:  { fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 },
  label: { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '10px 0 4px', display: 'block' },
  mono:  { fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-all' },
  warn:  { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', background: 'color-mix(in srgb, var(--warning) 8%, transparent)', margin: '12px 0' },
  row:   { display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-soft)', flexWrap: 'wrap' },
  acts:  { display: 'flex', gap: 8, flexWrap: 'wrap' },
  reauth:{ marginTop: 12 },
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message}${e.code ? ` (${e.code})` : ''}`;
  return e instanceof Error ? e.message : 'Unbekannter Fehler';
}

export function ManagedNodesPanel() {
  const [nodes, setNodes] = useState<InstalledNode[] | null>(null);
  const [keypair, setKeypair] = useState<DeployKeypairInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reauthPw, setReauthPw] = useState('');
  const [busy, setBusy] = useState('');            // '' | 'keypair' | node.id
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [copied, setCopied] = useState(false);

  async function load(signal?: AbortSignal) {
    try {
      const [nodesRes, kpRes] = await Promise.all([
        provisioningApi.listNodes({ limit: 200 }, { signal }),
        deployApi.getKeypair({ signal }),
      ]);
      setNodes(nodesRes.data);
      setKeypair(kpRes.data);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setLoadError(errMsg(e));
    }
  }

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, []);

  // Ein Step-up pro Aktion: frisches Passwort → deploy_reauth-Token (one-shot) → Aktion.
  // Bei Erfolg Passwort löschen (erzwingt erneute Bestätigung) und Registry neu laden.
  async function withReauth(key: string, fn: (token: string) => Promise<void>) {
    setActionError('');
    setNotice('');
    setBusy(key);
    try {
      const { data } = await deployApi.reauth(reauthPw);
      await fn(data.reauthToken);
      setReauthPw('');
      await load();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy('');
    }
  }

  function handleGenerate() {
    const rotating = Boolean(keypair?.isSet);
    void withReauth('keypair', async (token) => {
      const res = await deployApi.generateKeypair(token);
      setKeypair(res.data);
      setNotice(rotating ? 'Deploy-Keypair rotiert.' : 'Deploy-Keypair generiert.');
    });
  }

  function handleCapture(node: InstalledNode) {
    void withReauth(node.id, async (token) => {
      const res = await deployApi.captureHostKey(node.id, token);
      setNotice(`Host-Key erfasst (${node.name}): ${res.data.fingerprint} — bitte out-of-band verifizieren.`);
    });
  }

  function handleUpdate(node: InstalledNode) {
    void withReauth(node.id, async (token) => {
      await deployApi.updateNode(node.id, token);
      setNotice(`Update auf ${node.name} ausgelöst.`);
    });
  }

  // Public-Key in die Zwischenablage — damit der Admin ihn auf Hosts pinnen kann, die
  // Nexora nicht selbst ausgerollt hat (Auto-Provisionierung greift nur bei vm-clone).
  function copyPublicKey() {
    if (!keypair?.publicKey) return;
    void navigator.clipboard?.writeText(keypair.publicKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loadError) return <ErrorCard message={loadError} />;
  if (!nodes || !keypair) return <Spinner />;
  const managed = managedNodes(nodes);
  const pwMissing = !reauthPw;

  return (
    <>
      <Card>
        <CardHeader
          title="Deploy-Keypair"
          actions={<Badge tone={keypair.isSet ? 'success' : 'muted'} dot>{keypair.isSet ? 'aktiv' : 'nicht gesetzt'}</Badge>}
        />
        <CardBody>
          <div style={s.hint}>
            SSH-Keypair, mit dem Nexora deployte Server für Updates erreicht (Auth-Modell A).
            Der Private-Key bleibt server-seitig AES-256-GCM-verschlüsselt und wird nie herausgegeben.
          </div>
          {keypair.isSet ? (
            <div style={{ marginTop: 10 }}>
              <Field label="Fingerprint">
                <span style={s.mono}><Fingerprint size={12} style={{ verticalAlign: -1, marginRight: 4 }} />{shortFingerprint(keypair.fingerprint)}</span>
              </Field>
              {keypair.publicKey && (
                <div>
                  {/* Kein <Field>/<label> hier: der Copy-Button darf nicht im Label liegen
                      (sonst wird der Label-Text sein Accessible Name). */}
                  <span style={s.label}>Public Key (authorized_keys)</span>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={s.mono}>{keypair.publicKey}</span>
                    <Button
                      variant="ghost" size="sm"
                      icon={copied ? <Check size={13} /> : <Copy size={13} />}
                      onClick={copyPublicKey}
                      title="Public Key in die Zwischenablage kopieren"
                    >
                      {copied ? 'Kopiert' : 'Kopieren'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState title="Kein Deploy-Keypair" message="Ohne Keypair können deployte Server nicht per SSH aktualisiert werden. Zuerst generieren." />
          )}
          <div style={s.warn}>
            <ShieldAlert size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
            <div style={s.hint}>
              <strong>Rotieren invalidiert bestehende <code>authorized_keys</code>-Provisionierungen.</strong> Bereits
              ausgerollte Server sind danach nicht mehr per SSH erreichbar und müssen mit dem neuen Public Key neu ausgerollt werden.
            </div>
          </div>
          <Field label="Passwort-Bestätigung (Reauth)">
            <Input type="password" value={reauthPw} onChange={(e) => setReauthPw(e.target.value)} placeholder="Aktuelles Passwort" />
          </Field>
          <div style={{ marginTop: 10 }}>
            <Button
              variant={keypair.isSet ? 'danger' : 'primary'}
              icon={keypair.isSet ? <RefreshCw size={14} /> : <KeyRound size={14} />}
              disabled={pwMissing || busy === 'keypair'}
              onClick={handleGenerate}
            >
              {busy === 'keypair' ? 'Arbeitet …' : keypair.isSet ? 'Keypair rotieren' : 'Keypair generieren'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Verwaltete Nodes — Update"
          actions={<Badge tone="accent">{managed.length}</Badge>}
        />
        <CardBody>
          <div style={s.hint}>
            Windows- und Linux-Nodes aus der Registry. Voraussetzung fürs Update: gepinnter Host-Key (kein TOFU) und ein
            vorhandenes Deploy-Keypair. Update und Host-Key-Erfassung erfordern eine frische Passwort-Bestätigung (oben).
          </div>
          <div style={{ marginTop: 12 }}>
            {managed.length === 0 ? (
              <EmptyState title="Keine verwalteten Nodes" message="Über das Deployment Center ausgerollte Windows-/Linux-Nodes (und enrollte Linux-Hosts) erscheinen hier automatisch." />
            ) : managed.map((n) => {
              const st = nodeActionState(n, keypair);
              const nodeBusy = busy === n.id;
              return (
                <div key={n.id} style={s.row}>
                  <div style={{ minWidth: 160 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{n.name}</div>
                    <div style={{ ...s.hint, ...s.mono }}>{n.ip ?? 'keine IP'}</div>
                    <div style={s.hint}>Agent {n.version ? `v${n.version}` : 'unbekannt'}</div>
                  </div>
                  <Badge tone={st.hostKeyPinned ? 'success' : 'warning'} dot>
                    {st.hostKeyPinned ? 'Host-Key gepinnt' : 'kein Host-Key'}
                  </Badge>
                  <div style={s.acts}>
                    {st.canCaptureHostKey && (
                      <Button
                        variant="ghost" size="sm" icon={<DownloadCloud size={13} />}
                        disabled={pwMissing || nodeBusy}
                        onClick={() => handleCapture(n)}
                        title="Host-Key des Nodes scannen und pinnen"
                      >
                        {st.hostKeyPinned ? 'Host-Key neu erfassen' : 'Host-Key erfassen'}
                      </Button>
                    )}
                    <Button
                      variant="primary" size="sm"
                      disabled={!st.canUpdate || pwMissing || nodeBusy}
                      onClick={() => handleUpdate(n)}
                      title={st.updateBlockedReason ?? 'Wazuh-Agent aktualisieren'}
                    >
                      {nodeBusy ? 'Arbeitet …' : 'Update'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {notice && <div style={{ ...s.hint, marginTop: 12, color: 'var(--success)' }} role="status">{notice}</div>}
      {actionError && <div style={{ marginTop: 12 }}><ErrorCard message={actionError} /></div>}
    </>
  );
}
