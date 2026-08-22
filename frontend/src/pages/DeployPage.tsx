import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Server, Plus, ShieldAlert, PlayCircle, CheckCircle2, Lightbulb, Rocket, FileText, Shield, Database, Monitor, Eye } from 'lucide-react';
import { LinuxTypeIcon, DockerTypeIcon, WindowsTypeIcon, WazuhTypeIcon, type DeployTypeIconProps } from '../features/deploy/deployTypeIcons';
import { Card, CardHeader, CardBody, Button, Badge, Field, Input, Spinner, ErrorCard, EmptyState, HelpTip, ExampleHint } from '../components/ui';
import {
  deployApi,
  type DeployModule, type DeployConnector, type DeploySpec, type DeployRun, type DeployRunStep,
  type Preconditions, type ProxmoxConnectorCapacity, type CreateConnectorBody,
  type CreateProxmoxConnectorBody, type CreateSshConnectorBody,
} from '../features/deploy/deployApi';
import { isTerminal, runStatusLabel, runStatusTone, summarizeParams, preconditionsSummary, stepLabel, stepStatusTone, buildAgentInstallSpecBody, buildLxcSpecBody, buildWindowsServerSpecBody } from '../features/deploy/deployView';
import { deriveParamFields, initialParamValues, validateParamValues } from '../features/deploy/paramFormModel';
import { deriveModuleTiles, type GroupedModuleTiles, type ModuleTile } from '../features/deploy/deployModuleTiles';
import { ManagedNodesPanel } from '../features/deploy/ManagedNodesPanel';
import { DeployTargetCards } from '../features/deploy/DeployTargetCards';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/apiClient';

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
  flow:      { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 },
  flowStep:  { padding: 14, border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-soft))' },
  stepNo:    { display: 'inline-flex', width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-text)', fontWeight: 700, fontSize: 12, marginBottom: 8 },
  wizard:    { display: 'flex', alignItems: 'center', gap: 16, maxWidth: 1280, margin: '18px auto 30px' },
  wizardStep:{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28, padding: 0, border: 'none', background: 'transparent', whiteSpace: 'nowrap' },
  wizardDot: { flex: '0 0 auto', width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 },
  sectionTitle: { margin: '0 0 4px', fontSize: 18, letterSpacing: '-0.02em' },
  setupShell: { maxWidth: 980, margin: '10px auto 0' },
  setupGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0 22px' },
  platformGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 10, marginBottom: 24 },
  platformCard: { minHeight: 76, textAlign: 'left', padding: '11px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border-soft)', background: 'var(--bg-card-soft)', color: 'var(--text)' },
  securityNote: { display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18, padding: '12px 14px', borderRadius: 'var(--radius)', border: '1px solid color-mix(in srgb, var(--success) 35%, var(--border-soft))', background: 'color-mix(in srgb, var(--success) 7%, var(--bg-card))' },
  wizardSurface: { maxWidth: 1280, margin: '0 auto 18px' },
  selectionIntro: { margin: '0 0 22px' },
  summaryStrip: { display: 'grid', gridTemplateColumns: 'minmax(190px, 1fr) minmax(0, 3fr)', gap: 10, margin: '0 0 20px' },
  resourceStrip: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, padding: '12px 14px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', background: 'linear-gradient(145deg, var(--bg-card), var(--bg-card-soft))' },
  configGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 18, alignItems: 'start' },
  reviewGrid: { display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(360px, 1.25fr)', gap: 16 },
  reviewPanel: { padding: '16px 18px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', background: 'linear-gradient(145deg, var(--bg-card), var(--bg-card-soft))' },
  reviewRow: { display: 'grid', gridTemplateColumns: '22px minmax(130px, 1fr) auto', gap: 8, alignItems: 'center', padding: '8px 0', fontSize: 12, borderBottom: '1px solid var(--border-soft)' },
  footerActions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 28 },
  deployTypeGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 28 },
  deployTypeCard: { position: 'relative', minHeight: 330, padding: '40px 22px 28px', textAlign: 'center', border: '1px solid var(--border-soft)', borderRadius: 'calc(var(--radius) + 7px)', background: 'linear-gradient(145deg, var(--bg-card), var(--bg-card-soft))', color: 'var(--text)', fontFamily: 'inherit' },
};

const EMPTY_PROXMOX: CreateProxmoxConnectorBody = { type: 'proxmox', name: '', host: '', apiToken: '', targetNode: '', storage: 'local-lvm', bridge: 'vmbr1', verifyTls: true };
const EMPTY_SSH: CreateSshConnectorBody = { type: 'ssh', name: '', host: '', sshUser: 'root', sshPort: 22, privateKey: '', passphrase: '', hostKeyPin: '' };
const emptyConnector = (type: 'proxmox' | 'ssh'): CreateConnectorBody => (type === 'ssh' ? { ...EMPTY_SSH } : { ...EMPTY_PROXMOX });

// Erklärungen zu den schema-getriebenen Feldern. Fehlt ein Eintrag, fällt das
// Formular auf einen generischen Text zurück — ein neues Modul ist also nie
// unbedienbar, nur weniger ausführlich erklärt.
const PARAM_HINTS: Record<string, string> = {
  wazuhManager:     'Adresse des Wazuh-Managers, bei dem sich der Agent meldet (z. B. 10.0.10.77) — nicht der Zielhost und nicht der Proxmox-Server.',
  agentName:        'Anzeigename des Agents. Leer lassen = Standardname des Zielsystems.',
  os:               'Wählt den Paketmanager auf dem Zielhost (apt / dnf / zypper).',
  collectorVersion: 'Version des Collector-Artefakts, z. B. v1.2.0.',
  checksumSha256:   'SHA256 des Artefakts (64 Hex-Zeichen). Pflicht: der Installer bricht bei Abweichung ab und installiert nichts.',
  intakeUrl:        'Wohin der Collector seine Events sendet, z. B. https://10.0.10.75/api/v1/dataplane/events',
  artifactBaseUrl:  'Woher das Artefakt geladen wird. Leer = Standardquelle; eigener Webserver oder Spiegel ist gleichwertig (die Prüfsumme sichert die Integrität).',
};


// Gemeinsames VM-Deploy-Formular. Zahlen bleiben bis zum Absenden Strings.
// Zugangsdaten gehoeren nie in einen Deploy-Spec: sie liegen nur write-only im Connector.
type VmForm = { moduleId: string; connectorId: string; hostname: string; ipMode: 'static' | 'dhcp'; staticIp: string; cidr: string; gateway: string; dns: string; templateVmid: string; lxcTemplate: string; wazuhManager: string };
const emptyVmForm = (moduleId: string, connectorId = ''): VmForm => ({ moduleId, connectorId, hostname: '', ipMode: 'static', staticIp: '', cidr: '24', gateway: '', dns: '', templateVmid: '', lxcTemplate: '', wazuhManager: '' });
type WizardStep = 1 | 2 | 3 | 4;
type DeployView = 'overview' | 'connector' | 'wizard';

function DeployTypeGrid({ groups, selectedKey, onSelect }: { groups: GroupedModuleTiles[]; selectedKey: string; onSelect: (tile: ModuleTile) => void }) {
  const all = groups.flatMap((group) => group.tiles);
  const items: Array<[string, string, string, React.ComponentType<DeployTypeIconProps>]> = [
    ['opnsense', 'Firewall', 'OPNsense, pfSense, FortiGate, …', Shield],
    ['rocky-linux-container', 'Linux-Server / Container', 'Rocky Linux, Ubuntu, Debian, …', LinuxTypeIcon],
    ['docker-engine', 'Docker / Portainer', 'Docker Engine, Portainer, …', DockerTypeIcon],
    ['siem-collector', 'SIEM / Wazuh', 'Wazuh Manager, Indexer, Dashboard', WazuhTypeIcon],
    ['ids-sensor', 'IDS-Sensor', 'Suricata, Zeek, Snort, …', Eye],
    ['linux-client', 'Endpoint / Wazuh-Agent', 'Linux, Windows, macOS Agent', Monitor],
    ['windows-server', 'Windows Server', 'Windows Server 2019/2022/2025', WindowsTypeIcon],
    ['database', 'Datenbank / Dienste', 'PostgreSQL, MySQL, Redis, …', Database],
  ];
  return <div style={s.deployTypeGrid} aria-label="Bereitstellbare Ressourcen">
    {items.map(([key, title, description, Icon]) => {
      const tile = all.find((candidate) => candidate.productKey === key);
      const selected = tile?.productKey === selectedKey;
      return <button key={key} type="button" disabled={!tile?.available} onClick={() => tile && onSelect(tile)} aria-pressed={selected} style={{ ...s.deployTypeCard, cursor: tile?.available ? 'pointer' : 'default', opacity: tile?.available ? 1 : 0.6, borderColor: selected ? 'var(--accent)' : 'var(--border-soft)', boxShadow: selected ? '0 0 0 3px var(--accent-soft)' : 'var(--shadow-card)' }}>
        {selected && <CheckCircle2 size={16} color="var(--accent)" style={{ position: 'absolute', right: 12, top: 12 }} />}
        <span style={{ width: 140, height: 140, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, var(--bg-card-soft), color-mix(in srgb, var(--bg-card-soft) 60%, white))', color: 'var(--danger)', marginBottom: 24 }}><Icon size={70} strokeWidth={1.65} /></span>
        <div style={{ fontWeight: 800, fontSize: 24, lineHeight: 1.16 }}>{title}</div><div style={{ fontSize: 17, lineHeight: 1.55, color: 'var(--text-dim)', marginTop: 20 }}>{description}</div>
      </button>;
    })}
  </div>;
}

function DeploymentOverview({ connectors, capacities, runs, onStart, onAddTarget, onTrustCertificate }: { connectors: DeployConnector[]; capacities: Record<string, ProxmoxConnectorCapacity | undefined>; runs: DeployRun[]; onStart: () => void; onAddTarget: () => void; onTrustCertificate: (id: string, password: string) => Promise<void> }) {
  const online = connectors.filter((connector) => capacities[connector.id]?.node.online).length;
  const activeRuns = runs.filter((run) => !isTerminal(run.status)).length;
  const [certificateTarget, setCertificateTarget] = useState<string | null>(null);
  const [certificatePassword, setCertificatePassword] = useState('');
  const [certificateBusy, setCertificateBusy] = useState(false);
  const [certificateError, setCertificateError] = useState('');
  async function confirmCertificate() {
    if (!certificateTarget) return;
    setCertificateBusy(true); setCertificateError('');
    try { await onTrustCertificate(certificateTarget, certificatePassword); setCertificateTarget(null); setCertificatePassword(''); }
    catch (error) { setCertificateError(errMsg(error)); }
    finally { setCertificateBusy(false); }
  }
  return (
    <div style={s.page}>
      <div style={s.head}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 25, letterSpacing: '-0.03em' }}>Deployment Center</h1>
          <p style={{ ...s.hint, fontSize: 13, margin: '6px 0 0' }}>Sichere Infrastruktur-Bereitstellung für Ihre Umgebung.</p>
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={onAddTarget}>Deploy-Ziel hinzufügen</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 18 }}>
        {[
          { Icon: Server, value: String(connectors.length), label: 'Connectoren', sub: `${online} online` },
          { Icon: Rocket, value: String(activeRuns), label: 'Aktiv', sub: 'Bereitstellungen laufen' },
          { Icon: FileText, value: '–', label: 'Templates', sub: 'Über Connector abrufbar' },
          { Icon: CheckCircle2, value: '–', label: 'Erfolgsquote', sub: 'Noch keine Deployments' },
        ].map(({ Icon, value, label, sub }) => <div key={label} style={{ ...s.flowStep, minHeight: 68, display: 'flex', alignItems: 'center', gap: 13 }}>
          <span style={{ width: 42, height: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 13, color: 'var(--accent)', background: 'var(--accent-soft)' }}><Icon size={22} /></span>
          <div><div style={{ fontSize: 23, fontWeight: 800, lineHeight: 1 }}>{value}</div><div style={{ fontWeight: 700, fontSize: 12, marginTop: 4 }}>{label}</div><div style={s.hint}>{sub}</div></div>
        </div>)}
      </div>

      <Card style={{ marginBottom: 16 }}>
        <CardHeader title="Deploy-Ziele (Connectoren)" actions={<Badge tone={online > 0 ? 'success' : 'warning'}>{online} verifiziert online</Badge>} />
        <CardBody>
          {connectors.length === 0 ? <EmptyState title="Noch keine Deploy-Ziele" message="Verbinde zuerst Proxmox oder einen SSH-Host. Danach kannst du Ressourcen direkt darauf bereitstellen." /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
              {connectors.map((connector) => {
                const capacity = capacities[connector.id];
                const verified = Boolean(capacity?.node.online);
                return <div key={connector.id} style={{ ...s.flowStep, minHeight: 150, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Server size={25} color="var(--accent)" /><strong>{connector.name}</strong>{verified && <CheckCircle2 size={15} color="var(--accent)" style={{ marginLeft: 'auto' }} />}</div>
                  <div style={{ ...s.hint, color: verified ? 'var(--success)' : 'var(--warning)', marginTop: 4 }}>● {verified ? 'Online' : 'Verbindung wird geprüft'}</div>
                  <div style={{ ...s.hint, marginTop: 17, display: 'flex', justifyContent: 'space-between' }}><span>{connector.type === 'proxmox' ? 'Node' : 'Typ'}</span><strong>{connector.type === 'proxmox' ? connector.targetNode ?? '–' : 'SSH (Linux-Client)'}</strong></div>
                  <div style={s.actions}><Button variant="primary" onClick={onStart}>Deploy starten</Button>{connector.type === 'proxmox' && (certificateTarget === connector.id ? <><Input type="password" value={certificatePassword} onChange={(e) => setCertificatePassword(e.target.value)} placeholder="Nexora-Passwort" aria-label="Nexora-Passwort zur Zertifikatsfreigabe" /><Button variant="primary" disabled={!certificatePassword || certificateBusy} onClick={confirmCertificate}>{certificateBusy ? 'Prüft …' : 'Bestätigen'}</Button><Button variant="ghost" onClick={() => { setCertificateTarget(null); setCertificatePassword(''); }}>Abbrechen</Button>{certificateError && <div role="alert" style={{ color: 'var(--danger)' }}>{certificateError}</div>}</> : <Button variant="ghost" onClick={() => setCertificateTarget(connector.id)}>Zertifikat prüfen</Button>)}</div>
                </div>;
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(290px, 1fr)', gap: 16 }}>
        <Card>
          <CardHeader title="Schneller Deploy-Flow" />
          <CardBody>
            <p style={s.hint}>In vier einfachen Schritten zur neuen Infrastruktur.</p>
            <div style={{ ...s.flow, gridTemplateColumns: 'repeat(4, minmax(130px, 1fr))' }}>
              {['Was bereitstellen?', 'Wohin deployen?', 'Konfigurieren', 'Prüfen & planen'].map((title, index) => <div key={title} style={s.flowStep}><span style={s.stepNo}>{index + 1}</span><div style={{ fontWeight: 750, fontSize: 12 }}>{title}</div></div>)}
            </div>
            <div style={s.actions}><Button variant="primary" onClick={onStart}>Neuen Deploy starten</Button></div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sicher bereitstellen" />
          <CardBody><p style={s.hint}>Jeder Plan wird geprüft, durch das Vier-Augen-Prinzip freigegeben und vollständig auditiert.</p></CardBody>
        </Card>
      </div>

      <Card style={{ marginTop: 16 }}>
        <CardHeader title="Aktuelle Deployments" actions={<Badge tone="muted">Letzte {runs.length}</Badge>} />
        <CardBody>
          {runs.length === 0 ? <EmptyState title="Noch keine Deployments" message="Geplante und ausgeführte Bereitstellungen erscheinen hier automatisch." /> : runs.map((run) => <div key={run.id} style={s.row}>
            <div><strong>Run {run.id.slice(0, 8)}</strong><div style={s.hint}>Gestartet von {run.startedBy || 'Unbekannt'} · {new Date(run.startedAt).toLocaleString('de-DE')}</div></div>
            <Badge tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Badge>
          </div>)}
        </CardBody>
      </Card>
    </div>
  );
}

function ConnectorSetupPage({ form, onChange, onSelectType, onSubmit, onCancel, busy, password, onPasswordChange }: {
  form: CreateConnectorBody;
  onChange: (patch: Partial<CreateConnectorBody>) => void;
  onSelectType: (type: 'proxmox' | 'ssh') => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  busy: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
}) {
  const isProxmox = form.type === 'proxmox';
  const requiredValues = isProxmox
    ? [
      ['Name', form.name], ['Proxmox API-Token', form.apiToken], ['Adresse / IP', form.host],
      ['Ziel-Node', form.targetNode], ['Standard-Storage', form.storage ?? ''], ['Netzwerk-Bridge', form.bridge ?? ''],
    ]
    : [
      ['Name', form.name], ['Adresse / IP', form.host], ['SSH-Benutzer', form.sshUser ?? ''],
      ['Host-Key-Pin', form.hostKeyPin], ['Privater SSH-Key', form.privateKey],
    ];
  const missingFields = [...requiredValues, ['Nexora-Passwort-Bestätigung', password]].filter(([, value]) => !String(value).trim()).map(([label]) => label);
  const canSave = !busy && missingFields.length === 0;
  const platforms = [
    { group: 'Virtualisierung', items: [{ name: 'Proxmox VE', ready: true, type: 'proxmox' as const }, { name: 'VMware ESXi / vSphere', ready: false }, { name: 'Microsoft Hyper-V', ready: false }] },
    { group: 'Container', items: [{ name: 'Docker Engine', ready: false }, { name: 'Portainer', ready: false }, { name: 'Kubernetes', ready: false }] },
    { group: 'Hosts', items: [{ name: 'SSH / Bare Metal', ready: true, type: 'ssh' as const }] },
  ];
  return <div style={s.page}>
    <div style={s.setupShell}>
      <div style={s.head}>
        <div><h1 style={{ margin: 0, fontSize: 25, letterSpacing: '-0.03em' }}>Deploy-Ziel hinzufügen</h1><p style={{ ...s.hint, fontSize: 13, margin: '6px 0 0' }}>Wähle die Plattform und hinterlege die Verbindung einmalig.</p></div>
      </div>
      <Card>
      <CardHeader title={isProxmox ? 'Deploy-Ziel hinzufügen (Proxmox VE)' : 'Deploy-Ziel hinzufügen (SSH / Bare Metal)'} />
      <CardBody>
        {platforms.map(({ group, items }) => <section key={group} style={{ marginBottom: 16 }} aria-label={group}>
          <div style={{ ...s.hint, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7 }}>{group}</div>
          <div style={s.platformGrid} role="radiogroup" aria-label={`${group} auswählen`}>{items.map((platform) => {
            const selected = platform.type === form.type;
            return <button key={platform.name} type="button" role="radio" disabled={!platform.ready} aria-checked={selected} onClick={() => platform.type && onSelectType(platform.type)} style={{ ...s.platformCard, cursor: platform.ready ? 'pointer' : 'not-allowed', opacity: platform.ready ? 1 : 0.52, borderColor: selected ? 'var(--accent)' : 'var(--border-soft)', boxShadow: selected ? '0 0 0 2px var(--accent-soft)' : undefined }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{platform.name}</div><div style={{ ...s.hint, marginTop: 4, color: platform.ready ? 'var(--success)' : 'var(--text-dim)' }}>{platform.ready ? 'Verfügbar' : 'Adapter folgt'}</div>
            </button>;
          })}</div>
        </section>)}
        <form onSubmit={onSubmit}>
          <div style={s.setupGrid}>
            <Field label="Name"><Input value={form.name} onChange={(event) => onChange({ name: event.target.value })} placeholder={isProxmox ? 'z. B. Proxmox Produktion' : 'z. B. Wazuh Linux Hosts'} required /></Field>
            {isProxmox ? <>
              <Field label="Proxmox API-Token"><Input mono type="password" value={form.apiToken} onChange={(event) => onChange({ apiToken: event.target.value })} placeholder="NexoraDeploy@pam!deploy=Secret" required /><div style={{ ...s.hint, marginTop: 4 }}>Token-ID und einmalig angezeigtes Secret mit <code>=</code> verbinden.</div></Field>
              <Field label="Adresse / IP"><Input value={form.host} onChange={(event) => onChange({ host: event.target.value })} placeholder="10.0.10.20" required /></Field>
              <Field label="Standard-Storage"><Input value={form.storage} onChange={(event) => onChange({ storage: event.target.value })} placeholder="local-lvm" required /></Field>
              <Field label="Ziel-Node"><Input value={form.targetNode} onChange={(event) => onChange({ targetNode: event.target.value })} placeholder="pve" required /></Field>
              <Field label="Netzwerk-Bridge"><Input value={form.bridge} onChange={(event) => onChange({ bridge: event.target.value })} placeholder="vmbr0" required /></Field>
            </> : <>
              <Field label="Adresse / IP"><Input value={form.host} onChange={(event) => onChange({ host: event.target.value })} placeholder="server.nexora.local" required /></Field>
              <Field label="SSH-Benutzer"><Input value={form.sshUser ?? ''} onChange={(event) => onChange({ sshUser: event.target.value })} required /></Field>
              <Field label="SSH-Port"><Input value={String(form.sshPort ?? 22)} onChange={(event) => onChange({ sshPort: Number(event.target.value) || 22 })} required /></Field>
              <Field label="Host-Key-Pin (SHA-256)"><Input mono value={form.hostKeyPin} onChange={(event) => onChange({ hostKeyPin: event.target.value })} required /></Field>
              <Field label="Privater SSH-Key"><textarea value={form.privateKey} onChange={(event) => onChange({ privateKey: event.target.value })} required rows={5} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 10px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', background: 'transparent', color: 'inherit', resize: 'vertical' }} /></Field>
              <Field label="Passphrase (optional)"><Input type="password" value={form.passphrase ?? ''} onChange={(event) => onChange({ passphrase: event.target.value })} /></Field>
            </>}
          </div>
          <Field label="Passwort-Bestätigung (Nexora-Login)"><Input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="Dein aktuelles Nexora-Passwort" required /></Field>
          {missingFields.length > 0 && <p role="status" style={{ ...s.hint, color: 'var(--warning)', margin: '0 0 10px' }}>Zum Speichern fehlt: {missingFields.join(', ')}.</p>}
          <div style={s.actions}><Button type="button" variant="ghost" onClick={onCancel}>Abbrechen</Button><Button type="submit" variant="primary" icon={<Plus size={15} />} disabled={!canSave}>{busy ? 'Speichert …' : 'Speichern'}</Button></div>
        </form>
      </CardBody>
      </Card>
      <div style={s.securityNote}><CheckCircle2 size={20} color="var(--success)" /><div><strong>Geschützte Zugangsdaten</strong><div style={s.hint}>Token, Passwörter und API-Keys werden verschlüsselt gespeichert und nach dem Speichern nie wieder angezeigt.</div></div></div>
    </div>
  </div>;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message}${e.code ? ` (${e.code})` : ''}`;
  return e instanceof Error ? e.message : 'Unbekannter Fehler';
}

function fieldLabel(text: string, hint: ReactNode): ReactNode {
  return (
    <span style={s.labelRow}>
      <span>{text}</span>
      <HelpTip topic="deploy" hint={hint}>
        <span style={s.bulb} aria-label={`${text} erklären`}>
          <Lightbulb size={13} aria-hidden />
        </span>
      </HelpTip>
    </span>
  );
}

export function DeployPage() {
  const { user } = useAuth();
  const isAdmin = can.admin(user?.role);

  const [modules, setModules] = useState<DeployModule[]>([]);
  const [connectors, setConnectors] = useState<DeployConnector[]>([]);
  const [runs, setRuns] = useState<DeployRun[]>([]);
  const [connectorCapacities, setConnectorCapacities] = useState<Record<string, ProxmoxConnectorCapacity | undefined>>({});
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
  const [vmForm, setVmForm] = useState<VmForm | null>(null);
  const [selectedTile, setSelectedTile] = useState<ModuleTile | null>(null);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [view, setView] = useState<DeployView>('overview');
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
      deployApi.listRuns({ signal: ctrl.signal }),
    ])
      .then(([m, c, latestRuns]) => { setModules(m.data); setConnectors(c.data); setRuns(latestRuns.data); })
      .catch((e) => { if (!(e instanceof Error && e.name === 'AbortError')) setLoadError(errMsg(e)); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [isAdmin]);

  async function refreshConnectors() {
    const c = await deployApi.listConnectors();
    setConnectors(c.data);
  }

  // Live-Ressourcen sind reine Lese-Daten: sie machen die Zielwahl verständlich,
  // ohne ein Deploy zu starten oder den Write-Gate zu berühren. Ein einzelnes
  // nicht erreichbares Ziel blendet nur dessen Werte aus – die übrigen Karten
  // bleiben nutzbar.
  useEffect(() => {
    const proxmox = connectors.filter((connector) => connector.type === 'proxmox');
    if (proxmox.length === 0) { setConnectorCapacities({}); return; }
    const ctrl = new AbortController();
    Promise.all(proxmox.map(async (connector) => {
      try {
        const result = await deployApi.getConnectorCapacity(connector.id, { signal: ctrl.signal });
        return [connector.id, result.data] as const;
      } catch { return [connector.id, undefined] as const; }
    })).then((entries) => {
      if (!ctrl.signal.aborted) setConnectorCapacities(Object.fromEntries(entries));
    });
    return () => ctrl.abort();
  }, [connectors]);

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
      setView('overview');
    } catch {
      setNotice('Connector angelegt (Liste konnte nicht aktualisiert werden — neu laden).');
      setNoticeTone('warning');
    }
  }

  // Abgeleitete Kachel-Sicht: Verfügbarkeit kommt aus den ECHTEN Backend-Modulen
  // (nur OPNsense ist heute implementiert); geplante Produkte sind „Geplant".
  const tileGroups = deriveModuleTiles(modules);

  // Klick auf eine verfügbare Kachel startet den bestehenden Deploy-Fluss.
  // Geplante Kacheln sind in der UI nicht klickbar; diese Guard ist Defense-in-Depth.
  function startModule(tile: ModuleTile) {
    if (!tile.available || !tile.moduleId) return;
    const module = modules.find((m) => m.id === tile.moduleId);
    if (module?.kind === 'agent-install') {
      // Brownfield: erst Ziel-Connector + Wazuh-Manager erfassen (kein Demo, echte Werte).
      const firstSsh = connectors.find((c) => c.type === 'ssh');
      setActionError(''); setNotice('');
      // Felder kommen aus dem paramSchema des Moduls — kein hartkodiertes Wazuh-Formular mehr,
      // damit neue Module (Kollektoren, Sensoren) ohne UI-Aenderung funktionieren.
      setAgentForm({ moduleId: module.id, connectorId: firstSsh?.id ?? '', values: initialParamValues(deriveParamFields(module.paramSchema)) });
      setWizardStep(2);
      return;
    }
    if (!module) return;
    {
      // Greenfield vm-clone: ein gemeinsames Formular fuer Firewall und Server
      // statt versteckter Demo-Werte.
      setActionError(''); setNotice('');
      setVmForm(emptyVmForm(module.id, connectors.find((c) => c.type === 'proxmox')?.id ?? ''));
      setWizardStep(2);
      return;
    }
  }

  function handleSelectModule(tile: ModuleTile) {
    if (!tile.available || !tile.moduleId) return;
    setSelectedTile(tile);
  }

  // VM-Clone: Spec aus dem gewaehlten Modul + PVE-Connector bauen und planen.
  async function handlePlanVmClone(e: FormEvent) {
    e.preventDefault();
    if (!vmForm) return;
    setActionError(''); setBusy('plan'); setNotice('');
    try {
      const module = modules.find((m) => m.id === vmForm.moduleId);
      if (!module) throw new Error('Ausgewaehltes Modul nicht gefunden.');
      const connector = connectors.find((c) => c.id === vmForm.connectorId && c.type === 'proxmox');
      if (!connector) throw new Error('Ein Proxmox-Connector wird benötigt.');
      const input = {
        hostname: vmForm.hostname,
        ipMode: vmForm.ipMode,
        staticIp: vmForm.staticIp || undefined,
        cidr: vmForm.cidr ? Number(vmForm.cidr) : undefined,
        gateway: vmForm.gateway || undefined,
        dns: vmForm.dns ? [vmForm.dns] : undefined,
        templateVmid: vmForm.templateVmid ? Number(vmForm.templateVmid) : undefined,
        wazuhManager: vmForm.wazuhManager || undefined,
      };
      const body = module.kind === 'lxc-create'
        ? buildLxcSpecBody(module.id, connector, module.resourceDefaults, { ...input, lxcTemplate: vmForm.lxcTemplate })
        : buildWindowsServerSpecBody(module.id, connector, module.resourceDefaults, input);
      const created = (await deployApi.createSpec(body)).data;
      setSpec(created);
      const planned = (await deployApi.plan(created.id)).data;
      setRun(planned.run); setPreconditions(planned.preconditions);
      setVmForm(null);
      setWizardStep(4);
    } catch (err) { setActionError(errMsg(err)); } finally { setBusy(''); }
  }

  // agent-install (Linux-/Windows-Client): Spec aus dem Formular bauen + planen.
  async function handlePlanAgentInstall(e: FormEvent) {
    e.preventDefault();
    if (!agentForm) return;
    setActionError(''); setBusy('plan'); setNotice('');
    try {
      const connector = connectors.find((c) => c.id === agentForm.connectorId);
      if (!connector) throw new Error('Bitte einen SSH-Connector wählen.');
      // targetHost = Connector-Host (der gepinnte Host-Key gilt genau für diesen Host).
      // Felder aus dem Modul-Schema — vor dem Absenden gegen dieselben Regeln pruefen
      // wie das Backend (frueheres Feedback; das Backend validiert unabhaengig weiter).
      const fields = deriveParamFields(modules.find((m) => m.id === agentForm.moduleId)?.paramSchema);
      const errs = validateParamValues(fields, agentForm.values);
      if (Object.keys(errs).length > 0) {
        const first = fields.find((f) => errs[f.name]);
        throw new Error(`Bitte pruefen: ${first ? first.label : 'Eingaben'} — ${first ? errs[first.name] : 'ungueltig'}`);
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
      setWizardStep(4);
    } catch (err) { setActionError(errMsg(err)); } finally { setBusy(''); }
  }

  // Demo-Fluss (vm-clone / OPNsense — feste Lab-Werte; ein volles Formular folgt).
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
        <EmptyState title="Kein Zugriff" message="Das Deployment Center ist Administratoren vorbehalten." icon={<ShieldAlert size={24} />} />
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
  const selectedVmModule = vmForm ? modules.find((m) => m.id === vmForm.moduleId) : null;
  const selectedModule = modules.find((module) => module.id === (vmForm?.moduleId ?? agentForm?.moduleId));
  const hasCompatibleTarget = vmForm
    ? connectors.some((connector) => connector.type === 'proxmox')
    : agentForm
      ? connectors.some((connector) => connector.type === 'ssh')
      : false;
  const isLxc = selectedVmModule?.kind === 'lxc-create';
  const vmIpMode = selectedVmModule?.paramSchema?.ipMode as { values?: string[] } | undefined;
  const vmSupportsDhcp = vmIpMode?.values?.includes('dhcp') ?? true;

  async function trustCertificate(connectorId: string, password: string) {
    const certificate = await deployApi.inspectConnectorCertificate(connectorId);
    if (!window.confirm(`PVE-Fingerprint:\n${certificate.data.fingerprint}\n\nVergleiche ihn zuerst in der PVE-Konsole. Nur bei exakter Übereinstimmung speichern.`)) return;
    const { data } = await deployApi.reauth(password);
    await deployApi.trustConnectorCertificate(connectorId, certificate.data.fingerprint, data.reauthToken);
    await refreshConnectors();
  }
  if (view === 'overview') return <DeploymentOverview connectors={connectors} capacities={connectorCapacities} runs={runs} onStart={() => { setSelectedTile(null); setVmForm(null); setAgentForm(null); setWizardStep(1); setView('wizard'); }} onAddTarget={() => setView('connector')} onTrustCertificate={trustCertificate} />;
  if (view === 'connector') return <ConnectorSetupPage
    form={connForm}
    onChange={(patch) => patchConn(patch as Partial<CreateProxmoxConnectorBody> & Partial<CreateSshConnectorBody>)}
    onSelectType={(type) => setConnForm(emptyConnector(type))}
    onSubmit={handleCreateConnector}
    onCancel={() => { setConnForm(emptyConnector('proxmox')); setConnReauthPw(''); setView('overview'); }}
    busy={busy === 'connector'}
    password={connReauthPw}
    onPasswordChange={setConnReauthPw}
  />;

  return (
    <div style={s.page}>
      <div style={s.head}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: 0, fontSize: 20, display: 'flex', alignItems: 'center', gap: 8 }}><Server size={20} /> Deployment Center <HelpTip topic="deploy" /></h1>
          <p style={s.hint}>Wähle eine Komponente, dann ein vorbereitetes Ziel. Nexora erstellt erst einen prüfbaren Plan; echte Änderungen brauchen Vier-Augen-Freigabe.</p>
        </div>
      </div>

      {notice && <div style={{ ...s.hint, marginBottom: 12, color: noticeTone === 'warning' ? 'var(--warning)' : 'var(--success)' }}>{notice}</div>}
      {actionError && <div style={{ marginBottom: 12 }}><ErrorCard message={actionError} /></div>}

      <ol style={{ ...s.wizard, listStyle: 'none', padding: 0 }} aria-label="Deploy-Assistent">
        {['Was bereitstellen?', 'Wohin deployen?', 'Maschine konfigurieren', 'Prüfen & planen'].map((title, index) => {
          const step = (index + 1) as WizardStep;
          const active = wizardStep === step;
          const complete = wizardStep > step;
          return <li key={title} style={{ display: 'flex', alignItems: 'center', gap: 16 }} aria-current={active ? 'step' : undefined}>
            <div style={{ ...s.wizardStep, color: active ? 'var(--accent)' : 'var(--text)', opacity: wizardStep < step ? 0.58 : 1 }}>
              <span style={{ ...s.wizardDot, background: active ? 'var(--accent)' : (complete ? 'var(--success)' : 'var(--bg-card-soft)'), color: active ? 'var(--accent-text)' : (complete ? 'white' : 'var(--text-dim)') }}>{complete ? '✓' : step}</span>
              <span style={{ fontSize: 12, fontWeight: active ? 800 : 650 }}>{title}</span>
            </div>
            {index < 3 && <span aria-hidden="true" style={{ color: 'var(--text-dim)', fontSize: 14 }}>→</span>}
          </li>;
        })}
      </ol>

      <Card style={{ ...s.wizardSurface, display: wizardStep === 1 ? undefined : 'none' }}>
        <CardBody>
          <div style={s.selectionIntro}><h2 style={s.sectionTitle}>Was möchtest du bereitstellen?</h2><p style={s.hint}>Wähle den Typ der Ressource, die du deployen möchtest.</p></div>
          <DeployTypeGrid groups={tileGroups} selectedKey={selectedTile?.productKey ?? ''} onSelect={handleSelectModule} />
          <div style={s.footerActions}><Button variant="ghost" onClick={() => setView('overview')}>Abbrechen</Button><Button variant="primary" disabled={!selectedTile} onClick={() => selectedTile && startModule(selectedTile)}>Weiter zu Schritt 2</Button></div>
        </CardBody>
      </Card>

      <div style={{ display: wizardStep === 1 ? 'none' : 'block' }}>
        {/* Connectors */}
        <Card style={{ ...s.wizardSurface, display: wizardStep === 2 ? undefined : 'none' }}>
          <CardBody>
            <h2 style={s.sectionTitle}>2. Wohin möchtest du deployen?</h2>
            <p style={{ ...s.hint, marginBottom: 20 }}>Wähle das Zielsystem (Connector) aus, auf dem die Ressource erstellt werden soll.</p>
            {vmForm && <>
              <DeployTargetCards
                connectors={connectors.filter((connector) => connector.type === 'proxmox')}
                capacities={connectorCapacities}
                selectedId={vmForm.connectorId}
                onSelect={(connector) => setVmForm({ ...vmForm, connectorId: connector.id })}
              />
              <div style={s.footerActions}>
                <Button variant="ghost" onClick={() => { setVmForm(null); setWizardStep(1); }}>Zurück</Button>
                <Button variant="primary" disabled={!vmForm.connectorId} onClick={() => setWizardStep(3)}>Weiter zu Schritt 3</Button>
              </div>
            </>}
            {agentForm && <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
                {connectors.filter((connector) => connector.type === 'ssh').map((connector) => <button key={connector.id} type="button" onClick={() => setAgentForm({ ...agentForm, connectorId: connector.id })} style={{ ...s.flowStep, textAlign: 'left', cursor: 'pointer', borderColor: connector.id === agentForm.connectorId ? 'var(--accent)' : 'var(--border-soft)' }}>
                  <strong>{connector.name}</strong><div style={{ ...s.hint, marginTop: 5 }}>{connector.host} · {connector.sshUser ?? 'root'}</div>
                </button>)}
              </div>
              <div style={s.footerActions}>
                <Button variant="ghost" onClick={() => { setAgentForm(null); setWizardStep(1); }}>Zurück</Button>
                <Button variant="primary" disabled={!agentForm.connectorId} onClick={() => setWizardStep(3)}>Weiter zu Schritt 3</Button>
              </div>
            </>}
            {!hasCompatibleTarget && <EmptyState
              title={vmForm ? 'Noch kein Proxmox-Ziel' : 'Noch kein SSH-Ziel'}
              message={vmForm
                ? 'Für diese Ressource wird ein Proxmox-Connector benötigt. Verbinde ihn einmalig unten.'
                : 'Für diesen Agenten wird ein SSH-Connector benötigt. Verbinde den Zielhost einmalig unten.'}
            />}

            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Infrastruktur verbinden (einmalig)</summary>
              <p style={{ ...s.hint, marginTop: 8 }}>Diese Zugangsdaten werden einmalig verschluesselt gespeichert. Im normalen Deploy-Flow brauchst du sie nicht erneut einzugeben.</p>
            <form onSubmit={handleCreateConnector} style={{ marginTop: 14 }}>
                <Field label={fieldLabel('Connector-Typ', (
                  <ExampleHint
                    title="Wähle zuerst die Art des Zielsystems"
                    text="Lege fest, ob Nexora auf Proxmox klonen oder einen bestehenden Linux-Host per SSH ansprechen soll."
                    exampleLabel="Typischer Einstieg"
                    rows={[
                      { label: 'Proxmox', value: 'neue VM aus Template klonen' },
                      { label: 'SSH', value: 'bestehenden Linux-Host anbinden' },
                    ]}
                    footer="Wenn du eine neue Firewall oder einen neuen Windows-Server ausrollen willst, startest du fast immer mit Proxmox."
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
                    title="So sollte der Connector heißen"
                    text="Interner Anzeigename für diesen Connector. Nimm etwas, das du im Alltag sofort wiedererkennst, zum Beispiel Standort oder Zweck."
                    exampleLabel="Beispiel"
                    rows={[
                      { label: 'Name', value: 'Proxmox-Lab-Nord' },
                    ]}
                    footer="Gut ist ein Name, den auch jemand anderes morgen sofort versteht."
                  />
                ))}><Input value={connForm.name} onChange={(e) => patchConn({ name: e.target.value })} required /></Field>
                <Field label={fieldLabel('Host (IP/DNS)', (
                  <ExampleHint
                    title="Adresse des Zielsystems"
                    text="Hier kommt die Adresse des Zielsystems hinein, also zum Beispiel der Proxmox-Host oder der Linux-Server."
                    exampleLabel="Beispiel"
                    rows={[
                      { label: 'Proxmox', value: '10.0.10.20' },
                      { label: 'SSH-Host', value: 'srv-wazuh-01.nexora.local' },
                    ]}
                    footer="Nimm immer die Adresse, die von Nexora aus wirklich erreichbar ist, nicht irgendeine alternative Management-IP."
                  />
                ))}><Input value={connForm.host} onChange={(e) => patchConn({ host: e.target.value })} required /></Field>
                {connForm.type === 'proxmox' && (
                  <>
                    <Field label={fieldLabel('Ziel-Node', (
                      <ExampleHint
                        title="Echter Proxmox-Node-Name"
                        text="Der konkrete Proxmox-Node, auf dem geklont oder gestartet werden soll. Das ist der echte Node-Name aus Proxmox."
                        exampleLabel="Beispiel aus Proxmox"
                        rows={[
                          { label: 'Node', value: 'pve' },
                          { label: 'Alternative', value: 'proxmox-02' },
                        ]}
                        footer="Der Wert muss exakt so heißen wie im Proxmox-Cluster, sonst kann Nexora das Klonen nicht sauber zuordnen."
                      />
                    ))}><Input value={connForm.targetNode} onChange={(e) => patchConn({ targetNode: e.target.value })} required /></Field>
                    <Field label={fieldLabel('API-Token', 'Das Proxmox-API-Token für die Verbindung. Es wird nicht offen angezeigt, also hier sorgfältig einfügen.')}><Input mono type="password" value={connForm.apiToken} onChange={(e) => patchConn({ apiToken: e.target.value })} required /></Field>
                  </>
                )}
                {connForm.type === 'ssh' && (
                  <>
                    <Field label={fieldLabel('SSH-User', 'Der Benutzer, mit dem sich Nexora auf dem Zielhost anmeldet. Standard ist oft root, aber nur wenn es bei euch wirklich so gewollt ist.')}><Input value={connForm.sshUser ?? ''} onChange={(e) => patchConn({ sshUser: e.target.value })} /></Field>
                    <Field label={fieldLabel('SSH-Port', 'Der SSH-Port des Zielhosts. Normalerweise 22, nur ändern wenn der Server bewusst einen anderen Port nutzt.')}><Input value={String(connForm.sshPort ?? 22)} onChange={(e) => patchConn({ sshPort: Number(e.target.value) || 22 })} /></Field>
                    <Field label={fieldLabel('Host-Key-Pin (SHA-256)', 'Der gepinnte SSH-Fingerabdruck des Zielhosts. Das schützt davor, versehentlich mit dem falschen Server zu sprechen.')}><Input mono value={connForm.hostKeyPin} onChange={(e) => patchConn({ hostKeyPin: e.target.value })} required /></Field>
                    <Field label={fieldLabel('Passphrase (optional)', 'Nur ausfüllen, wenn der private SSH-Key zusätzlich mit einer Passphrase geschützt ist.')}><Input type="password" value={connForm.passphrase ?? ''} onChange={(e) => patchConn({ passphrase: e.target.value })} /></Field>
                  </>
                )}
              </div>
              {connForm.type === 'ssh' && (
                <Field label={fieldLabel('Private Key (write-only, wird verschlüsselt gespeichert)', 'Hier kommt der private SSH-Schlüssel hinein, mit dem sich Nexora am Zielhost anmeldet. Er wird nur zum Speichern entgegengenommen und nicht wieder offen angezeigt.')}>
                  <textarea
                    value={connForm.privateKey}
                    onChange={(e) => patchConn({ privateKey: e.target.value })}
                    required rows={4}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 10px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', background: 'transparent', color: 'inherit', resize: 'vertical' }}
                  />
                </Field>
              )}
              <Field label={fieldLabel('Passwort-Bestätigung (Reauth zum Anlegen)', 'Sicherheits-Schritt: Damit du wirklich du bist, bevor ein Connector mit Secret-Daten gespeichert wird.')}>
                <Input type="password" value={connReauthPw} onChange={(e) => setConnReauthPw(e.target.value)} placeholder="Aktuelles Passwort" required />
              </Field>
              <div style={s.actions}>
                <Button type="submit" variant="primary" icon={<Plus size={15} />} disabled={busy === 'connector' || !connReauthPw}>
                  {busy === 'connector' ? 'Speichert …' : 'Connector anlegen'}
                </Button>
              </div>
            </form>
            </details>
          </CardBody>
        </Card>

        {/* Deploy-Fluss */}
        <Card style={{ ...s.wizardSurface, display: wizardStep >= 3 ? undefined : 'none' }}>
          <CardBody>
            {!run && !agentForm && !vmForm && (
              <>
                <p style={s.hint}><strong>Starte mit Schritt 1 oben.</strong> Nach der Auswahl zeigen wir nur die Konfiguration fuer diese Komponente – ohne Demo-Werte und ohne technische Nebenformulare.</p>
                {connectors.length === 0 && <p style={s.hint}>Falls noch kein Ziel verbunden ist: „Infrastruktur verbinden“ links oeffnen.</p>}
              </>
            )}

            {!run && vmForm && wizardStep === 3 && (
              <form onSubmit={(event) => { event.preventDefault(); setWizardStep(4); }}>
                <h2 style={s.sectionTitle}>3. Maschine konfigurieren</h2>
                <p style={{ ...s.hint, marginBottom: 16 }}>Konfiguriere die neue Ressource auf dem ausgewählten Ziel.</p>
                <div style={s.summaryStrip}>
                  <div style={s.flowStep}><div style={s.hint}>Zielsystem</div><strong>{connectors.find((connector) => connector.id === vmForm.connectorId)?.name ?? '–'}</strong><div style={s.hint}>Proxmox VE · {connectors.find((connector) => connector.id === vmForm.connectorId)?.targetNode ?? '–'}</div></div>
                  <div style={s.resourceStrip}>
                    <div><div style={s.hint}>Ressource</div><strong>{selectedVmModule?.name ?? 'Maschine'}</strong></div>
                    <div><div style={s.hint}>CPU</div><strong>{connectorCapacities[vmForm.connectorId]?.node.cpu.total ?? '–'} Cores</strong><div style={s.hint}>vor Plan geprüft</div></div>
                    <div><div style={s.hint}>RAM</div><strong>{connectorCapacities[vmForm.connectorId] ? `${Math.round(connectorCapacities[vmForm.connectorId]!.node.memory.totalBytes / 1024 / 1024 / 1024)} GB` : '–'}</strong><div style={s.hint}>Gesamtkapazität</div></div>
                    <div><div style={s.hint}>Storage</div><strong>im Plan prüfen</strong><div style={s.hint}>{isLxc ? 'Container' : 'Virtuelle Maschine'}</div></div>
                  </div>
                </div>
                <div style={s.configGrid}>
                  <Field label={fieldLabel('Hostname', (
                    <ExampleHint
                      title="Rechnername der neuen VM"
                      text="Der Rechnername der neuen Windows-VM. Er sollte zu eurer Namenskonvention passen und später im Betrieb wiedererkennbar sein."
                      exampleLabel="Typischer Servername"
                      rows={[
                        { label: 'Hostname', value: 'WIN-DC-LAB-02' },
                      ]}
                      footer="Vermeide Fantasienamen. Besser Standort, Rolle und laufende Nummer."
                    />
                  ))}><Input aria-label="Hostname" value={vmForm.hostname} onChange={(e) => setVmForm({ ...vmForm, hostname: e.target.value })} required /></Field>
                  {isLxc ? (
                    <Field label={fieldLabel('LXC-Template', 'Wähle ein Rocky- oder anderes Linux-LXC-Template, das bereits in Proxmox vorhanden ist. Nexora lädt keine Images selbst herunter.')}>
                      <select
                        value={vmForm.lxcTemplate}
                        onChange={(e) => setVmForm({ ...vmForm, lxcTemplate: e.target.value })}
                        required
                        style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '8px 10px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', background: 'transparent', color: 'inherit' }}
                      >
                        <option value="">— LXC-Template auswählen —</option>
                        {(connectorCapacities[vmForm.connectorId]?.templates.lxc ?? []).map((template) => <option key={template.volid} value={template.volid}>{template.name}</option>)}
                      </select>
                    </Field>
                  ) : <Field label={fieldLabel('Template-VMID (Golden-Template)', (
                    <ExampleHint
                      title="Von welcher Vorlage geklont wird"
                      text="Die VMID des vorbereiteten Windows-Basis-Templates in Proxmox. Von genau diesem Template wird geklont."
                      exampleLabel="Beispiel"
                      rows={[
                        { label: 'Template-VMID', value: '9000' },
                        { label: 'Beschreibung', value: 'Win2025-Golden-Base' },
                      ]}
                      footer="Die Zahl muss zur vorbereiteten Golden-Template-VM in Proxmox gehören, nicht zu einer laufenden Maschine."
                    />
                  ))}><Input aria-label="Template-VMID (Golden-Template)" value={vmForm.templateVmid} onChange={(e) => setVmForm({ ...vmForm, templateVmid: e.target.value })} required /></Field>}
                </div>
                <Field label={fieldLabel('IP-Modus', 'Lege fest, ob die VM ihre Adresse per DHCP bezieht oder feste Netzwerkdaten bekommt.')}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button type="button" variant={vmForm.ipMode === 'static' ? 'primary' : 'ghost'} onClick={() => setVmForm({ ...vmForm, ipMode: 'static' })}>Statisch</Button>
                    {vmSupportsDhcp && <Button type="button" variant={vmForm.ipMode === 'dhcp' ? 'primary' : 'ghost'} onClick={() => setVmForm({ ...vmForm, ipMode: 'dhcp' })}>DHCP</Button>}
                  </div>
                </Field>
                {vmForm.ipMode === 'static' && (
                  <div style={s.configGrid}>
                    <Field label={fieldLabel('Statische IP', (
                      <ExampleHint
                        title="Feste Adresse für die neue VM"
                        text="Die feste IP-Adresse der neuen VM. Nur ausfüllen, wenn du den statischen Modus gewählt hast."
                        exampleLabel="Beispiel-Netz"
                        rows={[
                          { label: 'IP', value: '10.0.10.25' },
                          { label: 'CIDR', value: '24' },
                        ]}
                        footer="Die IP muss im richtigen VLAN frei sein. Nexora prüft nicht für dich, ob die Adresse schon anderweitig vergeben wurde."
                      />
                    ))}><Input aria-label="Statische IP" value={vmForm.staticIp} onChange={(e) => setVmForm({ ...vmForm, staticIp: e.target.value })} required /></Field>
                    <Field label={fieldLabel('CIDR (0–32)', (
                      <ExampleHint
                        title="Netzgröße der Adresse"
                        text="Das Netzpräfix der Adresse, zum Beispiel 24 für ein /24-Netz."
                        exampleLabel="Beispiel"
                        rows={[
                          { label: 'CIDR', value: '24' },
                          { label: 'Bedeutung', value: '255.255.255.0' },
                        ]}
                        footer="Wenn du hier falsch liegst, ist der Host zwar gebaut, spricht aber oft nicht sauber mit dem Rest des Netzes."
                      />
                    ))}><Input value={vmForm.cidr} onChange={(e) => setVmForm({ ...vmForm, cidr: e.target.value })} required /></Field>
                    <Field label={fieldLabel('Gateway', (
                      <ExampleHint
                        title="Wohin der Server sein Standard-Routing schickt"
                        text="Das Standard-Gateway, über das die VM andere Netze erreicht."
                        exampleLabel="Beispiel"
                        rows={[
                          { label: 'Gateway', value: '10.0.10.1' },
                        ]}
                        footer="Das ist in vielen Umgebungen die Firewall-Adresse des VLANs."
                      />
                    ))}><Input aria-label="Gateway" value={vmForm.gateway} onChange={(e) => setVmForm({ ...vmForm, gateway: e.target.value })} required /></Field>
                    <Field label={fieldLabel('DNS-Server', (
                      <ExampleHint
                        title="Namensauflösung für die neue VM"
                        text="Der DNS-Server, den der neue Windows-Server für Namensauflösung nutzen soll."
                        exampleLabel="Beispiel"
                        rows={[
                          { label: 'DNS', value: '10.0.10.10' },
                        ]}
                        footer="Nimm den internen DNS, wenn die Maschine später interne Namen, AD oder Wazuh erreichen soll."
                      />
                    ))}><Input aria-label="DNS-Server" value={vmForm.dns} onChange={(e) => setVmForm({ ...vmForm, dns: e.target.value })} required /></Field>
                  </div>
                )}
                <Field label={fieldLabel('Wazuh-Manager (optional — First-Boot-Enroll)', 'Optionaler Wazuh-Manager für die erste automatische Agent-Anbindung beim ersten Start der VM.')}><Input value={vmForm.wazuhManager} onChange={(e) => setVmForm({ ...vmForm, wazuhManager: e.target.value })} /></Field>
                <div style={s.footerActions}>
                  <Button type="button" variant="ghost" onClick={() => setWizardStep(2)}>Zurück</Button>
                  <Button type="submit" variant="primary" icon={<CheckCircle2 size={15} />} disabled={!vmForm.connectorId}>
                    Weiter zu Schritt 4
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => { setVmForm(null); setWizardStep(1); }}>Abbrechen</Button>
                </div>
                {connectors.filter((c) => c.type === 'proxmox').length === 0 && <p style={s.hint}>Zuerst einen Proxmox-Connector anlegen.</p>}
              </form>
            )}

            {!run && agentForm && wizardStep === 3 && (
              <form onSubmit={(event) => { event.preventDefault(); setWizardStep(4); }}>
                <h2 style={s.sectionTitle}>3. Maschine konfigurieren</h2>
                <p style={s.hint}>Wazuh-Agent auf einen bestehenden Host (Brownfield). Ziel-Host + gepinnter Host-Key kommen aus dem SSH-Connector.</p>
                <div style={{ ...s.hint, marginBottom: 14 }}>Ziel: <strong>{connectors.find((connector) => connector.id === agentForm.connectorId)?.name ?? '–'}</strong></div>
                {/* Felder kommen aus dem paramSchema des Moduls (EINE Quelle der Wahrheit).
                    Neue Module — Kollektoren, Sensoren — erscheinen damit ohne UI-Aenderung.
                    Ziel-Host/SSH-Benutzer/-Port fehlen bewusst: sie kommen aus dem Connector. */}
                <div style={s.grid2}>
                  {deriveParamFields(modules.find((m) => m.id === agentForm.moduleId)?.paramSchema).map((f) => (
                    <Field key={f.name} label={fieldLabel(
                      f.required ? f.label : `${f.label} (optional)`,
                      PARAM_HINTS[f.name] ?? `Wert fuer ${f.label}.`,
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
                <div style={s.footerActions}>
                  <Button type="button" variant="ghost" onClick={() => setWizardStep(2)}>Zurück</Button>
                  <Button type="submit" variant="primary" icon={<CheckCircle2 size={15} />} disabled={!agentForm.connectorId}>
                    Weiter zu Schritt 4
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => { setAgentForm(null); setWizardStep(1); }}>Abbrechen</Button>
                </div>
                {connectors.filter((c) => c.type === 'ssh').length === 0 && <p style={s.hint}>Zuerst einen SSH-Connector anlegen.</p>}
              </form>
            )}

            {!run && wizardStep === 4 && (vmForm || agentForm) && (
              <>
                <h2 style={s.sectionTitle}>4. Prüfen und planen</h2>
                <p style={{ ...s.hint, marginBottom: 16 }}>Überprüfe die Konfiguration und erstelle den Deployment-Plan. Es wird noch keine Maschine erstellt.</p>
                <div style={s.reviewGrid}>
                  <section style={s.reviewPanel} aria-label="Zusammenfassung">
                    <strong>Zusammenfassung</strong>
                    {[
                      ['Ressource', selectedModule?.name ?? '–'],
                      ['Zielsystem', connectors.find((connector) => connector.id === (vmForm?.connectorId ?? agentForm?.connectorId))?.name ?? '–'],
                      ['Name / Hostname', vmForm?.hostname || agentForm?.values.agentName || '–'],
                      ['Ressourcen', vmForm ? 'gemäß Konfiguration' : 'Bestehender Host'],
                      ['IP-Konfiguration', vmForm ? (vmForm.ipMode === 'dhcp' ? 'DHCP' : `${vmForm.staticIp || '–'}/${vmForm.cidr || '–'}`) : 'Über SSH-Connector'],
                      ['Optionen', vmForm?.wazuhManager ? 'Wazuh-Erstregistrierung' : 'Keine zusätzlichen Optionen'],
                    ].map(([label, value]) => <div key={label} style={s.reviewRow}><CheckCircle2 size={15} color="var(--accent)" /><span style={s.hint}>{label}</span><span>{value}</span></div>)}
                  </section>
                  <div>
                    <section style={s.reviewPanel} aria-label="Validierung">
                      <strong>Validierung</strong>
                      {[
                        ['Zielsystem ausgewählt', Boolean(vmForm?.connectorId ?? agentForm?.connectorId), 'für Plan vorgemerkt'],
                        ['Template-Angabe vollständig', Boolean(!vmForm || (isLxc ? vmForm.lxcTemplate : vmForm.templateVmid)), vmForm && isLxc ? 'LXC-Template angegeben' : 'Golden-VMID angegeben'],
                        ['Netzwerkangaben vollständig', Boolean(!vmForm || vmForm.ipMode === 'dhcp' || (vmForm.staticIp && vmForm.gateway && vmForm.dns)), vmForm?.ipMode === 'dhcp' ? 'DHCP gewählt' : 'Statische Angaben vollständig'],
                        ['Kapazität und Ziel prüfen', false, 'wird beim Plan geprüft'],
                      ].map(([label, passed, detail]) => <div key={String(label)} style={s.reviewRow}><CheckCircle2 size={15} color={passed ? 'var(--success)' : 'var(--warning)'} /><strong>{label}</strong><span style={{ color: passed ? 'var(--success)' : 'var(--warning)' }}>{detail}</span></div>)}
                    </section>
                    <section style={{ ...s.reviewPanel, marginTop: 12 }} aria-label="Ablauf nach Planerstellung">
                      <strong>Ablauf nach Planerstellung</strong>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, marginTop: 14, textAlign: 'center' }}>
                        {['Plan erstellen', 'Genehmigung', 'Admin bestätigt', 'Nexora sendet Auftrag', 'Proxmox erstellt Ressource'].map((label, index) => <div key={label}><FileText size={15} color={index === 0 ? 'var(--accent)' : 'var(--text-dim)'} /><div style={{ ...s.hint, marginTop: 4 }}>{label}</div></div>)}
                      </div>
                    </section>
                  </div>
                </div>
                <div style={s.footerActions}>
                  <Button variant="ghost" onClick={() => setWizardStep(3)}>Zurück</Button>
                  {vmForm && <form onSubmit={handlePlanVmClone}><Button type="submit" variant="primary" icon={<PlayCircle size={15} />} disabled={busy === 'plan'}>{busy === 'plan' ? 'Plant …' : 'Plan erstellen'}</Button></form>}
                  {agentForm && <form onSubmit={handlePlanAgentInstall}><Button type="submit" variant="primary" icon={<PlayCircle size={15} />} disabled={busy === 'plan'}>{busy === 'plan' ? 'Plant …' : 'Plan erstellen'}</Button></form>}
                </div>
              </>
            )}

            {run && (
              <>
                {spec && <div style={{ ...s.hint, marginBottom: 8 }}><strong>Spec:</strong> {summarizeParams(spec.params)}</div>}
                <div style={{ ...s.hint, marginBottom: 8 }}><strong>Vorbedingungen:</strong> {preconditionsSummary(preconditions)}</div>
                <div style={{ ...s.hint, ...s.mono, marginBottom: 8 }}>Run {run.id.slice(0, 8)} · von {run.startedBy}{run.approvedBy ? ` · genehmigt: ${run.approvedBy}` : ''}{run.vmid ? ` · VMID ${run.vmid}` : ''}</div>
                {run.failureReason && <ErrorCard message={run.failureReason} />}

                {steps.length > 0 && (
                  <div style={{ margin: '10px 0' }}>
                    <div style={{ ...s.hint, marginBottom: 4 }}><strong>Schritte</strong></div>
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
                      {busy === 'approve' ? 'Genehmigt …' : 'Genehmigen (Vier-Augen)'}
                    </Button>
                  </div>
                )}

                {canApply && (
                  <div style={{ marginTop: 12 }}>
                    <Field label={fieldLabel('Passwort-Bestätigung (Reauth für Apply)', 'Letzter Sicherheits-Schritt vor einer echten schreibenden Aktion. Ohne diese Bestätigung wird nichts angewendet.')}>
                      <Input type="password" value={reauthPw} onChange={(e) => setReauthPw(e.target.value)} placeholder="Aktuelles Passwort" />
                    </Field>
                    <div style={s.actions}>
                      <Button variant="danger" onClick={handleApply} disabled={!reauthPw || busy === 'apply'} icon={<Server size={15} />}>
                        {busy === 'apply' ? 'Wendet an …' : 'Apply — VM deployen'}
                      </Button>
                    </div>
                    <p style={s.hint}>Apply schlägt fehl, solange der Operator <code>DEPLOY_ENABLED</code> nicht scharf gestellt hat — das ist beabsichtigt.</p>
                  </div>
                )}

                <div style={s.actions}>
                  <Button variant="ghost" onClick={() => { setRun(null); setSpec(null); setPreconditions(null); setSteps([]); setWizardStep(1); }}>Neuen Deploy starten</Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Verwaltete Nodes: Deploy-Keypair + gated Updates deployter Windows-Server (Slice 7). */}
      {isAdmin && (
        <div style={{ marginTop: 12 }}>
          <ManagedNodesPanel />
        </div>
      )}
    </div>
  );
}
