import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Server, Plus, ShieldAlert, PlayCircle, CheckCircle2, Lightbulb } from 'lucide-react';
import { Card, CardHeader, CardBody, Button, Badge, Field, Input, Spinner, ErrorCard, EmptyState, HelpTip, ExampleHint } from '../components/ui';
import {
  deployApi,
  type DeployModule, type DeployConnector, type DeploySpec, type DeployRun, type DeployRunStep,
  type Preconditions, type CreateConnectorBody, type CreateSpecBody,
  type CreateProxmoxConnectorBody, type CreateSshConnectorBody,
} from '../features/deploy/deployApi';
import { runStatusTone, runStatusLabel, isTerminal, summarizeParams, preconditionsSummary, stepLabel, stepStatusTone, buildAgentInstallSpecBody, buildWindowsServerSpecBody } from '../features/deploy/deployView';
import { deriveParamFields, initialParamValues, validateParamValues } from '../features/deploy/paramFormModel';
import { deriveModuleTiles, type ModuleTile } from '../features/deploy/deployModuleTiles';
import { ModuleTileCatalog } from '../features/deploy/ModuleTileCatalog';
import { ManagedNodesPanel } from '../features/deploy/ManagedNodesPanel';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/apiClient';
import { Trans, useTranslation } from 'react-i18next';
import i18n from '../i18n';

const s: Record<string, CSSProperties> = {
  page:      { padding: '16px 20px' },
  head:      { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' },
  grid2:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 },
  warn:      { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', background: 'color-mix(in srgb, var(--warning) 8%, transparent)', marginBottom: 16 },
  row:       { display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-soft)' },
  hint:      { fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 },
  mono:      { fontFamily: 'var(--font-mono)', fontSize: 12 },
  actions:   { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 },
  labelRow:  { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  bulb:      { display: 'inline-flex', alignItems: 'center', color: 'var(--warning)' },
};

const EMPTY_PROXMOX: CreateProxmoxConnectorBody = { type: 'proxmox', name: '', host: '', apiToken: '', targetNode: '', storage: 'local-lvm', bridge: 'vmbr1', verifyTls: true };
const EMPTY_SSH: CreateSshConnectorBody = { type: 'ssh', name: '', host: '', sshUser: 'root', sshPort: 22, privateKey: '', passphrase: '', hostKeyPin: '' };
const emptyConnector = (type: 'proxmox' | 'ssh'): CreateConnectorBody => (type === 'ssh' ? { ...EMPTY_SSH } : { ...EMPTY_PROXMOX });

// Erklärungen zu den schema-getriebenen Feldern. Fehlt ein Eintrag, fällt das
// Formular auf einen generischen Text zurück — ein neues Modul ist also nie
// unbedienbar, nur weniger ausführlich erklärt.
const paramHints = (): Record<string, string> => ({
  wazuhManager:     i18n.t('deploy.addressWazuhManagerAgentReports'),
  agentName:        i18n.t('text.displayNameAgentLeaveEmpty'),
  os:               i18n.t('deploy.selectsPackageManagerTargetHost'),
  collectorVersion: i18n.t('text.versionCollectorArtefactEG'),
  checksumSha256:   i18n.t('deploy.sha256Artefact64Hex'),
  intakeUrl:        i18n.t('deploy.whereCollectorSendsItsEvents'),
  artifactBaseUrl:  i18n.t('deploy.whereArtefactFetchedFromEmpty'),
});


// windows-server (vm-clone) Deploy-Formular. Zahlen als Strings (Formular), beim
// Absenden geparst. Secrets kommen NIE ins Formular (Admin-PW/Key server-seitig).
type WinForm = { hostname: string; ipMode: 'static' | 'dhcp'; staticIp: string; cidr: string; gateway: string; dns: string; templateVmid: string; wazuhManager: string };
const EMPTY_WIN: WinForm = { hostname: '', ipMode: 'static', staticIp: '', cidr: '24', gateway: '', dns: '', templateVmid: '', wazuhManager: '' };

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message}${e.code ? ` (${e.code})` : ''}`;
  return e instanceof Error ? e.message : i18n.t('common.unknownError');
}

function fieldLabel(text: string, hint: ReactNode): ReactNode {
  return (
    <span style={s.labelRow}>
      <span>{text}</span>
      <HelpTip topic="deploy" hint={hint}>
        <span style={s.bulb} aria-label={i18n.t('common.explainX', { text })}>
          <Lightbulb size={13} aria-hidden />
        </span>
      </HelpTip>
    </span>
  );
}

export function DeployPage() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const isAdmin = can.admin(user?.role);

  const [modules, setModules] = useState<DeployModule[]>([]);
  const [connectors, setConnectors] = useState<DeployConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [connForm, setConnForm] = useState<CreateConnectorBody>(emptyConnector('proxmox'));
  const [spec, setSpec] = useState<DeploySpec | null>(null);
  const [run, setRun] = useState<DeployRun | null>(null);
  const [steps, setSteps] = useState<DeployRunStep[]>([]);
  const [preconditions, setPreconditions] = useState<Preconditions | null>(null);
  const [agentForm, setAgentForm] = useState<{ moduleId: string; connectorId: string; values: Record<string, string> } | null>(null);
  const [reauthPw, setReauthPw] = useState('');
  const [connReauthPw, setConnReauthPw] = useState(''); // Step-up fürs Connector-Anlegen (Secret at-rest)
  const [winForm, setWinForm] = useState<WinForm | null>(null); // windows-server vm-clone-Formular
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  // Ton des notice-Kanals: 'success' (grün) für echten Erfolg, 'warning' (gelb) für
  // Teilerfolg (Aktion ok, aber ein Folgeschritt wie das Neuladen schlug fehl).
  const [noticeTone, setNoticeTone] = useState<'success' | 'warning'>('success');

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    const ctrl = new AbortController();
    Promise.all([
      deployApi.listModules({ signal: ctrl.signal }),
      deployApi.listConnectors({ signal: ctrl.signal }),
    ])
      .then(([m, c]) => { setModules(m.data); setConnectors(c.data); })
      .catch((e) => { if (!(e instanceof Error && e.name === 'AbortError')) setLoadError(errMsg(e)); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [isAdmin]);

  async function refreshConnectors() {
    const c = await deployApi.listConnectors();
    setConnectors(c.data);
  }

  // Union-sicheres Feld-Update: nur Felder des aktuellen Connector-Typs werden
  // gerendert/gepatcht, daher ist der Cast auf die Union hier sicher.
  function patchConn(patch: Partial<CreateProxmoxConnectorBody> & Partial<CreateSshConnectorBody>) {
    setConnForm((prev) => ({ ...prev, ...patch }) as CreateConnectorBody);
  }

  async function handleCreateConnector(e: FormEvent) {
    e.preventDefault();
    setActionError(''); setBusy('connector');
    try {
      // Step-up wie bei Apply: frische Passwort-Bestätigung → deploy_reauth-Token,
      // damit ein Connector (Secret at-rest) nur mit erneuter Auth angelegt wird.
      const { data } = await deployApi.reauth(connReauthPw);
      await deployApi.createConnector(connForm, data.reauthToken);
      setConnForm(emptyConnector(connForm.type === 'ssh' ? 'ssh' : 'proxmox'));
      setConnReauthPw('');
      setNotice('Connector angelegt.'); setNoticeTone('success');
    } catch (err) { setActionError(errMsg(err)); setBusy(''); return; }
    setBusy('');
    // Refresh separat: ein Fehler hier darf das erfolgreiche Anlegen nicht als
    // Fehlschlag darstellen — aber als Teilerfolg (Warn-Ton), nicht als glatter Erfolg.
    try {
      await refreshConnectors();
    } catch {
      setNotice(tr('deploy.connectorCreatedListCouldNot'));
      setNoticeTone('warning');
    }
  }

  // Abgeleitete Kachel-Sicht: Verfügbarkeit kommt aus den ECHTEN Backend-Modulen
  // (nur OPNsense ist heute implementiert); geplante Produkte sind „Geplant".
  const tileGroups = deriveModuleTiles(modules);

  // Klick auf eine verfügbare Kachel startet den bestehenden Deploy-Fluss.
  // Geplante Kacheln sind in der UI nicht klickbar; diese Guard ist Defense-in-Depth.
  function handleSelectModule(tile: ModuleTile) {
    if (!tile.available || !tile.moduleId) return;
    const module = modules.find((m) => m.id === tile.moduleId);
    if (module?.kind === 'agent-install') {
      // Brownfield: erst Ziel-Connector + Wazuh-Manager erfassen (kein Demo, echte Werte).
      const firstSsh = connectors.find((c) => c.type === 'ssh');
      setActionError(''); setNotice('');
      // Felder kommen aus dem paramSchema des Moduls — kein hartkodiertes Wazuh-Formular mehr,
      // damit neue Module (Kollektoren, Sensoren) ohne UI-Aenderung funktionieren.
      setAgentForm({ moduleId: module.id, connectorId: firstSsh?.id ?? '', values: initialParamValues(deriveParamFields(module.paramSchema)) });
      return;
    }
    if (module?.id === 'windows-server') {
      // Greenfield vm-clone: echtes Formular (Netzwerk + Template + optional Wazuh-Enroll).
      setActionError(''); setNotice('');
      setWinForm({ ...EMPTY_WIN });
      return;
    }
    void handlePlanDemo(tile.moduleId);
  }

  // windows-server (vm-clone): Spec aus dem Formular bauen + planen.
  async function handlePlanWindowsServer(e: FormEvent) {
    e.preventDefault();
    if (!winForm) return;
    setActionError(''); setBusy('plan'); setNotice('');
    try {
      const module = modules.find((m) => m.id === 'windows-server');
      if (!module) throw new Error(tr('deploy.moduleWindowsServerMissing'));
      const connector = connectors.find((c) => c.type === 'proxmox');
      if (!connector) throw new Error(tr('deploy.proxmoxConnectorRequired'));
      const body = buildWindowsServerSpecBody(module.id, connector, module.resourceDefaults, {
        hostname: winForm.hostname,
        ipMode: winForm.ipMode,
        staticIp: winForm.staticIp || undefined,
        cidr: winForm.cidr ? Number(winForm.cidr) : undefined,
        gateway: winForm.gateway || undefined,
        dns: winForm.dns ? [winForm.dns] : undefined,
        templateVmid: winForm.templateVmid ? Number(winForm.templateVmid) : undefined,
        wazuhManager: winForm.wazuhManager || undefined,
      });
      const created = (await deployApi.createSpec(body)).data;
      setSpec(created);
      const planned = (await deployApi.plan(created.id)).data;
      setRun(planned.run); setPreconditions(planned.preconditions);
      setWinForm(null);
    } catch (err) { setActionError(errMsg(err)); } finally { setBusy(''); }
  }

  // agent-install (Linux-/Windows-Client): Spec aus dem Formular bauen + planen.
  async function handlePlanAgentInstall(e: FormEvent) {
    e.preventDefault();
    if (!agentForm) return;
    setActionError(''); setBusy('plan'); setNotice('');
    try {
      const connector = connectors.find((c) => c.id === agentForm.connectorId);
      if (!connector) throw new Error(tr('deploy.pleaseChooseSshConnector'));
      // targetHost = Connector-Host (der gepinnte Host-Key gilt genau für diesen Host).
      // Felder aus dem Modul-Schema — vor dem Absenden gegen dieselben Regeln pruefen
      // wie das Backend (frueheres Feedback; das Backend validiert unabhaengig weiter).
      const fields = deriveParamFields(modules.find((m) => m.id === agentForm.moduleId)?.paramSchema);
      const errs = validateParamValues(fields, agentForm.values);
      if (Object.keys(errs).length > 0) {
        const first = fields.find((f) => errs[f.name]);
        throw new Error(i18n.t('deploy.pleaseCheck', {
          field: first ? first.label : i18n.t('deploy.inputs'),
          problem: first ? errs[first.name] : i18n.t('deploy.invalid'),
        }));
      }
      // Leere optionale Felder NICHT mitschicken (das Backend setzt dann seine Defaults).
      const params: Record<string, string> = {};
      for (const f of fields) {
        const v = (agentForm.values[f.name] ?? '').trim();
        if (v !== '') params[f.name] = v;
      }
      const body = buildAgentInstallSpecBody(agentForm.moduleId, connector.id, {
        // targetHost/sshUser/sshPort kommen aus dem Connector — der gepinnte Host-Key
        // gilt genau fuer diesen Host; doppelte Eingabe koennte auseinanderlaufen.
        targetHost: connector.host,
        sshUser: connector.sshUser,
        sshPort: connector.sshPort,
        ...params,
      });
      const created = (await deployApi.createSpec(body)).data;
      setSpec(created);
      const planned = (await deployApi.plan(created.id)).data;
      setRun(planned.run); setPreconditions(planned.preconditions);
      setAgentForm(null);
    } catch (err) { setActionError(errMsg(err)); } finally { setBusy(''); }
  }

  // Demo-Fluss (vm-clone / OPNsense — feste Lab-Werte; ein volles Formular folgt).
  async function handlePlanDemo(moduleId: string) {
    setActionError(''); setBusy('plan'); setNotice('');
    try {
      const module = modules.find((m) => m.id === moduleId);
      if (!module) throw new Error(tr('deploy.moduleMissing'));
      const connector = connectors.find((c) => c.type === 'proxmox') ?? connectors[0];
      if (!connector) throw new Error(tr('deploy.proxmoxConnectorRequired'));
      const body: CreateSpecBody = {
        moduleId: module.id, connectorId: connector.id, targetNode: connector.targetNode,
        storage: connector.storage || 'local-lvm', bridge: connector.bridge || 'vmbr1',
        resources: module.resourceDefaults,
        params: { hostname: 'fw-lab', ipMode: 'static', staticIp: '10.0.10.1', cidr: 24, gateway: '10.0.10.254', vlanTag: 10, dns: ['10.0.10.10'], templateVmid: 9000 },
      };
      const created = (await deployApi.createSpec(body)).data;
      setSpec(created);
      const planned = (await deployApi.plan(created.id)).data;
      setRun(planned.run); setPreconditions(planned.preconditions);
    } catch (err) { setActionError(errMsg(err)); } finally { setBusy(''); }
  }

  async function handleApprove() {
    if (!run) return;
    setActionError(''); setBusy('approve');
    try {
      const approved = (await deployApi.approve(run.id, 'Genehmigt via UI')).data;
      setRun(approved);
    } catch (err) { setActionError(errMsg(err)); } finally { setBusy(''); }
  }

  async function handleApply() {
    if (!run) return;
    setActionError(''); setBusy('apply');
    try {
      const { data } = await deployApi.reauth(reauthPw);
      const applied = (await deployApi.apply(run.id, data.reauthToken)).data;
      setRun(applied);
      setReauthPw('');
      // Schritt-Timeline separat nachladen (append-only Steps) — Fehler hier ist unkritisch.
      try { const detail = (await deployApi.getRun(applied.id)).data; setSteps(detail.steps); } catch { /* Steps optional */ }
    } catch (err) { setActionError(errMsg(err)); } finally { setBusy(''); }
  }

  if (!isAdmin) {
    return (
      <div style={s.page}>
        <EmptyState title={tr('text.noAccess')} message={tr('deploy.deploymentCenterReservedAdministrators')} icon={<ShieldAlert size={24} />} />
      </div>
    );
  }
  if (loading) return <div style={s.page}><Spinner label="Lade Deployment Center …" /></div>;
  if (loadError) return <div style={s.page}><ErrorCard message={loadError} /></div>;

  // Vier-Augen-Spiegel: stabile User-ID bevorzugt (konsistent zum Backend), Label als Fallback.
  const isCreator = run && user
    ? (run.startedById && user.id ? run.startedById === user.id : run.startedBy === user.email)
    : false;
  const canApprove = Boolean(run && run.status === 'planned' && user && !isCreator);
  const canApply = Boolean(run && run.status === 'approved');

  return (
    <div style={s.page}>
      <div style={s.head}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: 0, fontSize: 20, display: 'flex', alignItems: 'center', gap: 8 }}><Server size={20} /> Deployment Center <HelpTip topic="deploy" /></h1>
          <p style={s.hint}>{tr('deploy.networkAsCodeIntro')}</p>
        </div>
      </div>

      <div style={s.warn}>
        <ShieldAlert size={18} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
        <div style={s.hint}>
          <Trans i18nKey="deploy.infraWritingChannel" components={{ b: <strong />, c: <code /> }} />
        </div>
      </div>

      {notice && <div style={{ ...s.hint, marginBottom: 12, color: noticeTone === 'warning' ? 'var(--warning)' : 'var(--success)' }}>{notice}</div>}
      {actionError && <div style={{ marginBottom: 12 }}><ErrorCard message={actionError} /></div>}

      <div style={s.grid2}>
        {/* Connectors */}
        <Card>
          <CardHeader title="Connectoren (Proxmox / SSH)" actions={<Badge tone="accent">{connectors.length}</Badge>} />
          <CardBody>
            {connectors.length === 0
              ? <EmptyState title={tr('deploy.noConnector')} message={tr('deploy.createConnectorFirst')} />
              : connectors.map((c) => (
                <div key={c.id} style={s.row}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                    <div style={{ ...s.hint, ...s.mono }}>
                      {c.type === 'ssh'
                        ? `${c.host} · SSH ${c.sshUser ?? 'root'}${c.sshPort && c.sshPort !== 22 ? `:${c.sshPort}` : ''}`
                        : `${c.host} · ${c.targetNode ?? ''} · ${c.prefix ?? ''}`}
                    </div>
                  </div>
                  <Badge tone={c.type === 'ssh' ? 'accent' : (c.verifyTls ? 'success' : 'warning')}>
                    {c.type === 'ssh' ? 'SSH' : (c.verifyTls ? 'TLS' : tr('settings.tlsOff'))}
                  </Badge>
                </div>
              ))}

            <form onSubmit={handleCreateConnector} style={{ marginTop: 14 }}>
                <Field label={fieldLabel('Connector-Typ', (
                  <ExampleHint
                    title={tr('deploy.chooseKindTargetSystemFirst')}
                    text={tr('deploy.decideWhetherNexoraShouldClone')}
                    exampleLabel="Typischer Einstieg"
                    rows={[
                      { label: 'Proxmox', value: tr('deploy.cloneVmFromTemplate') },
                      { label: 'SSH', value: 'bestehenden Linux-Host anbinden' },
                    ]}
                    footer={tr('deploy.ifYouWantRollOut')}
                  />
                ))}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button type="button" variant={connForm.type === 'proxmox' ? 'primary' : 'ghost'} onClick={() => setConnForm(emptyConnector('proxmox'))}>Proxmox</Button>
                  <Button type="button" variant={connForm.type === 'ssh' ? 'primary' : 'ghost'} onClick={() => setConnForm(emptyConnector('ssh'))}>SSH (Linux-Client)</Button>
                </div>
              </Field>
              <div style={s.grid2}>
                <Field label={fieldLabel('Name', (
                  <ExampleHint
                    title={tr('deploy.whatConnectorShouldCalled')}
                    text={tr('deploy.internalDisplayNameConnectorPick')}
                    exampleLabel="Beispiel"
                    rows={[
                      { label: 'Name', value: 'Proxmox-Lab-Nord' },
                    ]}
                    footer={tr('deploy.goodNameOneSomeoneElse')}
                  />
                ))}><Input value={connForm.name} onChange={(e) => patchConn({ name: e.target.value })} required /></Field>
                <Field label={fieldLabel('Host (IP/DNS)', (
                  <ExampleHint
                    title={tr('text.addressTargetSystem')}
                    text={tr('deploy.addressTargetSystemProxmoxHost')}
                    exampleLabel="Beispiel"
                    rows={[
                      { label: 'Proxmox', value: '10.0.10.20' },
                      { label: 'SSH-Host', value: 'srv-wazuh-01.nexora.local' },
                    ]}
                    footer={tr('deploy.alwaysUseAddressActuallyReachable')}
                  />
                ))}><Input value={connForm.host} onChange={(e) => patchConn({ host: e.target.value })} required /></Field>
                {connForm.type === 'proxmox' && (
                  <>
                    <Field label={fieldLabel(tr('deploy.targetNode'), (
                      <ExampleHint
                        title="Echter Proxmox-Node-Name"
                        text={tr('deploy.specificProxmoxNodeCloneStart')}
                        exampleLabel={tr('deploy.exampleFromProxmox')}
                        rows={[
                          { label: 'Node', value: 'pve' },
                          { label: 'Alternative', value: 'proxmox-02' },
                        ]}
                        footer={tr('deploy.valueMustMatchProxmoxCluster')}
                      />
                    ))}><Input value={connForm.targetNode} onChange={(e) => patchConn({ targetNode: e.target.value })} required /></Field>
                    <Field label={fieldLabel('API-Token', tr('deploy.proxmoxApiTokenConnectionNever'))}><Input mono type="password" value={connForm.apiToken} onChange={(e) => patchConn({ apiToken: e.target.value })} required /></Field>
                  </>
                )}
                {connForm.type === 'ssh' && (
                  <>
                    <Field label={fieldLabel('SSH-User', tr('deploy.userNexoraSignsTargetHost'))}><Input value={connForm.sshUser ?? ''} onChange={(e) => patchConn({ sshUser: e.target.value })} /></Field>
                    <Field label={fieldLabel('SSH-Port', tr('deploy.sshPortTargetHostUsually'))}><Input value={String(connForm.sshPort ?? 22)} onChange={(e) => patchConn({ sshPort: Number(e.target.value) || 22 })} /></Field>
                    <Field label={fieldLabel('Host-Key-Pin (SHA-256)', tr('deploy.pinnedSshFingerprintTargetHost'))}><Input mono value={connForm.hostKeyPin} onChange={(e) => patchConn({ hostKeyPin: e.target.value })} required /></Field>
                    <Field label={fieldLabel('Passphrase (optional)', tr('deploy.fillOnlyIfPrivateSsh'))}><Input type="password" value={connForm.passphrase ?? ''} onChange={(e) => patchConn({ passphrase: e.target.value })} /></Field>
                  </>
                )}
              </div>
              {connForm.type === 'ssh' && (
                <Field label={fieldLabel(tr('deploy.privateKeyWriteOnlyStored'), tr('deploy.privateSshKeyNexoraSigns'))}>
                  <textarea
                    value={connForm.privateKey}
                    onChange={(e) => patchConn({ privateKey: e.target.value })}
                    required rows={4}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 10px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', background: 'transparent', color: 'inherit', resize: 'vertical' }}
                  />
                </Field>
              )}
              <Field label={fieldLabel(tr('deploy.passwordConfirmationReAuthenticationCreate'), tr('deploy.securityStepConfirmReallyYou'))}>
                <Input type="password" value={connReauthPw} onChange={(e) => setConnReauthPw(e.target.value)} placeholder={tr('settings.currentPassword')} required />
              </Field>
              <div style={s.actions}>
                <Button type="submit" variant="primary" icon={<Plus size={15} />} disabled={busy === 'connector' || !connReauthPw}>
                  {busy === 'connector' ? 'Speichert …' : tr('deploy.createConnector')}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>

        {/* Deploy-Fluss */}
        <Card>
          <CardHeader
            title="Deploy-Fluss (Plan → Vier-Augen → Apply)"
            actions={run ? <Badge tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Badge> : undefined}
          />
          <CardBody>
            {!run && !agentForm && !winForm && (
              <>
                <p style={s.hint}>{tr('deploy.pickModuleBelow')}<strong>Endpoints (Linux-/Windows-Client)</strong>{tr('deploy.opensFormConnector')}<strong>Windows Server (VM)</strong>{tr('deploy.opensDeployForm')}<strong>OPNsense</strong>{tr('deploy.demoFlowNote')}</p>
                <div style={s.actions}>
                  <Button variant="primary" icon={<PlayCircle size={15} />} onClick={() => handlePlanDemo('opnsense')} disabled={busy === 'plan' || connectors.length === 0}>
                    {busy === 'plan' ? 'Plant …' : 'OPNsense-Demo planen (Dry-Run)'}
                  </Button>
                </div>
                {connectors.length === 0 && <p style={s.hint}>{tr('deploy.connectorFirst')}</p>}
              </>
            )}

            {!run && winForm && (
              <form onSubmit={handlePlanWindowsServer}>
                <p style={s.hint}>{tr('deploy.windowsServerIntro')}</p>
                <div style={s.grid2}>
                  <Field label={fieldLabel('Hostname', (
                    <ExampleHint
                      title={tr('deploy.computerNameNewVm')}
                      text={tr('deploy.computerNameNewWindowsVm')}
                      exampleLabel="Typischer Servername"
                      rows={[
                        { label: 'Hostname', value: 'WIN-DC-LAB-02' },
                      ]}
                      footer={tr('deploy.avoidInventedNamesSiteRole')}
                    />
                  ))}><Input value={winForm.hostname} onChange={(e) => setWinForm({ ...winForm, hostname: e.target.value })} required /></Field>
                  <Field label={fieldLabel('Template-VMID (Golden-Template)', (
                    <ExampleHint
                      title={tr('deploy.whichTemplateClonedFrom')}
                      text={tr('deploy.vmidPreparedWindowsBaseTemplate')}
                      exampleLabel="Beispiel"
                      rows={[
                        { label: 'Template-VMID', value: '9000' },
                        { label: tr('common.description'), value: 'Win2025-Golden-Base' },
                      ]}
                      footer={tr('deploy.numberMustBelongPreparedGolden')}
                    />
                  ))}><Input value={winForm.templateVmid} onChange={(e) => setWinForm({ ...winForm, templateVmid: e.target.value })} required /></Field>
                </div>
                <Field label={fieldLabel('IP-Modus', tr('deploy.decideWhetherVmObtainsIts'))}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button type="button" variant={winForm.ipMode === 'static' ? 'primary' : 'ghost'} onClick={() => setWinForm({ ...winForm, ipMode: 'static' })}>{tr('common.static')}</Button>
                    <Button type="button" variant={winForm.ipMode === 'dhcp' ? 'primary' : 'ghost'} onClick={() => setWinForm({ ...winForm, ipMode: 'dhcp' })}>DHCP</Button>
                  </div>
                </Field>
                {winForm.ipMode === 'static' && (
                  <div style={s.grid2}>
                    <Field label={fieldLabel('Statische IP', (
                      <ExampleHint
                        title={tr('deploy.fixedAddressNewVm')}
                        text={tr('deploy.fixedIpAddressNewVm')}
                        exampleLabel={tr('deploy.exampleNetwork')}
                        rows={[
                          { label: 'IP', value: '10.0.10.25' },
                          { label: 'CIDR', value: '24' },
                        ]}
                        footer={tr('deploy.ipMustFreeCorrectVlan')}
                      />
                    ))}><Input value={winForm.staticIp} onChange={(e) => setWinForm({ ...winForm, staticIp: e.target.value })} required /></Field>
                    <Field label={fieldLabel('CIDR (0–32)', (
                      <ExampleHint
                        title={tr('deploy.networkSizeAddress')}
                        text={tr('deploy.networkPrefixAddressExample24')}
                        exampleLabel="Beispiel"
                        rows={[
                          { label: 'CIDR', value: '24' },
                          { label: tr('common.meaning'), value: '255.255.255.0' },
                        ]}
                        footer={tr('deploy.ifYouGetWrongHost')}
                      />
                    ))}><Input value={winForm.cidr} onChange={(e) => setWinForm({ ...winForm, cidr: e.target.value })} required /></Field>
                    <Field label={fieldLabel('Gateway', (
                      <ExampleHint
                        title={tr('deploy.whereServerSendsItsDefault')}
                        text={tr('deploy.defaultGatewayThroughWhichVm')}
                        exampleLabel="Beispiel"
                        rows={[
                          { label: 'Gateway', value: '10.0.10.1' },
                        ]}
                        footer={tr('deploy.manyEnvironmentsFirewallAddressVlan')}
                      />
                    ))}><Input value={winForm.gateway} onChange={(e) => setWinForm({ ...winForm, gateway: e.target.value })} required /></Field>
                    <Field label={fieldLabel('DNS-Server', (
                      <ExampleHint
                        title={tr('deploy.nameResolutionNewVm')}
                        text={tr('deploy.dnsServerNewWindowsServer')}
                        exampleLabel="Beispiel"
                        rows={[
                          { label: 'DNS', value: '10.0.10.10' },
                        ]}
                        footer={tr('deploy.useInternalDnsIfMachine')}
                      />
                    ))}><Input value={winForm.dns} onChange={(e) => setWinForm({ ...winForm, dns: e.target.value })} required /></Field>
                  </div>
                )}
                <Field label={fieldLabel('Wazuh-Manager (optional — First-Boot-Enroll)', tr('deploy.optionalWazuhManagerFirstAutomatic'))}><Input value={winForm.wazuhManager} onChange={(e) => setWinForm({ ...winForm, wazuhManager: e.target.value })} /></Field>
                <div style={s.actions}>
                  <Button type="submit" variant="primary" icon={<PlayCircle size={15} />} disabled={busy === 'plan' || connectors.filter((c) => c.type === 'proxmox').length === 0}>
                    {busy === 'plan' ? 'Plant …' : tr('deploy.createPlanDryRun')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setWinForm(null)}>{tr('common.cancel2')}</Button>
                </div>
                {connectors.filter((c) => c.type === 'proxmox').length === 0 && <p style={s.hint}>{tr('text.createProxmoxConnectorFirst')}</p>}
              </form>
            )}

            {!run && agentForm && (
              <form onSubmit={handlePlanAgentInstall}>
                <p style={s.hint}>{tr('deploy.wazuhAgentOntoExistingHost')}</p>
                <Field label={fieldLabel(tr('deploy.sshConnectorTarget'), tr('deploy.pickSshConnector'))}>
                  <select
                    value={agentForm.connectorId}
                    onChange={(e) => setAgentForm({ ...agentForm, connectorId: e.target.value })}
                    required
                    style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '8px 10px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', background: 'transparent', color: 'inherit' }}
                  >
                    <option value="">{tr('common.pleaseSelect')}</option>
                    {connectors.filter((c) => c.type === 'ssh').map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.host})</option>
                    ))}
                  </select>
                </Field>
                {/* Felder kommen aus dem paramSchema des Moduls (EINE Quelle der Wahrheit).
                    Neue Module — Kollektoren, Sensoren — erscheinen damit ohne UI-Aenderung.
                    Ziel-Host/SSH-Benutzer/-Port fehlen bewusst: sie kommen aus dem Connector. */}
                <div style={s.grid2}>
                  {deriveParamFields(modules.find((m) => m.id === agentForm.moduleId)?.paramSchema).map((f) => (
                    <Field key={f.name} label={fieldLabel(
                      f.required ? f.label : `${f.label} (optional)`,
                      paramHints()[f.name] ?? tr('deploy.valueFor', { label: f.label }),
                    )}>
                      {f.kind === 'select' ? (
                        <select
                          value={agentForm.values[f.name] ?? ''}
                          onChange={(e) => setAgentForm({ ...agentForm, values: { ...agentForm.values, [f.name]: e.target.value } })}
                          style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '8px 10px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', background: 'transparent', color: 'inherit' }}
                        >
                          {(f.options ?? []).map((o) => (<option key={o} value={o}>{o}</option>))}
                        </select>
                      ) : (
                        <Input
                          value={agentForm.values[f.name] ?? ''}
                          onChange={(e) => setAgentForm({ ...agentForm, values: { ...agentForm.values, [f.name]: e.target.value } })}
                          required={f.required}
                        />
                      )}
                    </Field>
                  ))}
                </div>
                <div style={s.actions}>
                  <Button type="submit" variant="primary" icon={<PlayCircle size={15} />} disabled={busy === 'plan' || !agentForm.connectorId}>
                    {busy === 'plan' ? 'Plant …' : tr('deploy.createPlanDryRun')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setAgentForm(null)}>{tr('common.cancel2')}</Button>
                </div>
                {connectors.filter((c) => c.type === 'ssh').length === 0 && <p style={s.hint}>{tr('text.createSshConnectorFirst')}</p>}
              </form>
            )}

            {run && (
              <>
                {spec && <div style={{ ...s.hint, marginBottom: 8 }}><strong>Spec:</strong> {summarizeParams(spec.params)}</div>}
                <div style={{ ...s.hint, marginBottom: 8 }}><strong>{tr('deploy.preconditions')}</strong> {preconditionsSummary(preconditions)}</div>
                <div style={{ ...s.hint, ...s.mono, marginBottom: 8 }}>Run {run.id.slice(0, 8)} · von {run.startedBy}{run.approvedBy ? ` · genehmigt: ${run.approvedBy}` : ''}{run.vmid ? ` · VMID ${run.vmid}` : ''}</div>
                {run.failureReason && <ErrorCard message={run.failureReason} />}

                {steps.length > 0 && (
                  <div style={{ margin: '10px 0' }}>
                    <div style={{ ...s.hint, marginBottom: 4 }}><strong>{tr('common.steps')}</strong></div>
                    {steps.map((st) => (
                      <div key={st.id} style={s.row}>
                        <span style={{ fontSize: 12 }}>{stepLabel(st.step)}</span>
                        <Badge tone={stepStatusTone(st.status)}>{st.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}

                {!isTerminal(run.status) && (
                  <div style={s.actions}>
                    <Button variant="default" onClick={handleApprove} disabled={!canApprove || busy === 'approve'} icon={<CheckCircle2 size={15} />}>
                      {busy === 'approve' ? 'Genehmigt …' : tr('deploy.approveFourEyes')}
                    </Button>
                  </div>
                )}

                {canApply && (
                  <div style={{ marginTop: 12 }}>
                    <Field label={fieldLabel(tr('deploy.passwordConfirmationReAuthenticationApply'), tr('deploy.finalSecurityStepBeforeReal'))}>
                      <Input type="password" value={reauthPw} onChange={(e) => setReauthPw(e.target.value)} placeholder={tr('settings.currentPassword')} />
                    </Field>
                    <div style={s.actions}>
                      <Button variant="danger" onClick={handleApply} disabled={!reauthPw || busy === 'apply'} icon={<Server size={15} />}>
                        {busy === 'apply' ? 'Wendet an …' : 'Apply — VM deployen'}
                      </Button>
                    </div>
                    <p style={s.hint}>{tr('deploy.applyFailsLongOperatorHas')} <code>DEPLOY_ENABLED</code> {tr('deploy.notArmedIntentional')}</p>
                  </div>
                )}

                <div style={s.actions}>
                  <Button variant="ghost" onClick={() => { setRun(null); setSpec(null); setPreconditions(null); setSteps([]); }}>{tr('analysis.reset')}</Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <Card style={{ marginTop: 12 }}>
        <CardHeader title={tr('deploy.moduleCatalogue')} actions={<Badge tone="accent">{modules.length} verfügbar</Badge>} />
        <CardBody>
          <p style={{ ...s.hint, marginBottom: 16 }}>
            <Trans i18nKey="deploy.pickModuleHint" components={{ b: <strong /> }} />
          </p>
          <ModuleTileCatalog groups={tileGroups} onSelect={handleSelectModule} />
        </CardBody>
      </Card>

      {/* Verwaltete Nodes: Deploy-Keypair + gated Updates deployter Windows-Server (Slice 7). */}
      {isAdmin && (
        <div style={{ marginTop: 12 }}>
          <ManagedNodesPanel />
        </div>
      )}
    </div>
  );
}
